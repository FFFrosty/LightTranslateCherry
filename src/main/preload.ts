import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, TranslationChunk } from '../shared/api';
const bridge: Bridge = {
  getInitial: () => ipcRenderer.invoke('lt:initial'),
  translate: request => ipcRenderer.invoke('lt:translate', request),
  cancel: id => ipcRenderer.invoke('lt:cancel', id),
  onChunk(listener) { const receive = (_event: Electron.IpcRendererEvent, chunk: TranslationChunk) => listener(chunk); ipcRenderer.on('lt:chunk', receive); return () => ipcRenderer.removeListener('lt:chunk', receive); },
  openTranslation: text => ipcRenderer.invoke('lt:open', text),
  translateSelection: () => ipcRenderer.invoke('lt:selection'),
  setPinned: value => ipcRenderer.invoke('lt:pin', value),
  setOpacity: value => ipcRenderer.invoke('lt:opacity', value),
  minimize: () => ipcRenderer.invoke('lt:minimize'),
  close: () => ipcRenderer.invoke('lt:close'),
  copy: text => ipcRenderer.invoke('lt:copy', text),
  reimportProfile: () => ipcRenderer.invoke('lt:reimport'),
  saveLanguages: value => ipcRenderer.invoke('lt:languages', value)
};
contextBridge.exposeInMainWorld('lightTranslate', Object.freeze(bridge));
