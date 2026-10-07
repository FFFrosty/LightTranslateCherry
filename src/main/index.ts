import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, Tray } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { SelectionHookInstance, SelectionHookConstructor, TextSelectionData } from 'selection-hook';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InitialState, Preferences, TranslateRequest } from '../shared/api';
import { ProfileStore } from './profile';
import { translate, validLanguage } from './translation';
import { fitBounds, replaceableResults } from './windowPolicy';

const demo = process.argv.includes('--demo');
app.setName('LightTranslate Cherry');
const demoDataPath = demo ? app.commandLine.getSwitchValue('user-data-dir') : '';
app.setPath('userData', demoDataPath && path.isAbsolute(demoDataPath) ? demoDataPath : path.join(app.getPath('appData'), demo ? 'LightTranslate Cherry Demo' : 'LightTranslate Cherry'));
app.setAppUserModelId('io.lighttranslate.cherry');
const prefsFile = path.join(app.getPath('userData'), 'preferences.json');
let preferences: Preferences = { primary: 'zh-cn', alternate: 'en-us' };
let sizes = { manual: { width: 620, height: 660 }, result: { width: 540, height: 540 } };
try {
  const saved = JSON.parse(readFileSync(prefsFile, 'utf8'));
  if (validLanguage(saved.primary) && validLanguage(saved.alternate)) preferences = { primary: saved.primary, alternate: saved.alternate };
  for (const kind of ['manual', 'result'] as const) { const size = saved.sizes?.[kind]; if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) sizes[kind] = { width: Math.max(360, Math.min(1800, size.width)), height: Math.max(280, Math.min(1400, size.height)) }; }
} catch { /* First run or damaged non-secret preferences: use defaults. */ }
function savePreferences() { try { writeFileSync(prefsFile, JSON.stringify({ ...preferences, sizes })); } catch { /* Window closing must remain available even on a read-only disk. */ } }
type Managed = { window: BrowserWindow; state: Pick<InitialState, 'kind' | 'text'>; pinned: boolean; request?: { id: string; controller: AbortController }; timer?: ReturnType<typeof setTimeout> };
const windows = new Map<number, Managed>();
let profile: ProfileStore;
let tray: Tray | undefined;
let hook: SelectionHookInstance | null = null;
let paused = false;
let hookError = '';
let toolbar: BrowserWindow | undefined;
let ready = false;
let quitting = false;
const rendererFile = path.join(__dirname, '../renderer/index.html');
const rendererUrl = pathToFileURL(rendererFile).toString();
const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');

function ownSelection(data: TextSelectionData) {
  return !!BrowserWindow.getFocusedWindow() || data.programName.toLowerCase() === path.basename(process.execPath).toLowerCase() || /lighttranslate cherry/i.test(data.programName);
}
function cancelRequest(entry: Managed) { if (entry.request) { entry.request.controller.abort(); entry.request = undefined; } }
function hideToolbar() { if (toolbar && !toolbar.isDestroyed()) toolbar.hide(); }
function activate(entry: Managed) {
  const win = entry.window;
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true); win.show(); win.focus();
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(entry.pinned); }, 350);
}
function createWindow(kind: InitialState['kind'], text = '', point = screen.getCursorScreenPoint()): Managed {
  const isToolbar = kind === 'toolbar';
  const size = isToolbar ? { width: 176, height: 48 } : sizes[kind];
  const area = screen.getDisplayNearestPoint(point).workArea;
  const bounds = fitBounds({ x: point.x + 10, y: point.y + 14 }, size, area);
  const win = new BrowserWindow({ ...bounds, title: 'LightTranslate Cherry', icon: iconPath, show: false, frame: false, transparent: false, backgroundColor: '#fbfbfc', resizable: !isToolbar, maximizable: !isToolbar, minimizable: !isToolbar, minWidth: isToolbar ? 176 : 360, minHeight: isToolbar ? 48 : 280, skipTaskbar: isToolbar, focusable: !isToolbar, alwaysOnTop: isToolbar, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: demo } });
  const entry: Managed = { window: win, state: { kind, text }, pinned: false };
  const contentId = win.webContents.id;
  windows.set(contentId, entry);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => { cancelRequest(entry); if (entry.timer) clearTimeout(entry.timer); windows.delete(contentId); if (toolbar === win) toolbar = undefined; });
  if (!isToolbar) win.on('resized', () => { if (!win.isDestroyed() && !win.isMaximized()) { const [width, height] = win.getSize(); sizes[kind] = { width, height }; savePreferences(); } });
  win.once('ready-to-show', () => { if (win.isDestroyed()) return; if (isToolbar) { if (toolbar === win && !paused) win.showInactive(); } else activate(entry); });
  void win.loadFile(rendererFile).catch(() => { if (!win.isDestroyed()) win.close(); });
  return entry;
}
function showManual() {
  if (!ready || quitting) return;
  const existing = [...windows.values()].find(entry => entry.state.kind === 'manual');
  if (existing) activate(existing); else createWindow('manual');
}
function openResult(text: string) {
  if (quitting) return;
  hideToolbar();
  for (const id of replaceableResults([...windows.entries()].map(([id, entry]) => ({ id, kind: entry.state.kind, pinned: entry.pinned })))) { const win = windows.get(id)?.window; if (win && !win.isDestroyed()) win.close(); }
  createWindow('result', text);
}
function processSelection(data: TextSelectionData) {
  if (quitting || paused || ownSelection(data) || !data.text?.trim() || data.text.length > 12000) return;
  if (toolbar && !toolbar.isDestroyed()) toolbar.close();
  // Adapted from Cherry Studio SelectionService.processTextSelection:
  // native Windows coordinates are physical pixels; Electron uses DIP, then clamp to workArea.
  const raw = data.posLevel >= 3 ? data.endBottom : data.mousePosEnd;
  const valid = raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && raw.x !== -99999 && raw.y !== -99999;
  const point = valid ? screen.screenToDipPoint({ x: Math.round(raw.x), y: Math.round(raw.y) }) : screen.getCursorScreenPoint();
  toolbar = createWindow('toolbar', data.text, point).window;
}
function captureSelection() {
  if (quitting || !ready) return;
  try { const selection = hook?.getCurrentSelection(); if (selection && !ownSelection(selection) && selection.text?.trim() && selection.text.length <= 12000) { openResult(selection.text); return; } } catch { /* Manual entry is the explicit fallback. */ }
  showManual();
}
function updateTray() {
  if (quitting || !tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开翻译面板', click: showManual },
    { label: '翻译当前选中文字  Ctrl+Alt+Y', click: captureSelection, enabled: !demo },
    { type: 'separator' },
    { label: demo ? '演示模式（监听已禁用）' : hookError || (paused ? '恢复划词监听' : '暂停划词监听'), enabled: !demo, click: () => { paused = !paused; hideToolbar(); if (paused) { try { hook?.stop(); } catch { hookError = '监听暂停失败，请退出后重试'; } } else startHook(); updateTray(); } },
    { type: 'separator' },
    { label: '关于与许可', click: () => { void dialog.showMessageBox({ type: 'info', title: '关于 LightTranslate Cherry', message: `LightTranslate Cherry ${app.getVersion()}`, detail: '独立衍生工具，非 Cherry Studio 官方发行版。\n\n来源：CherryHQ/cherry-studio\n来源提交：dd0767e1e7ecd8e37f44376382f35cb7ba04bea8\n\n本程序按 GNU AGPL-3.0 发布，不提供任何保证。\n许可证、修改说明与对应源码说明见项目目录中的 LICENSE、NOTICE.md 和 THIRD_PARTY_NOTICES.md。', buttons: ['确定'], noLink: true }).catch(() => {}); } },
    { label: '退出 LightTranslate Cherry', click: () => app.quit() }
  ]));
}
function startHook() {
  if (demo || paused || quitting) return;
  try {
    if (!hook) {
      const Hook = require('selection-hook') as SelectionHookConstructor;
      hook = new Hook();
      hook.on('text-selection', processSelection);
      hook.on('error', () => { hookError = '监听失败（点击暂停后重试）'; updateTray(); });
      hook.on('mouse-down', event => { if (!toolbar || toolbar.isDestroyed()) return; const p = screen.screenToDipPoint({ x: event.x, y: event.y }), b = toolbar.getBounds(); if (p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height) toolbar.hide(); });
      hook.on('mouse-wheel', hideToolbar);
      hook.on('key-down', hideToolbar);
    }
    // Only accessibility selection is read. Never fall back to the old clipboard.
    if (!hook.start({ debug: false, enableClipboard: false, enableMouseMoveEvent: false })) throw new Error();
    hookError = '';
  } catch { hookError = '监听不可用（可使用手动翻译）'; }
  updateTray();
}
function sender(event: IpcMainInvokeEvent) {
  const entry = windows.get(event.sender.id);
  if (!entry || entry.window.isDestroyed() || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== rendererUrl) throw new Error('窗口请求无效。');
  return entry;
}
function checkedText(value: unknown, max = 12000): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`文本无效或超过 ${max} 字符限制。`); return value; }
function checkedId(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('请求编号无效。'); return value; }
function bind(channel: string, callback: (entry: Managed, ...args: any[]) => unknown) { ipcMain.handle(channel, (event, ...args) => callback(sender(event), ...args)); }
function setupIpc() {
  bind('lt:initial', entry => ({ ...entry.state, preferences, profile: demo ? { provider: '演示服务', model: 'Demo · 离线预览', configured: true } : profile.public }));
  bind('lt:open', (_entry, text) => openResult(checkedText(text)));
  bind('lt:selection', entry => { if (entry.state.kind !== 'toolbar') throw new Error('请从划词工具条发起翻译。'); openResult(checkedText(entry.state.text)); });
  bind('lt:pin', (entry, value) => { if (typeof value !== 'boolean' || entry.state.kind === 'toolbar') throw new Error('置顶设置无效。'); entry.pinned = value; entry.window.setAlwaysOnTop(value); });
  bind('lt:opacity', (entry, value) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.35 || value > 1) throw new Error('透明度无效。'); entry.window.setOpacity(value); });
  bind('lt:minimize', entry => entry.window.minimize());
  bind('lt:close', entry => entry.window.close());
  bind('lt:copy', (_entry, text) => clipboard.writeText(checkedText(text, 200000)));
  bind('lt:reimport', () => demo ? { provider: '演示服务', model: 'Demo · 离线预览', configured: true } : profile.reimport());
  bind('lt:languages', (_entry, value) => { if (!value || !validLanguage(value.primary) || !validLanguage(value.alternate)) throw new Error('语言设置无效。'); preferences = { primary: value.primary, alternate: value.alternate }; savePreferences(); });
  bind('lt:cancel', (entry, id) => { if (entry.request?.id === checkedId(id)) cancelRequest(entry); });
  bind('lt:translate', async (entry, input: TranslateRequest) => {
    if (entry.state.kind === 'toolbar' || !input || typeof input !== 'object') throw new Error('翻译请求无效。');
    const id = checkedId(input.id), text = checkedText(input.text);
    if (!validLanguage(input.target)) throw new Error('目标语言无效。');
    cancelRequest(entry);
    const controller = new AbortController();
    const request = { id, controller }; entry.request = request;
    const timeout = setTimeout(() => controller.abort('timeout'), 45000);
    const emit = (text: string) => { if (entry.request === request && !controller.signal.aborted && !entry.window.isDestroyed()) entry.window.webContents.send('lt:chunk', { id, text }); };
    try {
      if (demo) {
        const output = input.target === 'zh-cn' ? `这是一段演示译文。\n\n**独立翻译窗口**支持拖动、四边缩放、置顶和 Markdown 排版。\n\n原文：${text}` : `Demo translation (${input.target})\n\n${text}`;
        for (let index = 0; index < output.length; index += 4) { await new Promise(resolve => setTimeout(resolve, 45)); if (controller.signal.aborted) throw new Error('翻译已取消。'); emit(output.slice(0, index + 4)); }
        return output;
      }
      if (!profile.secret) throw new Error('尚未导入配置。请点击“重新导入”，从旧版安全配置恢复。');
      return await translate(profile.secret, text, input.target, controller.signal, emit);
    } finally { clearTimeout(timeout); if (entry.request === request) entry.request = undefined; }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showManual);
  app.on('window-all-closed', () => { /* The independent tray keeps the app available. */ });
  app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); for (const entry of windows.values()) cancelRequest(entry); try { hook?.stop(); hook?.removeAllListeners(); hook?.cleanup(); } catch { /* Release remaining Electron resources regardless of hook state. */ } if (tray && !tray.isDestroyed()) tray.destroy(); });
  void app.whenReady().then(async () => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    profile = new ProfileStore();
    if (!demo) { try { await profile.initialize(); } catch { /* The manual panel offers a safe, explicit reimport error. */ } }
    if (quitting) return;
    setupIpc();
    ready = true;
    tray = new Tray(nativeImage.createFromPath(iconPath)); tray.setToolTip('LightTranslate Cherry'); tray.on('double-click', showManual); updateTray();
    showManual();
    if (!demo) { startHook(); if (!globalShortcut.register('Control+Alt+Y', captureSelection)) { hookError = '快捷键占用；请使用托盘菜单'; updateTray(); } }
  }).catch(() => { dialog.showErrorBox('LightTranslate Cherry 启动失败', '无法启动独立翻译工具。请检查程序资源与本地数据目录权限，然后重新打开。'); app.quit(); });
}
