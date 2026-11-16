// macOS: gửi phím bằng CGEvent theo MÃ PHÍM VẬT LÝ cố định (kVK_*), không tra theo bố cục bàn phím.
//
// Vì sao không dùng libnut cho phím chữ: libnut đổi 'a' -> mã phím bằng cách đọc bố cục của kiểu gõ
// hiện tại (TISCopyCurrentASCIICapableKeyboardInputSource). Khi máy host đang ở kiểu gõ tiếng Việt
// (Telex/VNI của macOS) kiểu gõ đó không có dữ liệu bố cục -> libnut đọc con trỏ NULL -> SẬP CẢ APP
// ngay phím chữ đầu tiên. Gửi thẳng mã phím vật lý thì bộ gõ của host (ABC hay Telex) vẫn nhận bình
// thường, đúng như gõ trên bàn phím thật.
const koffi = require('koffi');

const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const CGEventSourceCreate = CG.func('void *CGEventSourceCreate(int32_t stateID)');
const CGEventCreateKeyboardEvent = CG.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t virtualKey, bool keyDown)');
const CGEventKeyboardSetUnicodeString = CG.func('void CGEventKeyboardSetUnicodeString(void *event, unsigned long length, const uint16_t *str)');
const CGEventPost = CG.func('void CGEventPost(uint32_t tap, void *event)');
const CGEventGetFlags = CG.func('uint64_t CGEventGetFlags(void *event)');
const CGEventSetFlags = CG.func('void CGEventSetFlags(void *event, uint64_t flags)');
const CGEventSourceFlagsState = CG.func('uint64_t CGEventSourceFlagsState(int32_t stateID)');
const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
const CFRelease = CF.func('void CFRelease(void *cf)');
const CFEqual = CF.func('bool CFEqual(void *a, void *b)');
const HIToolbox = koffi.load('/System/Library/Frameworks/Carbon.framework/Frameworks/HIToolbox.framework/HIToolbox');
const TISCopyCurrentKeyboardInputSource = HIToolbox.func('void *TISCopyCurrentKeyboardInputSource()');
const TISCopyCurrentKeyboardLayoutInputSource = HIToolbox.func('void *TISCopyCurrentKeyboardLayoutInputSource()');

const kCGEventSourceStateCombinedSessionState = 0;
const kCGEventSourceStateHIDSystemState = 1;
const kCGSessionEventTap = 1;
const kVK_Space = 0x31;
const FLAG_CAPS = 0x10000n;
const MODIFIER_MASK = FLAG_CAPS | 0x20000n | 0x40000n | 0x80000n | 0x100000n; // Caps | Shift | Ctrl | Option | Cmd
const source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);

// KeyboardEvent.code -> mã phím macOS (Carbon kVK_*)
const KEYCODE = {
  KeyA: 0x00, KeyS: 0x01, KeyD: 0x02, KeyF: 0x03, KeyH: 0x04, KeyG: 0x05, KeyZ: 0x06, KeyX: 0x07,
  KeyC: 0x08, KeyV: 0x09, KeyB: 0x0B, KeyQ: 0x0C, KeyW: 0x0D, KeyE: 0x0E, KeyR: 0x0F, KeyY: 0x10,
  KeyT: 0x11, KeyO: 0x1F, KeyU: 0x20, KeyI: 0x22, KeyP: 0x23, KeyL: 0x25, KeyJ: 0x26, KeyK: 0x28,
  KeyN: 0x2D, KeyM: 0x2E,
  Digit1: 0x12, Digit2: 0x13, Digit3: 0x14, Digit4: 0x15, Digit6: 0x16, Digit5: 0x17, Digit9: 0x19,
  Digit7: 0x1A, Digit8: 0x1C, Digit0: 0x1D,
  Equal: 0x18, Minus: 0x1B, BracketRight: 0x1E, BracketLeft: 0x21, Quote: 0x27, Semicolon: 0x29,
  Backslash: 0x2A, Comma: 0x2B, Slash: 0x2C, Period: 0x2F, Backquote: 0x32, IntlBackslash: 0x0A,
  Enter: 0x24, Tab: 0x30, Space: 0x31, Backspace: 0x33, Escape: 0x35, Delete: 0x75,
  Home: 0x73, End: 0x77, PageUp: 0x74, PageDown: 0x79, Insert: 0x72, // Insert -> Help như bàn phím Apple
  ArrowLeft: 0x7B, ArrowRight: 0x7C, ArrowDown: 0x7D, ArrowUp: 0x7E,
  MetaLeft: 0x37, MetaRight: 0x36, OSLeft: 0x37, OSRight: 0x36,
  ShiftLeft: 0x38, ShiftRight: 0x3C, AltLeft: 0x3A, AltRight: 0x3D, ControlLeft: 0x3B, ControlRight: 0x3E,
  ContextMenu: 0x6E,
  F1: 0x7A, F2: 0x78, F3: 0x63, F4: 0x76, F5: 0x60, F6: 0x61, F7: 0x62, F8: 0x64, F9: 0x65, F10: 0x6D,
  F11: 0x67, F12: 0x6F, F13: 0x69, F14: 0x6B, F15: 0x71, F16: 0x6A, F17: 0x40, F18: 0x4F, F19: 0x50, F20: 0x5A,
  Numpad0: 0x52, Numpad1: 0x53, Numpad2: 0x54, Numpad3: 0x55, Numpad4: 0x56, Numpad5: 0x57,
  Numpad6: 0x58, Numpad7: 0x59, Numpad8: 0x5B, Numpad9: 0x5C, NumpadDecimal: 0x41, NumpadMultiply: 0x43,
  NumpadAdd: 0x45, NumpadSubtract: 0x4E, NumpadDivide: 0x4B, NumpadEnter: 0x4C, NumpadEqual: 0x51,
  NumLock: 0x47, // Clear
};

// Phím bổ trợ -> cờ (Shift, Ctrl, Option, Cmd)
const MODIFIER_FLAG = {
  0x38: 0x20000n, 0x3C: 0x20000n, 0x3B: 0x40000n, 0x3E: 0x40000n,
  0x3A: 0x80000n, 0x3D: 0x80000n, 0x37: 0x100000n, 0x36: 0x100000n,
};
const heldModifiers = new Set(); // mã phím bổ trợ đang giữ (do viewer gửi)

function modifierFlags() {
  let f = 0n;
  for (const kc of heldModifiers) f |= MODIFIER_FLAG[kc];
  // CapsLock là trạng thái bật/tắt của hệ thống -> lấy từ hệ thống
  return f | (BigInt(CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState)) & FLAG_CAPS);
}

function post(keycode, down, text) {
  const ev = CGEventCreateKeyboardEvent(source, keycode, down);
  if (!ev) return;
  try {
    if (MODIFIER_FLAG[keycode]) {
      if (down) heldModifiers.add(keycode); else heldModifiers.delete(keycode);
    } else {
      // Phím thường: tự gắn cờ Shift/Ctrl/Option/Cmd đang giữ. Không gắn thì phím chữ không "thấy"
      // Shift vừa gửi (hệ thống cập nhật trễ vài ms) -> "A" thành "a", "!" thành "1", Cmd+C thành "c".
      CGEventSetFlags(ev, (BigInt(CGEventGetFlags(ev)) & ~MODIFIER_MASK) | modifierFlags());
    }
    if (text) {
      const units = [];
      for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i)); // UTF-16 (emoji = 2 đơn vị)
      CGEventKeyboardSetUnicodeString(ev, units.length, units);
    }
    CGEventPost(kCGSessionEventTap, ev);
  } finally {
    CFRelease(ev);
  }
}

/** Nhấn/nhả 1 phím theo KeyboardEvent.code. Trả về false nếu không có phím tương ứng. */
function key(code, down) {
  const kc = KEYCODE[code];
  if (kc === undefined) return false;
  post(kc, down);
  return true;
}

/**
 * Gõ 1 ký tự Unicode bất kỳ (chữ có dấu, emoji…).
 * bypassIME: host đang bật bộ gõ (Telex…) -> gắn ký tự vào phím Space: bộ gõ coi Space là "kết thúc từ",
 * chuyển thẳng ký tự cho ứng dụng mà không ghép dấu thêm. Gắn vào phím khác (vd. mã 0 = phím A) thì
 * Telex vẫn xử lý: "tieengs" -> "tiếng", "dd" -> "đ".
 */
function typeChar(ch, bypassIME) {
  const kc = bypassIME ? kVK_Space : 0;
  post(kc, true, ch);
  post(kc, false, ch);
}

/** Host đang dùng bộ gõ (Telex, VNI, tiếng Nhật…) thay vì bố cục bàn phím thường (ABC, US…)? */
function inputMethodActive() {
  const cur = TISCopyCurrentKeyboardInputSource();
  const layout = TISCopyCurrentKeyboardLayoutInputSource();
  try {
    return !!(cur && layout && !CFEqual(cur, layout));
  } finally {
    if (cur) CFRelease(cur);
    if (layout) CFRelease(layout);
  }
}

module.exports = { key, typeChar, inputMethodActive, has: (code) => KEYCODE[code] !== undefined };
