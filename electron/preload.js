'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obxodik', {
  getState: () => ipcRenderer.invoke('obxodik:get-state'),
  setService: (id, enabled) => ipcRenderer.invoke('obxodik:set-service', { id, enabled }),
  setAll: (enabled) => ipcRenderer.invoke('obxodik:set-all', { enabled }),
  restart: () => ipcRenderer.invoke('obxodik:restart'),
  setStrategy: (strategy) => ipcRenderer.invoke('obxodik:set-strategy', { strategy }),
  setIpsetMode: (mode) => ipcRenderer.invoke('obxodik:set-ipset-mode', { mode }),
  setAutostart: (enabled) => ipcRenderer.invoke('obxodik:set-autostart', { enabled }),
  setTelegramWs: (enabled) => ipcRenderer.invoke('obxodik:set-telegram-ws', { enabled }),
  tgwsConnect: () => ipcRenderer.invoke('obxodik:tgws-connect'),
  tgwsCopy: () => ipcRenderer.invoke('obxodik:tgws-copy'),
  test: () => ipcRenderer.invoke('obxodik:test'),
  telegramProxy: (value) => ipcRenderer.invoke('obxodik:telegram-proxy', { value }),
  openExternal: (url) => ipcRenderer.invoke('obxodik:open-external', { url }),
  openLogs: () => ipcRenderer.invoke('obxodik:open-logs'),
  relaunchAdmin: () => ipcRenderer.invoke('obxodik:relaunch-admin'),
  quit: () => ipcRenderer.invoke('obxodik:quit'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('obxodik:state', listener);
    return () => ipcRenderer.removeListener('obxodik:state', listener);
  },
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('obxodik:log', listener);
    return () => ipcRenderer.removeListener('obxodik:log', listener);
  },
});
