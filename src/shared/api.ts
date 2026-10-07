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
export interface Bridge {
  getInitial(): Promise<InitialState>;
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
