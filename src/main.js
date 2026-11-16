const {
  app, BrowserWindow, ipcMain, desktopCapturer, screen,
  systemPreferences, powerSaveBlocker, shell, clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const input = require('./input');
const lock = require('./lock');

const LOCK_TEST = lock.lockTestDelay(process.argv) !== null;

// Lỗi không bắt được: ghi vào file log thay vì để Electron hiện hộp thoại chặn luồng chính
// (host bị treo vì 1 hộp thoại thì người điều khiển từ xa không thể bấm tắt).
function logCrash(kind, err) {
  const line = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : err}\n`;
  console.error(line);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), line); } catch {}
}
process.on('uncaughtException', (e) => logCrash('uncaughtException', e));
process.on('unhandledRejection', (e) => logCrash('unhandledRejection', e));

// Mặc định Chromium giấu IP LAN trong ICE candidate bằng tên mDNS (*.local).
// Qua Tailscale không có multicast nên mDNS không phân giải được -> tắt để dùng IP thật.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const PLATFORM = process.platform;
const PORT = Number(process.env.RC_PORT) || 8787;
const BIND = process.env.RC_BIND || '0.0.0.0';
const ROOT = path.join(__dirname, '..');
const PKG = require('../package.json');
const MAX_FAILS = 5;            // sai mật khẩu 5 lần ...
const BLOCK_MS = 5 * 60 * 1000; // ... thì chặn IP đó 5 phút
const CLIPBOARD_MAX = 1024 * 1024; // tối đa 1MB text mỗi lần đồng bộ
const CLIPBOARD_POLL_MS = 400;
const ACTIVITY_MAX = 100;

const DEFAULT_SETTINGS = {
  allowInput: true,                               // cho phép điều khiển chuột/phím (tắt = chỉ xem)
  clipboard: process.env.RC_CLIPBOARD !== '0',    // đồng bộ clipboard
  keepAwake: true,                                // giữ màn hình sáng khi đang có phiên
  tailscaleOnly: true,                            // chỉ nhận kết nối từ mạng Tailscale
};

let win = null;
let settings = { ...DEFAULT_SETTINGS };
let password = process.env.RC_PASSWORD || genPassword();
let active = null;       // { ws, ip, send, since } của viewer đang điều khiển
let currentDisplayId = null;
let sleepBlocker = null;
let clipTimer = null;
let lastClip = '';       // nội dung clipboard host đã biết, tránh gửi lặp/vọng lại
let isAdmin = null;      // Windows: app có đang chạy quyền Administrator không
let lockState = { isLocked: () => false }; // gán thật trong app.whenReady
const failures = new Map(); // ip -> { count, until }
const activity = [];        // nhật ký kết nối
const blockedLogAt = new Map(); // ip -> lần cuối ghi log "bị chặn" (tránh spam)

// ---------------- Tiện ích ----------------
function genPassword() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function checkPassword(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isTailscaleIp(ip) {
  if (/^fd7a:115c:a1e0:/i.test(ip)) return true; // IPv6 của Tailscale
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;       // 100.64.0.0/10
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1';
}

function ipAllowed(ip) {
  return !settings.tailscaleOnly || isTailscaleIp(ip) || isLoopback(ip);
}

function cleanIp(raw) {
  return String(raw || '').replace(/^::ffff:/, '');
}

function listAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, address: a.address, tailscale: isTailscaleIp(a.address) });
    }
  }
  return out.sort((x, y) => Number(y.tailscale) - Number(x.tailscale));
}

function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label || `Màn hình ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId,
  }));
}

function currentDisplay() {
  return screen.getAllDisplays().find((d) => String(d.id) === currentDisplayId)
    || screen.getPrimaryDisplay();
}

// Toạ độ chuẩn hoá (0..1) trên màn hình đang chia sẻ -> toạ độ hệ điều hành
function toScreen(nx, ny) {
  const { bounds } = currentDisplay();
  const cx = Math.min(Math.max(Number(nx) || 0, 0), 0.9999);
  const cy = Math.min(Math.max(Number(ny) || 0, 0), 0.9999);
  let p = { x: bounds.x + cx * bounds.width, y: bounds.y + cy * bounds.height };
  // Windows: libnut dùng pixel vật lý, Electron dùng DIP
  if (PLATFORM === 'win32') p = screen.dipToScreenPoint(p);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function sendToUi(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sessionInfo() {
  return active ? { connected: true, peer: active.ip, since: active.since } : { connected: false };
}

function pushStatus() {
  sendToUi('status', sessionInfo());
}

function log(kind, ip, text) {
  const entry = { t: Date.now(), kind, ip, text };
  activity.unshift(entry);
  activity.length = Math.min(activity.length, ACTIVITY_MAX);
  console.log(`[${kind}] ${ip || ''} ${text}`);
  sendToUi('activity', entry);
}

// ---------------- Cài đặt (lưu trong thư mục dữ liệu của app) ----------------
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof saved[k] === 'boolean') settings[k] = saved[k];
    }
  } catch { /* chưa có file -> dùng mặc định */ }
  if (process.env.RC_CLIPBOARD === '0') settings.clipboard = false;
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[settings] không lưu được:', e.message);
  }
}

function applySettings(prev) {
  if (!active) return;
  if (prev.allowInput && !settings.allowInput) input.releaseAll();
  if (settings.clipboard !== prev.clipboard) {
    if (settings.clipboard) startClipboardWatch(active.send);
    else stopClipboardWatch();
  }
  if (settings.keepAwake !== prev.keepAwake) {
    if (settings.keepAwake) startKeepAwake(); else stopKeepAwake();
  }
  if (settings.tailscaleOnly && !ipAllowed(active.ip)) {
    kick('Đã ngắt vì bật chế độ "Chỉ Tailscale"');
    return;
  }
  active.send({ type: 'host-settings', input: canControl(), clipboard: settings.clipboard });
}

function canControl() {
  return settings.allowInput && input.available();
}

// ---------------- Kiểm tra môi trường theo hệ điều hành ----------------
function permissions() {
  if (PLATFORM !== 'darwin') return { screen: true, accessibility: true };
  return {
    screen: systemPreferences.getMediaAccessStatus('screen') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
}

function diagnostics() {
  const checks = [];
  const hasTailscale = listAddresses().some((a) => a.tailscale);
  checks.push({
    id: 'tailscale', ok: hasTailscale, label: 'Tailscale',
    detail: hasTailscale ? 'Máy này đã có địa chỉ Tailscale' : 'Chưa thấy địa chỉ 100.x — bật Tailscale trên máy này',
  });

  if (PLATFORM === 'darwin') {
    const p = permissions();
    checks.push({ id: 'screen', ok: p.screen, label: 'Ghi màn hình', detail: p.screen ? 'Đã cấp' : 'Chưa cấp — không gửi được hình', action: 'mac-screen' });
    checks.push({ id: 'accessibility', ok: p.accessibility, label: 'Trợ năng', detail: p.accessibility ? 'Đã cấp' : 'Chưa cấp — không điều khiển được chuột/phím', action: 'mac-accessibility' });
  }

  if (PLATFORM === 'linux') {
    const session = process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : 'không rõ');
    const x11 = session === 'x11';
    checks.push({
      id: 'session', ok: x11, label: 'Phiên đồ hoạ',
      detail: x11 ? 'Xorg (x11) — OK' : `Đang dùng ${session} — cần đăng nhập bằng "Ubuntu on Xorg"`,
    });
  }

  if (PLATFORM === 'win32' && isAdmin !== null) {
    checks.push({
      id: 'admin', ok: isAdmin, warn: !isAdmin, label: 'Quyền Administrator',
      detail: isAdmin ? 'Đang chạy quyền Admin — điều khiển được mọi cửa sổ' : 'Quyền thường — không điều khiển được cửa sổ chạy quyền Admin (không bắt buộc)',
    });
  }

  const err = input.loadError();
  checks.push({
    id: 'input', ok: !err, label: 'Module điều khiển chuột/phím',
    detail: err
      ? (PLATFORM === 'linux' ? `Không nạp được (${err.message.split('\n')[0]}) — cài: sudo apt install libxtst6 libpng16-16t64` : `Không nạp được: ${err.message.split('\n')[0]}`)
      : 'Đã nạp',
  });
  return checks;
}

function detectAdmin() {
  if (PLATFORM !== 'win32') return;
  execFile('net', ['session'], { windowsHide: true }, (err) => { isAdmin = !err; });
}

// Mở trang cài đặt hệ thống tương ứng (danh sách cố định, không nhận lệnh tuỳ ý từ renderer)
const OPENERS = {
  darwin: {
    'mac-screen': () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'),
    'mac-accessibility': () => {
      systemPreferences.isTrustedAccessibilityClient(true);
      return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    },
    'mac-firewall': () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Firewall'),
    'mac-energy': () => shell.openExternal('x-apple.systempreferences:com.apple.Battery-Settings.extension'),
  },
  win32: {
    'win-firewall': () => spawn('control', ['/name', 'Microsoft.WindowsFirewall', '/page', 'pageConfigureApps'], { detached: true, windowsHide: true }),
    'win-power': () => shell.openExternal('ms-settings:powersleep'),
    'win-uac': () => spawn('UserAccountControlSettings.exe', [], { detached: true }),
  },
  linux: {
    'linux-power': () => spawn('gnome-control-center', ['power'], { detached: true, stdio: 'ignore' }),
  },
};

// ---------------- HTTP: phục vụ trang viewer + tài nguyên dùng chung ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  const [dir, sub] = rel.startsWith('/shared/') ? ['shared', rel.slice('/shared/'.length)] : ['viewer', rel.slice(1)];
  const base = path.join(ROOT, dir);
  const file = path.normalize(path.join(base, sub));
  if (!file.startsWith(base + path.sep) || !MIME[path.extname(file)]) return null; // chặn ../
  return file;
}

const server = http.createServer((req, res) => {
  const ip = cleanIp(req.socket.remoteAddress);
  if (!ipAllowed(ip)) {
    noteBlocked(ip);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Máy này chỉ nhận kết nối qua Tailscale. Hãy mở bằng địa chỉ 100.x.x.x');
    return;
  }
  let file = null;
  try { file = req.method === 'GET' && resolveStatic(new URL(req.url, 'http://x').pathname); } catch {}
  if (!file) { res.writeHead(404).end('Not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

function noteBlocked(ip) {
  const last = blockedLogAt.get(ip) || 0;
  if (Date.now() - last < 60_000) return;
  blockedLogAt.set(ip, Date.now());
  log('blocked', ip, 'Bị chặn: không đến từ mạng Tailscale');
}

// ---------------- WebSocket: xác thực + signaling + input ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const ip = cleanIp(req.socket.remoteAddress);
  if (!ipAllowed(ip)) { noteBlocked(ip); ws.close(4004, 'tailscale only'); return; }

  let authed = false;
  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const authTimer = setTimeout(() => !authed && ws.close(4001, 'auth timeout'), 15_000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!authed) {
      if (msg.type !== 'auth') return;
      const f = failures.get(ip);
      if (f && f.until > Date.now()) {
        send({ type: 'auth-fail', reason: 'Bị khoá tạm thời do nhập sai nhiều lần, thử lại sau 5 phút.' });
        ws.close();
        return;
      }
      if (!checkPassword(msg.password)) {
        const count = (f?.count || 0) + 1;
        const locked = count >= MAX_FAILS;
        failures.set(ip, { count, until: locked ? Date.now() + BLOCK_MS : 0 });
        log('fail', ip, locked ? `Sai mật khẩu ${count} lần — khoá 5 phút` : `Sai mật khẩu (lần ${count})`);
        send({ type: 'auth-fail', reason: 'Sai mật khẩu.' });
        ws.close();
        return;
      }
      failures.delete(ip);
      authed = true;
      clearTimeout(authTimer);
      startSession(ws, ip, send);
      return;
    }

    if (active?.ws !== ws) return;
    switch (msg.type) {
      case 'answer':
      case 'ice':
        sendToUi('signal', msg);
        break;
      case 'input':
        if (!settings.allowInput) break;
        if (lockState.isLocked()) lock.wakeDisplay(); // tự giới hạn tần suất
        try { input.handle(msg.e, toScreen); } catch (e) { console.error('[input]', e.message); }
        break;
      case 'select-display':
        if (listDisplays().some((d) => d.id === msg.id)) {
          currentDisplayId = msg.id;
          input.releaseAll();
          sendToUi('switch-display', currentDisplayId);
          send({ type: 'display', id: currentDisplayId });
        }
        break;
      case 'quality':
        sendToUi('quality', msg.level);
        break;
      case 'clipboard':
        // viewer dán (paste) -> ghi vào clipboard host trước khi phím Ctrl/Cmd+V tới
        if (settings.clipboard && typeof msg.text === 'string' && msg.text.length <= CLIPBOARD_MAX) {
          lastClip = msg.text;
          clipboard.writeText(msg.text);
        }
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimer);
    if (active?.ws === ws) endSession('Đã ngắt kết nối');
  });
});

function startSession(ws, ip, send) {
  if (active) {
    // Chỉ cho 1 người điều khiển cùng lúc: người mới thay thế người cũ
    const old = active;
    endSession('Bị thay bởi kết nối mới');
    try { old.ws.close(4002, 'replaced'); } catch {}
  }
  active = { ws, ip, send, since: Date.now() };
  currentDisplayId = String(screen.getPrimaryDisplay().id);
  if (settings.keepAwake) startKeepAwake();
  lock.wakeDisplay();
  log('connect', ip, 'Bắt đầu điều khiển');
  send({
    type: 'auth-ok',
    host: os.hostname(),
    platform: PLATFORM,
    displays: listDisplays(),
    display: currentDisplayId,
    inputAvailable: canControl(),
    clipboard: settings.clipboard,
    locked: lockState.isLocked(),
  });
  sendToUi('session-start', currentDisplayId);
  pushStatus();
  if (settings.clipboard) startClipboardWatch(send);
}

function endSession(reason) {
  if (!active) return;
  const { ip, since } = active;
  active = null;
  stopClipboardWatch();
  stopKeepAwake();
  input.releaseAll();
  const mins = Math.max(1, Math.round((Date.now() - since) / 60000));
  log('disconnect', ip, `${reason || 'Kết thúc'} · ${mins} phút`);
  sendToUi('session-end');
  pushStatus();
}

function kick(reason) {
  if (!active) return;
  const { ws } = active;
  endSession(reason);
  try { ws.close(4003, 'kicked'); } catch {}
}

function startKeepAwake() {
  if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
}

function stopKeepAwake() {
  if (sleepBlocker !== null) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = null; }
}

// Host copy -> đẩy sang viewer. Không gửi nội dung có sẵn lúc vừa kết nối, chỉ gửi khi thay đổi.
// Electron 45+: clipboard.readText() trả về Promise (bản cũ trả về string) -> luôn await.
async function readClipboard() {
  try { return String((await clipboard.readText()) ?? ''); } catch { return ''; }
}

async function startClipboardWatch(send) {
  stopClipboardWatch();
  lastClip = await readClipboard();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const text = await readClipboard();
      if (clipTimer !== timer || text === lastClip) return;
      lastClip = text;
      if (text && text.length <= CLIPBOARD_MAX) send({ type: 'clipboard', text });
    } finally {
      busy = false;
    }
  }, CLIPBOARD_POLL_MS);
  clipTimer = timer;
}

function stopClipboardWatch() {
  clearInterval(clipTimer);
  clipTimer = null;
}

// ---------------- IPC với cửa sổ host ----------------
ipcMain.handle('get-info', () => ({
  version: app.getVersion(),
  port: PORT,
  password,
  hostname: os.hostname(),
  platform: PLATFORM,
  addresses: listAddresses(),
  displays: listDisplays().length,
  settings,
  checks: diagnostics(),
  session: sessionInfo(),
  electronPath: process.execPath,
  projectDir: ROOT,
}));

ipcMain.handle('get-activity', () => activity);

ipcMain.handle('new-password', () => {
  password = genPassword();
  return password;
});

ipcMain.handle('kick', () => kick('Host đã ngắt'));

ipcMain.handle('set-setting', (_e, key, value) => {
  if (!(key in DEFAULT_SETTINGS) || typeof value !== 'boolean') return settings;
  const prev = { ...settings };
  settings[key] = value;
  saveSettings();
  applySettings(prev);
  return settings;
});

ipcMain.handle('open-settings', (_e, kind) => {
  const fn = OPENERS[PLATFORM]?.[kind];
  if (fn) { try { fn(); } catch (e) { console.error('[open-settings]', e.message); } }
});

ipcMain.handle('open-releases', () => shell.openExternal(PKG.remoteComputer.releasesUrl));
ipcMain.handle('open-guide', () => shell.openExternal(PKG.remoteComputer.guideUrl));

ipcMain.handle('get-source', async (_e, displayId) => {
  let sources;
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  } catch (e) {
    if (PLATFORM === 'darwin' && !permissions().screen) {
      throw new Error('Chưa cấp quyền Ghi màn hình (System Settings → Privacy & Security → Screen Recording), cấp xong cần mở lại app.');
    }
    throw e;
  }
  const src = sources.find((s) => s.display_id === displayId) || sources[0];
  if (!src) throw new Error('Không tìm thấy màn hình để chia sẻ (kiểm tra quyền Screen Recording).');
  const d = screen.getAllDisplays().find((x) => String(x.id) === displayId) || screen.getPrimaryDisplay();
  return {
    id: src.id,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  };
});

ipcMain.on('signal', (_e, msg) => {
  if (active) active.send(msg);
});

// ---------------- App ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 800,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#1E1E27',
    title: 'Remote Computer',
    icon: path.join(ROOT, 'build', 'icon.png'),
    // macOS: ẩn thanh tiêu đề, giữ nút đèn giao thông. Windows: thanh tiêu đề cùng màu nền.
    ...(PLATFORM === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    ...(PLATFORM === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#1E1E27', symbolColor: '#E7E9EE', height: 36 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // vẫn stream khi cửa sổ bị thu nhỏ
    },
  });
  win.loadFile(path.join(__dirname, 'host.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  loadSettings();
  detectAdmin();
  // Chạy dev (npm start) trên macOS: Dock hiện icon Electron mặc định -> thay bằng logo app
  if (PLATFORM === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(ROOT, 'build', 'icon.png'));

  if (PLATFORM === 'darwin') {
    // Gọi 1 lần để macOS đưa app vào danh sách quyền (Screen Recording / Accessibility)
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
    if (!systemPreferences.isTrustedAccessibilityClient(false)) systemPreferences.isTrustedAccessibilityClient(true);
  }

  // Chế độ thử nghiệm màn hình khoá: không mở server/cửa sổ, chạy xong tự thoát
  if (LOCK_TEST) {
    lock.runLockTest(process.argv, input, shell).catch((e) => { logCrash('lock-test', e); app.quit(); });
    return;
  }

  lockState = lock.watch((locked) => {
    if (!active) return;
    log(locked ? 'lock' : 'unlock', active.ip, locked ? 'Máy này đã khoá màn hình' : 'Máy này đã mở khoá');
    if (locked) lock.wakeDisplay();
    input.releaseAll(); // tránh kẹt phím khi chuyển qua/lại màn hình khoá
    active.send({ type: 'host-lock', locked });
  });

  server.on('error', (e) => {
    console.error(`[http] không mở được cổng ${PORT}:`, e.message);
    sendToUi('server-error', e.code === 'EADDRINUSE' ? `Cổng ${PORT} đang bị chiếm (app đang mở ở cửa sổ khác?)` : e.message);
  });
  server.listen(PORT, BIND, () => {
    console.log(`[http] viewer: http://<ip-may-nay>:${PORT}  (bind ${BIND})`);
    console.log(`[auth] mật khẩu: ${password}`);
  });

  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (!LOCK_TEST) app.quit(); });
