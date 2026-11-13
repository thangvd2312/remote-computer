// Nội dung màn "Hướng dẫn" trong app host. Bản đầy đủ: docs/HUONG-DAN.md
// step: { title, body (HTML), code?, actions?: [{ label, open }], check?: id trong diagnostics() }
// {{electron}} được thay bằng đường dẫn electron.exe thật khi đang chạy trên Windows.
window.GUIDE = {
  darwin: {
    name: 'macOS',
    intro: 'macOS bắt buộc cấp <b>2 quyền</b>. Thiếu quyền nào thì tính năng đó không chạy và macOS <b>không báo lỗi</b>.',
    steps: [
      {
        title: 'Cấp quyền cho đúng ứng dụng',
        body: 'Cài từ file <code>.dmg</code> thì cấp quyền cho chính <b>Remote Computer</b>. '
          + 'Chạy bằng <code>npm start</code> từ terminal thì macOS tính quyền cho <b>ứng dụng terminal</b> (Terminal, iTerm2, VS Code…), không phải "Electron".',
      },
      {
        title: 'Ghi màn hình',
        check: 'screen',
        body: '<b>System Settings → Privacy & Security → Screen & System Audio Recording</b> (macOS 14 trở về trước: <i>Screen Recording</i>). '
          + 'Bật công tắc cho app; không có trong danh sách thì bấm <b>+</b> để thêm.<br>'
          + '⚠️ Bật xong phải <b>thoát hẳn app (Cmd+Q)</b> rồi mở lại thì mới có hiệu lực.',
        actions: [{ label: 'Mở cài đặt Ghi màn hình', open: 'mac-screen' }],
      },
      {
        title: 'Trợ năng (điều khiển chuột & bàn phím)',
        check: 'accessibility',
        body: '<b>System Settings → Privacy & Security → Accessibility</b> → bật công tắc cho app. '
          + 'Đã bật mà vẫn không click được: tắt công tắc, bật lại, rồi mở lại app.',
        actions: [{ label: 'Mở cài đặt Trợ năng', open: 'mac-accessibility' }],
      },
      {
        title: 'Không cho máy ngủ (khuyên làm)',
        body: '<b>System Settings → Battery → Options…</b> (Mac để bàn: <i>Energy</i>) → bật <b>Prevent automatic sleeping on power adapter when the display is off</b>. '
          + 'Máy đã ngủ thì không ai kết nối được.',
        actions: [{ label: 'Mở cài đặt Pin', open: 'mac-energy' }],
      },
      {
        title: 'Tường lửa (chỉ khi đang bật)',
        body: 'Khi app chạy lần đầu, nếu macOS hỏi <i>"Cho phép kết nối đến?"</i> thì chọn <b>Allow</b>. '
          + 'Lỡ từ chối: <b>System Settings → Network → Firewall → Options…</b> → thêm app, chọn <i>Allow incoming connections</i>.',
        actions: [{ label: 'Mở cài đặt Tường lửa', open: 'mac-firewall' }],
      },
    ],
    notes: [
      'Sau khi khởi động lại máy phải đăng nhập và mở app trên host trước.',
      'macOS 15+ thỉnh thoảng hỏi lại quyền ghi màn hình — chọn Allow.',
    ],
  },

  win32: {
    name: 'Windows',
    intro: 'Windows <b>không cần cấp quyền</b> ghi màn hình hay điều khiển. Chỉ cần mở tường lửa đúng cách.',
    steps: [
      {
        title: 'Cho phép qua tường lửa',
        body: 'Lần đầu chạy, hộp thoại <i>"Windows Defender Firewall has blocked some features…"</i> hiện ra: '
          + 'tick <b>cả Private và Public</b> (mạng Tailscale thường bị Windows xếp là Public) → <b>Allow access</b>.<br>'
          + 'Lỡ bấm Cancel: mở <b>Allowed apps</b> → <b>Change settings</b> → tick Private + Public cho <code>Electron</code>. '
          + 'Hoặc chạy lệnh sau trong PowerShell (Run as administrator), chỉ mở cho mạng Tailscale:',
        code: 'New-NetFirewallRule -DisplayName "Remote Computer (Tailscale)" -Direction Inbound -Action Allow `\n  -Program "{{electron}}" `\n  -RemoteAddress 100.64.0.0/10',
        actions: [{ label: 'Mở Allowed apps', open: 'win-firewall' }],
      },
      {
        title: 'Điều khiển cửa sổ Admin (tuỳ chọn)',
        check: 'admin',
        body: 'App chạy quyền thường thì <b>không click/gõ được</b> vào cửa sổ chạy quyền Admin (Task Manager, trình cài đặt…). '
          + 'Cần thì mở <b>Terminal bằng "Run as administrator"</b> rồi mới <code>npm start</code>.',
      },
      {
        title: 'Hộp thoại UAC (tuỳ chọn)',
        body: 'Hộp thoại <i>"Do you want to allow this app…"</i> hiện trên màn hình bảo mật riêng nên <b>không thấy từ xa</b>. '
          + 'Nếu cần: hạ UAC xuống <b>"Notify me only… (do not dim my desktop)"</b>. Việc này giảm bảo mật — chỉ làm khi thật cần.',
        actions: [{ label: 'Mở cài đặt UAC', open: 'win-uac' }],
      },
      {
        title: 'Không cho máy ngủ',
        body: '<b>Settings → System → Power & battery → Screen and sleep</b> → khi cắm sạc chọn <b>Never</b>.',
        actions: [{ label: 'Mở cài đặt Nguồn', open: 'win-power' }],
      },
    ],
    notes: [
      'Ctrl+Alt+Del và màn hình khoá (Win+L) không điều khiển được từ xa.',
      'Màn hình scale 125% / 150% đã được xử lý tự động.',
    ],
  },

  linux: {
    name: 'Ubuntu',
    intro: 'Hỗ trợ <b>Ubuntu 22.04 / 24.04 LTS</b>. Bắt buộc dùng phiên <b>Xorg</b> — trên Wayland ứng dụng không được phép điều khiển chuột/phím.',
    steps: [
      {
        title: 'Đăng nhập bằng "Ubuntu on Xorg"',
        check: 'session',
        body: '<b>Đăng xuất</b> → ở màn hình đăng nhập bấm vào tên tài khoản → bấm <b>bánh răng ⚙</b> góc dưới phải → chọn <b>Ubuntu on Xorg</b> → đăng nhập. '
          + 'Kiểm tra: lệnh dưới phải in ra <code>x11</code>.<br>'
          + 'Không thấy bánh răng: bỏ dấu <code>#</code> ở dòng <code>#WaylandEnable=false</code> trong <code>/etc/gdm3/custom.conf</code> rồi khởi động lại. '
          + 'Ubuntu 25.10+ đã bỏ Xorg → dùng 24.04 LTS cho máy host.',
        code: 'echo $XDG_SESSION_TYPE',
      },
      {
        title: 'Cài thư viện điều khiển chuột/phím',
        check: 'input',
        body: '<code>libxtst6</code> để giả lập chuột/phím, <code>libpng</code> cho module native.',
        code: 'sudo apt update\nsudo apt install -y libxtst6 libpng16-16t64 || sudo apt install -y libxtst6 libpng16-16',
      },
      {
        title: 'Lỗi sandbox (chỉ khi chạy từ mã nguồn / AppImage)',
        body: 'Cài bằng file <code>.deb</code> thì bỏ qua bước này. Nếu <code>npm start</code> báo <i>"The SUID sandbox helper binary was found, but is not configured correctly"</i>, chạy trong thư mục dự án:',
        code: 'sudo chown root:root node_modules/electron/dist/chrome-sandbox\nsudo chmod 4755 node_modules/electron/dist/chrome-sandbox',
      },
      {
        title: 'Tường lửa (nếu bật ufw)',
        body: 'Chỉ mở cho mạng Tailscale, không mở ra LAN hay Internet:',
        code: 'sudo ufw allow in on tailscale0',
      },
      {
        title: 'Không cho máy ngủ',
        body: '<b>Settings → Power</b> → <i>Screen Blank</i> = <b>Never</b>, <i>Automatic Suspend</i> = <b>Off</b>.',
        actions: [{ label: 'Mở cài đặt Nguồn', open: 'linux-power' }],
      },
    ],
    notes: [
      'Mỗi lần npm install tải lại Electron thì phải sửa sandbox lại.',
    ],
  },
};
