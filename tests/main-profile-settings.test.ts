import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const io = vi.hoisted(() => ({ files: new Map<string, Buffer>(), available: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), write: vi.fn(), copy: vi.fn(), rename: vi.fn(), remove: vi.fn(), exec: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => 'C:\\fixture\\model-settings' }, safeStorage: { isEncryptionAvailable: io.available, encryptString: io.encrypt, decryptString: io.decrypt } }));
vi.mock('node:fs', () => ({
  constants: { COPYFILE_EXCL: 1 }, existsSync: (file: string) => io.files.has(file),
  readFileSync: (file: string) => Buffer.from(io.files.get(file)!),
  statSync: (file: string) => ({ size: io.files.get(file)!.length, mtime: new Date('2026-10-07T00:00:00Z') }),
  writeFileSync: io.write, copyFileSync: io.copy, renameSync: io.rename, unlinkSync: io.remove
}));
vi.mock('node:child_process', () => ({ execFile: io.exec }));
import { ProfileMutationGate, ProfileStore } from '../src/main/profile';

const file = path.join('C:\\fixture\\model-settings', 'profile.enc');
const importedFile = path.join('C:\\fixture', 'selected.bin');
const original = { provider: 'Fixture A', model: 'model-a', baseUrl: 'https://a.example.invalid/v1', apiKey: 'FAKE-KEY-A' };
const replacement = { provider: 'Fixture B', model: 'model-b', baseUrl: 'https://b.example.invalid/v1', apiKey: 'FAKE-KEY-B' };
// A reversible test codec exercises persistence; no real safeStorage, DPAPI, files or network.
const encode = (value: unknown) => Buffer.from(`fixture-encrypted:${JSON.stringify(value)}`);
beforeEach(() => {
  vi.resetAllMocks();
  io.files.clear();
  io.files.set(file, encode(original));
  io.files.set(importedFile, Buffer.from('fixture-DPAPI-input'));
  io.available.mockReturnValue(true);
  io.encrypt.mockImplementation((plain: string) => Buffer.from(`fixture-encrypted:${plain}`));
  io.decrypt.mockImplementation((encrypted: Buffer) => {
    const value = encrypted.toString();
    if (!value.startsWith('fixture-encrypted:')) throw new Error('private crypto failure');
    return value.slice('fixture-encrypted:'.length);
  });
  io.write.mockImplementation((destination: string, value: Buffer) => { io.files.set(destination, Buffer.from(value)); });
  io.copy.mockImplementation((source: string, destination: string) => { io.files.set(destination, Buffer.from(io.files.get(source)!)); });
  io.rename.mockImplementation((source: string, destination: string) => { io.files.set(destination, io.files.get(source)!); io.files.delete(source); });
  io.remove.mockImplementation((destination: string) => { io.files.delete(destination); });
  io.exec.mockImplementation((_program, _args, _options, callback) => callback(null, JSON.stringify(replacement)));
});
async function loaded() { const store = new ProfileStore(); await store.initialize(); return store; }

describe('independent encrypted model settings', () => {
  it('preserves unreadable encrypted bytes and never imports automatically', async () => {
    const broken = Buffer.from('unreadable-existing-ciphertext');
    io.files.set(file, broken);
    const store = new ProfileStore();
    await expect(store.initialize()).rejects.toThrow('原文件已保留');
    expect(io.files.get(file)).toEqual(broken);
    expect(store.settings).toBeNull();
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
    expect(io.copy).not.toHaveBeenCalled();
  });
  it('does not import or create a profile on first launch', async () => {
    io.files.delete(file);
    const store = new ProfileStore();
    await expect(store.initialize()).rejects.toThrow('尚未设置');
    expect(io.files.has(file)).toBe(false);
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
  });
  it('saves encrypted settings atomically, backs up old bytes, and loads the saved configuration', async () => {
    const store = await loaded();
    expect(store.saveSettings(replacement)).toEqual({ provider: replacement.provider, model: replacement.model, configured: true });
    const backup = [...io.files.keys()].find(name => name.startsWith(`${file}.backup-`))!;
    expect(io.files.get(backup)).toEqual(encode(original));
    expect(io.files.get(file)).toEqual(encode(replacement));
    expect(io.rename.mock.calls[0][0]).toMatch(/profile\.enc\.tmp-/);
    expect(path.dirname(io.rename.mock.calls[0][0])).toBe(path.dirname(file));
    expect(io.copy.mock.invocationCallOrder[0]).toBeLessThan(io.rename.mock.invocationCallOrder[0]);
    expect([...io.files.keys()].some(name => name.includes('.tmp-'))).toBe(false);
    const reopened = await loaded();
    expect(reopened.secret).toEqual(replacement);
    expect(reopened.settings).toEqual({ provider: replacement.provider, model: replacement.model, baseUrl: replacement.baseUrl, hasApiKey: true });
    expect(JSON.stringify([reopened.public, reopened.settings, reopened.diagnostics])).not.toContain(replacement.apiKey);
    reopened.settings!.provider = 'external mutation';
    expect(reopened.settings!.provider).toBe(replacement.provider);
  });
  it('retains a blank key only for the same service URL', async () => {
    const store = await loaded();
    store.saveSettings({ provider: original.provider, model: 'new-model', baseUrl: original.baseUrl, apiKey: '  ' });
    expect(store.secret).toEqual({ ...original, model: 'new-model' });
    const saved = Buffer.from(io.files.get(file)!);
    expect(() => store.saveSettings({ ...replacement, apiKey: '' })).toThrow('必须填写');
    expect(io.files.get(file)).toEqual(saved);
    expect(store.secret!.baseUrl).toBe(original.baseUrl);
    expect(() => new ProfileStore().saveSettings({ ...replacement, apiKey: undefined })).toThrow('必须填写');
  });
  it.each([
    null, [], { ...replacement, provider: 123 }, { ...replacement, model: 'x'.repeat(301) },
    { ...replacement, baseUrl: 'http://remote.example.invalid' }, { ...replacement, baseUrl: 'x'.repeat(2049) },
    { ...replacement, apiKey: 123 }, { ...replacement, apiKey: 'x'.repeat(8193) }, { ...replacement, apiKey: 'key\nother' }
  ])('rejects invalid settings before writing (%#)', async value => {
    const store = await loaded();
    expect(() => store.saveSettings(value)).toThrow();
    expect(io.write).not.toHaveBeenCalled();
    expect(store.secret).toEqual(original);
    expect(io.files.get(file)).toEqual(encode(original));
  });
  it('writes nothing when safeStorage is unavailable', async () => {
    const store = await loaded();
    io.available.mockReturnValue(false);
    expect(() => store.saveSettings(replacement)).toThrow('安全存储');
    expect(io.write).not.toHaveBeenCalled();
    expect(io.encrypt).not.toHaveBeenCalled();
    expect(io.files.get(file)).toEqual(encode(original));
    expect(store.secret).toEqual(original);
  });
  it.each(['encrypt', 'write', 'copy', 'rename'] as const)('preserves memory and original file when %s fails', async operation => {
    const store = await loaded();
    io[operation].mockImplementation(() => { throw new Error('PRIVATE-INTERNAL-ERROR'); });
    expect(() => store.saveSettings(replacement)).toThrow(/^无法安全保存模型配置/);
    expect(io.files.get(file)).toEqual(encode(original));
    expect(store.secret).toEqual(original);
    expect([...io.files.keys()].some(name => name.includes('.tmp-'))).toBe(false);
  });
});

describe('explicit selected encrypted-file import', () => {
  it('blocks overlapping save/reimport while the picker and import are pending, then releases after cancellation', async () => {
    const store = await loaded();
    const gate = new ProfileMutationGate();
    let finishPicker!: (value: null) => void;
    const picker = new Promise<null>(resolve => { finishPicker = resolve; });
    const pending = gate.run(async () => store.importProfileFile(await picker));
    await expect(gate.run(() => store.saveSettings(replacement))).rejects.toThrow('已有配置操作');
    await expect(gate.run(() => store.reimport())).rejects.toThrow('已有配置操作');
    expect(io.write).not.toHaveBeenCalled();
    expect(io.exec).not.toHaveBeenCalled();
    finishPicker(null);
    await expect(pending).resolves.toBeNull();
    await expect(gate.run(() => store.saveSettings(replacement))).resolves.toMatchObject({ provider: replacement.provider });
  });
  it('holds the gate until decryption completes and releases it after a failed import', async () => {
    const store = await loaded();
    const gate = new ProfileMutationGate();
    let finish!: (error: Error, stdout: string) => void;
    io.exec.mockImplementation((_program, _args, _options, callback) => { finish = callback; });
    const pending = gate.run(() => store.importProfileFile(importedFile));
    await expect(gate.run(() => store.saveSettings(replacement))).rejects.toThrow('已有配置操作');
    finish(new Error('private failure'), 'private stdout');
    await expect(pending).rejects.toThrow('无法解密');
    await expect(gate.run(() => store.saveSettings(replacement))).resolves.toMatchObject({ provider: replacement.provider });
    await expect(gate.run(() => { throw new Error('fixed sync failure'); })).rejects.toThrow('fixed sync failure');
    await expect(gate.run(() => 'released')).resolves.toBe('released');
  });
  it('cancellation leaves the current configuration and files untouched', async () => {
    const store = await loaded();
    await expect(store.importProfileFile(null)).resolves.toBeNull();
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
    expect(store.secret).toEqual(original);
    expect(io.files.get(file)).toEqual(encode(original));
  });
  it('imports only the selected file and reencrypts for this instance', async () => {
    const store = await loaded();
    const result = await store.importProfileFile(importedFile);
    expect(result).toEqual({ provider: replacement.provider, model: replacement.model, configured: true });
    expect(JSON.stringify(result)).not.toContain(replacement.apiKey);
    expect(io.exec.mock.calls[0][2]).toMatchObject({ windowsHide: true, env: { LT_IMPORT_PROFILE: importedFile } });
    expect(io.exec.mock.calls[0][1].join(' ')).toContain('CurrentUser');
    expect(io.files.get(importedFile)).toEqual(Buffer.from('fixture-DPAPI-input'));
    expect(io.files.get(file)).toEqual(encode(replacement));
    expect(store.diagnostics.sourcePath).toBe(importedFile);
    expect(store.secret).toEqual(replacement);
  });
  it.each(['process', 'json', 'invalid'] as const)('leaves original bytes and memory after %s import failure', async failure => {
    const store = await loaded();
    io.exec.mockImplementation((_program, _args, _options, callback) => callback(failure === 'process' ? new Error('PRIVATE-PROCESS-ERROR') : null, failure === 'invalid' ? JSON.stringify({ ...replacement, apiKey: '' }) : 'PRIVATE-STDOUT'));
    let error: unknown;
    try { await store.importProfileFile(importedFile); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('PRIVATE');
    expect(io.write).not.toHaveBeenCalled();
    expect(store.secret).toEqual(original);
    expect(io.files.get(file)).toEqual(encode(original));
  });
});
