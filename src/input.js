// Inject mouse/keyboard events vào hệ điều hành của máy host bằng libnut (native, N-API).
// Nạp thẳng file .node để bỏ qua wrapper xin quyền của nut.js (main.js tự xử lý quyền).
const path = require('path');

let nut = null;
let loadError = null;
try {
  const pkg = `@nut-tree-fork/libnut-${process.platform}`;
  const pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
  nut = require(path.join(pkgDir, 'build', 'Release', 'libnut.node'));
  nut.setMouseDelay(0);
  nut.setKeyboardDelay(0);
} catch (e) {
  loadError = e;
}

const IS_MAC = process.platform === 'darwin';

// macOS: phím thường gửi bằng mã phím vật lý (xem mackeys.js) — libnut làm sập app khi host đang ở kiểu gõ tiếng Việt
let mac = null;
if (IS_MAC) {
  try { mac = require('./mackeys'); } catch (e) { console.error('[input] mackeys', e.message); }
}

// KeyboardEvent.code (trình duyệt) -> tên phím của libnut
const CODE_MAP = {
  Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Tab: 'tab', Escape: 'escape',
  Backspace: 'backspace', Delete: 'delete', Insert: 'insert',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  ShiftLeft: 'shift', ShiftRight: 'right_shift',
  ControlLeft: 'control', ControlRight: 'right_control',
  AltLeft: 'alt', AltRight: 'right_alt',
  MetaLeft: 'meta', MetaRight: 'right_meta', OSLeft: 'meta', OSRight: 'right_meta',
  CapsLock: 'caps_lock', NumLock: 'num_lock', ScrollLock: 'scroll_lock',
  PrintScreen: 'printscreen', ContextMenu: 'menu',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/',
  NumpadDecimal: 'numpad_decimal', NumpadEqual: 'numpad_equal',
  NumpadAdd: 'add', NumpadSubtract: 'subtract', NumpadMultiply: 'multiply', NumpadDivide: 'divide',
  AudioVolumeMute: 'audio_mute', AudioVolumeDown: 'audio_vol_down', AudioVolumeUp: 'audio_vol_up',
  MediaPlayPause: 'audio_play', MediaTrackNext: 'audio_next', MediaTrackPrevious: 'audio_prev',
};

function codeToKey(code) {
  if (typeof code !== 'string') return null;
  if (CODE_MAP[code]) return CODE_MAP[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].toLowerCase();
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  if ((m = /^Numpad([0-9])$/.exec(code))) return `numpad_${m[1]}`;
  if ((m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code))) return `f${m[1]}`;
  return null;
}

// Phím bổ trợ -> cờ modifier của libnut
const MODIFIER_FLAG = {
  shift: 'shift', right_shift: 'shift',
  control: 'control', right_control: 'control',
  alt: 'alt', right_alt: 'alt',
  meta: 'meta', right_meta: 'meta',
};

const BUTTONS = ['left', 'middle', 'right'];

// Ký tự -> phím trên bàn phím US (để gõ bằng phím thật khi cần, vd. ô mật khẩu màn hình khoá macOS)
const SHIFTED = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
const PUNCT_CODE = { '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote', ' ': 'Space' };
function charToKey(ch) {
  if (/^[a-z]$/.test(ch)) return { code: `Key${ch.toUpperCase()}`, shift: false };
  if (/^[A-Z]$/.test(ch)) return { code: `Key${ch}`, shift: true };
  if (/^[0-9]$/.test(ch)) return { code: `Digit${ch}`, shift: false };
  if (PUNCT_CODE[ch]) return { code: PUNCT_CODE[ch], shift: false };
  const base = SHIFTED[ch];
  if (base) return { code: /^[0-9]$/.test(base) ? `Digit${base}` : PUNCT_CODE[base], shift: true };
  return null;
}

let isLocked = () => false;

const heldKeys = new Set();     // KeyboardEvent.code của các phím đang giữ
const heldButtons = new Set();  // nút chuột đang giữ
const swallowUp = new Set();    // nút cần bỏ qua mouseup (sau khi đã giả lập double-click trên macOS)

function modifierFlags() {
  const flags = new Set();
  for (const c of heldKeys) { const k = codeToKey(c); if (MODIFIER_FLAG[k]) flags.add(MODIFIER_FLAG[k]); }
  return [...flags];
}

// Cờ modifier gắn kèm sự kiện phím.
// macOS: KHÔNG gắn cờ nào. Hệ thống tự theo dõi Shift/Ctrl/Alt/Cmd từ chính các sự kiện
// Shift↓/Shift↑ đã gửi. Nếu vừa gửi Shift↓ vừa gắn cờ 'shift' vào phím chữ thì Shift↑
// không xoá được cờ nữa -> Shift kẹt, mọi chữ gõ sau (kể cả bàn phím thật của máy host) đều in hoa.
function keyFlags() {
  return IS_MAC ? [] : modifierFlags();
}

// macOS: phím bổ trợ cần vài ms mới cập nhật vào trạng thái hệ thống; phím gửi sát ngay sau
// (chữ từ bàn phím ảo tới dồn cục: Shift↓ B Shift↑ c…) sẽ lấy nhầm trạng thái cũ -> chờ chút.
// Đã thử: 0 ms thì Shift vẫn kẹt, 8 ms thì đúng.
const MODIFIER_SETTLE_MS = 8;
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function settleModifier(code) {
  if (IS_MAC && MODIFIER_FLAG[codeToKey(code)]) Atomics.wait(sleepBuf, 0, 0, MODIFIER_SETTLE_MS);
}

function safe(fn) {
  try { fn(); } catch (e) { /* phím không hỗ trợ trên OS này -> bỏ qua */ }
}

// Nhấn/nhả 1 phím theo KeyboardEvent.code
function keyToggle(code, down) {
  if (mac && mac.key(code, down)) return;
  const key = codeToKey(code);
  if (!key) return;
  // macOS: KHÔNG để libnut tự tra phím chữ/số/dấu (sập app khi host đang gõ tiếng Việt), chỉ phím có mã cố định
  if (IS_MAC && key.length === 1) return;
  safe(() => nut.keyToggle(key, down ? 'down' : 'up', keyFlags()));
}

// macOS: gõ chữ từ bàn phím ảo (đã ghép dấu sẵn trên điện thoại)
function typeTextMac(s) {
  // Màn hình khoá: gõ bằng phím thật như trước (đã kiểm chứng với ô mật khẩu).
  // Host đang bật bộ gõ (Telex…): gõ thẳng ký tự, né bộ gõ để không bị ghép dấu lần nữa.
  // Còn lại: chữ ASCII gõ bằng phím thật (giống người gõ nhất), chữ có dấu/emoji gõ theo Unicode.
  const locked = isLocked();
  const bypass = !locked && mac.inputMethodActive();
  for (const ch of s) {
    const k = bypass ? null : charToKey(ch);
    if (!k) { mac.typeChar(ch, bypass); continue; }
    if (k.shift) mac.key('ShiftLeft', true);
    mac.key(k.code, true);
    mac.key(k.code, false);
    if (k.shift) mac.key('ShiftLeft', false);
  }
}

function move(x, y) {
  // macOS: khi đang giữ chuột phải gửi sự kiện "dragged", nếu không kéo-thả sẽ không hoạt động
  if (IS_MAC && heldButtons.size > 0) nut.dragMouse(x, y);
  else nut.moveMouse(x, y);
}

/**
 * Xử lý 1 sự kiện input từ viewer.
 * @param {object} msg  sự kiện (đã parse JSON)
 * @param {(nx:number, ny:number)=>{x:number,y:number}} toScreen  đổi toạ độ chuẩn hoá 0..1 -> toạ độ màn hình
 */
function handle(msg, toScreen) {
  if (!nut) return;
  switch (msg.t) {
    case 'mm': {
      const p = toScreen(msg.x, msg.y);
      move(p.x, p.y);
      break;
    }
    case 'md': {
      const btn = BUTTONS[msg.b];
      if (!btn) return;
      const p = toScreen(msg.x, msg.y);
      move(p.x, p.y);
      if (IS_MAC && msg.n === 2) {
        // mouseToggle của libnut không gắn click-count, macOS sẽ không nhận double-click.
        // mouseClick(btn, true) gửi down/up với clickState = 2.
        nut.mouseClick(btn, true);
        swallowUp.add(btn);
      } else {
        nut.mouseToggle('down', btn);
        heldButtons.add(btn);
      }
      break;
    }
    case 'mu': {
      const btn = BUTTONS[msg.b];
      if (!btn) return;
      if (swallowUp.delete(btn)) return;
      if (msg.x != null && msg.y != null) {
        const p = toScreen(msg.x, msg.y);
        move(p.x, p.y);
      }
      nut.mouseToggle('up', btn);
      heldButtons.delete(btn);
      break;
    }
    case 'wh': {
      const dx = Math.max(-2000, Math.min(2000, Math.round(Number(msg.dx) || 0)));
      const dy = Math.max(-2000, Math.min(2000, Math.round(Number(msg.dy) || 0)));
      // trình duyệt: deltaY > 0 = cuộn xuống; libnut: y > 0 = cuộn lên
      if (dx || dy) nut.scrollMouse(dx, -dy);
      break;
    }
    case 'kd': {
      if (typeof msg.code !== 'string') return;
      heldKeys.add(msg.code);
      keyToggle(msg.code, true);
      settleModifier(msg.code);
      break;
    }
    case 'ku': {
      if (typeof msg.code !== 'string') return;
      heldKeys.delete(msg.code);
      keyToggle(msg.code, false);
      settleModifier(msg.code);
      break;
    }
    case 'tx': {
      // Chữ từ bàn phím ảo điện thoại (đã ghép dấu sẵn): gõ thẳng
      if (typeof msg.s !== 'string' || !msg.s || msg.s.length > 200) return;
      safe(() => (mac ? typeTextMac(msg.s) : nut.typeString(msg.s)));
      break;
    }
  }
}

// Nhả mọi phím/nút đang giữ (khi viewer mất kết nối) để không bị "kẹt phím"
function releaseAll() {
  if (!nut) return;
  for (const code of [...heldKeys]) {
    heldKeys.delete(code);
    keyToggle(code, false);
  }
  for (const btn of [...heldButtons]) {
    heldButtons.delete(btn);
    safe(() => nut.mouseToggle('up', btn));
  }
  swallowUp.clear();
}

module.exports = {
  handle, releaseAll, available: () => !!nut, loadError: () => loadError,
  setLockedProvider: (fn) => { isLocked = fn; },
};
