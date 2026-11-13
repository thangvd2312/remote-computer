# Hướng dẫn cài đặt Remote Computer

Có 2 vai:

- **Máy host**: máy **bị điều khiển**. Cài và chạy app ở đây, cấp quyền theo hướng dẫn bên dưới.
- **Máy điều khiển**: chỉ cần trình duyệt (Chrome/Edge khuyên dùng). Không cài gì, không cấp quyền gì.

Cả hai máy phải cùng một mạng Tailscale (hoặc cùng LAN).

---

## Bước chung cho mọi hệ điều hành

1. Cài **Tailscale** trên cả 2 máy, đăng nhập cùng 1 tài khoản: <https://tailscale.com/download>
   Kiểm tra bằng lệnh `tailscale status`: máy kia phải hiện `active` hoặc ít nhất không phải `offline`.
2. Trên máy host, tải bản cài ở **<https://github.com/thangvd2312/remote-computer/releases/latest>**:

   | Hệ điều hành | File |
   |---|---|
   | macOS Apple Silicon (M1–M4) | `…-mac-arm64.dmg`. Mở ra, kéo app vào Applications |
   | macOS Intel | `…-mac-x64.dmg` |
   | Windows 10/11 | `Remote-Computer-Setup-….exe` |
   | Ubuntu | `…-amd64.deb`, cài bằng `sudo apt install ./<tên-file>.deb` |

   Lần mở đầu, hệ điều hành cảnh báo vì app không mua chứng chỉ ký:
   - **macOS**: bấm **Done** → **System Settings → Privacy & Security** → **Open Anyway**.
   - **Windows**: **More info** → **Run anyway**.

   *(Hoặc chạy từ mã nguồn: cài Node.js 20+, rồi `npm install` và `npm start` trong thư mục dự án.)*
3. Trên máy điều khiển, mở địa chỉ có nhãn **Tailscale** hiện trong cửa sổ host (dạng `http://100.x.y.z:8787`) và nhập mật khẩu 6 số.

---

## macOS

macOS bắt buộc cấp **2 quyền**. Thiếu quyền nào thì tính năng đó không chạy và **không báo lỗi rõ ràng**.

| Quyền | Để làm gì | Thiếu thì sao |
|---|---|---|
| Ghi màn hình | Gửi hình màn hình đi | Máy điều khiển kẹt ở "Đang nhận hình…" |
| Trợ năng (Accessibility) | Điều khiển chuột và bàn phím | Thấy hình nhưng click, gõ phím không có tác dụng |

### ⚠️ Cấp quyền cho ĐÚNG ứng dụng

- Cài từ file `.dmg`: cấp quyền cho chính **"Remote Computer"**.
- Chạy bằng `npm start` từ terminal: macOS tính quyền cho **ứng dụng terminal** đó (Terminal, iTerm2, Warp, VS Code…), không phải "Electron".
  → Bật quyền cho terminal bạn đang dùng. Đổi sang terminal khác thì phải cấp lại.

### 1. Ghi màn hình

1. Mở **System Settings** (Cài đặt hệ thống) → **Privacy & Security** (Quyền riêng tư & Bảo mật).
2. Chọn **Screen & System Audio Recording**. Trên macOS 14 trở về trước, mục này tên là **Screen Recording**.
3. Bật công tắc cho ứng dụng terminal của bạn. Nếu không thấy trong danh sách, bấm **+** và chọn ứng dụng trong thư mục `/Applications`.
4. **Thoát hẳn ứng dụng terminal** (Cmd+Q, không phải chỉ đóng cửa sổ), mở lại rồi chạy `npm start`.
   Quyền này chỉ có hiệu lực sau khi mở lại app.

> Trên macOS 15 trở lên, thỉnh thoảng hệ thống hỏi lại "… muốn tiếp tục ghi màn hình". Chọn **Allow / Cho phép**.

### 2. Trợ năng (Accessibility)

1. **System Settings** → **Privacy & Security** → **Accessibility** (Trợ năng).
2. Bật công tắc cho ứng dụng terminal (hoặc Remote Computer). Không có thì bấm **+** để thêm.
3. Nếu đã bật mà vẫn không điều khiển được: tắt công tắc đi, bật lại, rồi khởi động lại app.

Trong cửa sổ host có mục **Quyền macOS** hiện trạng thái *Đã cấp / Chưa cấp*. Nút bên cạnh mở thẳng đúng trang cài đặt.

### 3. Không cho máy ngủ (khuyên làm)

Khi đang có người điều khiển, app đã tự giữ màn hình không tắt. Nhưng nếu máy đã ngủ từ trước thì không ai kết nối được.

- **System Settings** → **Battery** (hoặc **Energy** trên Mac để bàn) → **Options…** → bật **Prevent automatic sleeping on power adapter when the display is off**.

### 4. Tường lửa (chỉ khi đang bật)

- **System Settings** → **Network** → **Firewall**. Nếu đang bật, khi app chạy lần đầu sẽ hiện hỏi "Cho phép kết nối đến?", chọn **Allow**.
- Hoặc vào **Options…** và thêm ứng dụng, chọn *Allow incoming connections*.

### Giới hạn trên macOS

- Sau khi khởi động lại máy, phải đăng nhập và mở app trên máy host trước thì mới điều khiển được.
- Màn hình khoá vẫn thấy hình. Gõ mật khẩu mở khoá thường dùng được, nhưng màn hình FileVault lúc mới bật máy thì không.

---

## Windows 10 / 11

Windows **không cần cấp quyền** ghi màn hình hay điều khiển chuột/phím. Chỉ cần lưu ý tường lửa và UAC.

### 1. Tường lửa (Windows Defender Firewall), quan trọng

Lần đầu chạy `npm start`, Windows hiện hộp thoại *"Windows Defender Firewall has blocked some features of this app"*:

- Tick **cả 2 ô**: **Private networks** và **Public networks**. Mạng Tailscale thường bị Windows xếp vào loại *Public*.
- Bấm **Allow access**.

Lỡ bấm *Cancel* thì làm lại bằng 1 trong 2 cách:

**Cách A, giao diện:** Start → gõ *"Allow an app through Windows Firewall"* → **Change settings** → tìm `Electron` (hoặc *Remote Computer*) → tick **Private** và **Public** → OK.

**Cách B, lệnh** (PowerShell chạy bằng quyền Administrator, thay đường dẫn cho đúng thư mục dự án):
```powershell
New-NetFirewallRule -DisplayName "Remote Computer (Tailscale)" -Direction Inbound -Action Allow `
  -Program "C:\duong-dan\remote-computer\node_modules\electron\dist\electron.exe" `
  -RemoteAddress 100.64.0.0/10
```
Lệnh này chỉ cho phép máy trong mạng Tailscale kết nối vào, an toàn hơn cách A.

### 2. Cửa sổ Administrator và UAC

- App chạy quyền thường thì **không click hay gõ được vào cửa sổ chạy quyền Admin** (Task Manager, trình cài đặt, Regedit…). Đây là giới hạn bảo mật của Windows.
  → Muốn điều khiển cả những cửa sổ đó: mở **Terminal / PowerShell bằng "Run as administrator"** rồi mới `npm start`.
- Hộp thoại **UAC** ("Do you want to allow this app…") hiện trên *màn hình bảo mật riêng*, nên **không thấy và không bấm được từ xa**. Nếu cần:
  Start → *"Change User Account Control settings"* → kéo xuống mức **"Notify me only when apps try to make changes (do not dim my desktop)"**.
  Hạ mức này sẽ giảm bảo mật một chút, chỉ làm khi thật sự cần.

### 3. Không cho máy ngủ

- **Settings** → **System** → **Power & battery** → **Screen and sleep** → khi cắm sạc chọn *"Put my device to sleep after"* = **Never**.

### Giới hạn trên Windows

- **Ctrl+Alt+Del** và màn hình khoá (Win+L) không điều khiển được từ xa.
- Màn hình scale 125%/150% đã được xử lý, chuột trỏ đúng vị trí.

---

## Ubuntu (22.04 / 24.04 LTS)

### 1. ⚠️ Bắt buộc dùng phiên Xorg, không dùng Wayland

Ubuntu mặc định dùng **Wayland**. Trên Wayland, ứng dụng **không được phép điều khiển chuột/phím** của hệ thống, và mỗi lần chia sẻ màn hình đều phải bấm đồng ý. Vì vậy phải chuyển sang Xorg:

1. **Đăng xuất** (Log Out).
2. Ở màn hình đăng nhập, bấm vào tên tài khoản. Biểu tượng **bánh răng ⚙** hiện ở góc dưới bên phải.
3. Bấm bánh răng → chọn **"Ubuntu on Xorg"** → nhập mật khẩu đăng nhập.
4. Kiểm tra:
   ```bash
   echo $XDG_SESSION_TYPE   # phải in ra: x11
   ```

Nếu không thấy bánh răng hoặc không có lựa chọn Xorg, mở file `/etc/gdm3/custom.conf`, bỏ dấu `#` ở dòng `#WaylandEnable=false`, rồi khởi động lại máy.

> Ubuntu 25.10 trở lên đã bỏ phiên Xorg của GNOME, nên dùng bản **24.04 LTS** cho máy host.

### 2. Cài thư viện cần thiết

```bash
sudo apt update
sudo apt install -y libxtst6 libpng16-16t64 || sudo apt install -y libxtst6 libpng16-16
```
(`libxtst6` dùng để giả lập chuột/phím. `libpng` là thư viện mà module điều khiển cần.)

### 3. Sửa lỗi sandbox của Electron (chỉ khi chạy từ mã nguồn hoặc AppImage)

Cài bằng file `.deb` thì bỏ qua bước này. Nếu `npm start` báo lỗi kiểu *"The SUID sandbox helper binary was found, but is not configured correctly"*:
```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```
Mỗi lần chạy lại `npm install` mà Electron được tải lại thì phải làm lại bước này.

### 4. Tường lửa (nếu có bật `ufw`)

```bash
sudo ufw status            # nếu "Status: active" thì chạy tiếp lệnh dưới
sudo ufw allow in on tailscale0
```
Lệnh này chỉ mở cho mạng Tailscale, không mở ra LAN hay Internet.

### 5. Không cho máy ngủ

- **Settings** → **Power** → *Screen Blank* = **Never**, *Automatic Suspend* = **Off**.

---

## Gặp lỗi? Tra nhanh

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Trình duyệt không mở được trang `http://100.x…:8787` | Máy kia chưa bật Tailscale, hoặc tường lửa chặn | `tailscale status` trên cả 2 máy; xem mục Tường lửa của hệ điều hành tương ứng |
| Báo **Sai mật khẩu** | Mật khẩu đổi mỗi lần mở app | Xem lại mật khẩu trong cửa sổ host, hoặc đặt cố định: `RC_PASSWORD=123456 npm start` |
| "Bị khoá tạm thời…" | Nhập sai 5 lần | Đợi 5 phút |
| Kẹt ở **"Đang nhận hình…"** | macOS: thiếu quyền Ghi màn hình / chưa mở lại app. Ubuntu: đang dùng Wayland | Xem lại mục quyền tương ứng |
| Thấy hình nhưng **không điều khiển được** | macOS: thiếu quyền Trợ năng. Ubuntu: Wayland hoặc thiếu `libxtst6`. Windows: cửa sổ đang mở là cửa sổ Admin | Xem lại mục tương ứng |
| Phím tắt như Cmd+Tab, Cmd+Q không gửi sang | Trình duyệt hoặc hệ điều hành của **máy điều khiển** giữ lại | Giới hạn của trình duyệt, chưa xử lý được |
| Hình mờ, giật | Mạng chậm | Chọn chất lượng **Trung bình** hoặc **Thấp** trên thanh công cụ |
