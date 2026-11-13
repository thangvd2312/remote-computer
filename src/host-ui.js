// Giao diện cửa sổ host: Trang chủ / Hướng dẫn / Hoạt động
const $ = (id) => document.getElementById(id);
const icon = (name) => (window.ICONS && ICONS[name]) || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let info = null;
let guideOs = null;
let sessionTimer = null;

function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.dataset.iconDone = '1';
  });
}

function toast(text, iconName = 'check') {
  const t = $('toast');
  t.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function copy(text, msg = 'Đã copy') {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Không copy được', 'circle-x'); }
}

const formatPassword = (p) => `${p.slice(0, 3)} ${p.slice(3)}`;
const timeOf = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
function duration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

function mainAddress() {
  if (!info) return null;
  return info.addresses.find((a) => a.tailscale) || (info.settings.tailscaleOnly ? null : info.addresses[0]) || null;
}
const urlOf = (a) => `http://${a.address}:${info.port}`;

// ---------------- Điều hướng ----------------
function show(view) {
  for (const v of ['home', 'guide', 'activity']) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelector('main').scrollTop = 0;
  if (view === 'guide') refresh();
  if (view === 'activity') renderActivity();
}
document.querySelectorAll('.bottom-nav button').forEach((b) => { b.onclick = () => show(b.dataset.view); });

// ---------------- Trang chủ ----------------
function renderHome() {
  $('hostname').textContent = info.hostname;
  $('app-version').textContent = info.version;
  const initials = info.hostname.replace(/\.local$/, '').split(/[-_.\s]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  $('avatar').textContent = initials || 'PC';
  $('avatar').title = info.hostname;
  $('password').textContent = formatPassword(info.password);
  $('os-name').textContent = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[info.platform] || info.platform;
  $('displays').textContent = info.displays;

  const main = mainAddress();
  $('address').textContent = main ? `${main.address}:${info.port}` : 'Chưa có';
  $('address-label').textContent = main?.tailscale ? 'Tailscale' : main ? main.name : 'Bật Tailscale';
  $('copy-link').disabled = !main;

  const others = info.addresses.filter((a) => a !== main && !a.tailscale);
  $('other-net').hidden = info.settings.tailscaleOnly || others.length === 0;
  $('other-addresses').innerHTML = others.map((a) => `<button class="chip" data-url="${esc(urlOf(a))}" title="${esc(a.name)}">${esc(a.address)}</button>`).join('');
  $('other-addresses').querySelectorAll('.chip').forEach((c) => { c.onclick = () => copy(c.dataset.url, 'Đã copy link'); });

  const checks = info.checks.filter((c) => !c.warn);
  const okCount = checks.filter((c) => c.ok).length;
  const allOk = okCount === checks.length;
  $('checks').textContent = `${okCount}/${checks.length}`;
  const ci = $('checks-icon');
  ci.classList.toggle('ok', allOk);
  ci.classList.toggle('warn', !allOk);
  $('setup-banner').hidden = allOk;
  $('setup-banner-text').textContent = `Còn ${checks.length - okCount} bước cài đặt chưa xong`;
  $('guide-dot').hidden = allOk;

  document.querySelectorAll('[data-setting]').forEach((inp) => {
    inp.checked = !!info.settings[inp.dataset.setting];
    inp.closest('.feature').classList.toggle('on', inp.checked);
  });

  renderStatus(info.session);
}

function renderStatus(s) {
  info.session = s;
  const live = !!s.connected;
  $('dial').classList.toggle('live', live);
  $('kick').disabled = !live;
  $('status-title').textContent = live ? 'Đang được điều khiển' : 'Đang chờ kết nối';
  clearInterval(sessionTimer);
  if (live) {
    const tick = () => { $('status-sub').textContent = `${s.peer} · ${duration(Date.now() - s.since)}`; };
    tick();
    sessionTimer = setInterval(() => { tick(); if (!$('view-activity').hidden) renderSession(); }, 1000);
  } else {
    $('status-sub').textContent = mainAddress() ? 'Mở link trên máy điều khiển và nhập mật khẩu' : 'Bật Tailscale để có địa chỉ kết nối';
  }
  if (!$('view-activity').hidden) renderSession();
}

$('new-pass').onclick = async () => {
  info.password = await host.newPassword();
  $('password').textContent = formatPassword(info.password);
  toast('Đã đổi mật khẩu', 'refresh-cw');
};
$('copy-link').onclick = () => { const a = mainAddress(); if (a) copy(urlOf(a), 'Đã copy link'); };
$('stat-address').onclick = () => { const a = mainAddress(); if (a) copy(urlOf(a), 'Đã copy link'); };
$('kick').onclick = () => host.kick();
$('stat-checks').onclick = () => show('guide');
$('setup-banner').onclick = () => show('guide');

document.querySelectorAll('[data-setting]').forEach((inp) => {
  inp.onchange = async () => {
    inp.closest('.feature').classList.toggle('on', inp.checked);
    info.settings = await host.setSetting(inp.dataset.setting, inp.checked);
    renderHome();
  };
});

// ---------------- Hướng dẫn ----------------
function renderGuide() {
  const osList = ['darwin', 'win32', 'linux'];
  if (!guideOs) guideOs = osList.includes(info.platform) ? info.platform : 'darwin';
  $('os-chips').innerHTML = osList.map((os) => `<button class="chip ${os === guideOs ? 'active' : ''}" data-os="${os}">${GUIDE[os].name}${os === info.platform ? '<span class="dot" title="Máy này"></span>' : ''}</button>`).join('');
  $('os-chips').querySelectorAll('.chip').forEach((c) => { c.onclick = () => { guideOs = c.dataset.os; renderGuide(); }; });

  const g = GUIDE[guideOs];
  const isHere = guideOs === info.platform;
  const checkById = Object.fromEntries(info.checks.map((c) => [c.id, c]));
  $('guide-intro').innerHTML = g.intro;

  $('checks-card').hidden = !isHere;
  $('check-list').innerHTML = info.checks.map((c) => {
    const cls = c.ok ? 'ok' : c.warn ? 'mutedbg' : 'warn';
    const ic = c.ok ? 'check' : c.warn ? 'info' : 'triangle-alert';
    const btn = !c.ok && c.action ? `<button class="btn-ghost" data-open="${esc(c.action)}">Mở</button>` : '';
    return `<li><span class="badge-icon ${cls}">${icon(ic)}</span><div class="check-text"><div class="check-label">${esc(c.label)}</div><div class="check-detail">${esc(c.detail)}</div></div>${btn}</li>`;
  }).join('');

  const electron = guideOs === 'win32' && isHere ? info.electronPath : 'C:\\duong-dan\\remote-computer\\node_modules\\electron\\dist\\electron.exe';
  $('steps').innerHTML = g.steps.map((s) => {
    const c = isHere && s.check ? checkById[s.check] : null;
    const state = !c ? ''
      : c.ok ? '<span class="step-state ok">Xong</span>'
      : c.warn ? '<span class="step-state opt">Tuỳ chọn</span>'
      : '<span class="step-state bad">Chưa xong</span>';
    const code = s.code ? `<div class="step-code"><pre>${esc(s.code.replaceAll('{{electron}}', electron))}</pre><button title="Copy lệnh" data-copy>${icon('copy')}</button></div>` : '';
    const actions = s.actions && isHere
      ? `<div class="step-actions">${s.actions.map((a) => `<button class="btn-ghost" data-open="${esc(a.open)}">${icon('external-link')}${esc(a.label)}</button>`).join('')}</div>`
      : '';
    return `<li class="step ${c?.ok ? 'done' : ''}"><div class="step-title">${esc(s.title)}${state}</div><div class="step-body">${s.body}</div>${code}${actions}</li>`;
  }).join('');
  $('notes').innerHTML = (g.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');

  document.querySelectorAll('#view-guide [data-open]').forEach((b) => { b.onclick = () => host.openSettings(b.dataset.open); });
  document.querySelectorAll('#view-guide [data-copy]').forEach((b) => {
    b.onclick = () => copy(b.previousElementSibling.textContent, 'Đã copy lệnh');
  });
}

$('recheck').onclick = async () => { await refresh(); toast('Đã kiểm tra lại', 'refresh-cw'); };
$('open-guide').onclick = () => host.openGuide();

// ---------------- Hoạt động ----------------
const KIND = {
  connect: { icon: 'log-in', cls: '' },
  disconnect: { icon: 'log-out', cls: 'mutedbg' },
  fail: { icon: 'lock', cls: 'danger' },
  blocked: { icon: 'ban', cls: 'danger' },
};

function renderSession() {
  const s = info.session;
  $('session-card').innerHTML = s.connected
    ? `<span class="badge-icon ok">${icon('monitor')}</span><div class="session-main"><div class="session-title">Đang được điều khiển</div><div class="session-sub">từ <span class="num">${esc(s.peer)}</span> · <span class="num">${duration(Date.now() - s.since)}</span></div></div><button class="circle-btn danger" id="kick2" title="Ngắt kết nối">${icon('x')}</button>`
    : `<span class="badge-icon mutedbg">${icon('monitor')}</span><div class="session-main"><div class="session-title">Không có phiên nào</div><div class="session-sub">Mật khẩu hiện tại: <span class="num">${formatPassword(info.password)}</span></div></div>`;
  const k = $('kick2');
  if (k) k.onclick = () => host.kick();
}

async function renderActivity() {
  renderSession();
  const items = await host.getActivity();
  $('activity-empty').hidden = items.length > 0;
  $('activity').innerHTML = items.map((a) => {
    const k = KIND[a.kind] || KIND.connect;
    return `<li><span class="badge-icon ${k.cls}">${icon(k.icon)}</span><div class="act-text">${esc(a.text)}<div class="act-ip">${esc(a.ip || '')}</div></div><span class="act-time">${timeOf(a.t)}</span></li>`;
  }).join('');
}

$('open-releases').onclick = () => host.openReleases();

// ---------------- Dữ liệu ----------------
async function refresh() {
  info = await host.getInfo();
  renderHome();
  renderGuide();
}

host.onStatus((s) => { if (info) { renderStatus(s); } });
host.onActivity(() => { if (!$('view-activity').hidden) renderActivity(); });
host.onServerError((m) => { $('server-error').textContent = m; $('server-error').hidden = false; });
window.addEventListener('focus', refresh); // quay lại app sau khi cấp quyền -> cập nhật ngay
setInterval(() => { if (document.hasFocus()) refresh(); }, 5000);

document.body.classList.add({ darwin: 'mac', win32: 'win', linux: 'linux' }[navigator.platform.startsWith('Mac') ? 'darwin' : navigator.platform.startsWith('Win') ? 'win32' : 'linux']);
fillIcons();
refresh();
