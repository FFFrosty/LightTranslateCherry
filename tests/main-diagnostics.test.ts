import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
const mocks = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn(), write: vi.fn(), stat: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), exec: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => 'C:\\fixture\\live-user-data' }, safeStorage: { decryptString: mocks.decrypt, encryptString: mocks.encrypt, isEncryptionAvailable: () => true } }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists, readFileSync: mocks.read, writeFileSync: mocks.write, statSync: mocks.stat }));
vi.mock('node:child_process', () => ({ execFile: mocks.exec }));
import { ProfileStore } from '../src/main/profile';
import { translate, TranslationDiagnostics, TranslationError } from '../src/main/translation';

const local = { provider: 'Memory Provider', model: 'memory-model', baseUrl: 'https://memory.example.invalid/private-path/v1', apiKey: 'LOCAL-FAKE-SECRET-NEVER-DISPLAY' };
const legacy = { provider: 'Imported Provider', model: 'imported-model', baseUrl: 'https://legacy.example.invalid/another-private-path/v1', apiKey: 'LEGACY-FAKE-SECRET-NEVER-DISPLAY' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('LOCALAPPDATA', 'D:\\fixture\\actual-process-environment');
  mocks.exists.mockReturnValue(true);
  mocks.read.mockReturnValue(Buffer.from('fake-encrypted-fixture'));
  mocks.decrypt.mockReturnValue(JSON.stringify(local));
  mocks.encrypt.mockReturnValue(Buffer.from('fake-ciphertext'));
  mocks.stat.mockReturnValue({ size: 456, mtime: new Date('2026-10-07T01:02:03.000Z') });
  mocks.exec.mockImplementation((_program, _args, _options, callback) => callback(null, JSON.stringify(legacy)));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('live profile diagnostics', () => {
  it('reports the loaded memory values rather than changes in the configuration file', async () => {
    const store = new ProfileStore();
    await store.initialize();
    mocks.decrypt.mockReturnValue(JSON.stringify(legacy));
    const diagnostic = store.diagnostics;
    expect(diagnostic).toEqual({ profilePath: path.join('C:\\fixture\\live-user-data', 'profile.enc'), source: 'local', sourcePath: path.join('C:\\fixture\\live-user-data', 'profile.enc'), sourceSize: 456, sourceModifiedAt: '2026-10-07T01:02:03.000Z', legacyImportPath: null, loadedAt: expect.any(String), localLoadFailure: null, provider: store.secret!.provider, model: store.secret!.model, host: 'memory.example.invalid' });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.decrypt).toHaveBeenCalledOnce();
    expect(JSON.stringify(diagnostic)).not.toContain(local.apiKey);
    expect(JSON.stringify(diagnostic)).not.toContain('/private-path');
    diagnostic.provider = 'external mutation';
    expect(store.diagnostics.provider).toBe('Memory Provider');
  });
  it('records the actual legacy path passed to the child and uses its source metadata after reimport', async () => {
    const store = new ProfileStore();
    await store.initialize();
    await store.reimport();
    const passedPath = mocks.exec.mock.calls[0][2].env.LT_IMPORT_PROFILE;
    expect(store.diagnostics.sourcePath).toBe(passedPath);
    expect(store.diagnostics.legacyImportPath).toBe(passedPath);
    expect(passedPath).toBe(path.join(process.env.LOCALAPPDATA!, 'LightTranslate', 'profile.bin'));
    expect(mocks.stat).toHaveBeenLastCalledWith(passedPath);
    expect(store.diagnostics).toMatchObject({ source: 'legacy', sourceSize: 456, sourceModifiedAt: '2026-10-07T01:02:03.000Z', provider: legacy.provider, model: legacy.model, host: 'legacy.example.invalid' });
    expect(JSON.stringify(store.diagnostics)).not.toContain(legacy.apiKey);
  });
  it.each(['missing', 'unreadable'] as const)('keeps only the %s local-load enum when falling back to legacy', async reason => {
    if (reason === 'missing') mocks.exists.mockImplementation(file => !String(file).endsWith('profile.enc'));
    else mocks.decrypt.mockImplementation(() => { throw new Error('private decryption exception and secret'); });
    const store = new ProfileStore();
    await store.initialize();
    expect(store.diagnostics).toMatchObject({ localLoadFailure: reason, source: 'legacy', provider: legacy.provider });
    expect(JSON.stringify(store.diagnostics)).not.toContain('private decryption');
  });
  it('does not replace a successful load when a later legacy import fails', async () => {
    const store = new ProfileStore();
    await store.initialize();
    mocks.exec.mockImplementation((_program, _args, _options, callback) => callback(new Error('private service detail'), 'private stdout'));
    await expect(store.reimport()).rejects.toThrow('无法解密旧版配置');
    expect(store.diagnostics).toMatchObject({ source: 'local', provider: local.provider, host: 'memory.example.invalid' });
    expect(JSON.stringify(store.diagnostics)).not.toContain('private service');
  });
});

describe('real-request metadata', () => {
  it('records HTTP 402 from the same captured profile used by fetch without text, key, URL path or response body', async () => {
    const store = new ProfileStore();
    await store.initialize();
    const requestProfile = store.secret!;
    const records = new TranslationDiagnostics();
    const generation = records.begin(requestProfile);
    await store.reimport(); // The active request must retain its original provider.
    const fetcher = vi.fn(async () => new Response('PRIVATE-BACKEND-BODY', { status: 402 })) as unknown as typeof fetch;
    try {
      await translate(requestProfile, 'PRIVATE-SELECTED-TEXT', 'en-us', new AbortController().signal, () => {}, fetcher, status => records.recordHttpStatus(generation, status));
      throw new Error('Expected a rejected request');
    } catch (error) {
      expect(error).toBeInstanceOf(TranslationError);
      expect((error as TranslationError).httpStatus).toBe(402);
      records.finish(generation, 'failed', (error as TranslationError).httpStatus);
    }
    expect(fetcher).toHaveBeenCalledWith('https://memory.example.invalid/private-path/v1/chat/completions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${local.apiKey}` }) }));
    expect(store.diagnostics.provider).toBe(legacy.provider);
    expect(records.snapshot).toEqual({ startedAt: expect.any(String), provider: local.provider, model: local.model, host: 'memory.example.invalid', status: 'failed', httpStatus: 402 });
    const serialized = JSON.stringify(records.snapshot);
    for (const secret of [local.apiKey, legacy.apiKey, 'PRIVATE-SELECTED-TEXT', 'PRIVATE-BACKEND-BODY', '/private-path']) expect(serialized).not.toContain(secret);
  });
  it('keeps the most recently started request when an older concurrent request finishes', () => {
    const records = new TranslationDiagnostics();
    const older = records.begin(local);
    const newer = records.begin(legacy);
    records.finish(older, 'failed', 402);
    expect(records.snapshot).toMatchObject({ provider: legacy.provider, status: 'pending', httpStatus: null });
    records.recordHttpStatus(newer, 200);
    records.finish(newer, 'succeeded');
    expect(records.snapshot).toMatchObject({ status: 'succeeded', httpStatus: 200 });
    records.snapshot!.provider = 'external mutation';
    expect(records.snapshot!.provider).toBe(legacy.provider);
  });
});
