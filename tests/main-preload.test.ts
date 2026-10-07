import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '../src/shared/api';
import { stripIpcErrorPrefix } from '../src/shared/ipcErrors';
const electron = vi.hoisted(() => ({ contextBridge: { exposeInMainWorld: vi.fn() }, ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));
vi.mock('electron', () => electron);
import '../src/main/preload';
const bridge = electron.contextBridge.exposeInMainWorld.mock.calls[0][1] as Bridge;
beforeEach(() => { electron.ipcRenderer.invoke.mockReset(); });

describe('safe IPC error presentation', () => {
  it('removes only the exact leading Electron transport prefix', () => {
    expect(stripIpcErrorPrefix("Error invoking remote method 'lt:translate': Error: 服务拒绝请求（HTTP 402）。")).toBe('服务拒绝请求（HTTP 402）。');
    expect(stripIpcErrorPrefix("Error invoking remote method 'lt:copy': 未找到选区。")).toBe('未找到选区。');
    expect(stripIpcErrorPrefix('普通错误：Error: 原始说明')).toBe('普通错误：Error: 原始说明');
    expect(stripIpcErrorPrefix("说明中提到 Error invoking remote method 'lt:copy': Error: X")).toBe("说明中提到 Error invoking remote method 'lt:copy': Error: X");
  });
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['initial', () => bridge.getInitial()], ['translate', () => bridge.translate({ id: 'req', text: 'text', target: 'en-us' })],
    ['cancel', () => bridge.cancel('req')], ['open', () => bridge.openTranslation('text')], ['selection', () => bridge.translateSelection()],
    ['pin', () => bridge.setPinned(true)], ['opacity', () => bridge.setOpacity(0.8)], ['minimize', () => bridge.minimize()],
    ['close', () => bridge.close()], ['copy', () => bridge.copy('text')], ['reimport', () => bridge.reimportProfile()],
    ['languages', () => bridge.saveLanguages({ primary: 'zh-cn', alternate: 'en-us' })]
  ];
  it.each(calls)('cleans failures from the %s bridge method', async (channel, call) => {
    electron.ipcRenderer.invoke.mockRejectedValue(new Error(`Error invoking remote method 'lt:${channel}': Error: 固定安全提示。`));
    await expect(call()).rejects.toThrow(/^固定安全提示。$/);
    expect(electron.ipcRenderer.invoke.mock.calls[0][0]).toBe(`lt:${channel}`);
  });
  it('preserves successful values and method arguments', async () => {
    electron.ipcRenderer.invoke.mockResolvedValue('  translated text\n');
    const request = { id: 'req', text: 'original', target: 'en-us' };
    await expect(bridge.translate(request)).resolves.toBe('  translated text\n');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('lt:translate', request);
  });
});
