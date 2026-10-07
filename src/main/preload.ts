import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, TranslationChunk } from '../shared/api';
import { stripIpcErrorPrefix } from '../shared/ipcErrors';
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) { throw new Error(error instanceof Error ? stripIpcErrorPrefix(error.message) : '操作失败，请重试。'); }
}
const bridge: Bridge = {
  getInitial: () => invoke('lt:initial'),
  getDiagnostics: () => invoke('lt:diagnostics'),
  translate: request => invoke('lt:translate', request),
  cancel: id => invoke('lt:cancel', id),
  onChunk(listener) { const receive = (_event: Electron.IpcRendererEvent, chunk: TranslationChunk) => listener(chunk); ipcRenderer.on('lt:chunk', receive); return () => ipcRenderer.removeListener('lt:chunk', receive); },
  openTranslation: text => invoke('lt:open', text),
  translateSelection: () => invoke('lt:selection'),
  setPinned: value => invoke('lt:pin', value),
  setOpacity: value => invoke('lt:opacity', value),
  minimize: () => invoke('lt:minimize'),
  close: () => invoke('lt:close'),
  copy: text => invoke('lt:copy', text),
  reimportProfile: () => invoke('lt:reimport'),
  saveLanguages: value => invoke('lt:languages', value)
};
contextBridge.exposeInMainWorld('lightTranslate', Object.freeze(bridge));
