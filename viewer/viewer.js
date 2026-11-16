// Trang điều khiển: chạy trong trình duyệt của máy điều khiển, được host phục vụ trực tiếp.
const $ = (id) => document.getElementById(id);
const icon = (name) => (window.ICONS && ICONS[name]) || '';
const video = $('screen');
const VIEWER_IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const QUALITY_LABEL = { high: 'Cao', medium: 'Vừa', low: 'Thấp' };

let ws = null;
let pc = null;
let active = false;
let pendingIce = [];
let statsTimer = null;
let lastBytes = 0;
let lastStatsAt = 0;
const state = { swap: false, clip: true, clipAvailable: true, input: true };

document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
$('target').textContent = location.host;

// ---------------- Kết nối ----------------
$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  connect($('pw').value.replace(/\s+/g, ''));
});

function connect(password) {
  $('login-error').textContent = '';
  $('connect-btn').disabled = true;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => send({ type: 'auth', password });
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = (ev) => {
    const reasons = {
      4001: 'Hết thời gian xác thực.',
      4002: 'Có người khác vừa kết nối thay bạn.',
      4003: 'Host đã ngắt kết nối.',
      4004: 'Host chỉ nhận kết nối qua Tailscale — hãy mở bằng địa chỉ 100.x.x.x',
    };
    teardown(reasons[ev.code] || (active ? 'Mất kết nối tới host.' : null));
  };
  ws.onerror = () => { if (!active) $('login-error').textContent = 'Không kết nối được tới host.'; };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function onMessage(msg) {
  switch (msg.type) {
    case 'auth-ok':
      active = true;
      $('login').hidden = true;
      $('remote').hidden = false;
      $('waiting').hidden = false;
      $('host-name').textContent = msg.host;
      $('handle-name').textContent = msg.host;
      document.title = `${msg.host} — Remote`;
      // Điều khiển máy khác hệ điều hành thì mặc định đổi Ctrl ⇄ Cmd
      state.swap = VIEWER_IS_MAC !== (msg.platform === 'darwin');
      state.clip = true;
      $('quality-select').value = 'high';
      $('quality-label').textContent = QUALITY_LABEL.high;
      fillDisplays(msg.displays, msg.display);
      applyHostSettings({ input: msg.inputAvailable, clipboard: msg.clipboard });
      setHostLocked(!!msg.locked, false);
      showTouchControls(true);
      showDock(true, 2500); // hiện thanh công cụ lúc đầu để người dùng biết nó ở đâu
      break;
    case 'auth-fail':
      $('login-error').textContent = msg.reason || 'Xác thực thất bại.';
      break;
    case 'offer':
      await onOffer(msg.sdp);
      break;
    case 'ice':
      if (!pc || !msg.candidate) return;
      if (pc.remoteDescription) pc.addIceCandidate(msg.candidate).catch(() => {});
      else pendingIce.push(msg.candidate);
      break;
    case 'display':
      $('display-select').value = msg.id;
      break;
    case 'host-settings':
      applyHostSettings(msg);
      break;
    case 'error':
      toast(msg.message, 'triangle-alert', 6000);
      break;
    case 'clipboard':
      receiveClipboard(msg.text);
      break;
    case 'host-lock':
      setHostLocked(!!msg.locked, true);
      break;
  }
}

function setHostLocked(locked, announce) {
  $('lock-badge').hidden = !locked;
  if (announce) toast(locked ? 'Máy host vừa khoá màn hình' : 'Máy host đã mở khoá', locked ? 'lock' : 'circle-check', 3000);
}

function applyHostSettings({ input, clipboard }) {
  const wasInput = state.input;
  state.input = !!input;
  state.clipAvailable = !!clipboard;
  if (!state.input) releaseAllKeys();
  if (active) showTouchControls(true);
  if (!state.input && (wasInput || !active)) toast('Host đang ở chế độ chỉ xem — không điều khiển được', 'info', 4000);
  else if (state.input && !wasInput) toast('Host đã bật lại điều khiển', 'mouse-pointer-2', 2500);
  renderTiles();
}

async function onOffer(sdp) {
  if (pc) pc.close();
  pc = new RTCPeerConnection({ iceServers: [] });
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0] || new MediaStream([e.track]);
    video.play().catch(() => {});
  };
  pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (pc && pc.connectionState === 'failed') toast('Kết nối video thất bại — kiểm tra 2 máy có thấy nhau qua Tailscale', 'triangle-alert', 8000);
  };
  await pc.setRemoteDescription(sdp);
  for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
  pendingIce = [];
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  send({ type: 'answer', sdp: pc.localDescription.toJSON() });
  startStats();
}

function teardown(reason) {
  releaseAllKeys();
  active = false;
  if (pc) { pc.close(); pc = null; }
  pendingIce = [];
  clearInterval(statsTimer);
  video.srcObject = null;
  $('lock-badge').hidden = true;
  showTouchControls(false);
  $('remote').hidden = true;
  $('login').hidden = false;
  $('connect-btn').disabled = false;
  if (reason) $('login-error').textContent = reason;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

video.addEventListener('loadeddata', () => { $('waiting').hidden = true; });

// ---------------- Thanh công cụ ----------------
let dockTimer = null;
let dockPinned = false;
function showDock(show, autoHideMs) {
  clearTimeout(dockTimer);
  $('dock').classList.toggle('shown', show);
  $('handle').hidden = show;
  if (show && autoHideMs) dockTimer = setTimeout(() => { if (!dockPinned) showDock(false); }, autoHideMs);
}
$('hot').addEventListener('mouseenter', () => showDock(true));
$('handle').addEventListener('mouseenter', () => showDock(true));
$('handle').addEventListener('click', () => showDock(true));
$('dock').addEventListener('mouseenter', () => { dockPinned = true; clearTimeout(dockTimer); });
$('dock').addEventListener('mouseleave', () => { dockPinned = false; dockTimer = setTimeout(() => showDock(false), 500); });

function renderTiles() {
  $('tile-swap').classList.toggle('on', state.swap);
  $('tile-clip').classList.toggle('on', state.clip && state.clipAvailable);
  $('tile-clip').hidden = !state.clipAvailable;
  $('tile-full').classList.toggle('on', !!document.fullscreenElement);
  $('tile-full').querySelector('.icon').outerHTML = icon(document.fullscreenElement ? 'minimize' : 'maximize');
}

function fillDisplays(displays, current) {
  const sel = $('display-select');
  sel.innerHTML = '';
  for (const d of displays) {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = `${d.label}${d.primary ? ' (chính)' : ''} · ${d.width}×${d.height}`;
    sel.appendChild(o);
  }
  sel.value = current;
  $('tile-display').hidden = displays.length < 2;
}

$('display-select').onchange = (e) => { send({ type: 'select-display', id: e.target.value }); e.target.blur(); };
$('quality-select').onchange = (e) => {
  send({ type: 'quality', level: e.target.value });
  $('quality-label').textContent = QUALITY_LABEL[e.target.value];
  e.target.blur();
};
$('tile-swap').onclick = (e) => {
  releaseAllKeys();
  state.swap = !state.swap;
  renderTiles();
  toast(state.swap ? 'Ctrl ⇄ Cmd: đang đổi phím' : 'Ctrl ⇄ Cmd: giữ nguyên phím', 'command', 1800);
  e.currentTarget.blur();
};
$('tile-clip').onclick = (e) => {
  state.clip = !state.clip;
  renderTiles();
  toast(state.clip ? 'Đã bật đồng bộ clipboard' : 'Đã tắt đồng bộ clipboard', 'clipboard', 1800);
  e.currentTarget.blur();
};
$('tile-full').onclick = (e) => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('remote').requestFullscreen().catch(() => {});
  e.currentTarget.blur();
};
$('tile-quit').onclick = () => ws && ws.close();
document.addEventListener('fullscreenchange', renderTiles);

function toast(text, iconName = 'info', ms = 5000) {
  const t = $('toast');
  t.innerHTML = `${icon(iconName)}<span></span>`;
  t.querySelector('span').textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function startStats() {
  clearInterval(statsTimer);
  lastBytes = 0;
  lastStatsAt = 0;
  statsTimer = setInterval(async () => {
    if (!pc) return;
    const report = await pc.getStats();
    let fps = 0, bytes = 0, w = 0, h = 0, rtt = null;
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        fps = s.framesPerSecond || 0; bytes = s.bytesReceived; w = s.frameWidth; h = s.frameHeight;
      }
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime != null) {
        rtt = Math.round(s.currentRoundTripTime * 1000);
      }
    });
    const now = performance.now();
    const mbps = lastStatsAt ? ((bytes - lastBytes) * 8) / ((now - lastStatsAt) * 1000) : 0;
    lastBytes = bytes; lastStatsAt = now;
    $('stats').textContent = `${w}×${h} · ${Math.round(fps)} fps · ${mbps.toFixed(1)} Mbps${rtt != null ? ` · ${rtt} ms` : ''}`;
  }, 1000);
}


// ---------------- Chuột ----------------
const buttonsDown = new Set();
let pendingMove = null;
let wheel = { dx: 0, dy: 0 };
let rafId = 0;

function sendInput(e) { send({ type: 'input', e }); }

// Đổi toạ độ chuột trên trang -> toạ độ chuẩn hoá 0..1 trên màn hình host (tính cả viền đen object-fit)
function norm(ev, clamp) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const r = video.getBoundingClientRect();
  const scale = Math.min(r.width / vw, r.height / vh);
  const dw = vw * scale, dh = vh * scale;
  let x = (ev.clientX - (r.left + (r.width - dw) / 2)) / dw;
  let y = (ev.clientY - (r.top + (r.height - dh) / 2)) / dh;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    if (!clamp) return null;
    x = Math.min(Math.max(x, 0), 1);
    y = Math.min(Math.max(y, 0), 1);
  }
  return { x, y };
}

function flush() {
  rafId = 0;
  if (pendingMove) { sendInput({ t: 'mm', x: pendingMove.x, y: pendingMove.y }); pendingMove = null; }
  if (wheel.dx || wheel.dy) { sendInput({ t: 'wh', dx: wheel.dx, dy: wheel.dy }); wheel = { dx: 0, dy: 0 }; }
}
function schedule() { if (!rafId) rafId = requestAnimationFrame(flush); }

video.addEventListener('mousedown', (e) => {
  if (!active) return;
  flushPendingCopy(); // có thao tác người dùng -> thử ghi clipboard còn treo
  if (e.button > 2) return;
  e.preventDefault();
  video.focus();
  const p = norm(e, false);
  if (!p) return;
  pendingMove = null;
  buttonsDown.add(e.button);
  sendInput({ t: 'md', b: e.button, x: p.x, y: p.y, n: e.detail });
});

window.addEventListener('mouseup', (e) => {
  if (!active || !buttonsDown.has(e.button)) return;
  buttonsDown.delete(e.button);
  const p = norm(e, true);
  pendingMove = null;
  sendInput({ t: 'mu', b: e.button, ...(p || {}) });
});

window.addEventListener('mousemove', (e) => {
  if (!active) return;
  if (buttonsDown.size === 0 && e.target !== video) return; // chuột đang ở trên thanh công cụ
  const p = norm(e, buttonsDown.size > 0); // đang kéo thì vẫn theo dõi khi ra ngoài khung hình
  if (!p) return;
  pendingMove = p;
  schedule();
});

video.addEventListener('wheel', (e) => {
  if (!active) return;
  e.preventDefault();
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  wheel.dx += e.deltaX * k;
  wheel.dy += e.deltaY * k;
  schedule();
}, { passive: false });

video.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------- Bàn phím ----------------
const pressed = new Map(); // code gốc -> code đã gửi (sau khi đổi Ctrl/Cmd)
const SWAP = { ControlLeft: 'MetaLeft', ControlRight: 'MetaRight', MetaLeft: 'ControlLeft', MetaRight: 'ControlRight' };
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

function mapCode(code) { return state.swap && SWAP[code] ? SWAP[code] : code; }
function isFormField(t) { return t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); }

function tap(code) {
  sendInput({ t: 'kd', code });
  sendInput({ t: 'ku', code });
}

window.addEventListener('keydown', (e) => {
  if (!active || isFormField(e.target)) return;
  flushPendingCopy();
  if (isPasteShortcut(e)) {
    // KHÔNG preventDefault: để trình duyệt bắn sự kiện 'paste' (cách duy nhất đọc clipboard qua http).
    // Phím V được giữ lại tới khi clipboard đã gửi sang host, rồi mới gửi để host dán đúng nội dung.
    const code = mapCode(e.code);
    pressed.set(e.code, code);
    pasteWait = { code, timer: setTimeout(finishPaste, 300) };
    return;
  }
  e.preventDefault();
  if (e.code === 'CapsLock') { tap('CapsLock'); return; }
  const code = pressed.get(e.code) || mapCode(e.code);
  pressed.set(e.code, code);
  sendInput({ t: 'kd', code });
});

window.addEventListener('keyup', (e) => {
  if (!active || isFormField(e.target)) return;
  e.preventDefault();
  // macOS: keydown khi bật CapsLock, keyup khi tắt -> mỗi sự kiện là 1 lần bấm
  if (e.code === 'CapsLock') { if (VIEWER_IS_MAC) tap('CapsLock'); return; }
  if (pasteWait && e.code === 'KeyV') finishPaste(); // đảm bảo kd luôn tới trước ku
  const code = pressed.get(e.code) || mapCode(e.code);
  pressed.delete(e.code);
  sendInput({ t: 'ku', code });
  // Chrome trên macOS không bắn keyup cho các phím được bấm trong lúc giữ Cmd -> tự nhả
  if (VIEWER_IS_MAC && (e.code === 'MetaLeft' || e.code === 'MetaRight')) {
    for (const [orig, sent] of [...pressed]) {
      if (!MODIFIERS.has(orig)) { pressed.delete(orig); sendInput({ t: 'ku', code: sent }); }
    }
  }
});

function releaseAllKeys() {
  if (pasteWait) { clearTimeout(pasteWait.timer); pasteWait = null; }
  for (const sent of pressed.values()) sendInput({ t: 'ku', code: sent });
  pressed.clear();
  for (const b of buttonsDown) sendInput({ t: 'mu', b });
  buttonsDown.clear();
}

// Chuyển sang tab/cửa sổ khác thì nhả hết phím để tránh kẹt phím trên host
window.addEventListener('blur', releaseAllKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllKeys(); });

// ---------------- Cảm ứng (điện thoại / máy tính bảng) ----------------
//  Chạm = click trái · chạm 2 lần = double-click · giữ ~0.6s = click phải
//  1 ngón kéo = kéo-thả chuột trái · 2 ngón kéo = cuộn
const TOUCH_SLOP = 10;        // px: di chuyển ít hơn vẫn tính là chạm
const LONG_PRESS_MS = 600;
const DOUBLE_TAP_MS = 350;
let touch = null;             // { mode: 'pending'|'drag'|'scroll'|'done', x0, y0, timer, mid }
let lastTap = { at: 0, x: 0, y: 0 };

function touchPoint(t) { return norm(t, true); }
function midpoint(ts) { return { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 }; }
// px trên màn hình điện thoại -> px trên màn hình host
function hostScale() {
  const r = video.getBoundingClientRect();
  if (!video.videoWidth || !r.width) return 1;
  return 1 / Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
}

function endTouch() {
  if (!touch) return;
  clearTimeout(touch.timer);
  if (touch.mode === 'drag') {
    flush();
    buttonsDown.delete(0);
    sendInput({ t: 'mu', b: 0 });
  }
  touch = null;
}

video.addEventListener('touchstart', (e) => {
  if (!active) return;
  e.preventDefault(); // chặn chuột giả lập + phóng to của trình duyệt
  flushPendingCopy();
  if ($('dock').classList.contains('shown') && !dockPinned) showDock(false);
  if (!state.input) return;
  if (e.touches.length >= 2) {
    // ngón thứ 2 đặt xuống -> chuyển sang cuộn
    endTouch();
    touch = { mode: 'scroll', mid: midpoint(e.touches) };
    return;
  }
  const t = e.touches[0];
  touch = { mode: 'pending', x0: t.clientX, y0: t.clientY };
  touch.timer = setTimeout(() => {
    // giữ yên -> click phải
    if (!touch || touch.mode !== 'pending') return;
    const p = touchPoint(t);
    if (p) { sendInput({ t: 'md', b: 2, x: p.x, y: p.y, n: 1 }); sendInput({ t: 'mu', b: 2, x: p.x, y: p.y }); }
    if (navigator.vibrate) navigator.vibrate(15);
    touch.mode = 'done';
  }, LONG_PRESS_MS);
}, { passive: false });

video.addEventListener('touchmove', (e) => {
  if (!active || !touch) return;
  e.preventDefault();
  if (touch.mode === 'scroll' && e.touches.length >= 2) {
    const m = midpoint(e.touches);
    const k = hostScale();
    // ngón đi lên = nội dung cuộn xuống (giống cuộn trên điện thoại)
    wheel.dx += (touch.mid.x - m.x) * k;
    wheel.dy += (touch.mid.y - m.y) * k;
    touch.mid = m;
    schedule();
    return;
  }
  const t = e.touches[0];
  if (touch.mode === 'pending') {
    if (Math.hypot(t.clientX - touch.x0, t.clientY - touch.y0) < TOUCH_SLOP) return;
    clearTimeout(touch.timer);
    const p0 = touchPoint({ clientX: touch.x0, clientY: touch.y0 });
    if (!p0) { touch.mode = 'done'; return; }
    touch.mode = 'drag';
    buttonsDown.add(0);
    sendInput({ t: 'md', b: 0, x: p0.x, y: p0.y, n: 1 });
  }
  if (touch.mode === 'drag') {
    const p = touchPoint(t);
    if (p) { pendingMove = p; schedule(); }
  }
}, { passive: false });

video.addEventListener('touchend', (e) => {
  if (!active || !touch) return;
  e.preventDefault();
  if (touch.mode === 'scroll') {
    if (e.touches.length === 0) touch = null;
    return;
  }
  if (touch.mode === 'pending') {
    clearTimeout(touch.timer);
    const p = touchPoint({ clientX: touch.x0, clientY: touch.y0 });
    if (p) {
      const now = performance.now();
      const dbl = now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(touch.x0 - lastTap.x, touch.y0 - lastTap.y) < 30;
      sendInput({ t: 'md', b: 0, x: p.x, y: p.y, n: dbl ? 2 : 1 });
      sendInput({ t: 'mu', b: 0, x: p.x, y: p.y });
      lastTap = dbl ? { at: 0, x: 0, y: 0 } : { at: now, x: touch.x0, y: touch.y0 };
    }
    touch = null;
    return;
  }
  endTouch();
}, { passive: false });

video.addEventListener('touchcancel', endTouch);

// ---------------- Bàn phím ảo (điện thoại) ----------------
// Bàn phím ảo không cho mã phím tin cậy (Android luôn báo 229/"Unidentified"),
// nên đọc chữ từ 1 ô nhập ẩn rồi đổi từng ký tự thành phím (theo bố cục US).
// Ký tự ngoài ASCII (tiếng Việt có dấu…) gửi nguyên chuỗi cho host gõ theo Unicode.
const kbd = $('kbd');
const KBD_SENTINEL = '    '; // giữ sẵn chữ để phím xoá luôn bắn sự kiện
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const SHIFTED = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
const PUNCT_CODE = { '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote', ' ': 'Space' };
// Bàn phím iOS hay tự đổi sang dấu "cong" -> đổi lại dấu thẳng
const SMART = { '‘': "'", '’': "'", '“': '"', '”': '"', ' ': ' ' };

// Ký tự -> { code, shift } trên bàn phím US; null nếu không có phím tương ứng
function charToKey(ch) {
  if (/^[a-z]$/.test(ch)) return { code: `Key${ch.toUpperCase()}`, shift: false };
  if (/^[A-Z]$/.test(ch)) return { code: `Key${ch}`, shift: true };
  if (/^[0-9]$/.test(ch)) return { code: `Digit${ch}`, shift: false };
  if (ch === '\n') return { code: 'Enter', shift: false };
  if (ch === '\t') return { code: 'Tab', shift: false };
  if (PUNCT_CODE[ch]) return { code: PUNCT_CODE[ch], shift: false };
  const base = SHIFTED[ch];
  if (base) return { code: /^[0-9]$/.test(base) ? `Digit${base}` : PUNCT_CODE[base], shift: true };
  return null;
}

function typeText(text) {
  if (!active || !state.input || !text) return;
  let uni = '';
  const flushUni = () => { if (uni) { sendInput({ t: 'tx', s: uni }); uni = ''; } };
  for (const raw of text.normalize('NFC')) {
    const ch = SMART[raw] || raw;
    const k = charToKey(ch);
    if (!k) { uni += ch; if (uni.length >= 100) flushUni(); continue; }
    flushUni();
    if (k.shift) sendInput({ t: 'kd', code: 'ShiftLeft' });
    tap(k.code);
    if (k.shift) sendInput({ t: 'ku', code: 'ShiftLeft' });
  }
  flushUni();
}

function resetKbd() {
  kbd.value = KBD_SENTINEL;
  try { kbd.setSelectionRange(KBD_SENTINEL.length, KBD_SENTINEL.length); } catch { /* bỏ qua */ }
}

// Phím đặc biệt: iOS có báo e.key đúng -> gửi luôn; Android báo "Unidentified" -> để sự kiện input xử lý
const SPECIAL_KEYS = new Set(['Backspace', 'Enter', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
kbd.addEventListener('keydown', (e) => {
  if (!active || e.isComposing || !SPECIAL_KEYS.has(e.key)) return;
  e.preventDefault();
  if (state.input) tap(e.key); // tên các phím này trùng với KeyboardEvent.code
});

kbd.addEventListener('input', (e) => {
  if (e.isComposing) return; // đang gõ bộ gõ (Telex, tiếng Nhật…) -> đợi compositionend
  const type = e.inputType || '';
  if (state.input && active) {
    if (type === 'insertLineBreak' || type === 'insertParagraph') tap('Enter');
    else if (type.startsWith('delete')) {
      const n = Math.max(1, KBD_SENTINEL.length - kbd.value.length);
      for (let i = 0; i < Math.min(n, 50); i++) tap(type.includes('Forward') ? 'Delete' : 'Backspace');
    } else if (e.data) typeText(e.data);
    else if (type === 'insertFromPaste' || !type) typeText(kbd.value.replace(/^ +/, ''));
  }
  resetKbd();
});

kbd.addEventListener('compositionend', (e) => {
  if (e.data) typeText(e.data);
  resetKbd();
});

function setKbd(open) {
  if (open) { resetKbd(); kbd.focus(); } else kbd.blur();
}
kbd.addEventListener('focus', () => { $('kbd-bar').hidden = false; $('kbd-btn').hidden = true; placeKbdBar(); });
kbd.addEventListener('blur', () => { $('kbd-bar').hidden = true; $('kbd-btn').hidden = !(IS_TOUCH && active); });
$('kbd-btn').addEventListener('click', () => setKbd(true)); // focus phải nằm ngay trong thao tác chạm thì iOS mới bật bàn phím

// Thanh phím phụ: giữ focus ở ô nhập (không để bàn phím ảo đóng lại)
$('kbd-bar').addEventListener('mousedown', (e) => e.preventDefault());
$('kbd-bar').addEventListener('touchstart', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault();
  if (b.id === 'kbd-close') { setKbd(false); return; }
  if (active && state.input) tap(b.dataset.key);
}, { passive: false });
$('kbd-bar').addEventListener('click', (e) => {
  // chuột/bút (không phải chạm)
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'kbd-close') setKbd(false);
  else if (active && state.input) tap(b.dataset.key);
});

// Đặt thanh phím phụ ngay trên bàn phím ảo
function placeKbdBar() {
  const vv = window.visualViewport;
  if (!vv) return;
  $('kbd-bar').style.bottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`;
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', placeKbdBar);
  visualViewport.addEventListener('scroll', placeKbdBar);
}

function showTouchControls(show) {
  $('kbd-btn').hidden = !(show && IS_TOUCH && state.input);
  if (!show) { $('kbd-bar').hidden = true; if (document.activeElement === kbd) kbd.blur(); }
}

// ---------------- Clipboard (chữ) ----------------
// Trang chạy qua http:// (không phải secure context) nên không có navigator.clipboard.
//  - Viewer -> host: đọc qua sự kiện 'paste' khi người dùng bấm Ctrl/Cmd+V.
//  - Host -> viewer: ghi bằng execCommand('copy'), chỉ được phép ngay sau thao tác người dùng,
//    nếu chưa được thì giữ lại và thử lại ở lần bấm phím/chuột kế tiếp.
const CLIPBOARD_MAX = 1024 * 1024;
let pasteWait = null;   // { code, timer } phím V đang chờ clipboard
let pendingCopy = null; // text từ host chưa ghi được vào clipboard máy này
let copyText = null;    // text đang ghi trong execCommand('copy')

function clipOn() { return active && state.clip && state.clipAvailable; }

function isPasteShortcut(e) {
  return clipOn() && e.code === 'KeyV' && !e.repeat && !e.altKey
    && (VIEWER_IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
}

function finishPaste() {
  if (!pasteWait) return;
  clearTimeout(pasteWait.timer);
  const { code } = pasteWait;
  pasteWait = null;
  sendInput({ t: 'kd', code });
}

document.addEventListener('paste', (e) => {
  if (!active || isFormField(e.target)) return;
  e.preventDefault();
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (clipOn() && text) {
    if (text.length > CLIPBOARD_MAX) toast('Clipboard quá lớn (>1MB), không gửi được.', 'triangle-alert');
    else send({ type: 'clipboard', text });
  }
  finishPaste();
});

document.addEventListener('copy', (e) => {
  if (copyText == null) return;
  e.clipboardData.setData('text/plain', copyText);
  e.preventDefault();
});

function writeLocalClipboard(text) {
  if (window.isSecureContext && navigator.clipboard) {
    return navigator.clipboard.writeText(text).then(() => true, () => execCopy(text));
  }
  return Promise.resolve(execCopy(text));
}

function execCopy(text) {
  copyText = text;
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  copyText = null;
  return ok;
}

function receiveClipboard(text) {
  if (!clipOn() || typeof text !== 'string') return;
  pendingCopy = text;
  flushPendingCopy();
}

function flushPendingCopy() {
  if (pendingCopy == null) return;
  const text = pendingCopy;
  writeLocalClipboard(text).then((ok) => {
    if (!ok || pendingCopy !== text) return;
    pendingCopy = null;
    toast(`Đã copy từ host · ${text.length} ký tự`, 'clipboard', 1600);
  });
}
