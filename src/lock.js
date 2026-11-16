// Màn hình khoá: phát hiện khoá/mở khoá, đánh thức màn hình, và chế độ thử nghiệm --lock-test.
//  - macOS / Windows: sự kiện powerMonitor 'lock-screen' / 'unlock-screen'.
//  - Linux: powerMonitor không có sự kiện này -> hỏi systemd-logind (LockedHint) định kỳ.
const { app, powerMonitor, desktopCapturer, screen, systemPreferences } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PLATFORM = process.platform;
const LINUX_POLL_MS = 3000;
const WAKE_MIN_INTERVAL_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// ---------------- Trạng thái khoá ----------------
function idleSaysLocked() {
  try { return powerMonitor.getSystemIdleState(1) === 'locked'; } catch { return false; }
}

async function linuxLocked() {
  const id = process.env.XDG_SESSION_ID || 'auto';
  const hint = await run('loginctl', ['show-session', id, '-p', 'LockedHint', '--value']);
  if (hint === 'yes') return true;
  if (hint === 'no') return false;
  return idleSaysLocked(); // không có logind -> dựa vào XScreenSaver của Chromium
}

async function queryLocked() {
  return PLATFORM === 'linux' ? linuxLocked() : idleSaysLocked();
}

/**
 * Theo dõi trạng thái khoá màn hình. Gọi sau app.whenReady().
 * @param {(locked: boolean) => void} onChange
 */
function watch(onChange) {
  let locked = false;
  const set = (v) => {
    if (v === locked) return;
    locked = v;
    onChange(v);
  };
  queryLocked().then((v) => { locked = v; });

  if (PLATFORM === 'linux') {
    let busy = false;
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try { set(await linuxLocked()); } finally { busy = false; }
    }, LINUX_POLL_MS).unref();
  } else {
    powerMonitor.on('lock-screen', () => set(true));
    powerMonitor.on('unlock-screen', () => set(false));
  }
  return { isLocked: () => locked };
}

// ---------------- Đánh thức màn hình ----------------
// Màn hình đã tắt thì capture chỉ ra khung đen -> bật lại trước khi chụp/điều khiển.
// Windows: SetThreadExecutionState(ES_DISPLAY_REQUIRED) qua PowerShell (mã hoá base64 để khỏi lo escape).
const WIN_WAKE = Buffer.from(
  "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';"
  + ' [W.P]::SetThreadExecutionState(2) | Out-Null',
  'utf16le',
).toString('base64');

let lastWake = 0;
function wakeDisplay() {
  if (Date.now() - lastWake < WAKE_MIN_INTERVAL_MS) return;
  lastWake = Date.now();
  if (PLATFORM === 'darwin') run('caffeinate', ['-u', '-t', '2']);
  else if (PLATFORM === 'linux') run('xset', ['dpms', 'force', 'on']);
  else if (PLATFORM === 'win32') run('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', WIN_WAKE], 10000);
}

// ---------------- Chế độ thử nghiệm: --lock-test[=giây] ----------------
// Chờ đến khi máy thật sự khoá (+ thêm N giây), rồi chụp màn hình -> gõ thử "abc" -> chụp lại -> xoá chữ đã gõ.
// Kết quả (ảnh + report.json) lưu vào thư mục dữ liệu của app, mở ra khi người dùng mở khoá.
function lockTestDelay(argv) {
  const arg = argv.find((a) => a === '--lock-test' || a.startsWith('--lock-test='));
  if (!arg) return null;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : 10; // số giây chờ SAU khi phát hiện máy đã khoá
}

function imageStats(img) {
  const { width, height } = img.getSize();
  const buf = img.toBitmap(); // BGRA
  let sum = 0;
  let lit = 0;
  let n = 0;
  for (let i = 0; i + 3 < buf.length; i += 4 * 16) { // lấy mẫu 1/16 điểm ảnh
    const l = 0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2];
    sum += l;
    if (l > 16) lit++;
    n++;
  }
  return { width, height, meanLuma: n ? +(sum / n).toFixed(1) : 0, litRatio: n ? +(lit / n).toFixed(3) : 0, buf };
}

function diffRatio(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let diff = 0;
  let n = 0;
  for (let i = 0; i + 3 < a.length; i += 4 * 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
    n++;
  }
  return n ? +(diff / n).toFixed(5) : null;
}

async function shot(dir, name) {
  const d = screen.getPrimaryDisplay();
  const scale = Math.min(1, 1920 / (d.size.width * d.scaleFactor));
  const size = {
    width: Math.round(d.size.width * d.scaleFactor * scale),
    height: Math.round(d.size.height * d.scaleFactor * scale),
  };
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
    if (!src) return { name, error: 'không có nguồn màn hình' };
    const file = path.join(dir, `${name}.png`);
    fs.writeFileSync(file, src.thumbnail.toPNG());
    const { buf, ...stats } = imageStats(src.thumbnail);
    return { name, file, ...stats, empty: src.thumbnail.isEmpty(), buf };
  } catch (e) {
    return { name, error: e.message };
  }
}

async function runLockTest(argv, input, shell) {
  const delay = lockTestDelay(argv);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(app.getPath('userData'), `lock-test-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const note = (...a) => console.log('[lock-test]', ...a);

  const report = {
    platform: PLATFORM,
    osRelease: os.release(),
    arch: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    execPath: process.execPath,
    session: PLATFORM === 'linux' ? (process.env.XDG_SESSION_TYPE || null) : undefined,
    permissions: PLATFORM === 'darwin' ? {
      screen: systemPreferences.getMediaAccessStatus('screen'),
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    } : undefined,
    inputLoadError: input.loadError()?.message || null,
    delaySec: delay,
    events: [],
  };
  const ev = (what) => { report.events.push({ t: Date.now(), what }); note(what); };
  let eventLocked = false;
  powerMonitor.on('lock-screen', () => { eventLocked = true; ev('powerMonitor: lock-screen'); });
  powerMonitor.on('unlock-screen', () => { eventLocked = false; ev('powerMonitor: unlock-screen'); });
  const isLocked = async () => eventLocked || queryLocked();

  // An toàn: chỉ gõ phím khi máy ĐANG khoá, tránh gõ "abc" vào cửa sổ người dùng đang làm việc.
  report.lockedBefore = await isLocked();
  note(`Đang chờ khoá màn hình (tối đa 15 phút). Khoá xong ${delay}s sẽ chụp + gõ thử "abc". Kết quả: ${dir}`);
  for (let i = 0; i < 900 && !(await isLocked()); i++) await sleep(1000);
  if (!(await isLocked())) {
    report.aborted = 'Hết 15 phút mà máy không khoá — không chạy test';
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    note(report.aborted);
    app.quit();
    return;
  }
  ev('phát hiện đã khoá');
  await sleep(delay * 1000);

  report.lockedDuring = await isLocked();
  ev(`trạng thái khoá khi test: ${report.lockedDuring}`);
  if (!report.lockedDuring) {
    report.aborted = 'Máy đã mở khoá trước khi test — không gõ phím';
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    note(report.aborted);
    app.quit();
    return;
  }
  lastWake = 0;
  wakeDisplay();
  await sleep(2000);

  const before = await shot(dir, '1-truoc-khi-go');
  ev('đã chụp ảnh 1');
  for (const code of ['KeyA', 'KeyB', 'KeyC']) {
    input.handle({ t: 'kd', code }, () => ({ x: 0, y: 0 }));
    input.handle({ t: 'ku', code }, () => ({ x: 0, y: 0 }));
    await sleep(150);
  }
  ev('đã gõ "abc"');
  await sleep(1500);
  const after = await shot(dir, '2-sau-khi-go');
  ev('đã chụp ảnh 2');
  for (let i = 0; i < 3; i++) {
    input.handle({ t: 'kd', code: 'Backspace' }, () => ({ x: 0, y: 0 }));
    input.handle({ t: 'ku', code: 'Backspace' }, () => ({ x: 0, y: 0 }));
    await sleep(100);
  }
  ev('đã xoá 3 ký tự');
  input.releaseAll();

  report.shots = [before, after].map(({ buf, ...s }) => s);
  report.diffRatio = diffRatio(before.buf, after.buf); // > 0: hình có thay đổi sau khi gõ (thường là dấu chấm mật khẩu)
  const reportFile = path.join(dir, 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  note(`Xong. Báo cáo: ${reportFile}`);

  // Đợi người dùng mở khoá (tối đa 10 phút) rồi mở thư mục kết quả
  for (let i = 0; i < 300 && await isLocked(); i++) await sleep(2000);
  shell.showItemInFolder(reportFile);
  await sleep(1000);
  app.quit();
}

module.exports = { watch, wakeDisplay, queryLocked, lockTestDelay, runLockTest };
