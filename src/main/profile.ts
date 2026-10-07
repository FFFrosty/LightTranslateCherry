import { app, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProfileDiagnostics, PublicProfile } from '../shared/api';
import { endpointFor, type SecretProfile } from './translation';

export class ProfileStore {
  private current: SecretProfile | null = null;
  private loadedSource: 'local' | 'legacy' | null = null;
  private loadedAt: string | null = null;
  private sourcePath: string | null = null;
  private sourceSize: number | null = null;
  private sourceModifiedAt: string | null = null;
  private legacyImportPath: string | null = null;
  private localLoadFailure: 'missing' | 'unreadable' | null = null;
  private readonly file = path.join(app.getPath('userData'), 'profile.enc');
  get secret() { return this.current; }
  get public(): PublicProfile | null { return this.current ? { provider: this.current.provider, model: this.current.model, configured: true } : null; }
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
      try { this.current = this.validate(JSON.parse(safeStorage.decryptString(readFileSync(this.file)))); this.recordLoaded('local', this.file); this.localLoadFailure = null; return; }
      catch { this.localLoadFailure = 'unreadable'; /* A corrupt local copy can be repaired from the original. */ }
    } else this.localLoadFailure = 'missing';
    await this.reimport();
  }
  private validate(raw: unknown): SecretProfile {
    if (!raw || typeof raw !== 'object') throw new Error('翻译配置格式无效。');
    const source = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value]));
    const take = (modern: string, legacy: string, max: number) => { const value = source[modern] ?? source[legacy]; if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('翻译配置不完整。'); return value.trim(); };
    const result = { provider: take('provider', 'providername', 200), model: take('model', 'modelid', 300), baseUrl: take('baseurl', 'baseurl', 2048), apiKey: take('apikey', 'apikey', 8192) };
    endpointFor(result.baseUrl);
    return result;
  }
  async reimport(): Promise<PublicProfile> {
    const local = process.env.LOCALAPPDATA;
    const source = local ? path.join(local, 'LightTranslate', 'profile.bin') : '';
    this.legacyImportPath = source || null;
    if (!source || !existsSync(source)) throw new Error('未找到旧版配置：%LOCALAPPDATA%\\LightTranslate\\profile.bin。请先在旧版保存配置，然后重新导入。');
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
    try { writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(next))); } catch { throw new Error('无法安全保存导入的配置，请检查本地文件权限。'); }
    this.current = next;
    this.recordLoaded('legacy', source);
    return this.public!;
  }
}
