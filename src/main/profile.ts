import { app, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import { constants, copyFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ModelSettings, ProfileDiagnostics, PublicProfile } from '../shared/api';
import { endpointFor, type SecretProfile } from './translation';

// Shared by all configuration-changing IPCs, including the file-picker lifetime.
export class ProfileMutationGate {
  private busy = false;
  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.busy) throw new Error('已有配置操作正在进行，请完成后重试。');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
}

export class ProfileStore {
  private current: SecretProfile | null = null;
  private loadError: string | undefined;
  private loadedSource: 'local' | 'legacy' | null = null;
  private loadedAt: string | null = null;
  private sourcePath: string | null = null;
  private sourceSize: number | null = null;
  private sourceModifiedAt: string | null = null;
  private legacyImportPath: string | null = null;
  private localLoadFailure: 'missing' | 'unreadable' | null = null;
  private readonly file = path.join(app.getPath('userData'), 'profile.enc');
  get secret() { return this.current; }
  get error() { return this.loadError; }
  get public(): PublicProfile | null { return this.current ? { provider: this.current.provider, model: this.current.model, configured: true } : null; }
  get settings(): ModelSettings | null { return this.current ? { provider: this.current.provider, model: this.current.model, baseUrl: this.current.baseUrl, hasApiKey: Boolean(this.current.apiKey) } : null; }
  get diagnostics(): ProfileDiagnostics {
    const current = this.current;
    // Whitelist only metadata from this live store; never re-read files for display.
    return { profilePath: this.file, source: this.loadedSource, sourcePath: this.sourcePath, sourceSize: this.sourceSize, sourceModifiedAt: this.sourceModifiedAt, legacyImportPath: this.legacyImportPath, loadedAt: this.loadedAt, localLoadFailure: this.localLoadFailure, provider: current?.provider ?? null, model: current?.model ?? null, host: current ? new URL(current.baseUrl).hostname : null };
  }
  private recordLoaded(source: 'local' | 'legacy', sourcePath: string) {
    this.loadedSource = source;
    this.sourcePath = sourcePath;
    this.loadedAt = new Date().toISOString();
    this.sourceSize = null;
    this.sourceModifiedAt = null;
    try { const stat = statSync(sourcePath); this.sourceSize = stat.size; this.sourceModifiedAt = stat.mtime.toISOString(); } catch { /* Metadata failure must not change loading behavior. */ }
  }
  async initialize() {
    if (existsSync(this.file)) {
      try { this.current = this.validate(JSON.parse(safeStorage.decryptString(readFileSync(this.file)))); this.recordLoaded('local', this.file); this.localLoadFailure = null; this.loadError = undefined; return; }
      catch { this.localLoadFailure = 'unreadable'; this.loadError = '无法读取或解密现有模型配置，原文件已保留。请打开“模型设置”重新配置，或选择已有加密配置文件导入。'; }
    } else { this.localLoadFailure = 'missing'; this.loadError = '尚未设置翻译模型。请打开“模型设置”填写配置，或导入已有加密配置文件。'; }
    // Never silently replace a missing/unreadable local profile with a different provider.
    throw new Error(this.loadError);
  }
  private validate(raw: unknown): SecretProfile {
    if (!raw || typeof raw !== 'object') throw new Error('翻译配置格式无效。');
    const source = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value]));
    const take = (modern: string, legacy: string, max: number) => { const value = source[modern] ?? source[legacy]; if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('翻译配置不完整。'); return value.trim(); };
    const result = { provider: take('provider', 'providername', 200), model: take('model', 'modelid', 300), baseUrl: take('baseurl', 'baseurl', 2048), apiKey: take('apikey', 'apikey', 8192) };
    endpointFor(result.baseUrl);
    if (/[\r\n]/.test(result.apiKey)) throw new Error('API Key 格式无效。');
    return result;
  }
  saveSettings(raw: unknown): PublicProfile {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('模型设置格式无效。');
    const input = raw as Record<string, unknown>;
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192)) throw new Error('API Key 格式无效。');
    if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) throw new Error('服务地址格式无效。');
    const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : input.baseUrl;
    if (!key && (!this.current || baseUrl !== this.current.baseUrl)) throw new Error('首次配置或更改服务地址时，必须填写该服务的 API Key。');
    const next = this.validate({ provider: input.provider, model: input.model, baseUrl, apiKey: key || this.current!.apiKey });
    this.persist(next, 'local', this.file);
    return this.public!;
  }
  private persist(next: SecretProfile, source: 'local' | 'legacy', sourcePath: string) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储暂不可用，配置未保存。');
    const temporary = `${this.file}.tmp-${randomUUID()}`;
    let encrypted: Buffer | undefined;
    try {
      encrypted = safeStorage.encryptString(JSON.stringify(next));
      writeFileSync(temporary, encrypted, { flag: 'wx' });
      // Back up the existing encrypted bytes before the atomic same-directory replacement.
      if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.backup-${randomUUID()}`, constants.COPYFILE_EXCL);
      renameSync(temporary, this.file);
    } catch { throw new Error('无法安全保存模型配置，原配置已保留。请检查本地文件权限后重试。'); }
    finally { encrypted?.fill(0); try { unlinkSync(temporary); } catch { /* The renamed or uncreated temporary file needs no cleanup. */ } }
    this.current = next;
    this.loadError = undefined;
    this.localLoadFailure = null;
    this.recordLoaded(source, sourcePath);
  }
  async reimport(): Promise<PublicProfile> {
    const local = process.env.LOCALAPPDATA;
    const source = local ? path.join(local, 'LightTranslate', 'profile.bin') : '';
    this.legacyImportPath = source || null;
    if (!source || !existsSync(source)) throw new Error('未找到旧版配置：%LOCALAPPDATA%\\LightTranslate\\profile.bin。请先在旧版保存配置，然后重新导入。');
    return this.importEncryptedFile(source);
  }
  async importProfileFile(source: string | null): Promise<PublicProfile | null> {
    if (source === null) return null;
    if (typeof source !== 'string' || !path.isAbsolute(source) || path.extname(source).toLowerCase() !== '.bin') throw new Error('请选择有效的 .bin 加密配置文件。');
    if (!existsSync(source)) throw new Error('所选配置文件不存在，请重新选择。');
    return this.importEncryptedFile(source);
  }
  private async importEncryptedFile(source: string): Promise<PublicProfile> {
    this.legacyImportPath = source;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储暂不可用，配置未保存。');
    // ProfileStore.cs encrypts UTF-8 JSON with CurrentUser DPAPI and no entropy.
    // The source path is passed via an environment value, never interpolated into PowerShell code.
    const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[IO.File]::ReadAllBytes($env:LT_IMPORT_PROFILE); $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); try { [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write([Text.Encoding]::UTF8.GetString($plain)) } finally { [Array]::Clear($plain,0,$plain.Length) }";
    const json = await new Promise<string>((resolve, reject) => {
      execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 65536, encoding: 'utf8', env: { ...process.env, LT_IMPORT_PROFILE: source } }, (error, stdout) => {
        // Never propagate process errors: stderr/stdout can contain decrypted material.
        if (error) reject(new Error('无法解密旧版配置。请使用保存该配置的 Windows 账户重新导入。')); else resolve(stdout);
      });
    });
    let next: SecretProfile;
    try { next = this.validate(JSON.parse(json)); } catch { throw new Error('旧版配置内容无效，请在旧版重新保存后再导入。'); }
    this.persist(next, 'legacy', source);
    return this.public!;
  }
}
