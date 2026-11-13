const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('host', {
  getInfo: () => ipcRenderer.invoke('get-info'),
  getActivity: () => ipcRenderer.invoke('get-activity'),
  newPassword: () => ipcRenderer.invoke('new-password'),
  kick: () => ipcRenderer.invoke('kick'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  openSettings: (kind) => ipcRenderer.invoke('open-settings', kind),
  openGuide: () => ipcRenderer.invoke('open-guide'),
  openReleases: () => ipcRenderer.invoke('open-releases'),
  getSource: (displayId) => ipcRenderer.invoke('get-source', displayId),
  sendSignal: (msg) => ipcRenderer.send('signal', msg),

  onStatus: on('status'),
  onActivity: on('activity'),
  onSessionStart: on('session-start'),
  onSessionEnd: on('session-end'),
  onSignal: on('signal'),
  onSwitchDisplay: on('switch-display'),
  onQuality: on('quality'),
  onServerError: on('server-error'),
});
