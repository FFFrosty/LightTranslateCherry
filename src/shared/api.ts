export interface PublicProfile { provider: string; model: string; configured: boolean }
export interface Preferences { primary: string; alternate: string }
export interface InitialState {
  kind: 'result' | 'toolbar' | 'manual';
  text: string;
  profile: PublicProfile | null;
  preferences: Preferences;
}
export interface TranslateRequest { id: string; text: string; target: string }
export interface TranslationChunk { id: string; text: string }
export interface ProfileDiagnostics {
  profilePath: string;
  source: 'local' | 'legacy' | null;
  sourcePath: string | null;
  sourceSize: number | null;
  sourceModifiedAt: string | null;
  legacyImportPath: string | null;
  loadedAt: string | null;
  localLoadFailure: 'missing' | 'unreadable' | null;
  provider: string | null;
  model: string | null;
  host: string | null;
}
export interface RequestDiagnostics {
  startedAt: string;
  provider: string;
  model: string;
  host: string;
  status: 'pending' | 'succeeded' | 'failed';
  httpStatus: number | null;
}
export interface AppDiagnostics {
  version: string;
  pid: number;
  executable: string;
  userData: string;
  demo: boolean;
  profile: ProfileDiagnostics;
  latestRequest: RequestDiagnostics | null;
}
export interface Bridge {
  getInitial(): Promise<InitialState>;
  getDiagnostics(): Promise<AppDiagnostics>;
  translate(request: TranslateRequest): Promise<string>;
  cancel(id: string): Promise<void>;
  onChunk(listener: (chunk: TranslationChunk) => void): () => void;
  openTranslation(text: string): Promise<void>;
  translateSelection(): Promise<void>;
  setPinned(value: boolean): Promise<void>;
  setOpacity(value: number): Promise<void>;
  minimize(): Promise<void>;
  close(): Promise<void>;
  copy(text: string): Promise<void>;
  reimportProfile(): Promise<PublicProfile>;
  saveLanguages(value: Preferences): Promise<void>;
}
declare global { interface Window { lightTranslate: Bridge } }
