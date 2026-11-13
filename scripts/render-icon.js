// Render build/icon.svg -> build/icon.png (1024×1024, nền trong suốt) bằng Electron offscreen.
// Chạy: npm run build:icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(1);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const out = img.getSize().width === 1024 ? img : img.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), out.toPNG());
  console.log('build/icon.png', out.getSize());
  app.quit();
});
