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

const heldKeys = new Set();     // tên phím libnut đang giữ
const heldButtons = new Set();  // nút chuột đang giữ
const swallowUp = new Set();    // nút cần bỏ qua mouseup (sau khi đã giả lập double-click trên macOS)

function modifierFlags() {
  const flags = new Set();
  for (const k of heldKeys) if (MODIFIER_FLAG[k]) flags.add(MODIFIER_FLAG[k]);
  return [...flags];
}

function safe(fn) {
  try { fn(); } catch (e) { /* phím không hỗ trợ trên OS này -> bỏ qua */ }
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
      const key = codeToKey(msg.code);
      if (!key) return;
      heldKeys.add(key);
      safe(() => nut.keyToggle(key, 'down', modifierFlags()));
      break;
    }
    case 'ku': {
      const key = codeToKey(msg.code);
      if (!key) return;
      heldKeys.delete(key);
      safe(() => nut.keyToggle(key, 'up', modifierFlags()));
      break;
    }
  }
}

// Nhả mọi phím/nút đang giữ (khi viewer mất kết nối) để không bị "kẹt phím"
function releaseAll() {
  if (!nut) return;
  for (const key of [...heldKeys]) {
    heldKeys.delete(key);
    safe(() => nut.keyToggle(key, 'up', []));
  }
  for (const btn of [...heldButtons]) {
    heldButtons.delete(btn);
    safe(() => nut.mouseToggle('up', btn));
  }
  swallowUp.clear();
}

module.exports = { handle, releaseAll, available: () => !!nut, loadError: () => loadError };
