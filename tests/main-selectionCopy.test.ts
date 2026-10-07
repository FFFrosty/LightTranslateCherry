import { beforeEach, describe, expect, it, vi } from 'vitest';
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
import { copyEdgeSelection, probeEdgeSource } from '../src/main/selectionCopy';

const helper = 'C:\\fixture\\SelectionCopy.exe';
const source = { hwnd: '123456', pid: 4321 };
beforeEach(() => { execFile.mockReset(); });
describe('explicit Edge copy wrapper', () => {
  it('probes only through the fixed hidden helper with a bounded probe timeout', async () => {
    execFile.mockImplementation((_path, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, source })));
    await expect(probeEdgeSource(helper)).resolves.toEqual(source);
    expect(execFile).toHaveBeenCalledWith(helper, ['probe'], expect.objectContaining({ windowsHide: true, timeout: 2500 }), expect.any(Function));
  });
  it('copies exact whitespace without a hard process timeout that could interrupt restoration', async () => {
    const text = 'Text-controlled  example\r\nnext line';
    execFile.mockImplementation((_path, _args, options, callback) => { expect(options).not.toHaveProperty('timeout'); callback(null, JSON.stringify({ ok: true, text })); });
    await expect(copyEdgeSelection(helper, source)).resolves.toBe(text);
    expect(execFile.mock.calls[0][1]).toEqual(['copy', '123456', '4321']);
  });
  it('rejects a second capture until the first helper finishes', async () => {
    let finish: (error: null, result: string) => void = () => {};
    execFile.mockImplementation((_path, _args, _options, callback) => { finish = callback; });
    const pending = copyEdgeSelection(helper, source);
    await expect(copyEdgeSelection(helper, source)).rejects.toThrow('正在读取另一个选区');
    expect(execFile).toHaveBeenCalledOnce();
    finish(null, JSON.stringify({ ok: true, text: 'fixed fixture text' }));
    await expect(pending).resolves.toBe('fixed fixture text');
  });
  it('rejects invalid source identifiers before launching a process', async () => {
    await expect(copyEdgeSelection(helper, { hwnd: '123;unexpected', pid: 1 })).rejects.toThrow('复制请求无效');
    expect(execFile).not.toHaveBeenCalled();
  });
  it('does not expose arbitrary subprocess error output', async () => {
    execFile.mockImplementation((_path, _args, _options, callback) => callback(new Error('private command'), JSON.stringify({ ok: false, error: 'private selected document text' })));
    await expect(copyEdgeSelection(helper, source)).rejects.toThrow('无法安全复制当前选区，请手动复制后粘贴到翻译面板。');
  });
  it('returns null for invalid or failed source probes', async () => {
    execFile.mockImplementation((_path, _args, _options, callback) => callback(null, JSON.stringify({ ok: true, source: { hwnd: 'invalid', pid: 1 } })));
    await expect(probeEdgeSource(helper)).resolves.toBeNull();
  });
});
