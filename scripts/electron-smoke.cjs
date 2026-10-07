/* Real, isolated BrowserWindow checks. Build first, then node scripts/electron-smoke.cjs.
 * Only the owned --demo app is automated; no global input or clipboard operations.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron, expect } = require('playwright/test');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.artifacts', 'electron-smoke');
const report = { startedAt: new Date().toISOString(), checks: [], warnings: [], screenshots: [], passed: false };
const firstText = 'Text-controlled  time series generation\nkeeps spaces, hyphens, and line breaks.';
const secondText = 'Temporary source: This result should be replaced by the next translation.';
const thirdText = 'Independent source: Closing another window must not stop this translation. ' + 'LongUnbrokenSource'.repeat(18);
let app;
let rendererNetworkAttempts = 0;
const pageErrors = [];

async function check(name, task) {
  const started = Date.now();
  try {
    const evidence = await task();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - started, ...(evidence ? { evidence } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, elapsedMs: Date.now() - started, error: String(error.message || error) });
    throw error;
  }
}

async function initial(page) {
  await page.waitForFunction(() => Boolean(window.lightTranslate));
  return page.evaluate(() => window.lightTranslate.getInitial());
}

async function nativeState(page) {
  const handle = await app.browserWindow(page);
  try {
    return await handle.evaluate(win => ({ id: win.id, visible: win.isVisible(), focused: win.isFocused(), pinned: win.isAlwaysOnTop(), resizable: win.isResizable(), bounds: win.getBounds(), minimum: win.getMinimumSize(), preferences: (() => { const p = win.webContents.getLastWebPreferences(); return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox }; })() }));
  } finally { await handle.dispose(); }
}

async function resize(page, width, height) {
  const before = (await nativeState(page)).bounds;
  const evidence = { before, requested: { width, height }, actual: null, toleranceDip: 1 };
  (report.resizes ||= []).push(evidence);
  const handle = await app.browserWindow(page);
  try { await handle.evaluate((win, size) => win.setBounds(size), { width, height }); }
  finally { await handle.dispose(); }
  // Windows fractional DPI can round the physical pixel size back by one DIP.
  // Check both native dimensions together and keep the actual bounds in reports.
  await expect.poll(async () => {
    evidence.actual = (await nativeState(page)).bounds;
    return Math.max(Math.abs(evidence.actual.width - width), Math.abs(evidence.actual.height - height));
  }, { message: `Native size must be within 1 DIP of ${width} × ${height}` }).toBeLessThanOrEqual(1);
  assert.ok(evidence.actual.width !== before.width || evidence.actual.height !== before.height, 'setBounds must actually change the native window size');
  return evidence;
}

async function screenshot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(artifacts, file) });
  report.screenshots.push(file);
}

async function completed(page) {
  await expect(page.locator('.translation-result')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect(page.locator('.translation-error')).toHaveCount(0);
  const content = await page.locator('.translation-result').innerText();
  assert.ok(content.trim().length > 0, 'Translation must have nonempty content');
  assert.ok(!/译文将在这里|等待输入文字|翻译已停止/.test(content), 'Expected a completed demo translation, not placeholder content');
  return content;
}

async function submit(manual, text) {
  await manual.getByLabel('输入或粘贴要翻译的文字').fill(text);
  const nextWindow = app.waitForEvent('window', { timeout: 10000 });
  await manual.getByRole('button', { name: '翻译', exact: true }).click();
  const page = await nextWindow;
  const state = await initial(page);
  assert.equal(state.kind, 'result');
  assert.equal(state.text, text);
  await expect(page.locator('[data-ui="selection.action"]')).toBeVisible();
  return page;
}

async function assertVisibleAndFocused(page) {
  await expect.poll(async () => (await nativeState(page)).visible, { message: 'New result must be natively visible' }).toBe(true);
  try {
    await expect.poll(async () => (await nativeState(page)).focused, { timeout: 5000, message: 'New result must receive native focus; do not substitute DOM focus or force focus in this test' }).toBe(true);
  } catch (error) {
    report.warnings.push('The native focus assertion failed. Windows desktop focus restrictions may affect unattended sessions; this run is not reported as passing.');
    report.focusFailure = await nativeState(page);
    throw error;
  }
  return nativeState(page);
}

async function assertNativePinned(page, expected) {
  const started = Date.now();
  const evidence = { expected, timeoutMs: 5000, samples: [] };
  (report.nativePinChecks ||= []).push(evidence);
  // Verify native state independently of the renderer's IPC acknowledgement.
  // Record a bounded observation window so a lasting native failure cannot be
  // mistaken for a short notification delay or replaced by the button's state.
  await expect.poll(async () => {
    const state = await nativeState(page);
    evidence.samples.push({ elapsedMs: Date.now() - started, windowId: state.id, pinned: state.pinned });
    return state.pinned;
  }, { timeout: evidence.timeoutMs, intervals: [25, 50, 100, 200], message: `Native always-on-top must become ${expected}` }).toBe(expected);
  return evidence;
}

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => {
    const containers = [document.documentElement, document.body, ...document.querySelectorAll('.action-window, .window-content, .translation-body, .translation-result, .language-settings, .window-footer')];
    return containers.map(el => ({ name: el.className || el.tagName, client: el.clientWidth, scroll: el.scrollWidth })).filter(row => row.client > 0);
  });
  for (const row of metrics) assert.ok(row.scroll <= row.client + 1, `${row.name} overflows horizontally: ${row.scroll} > ${row.client}`);
  return metrics;
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  await fs.access(path.join(root, 'dist/main/index.cjs'));
  const isolatedData = await fs.mkdtemp(path.join(artifacts, 'user-data-'));
  // ELECTRON_RUN_AS_NODE can be inherited from an editor terminal; remove it.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: ['.', '--demo', `--user-data-dir=${isolatedData}`], cwd: root, env, timeout: 30000 });
  app.context().on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  app.context().on('request', request => { if (/^https?:/i.test(request.url())) rendererNetworkAttempts++; });
  const manual = await app.firstWindow();
  manual.on('pageerror', error => pageErrors.push(error.message));
  manual.setDefaultTimeout(10000);

  await check('demo manual window and public IPC boundary', async () => {
    const runtime = await app.evaluate(({ app, globalShortcut }) => ({ userData: app.getPath('userData'), demo: process.argv.includes('--demo'), selectionShortcut: globalShortcut.isRegistered('Control+Alt+Y'), selectionHookLoaded: Object.keys(process.getBuiltinModule('module')._cache).some(file => /[\\/]selection-hook[\\/]/.test(file)) }));
    assert.equal(runtime.demo, true);
    assert.equal(path.resolve(runtime.userData), path.resolve(isolatedData), 'Demo must honor the isolated test user-data directory');
    assert.equal(runtime.selectionShortcut, false, 'Demo must not register the global selection shortcut');
    assert.equal(runtime.selectionHookLoaded, false, 'Demo must not load the global selection hook');
    const data = await initial(manual);
    assert.equal(data.kind, 'manual');
    assert.deepEqual(Object.keys(data).sort(), ['kind', 'preferences', 'profile', 'text']);
    assert.ok(data.profile?.configured, 'Demo must expose an immediately usable profile');
    assert.deepEqual(Object.keys(data.profile).sort(), ['configured', 'model', 'provider']);
    assert.equal(data.profile.provider, '演示服务', 'Demo must use its synthetic profile');
    const bridge = await manual.evaluate(() => ({ keys: Object.keys(window.lightTranslate).sort(), nodeAvailable: typeof window.require !== 'undefined' || typeof window.process !== 'undefined' }));
    assert.deepEqual(bridge.keys, ['cancel', 'close', 'copy', 'getDiagnostics', 'getInitial', 'getModelSettings', 'importProfileFile', 'saveModelSettings', 'minimize', 'onChunk', 'openTranslation', 'reimportProfile', 'saveLanguages', 'setOpacity', 'setPinned', 'translate', 'translateSelection'].sort());
    assert.equal(bridge.nodeAvailable, false);
    const state = await nativeState(manual);
    assert.equal(state.preferences.nodeIntegration, false);
    assert.equal(state.preferences.contextIsolation, true);
    assert.equal(state.preferences.sandbox, true);
    return { runtime, publicProfileFields: Object.keys(data.profile), bridgeFields: bridge.keys, webPreferences: state.preferences };
  });

  let first;
  let firstContent;
  await check('manual submission creates visible focused result', async () => {
    first = await submit(manual, firstText);
    const state = await assertVisibleAndFocused(first);
    firstContent = await completed(first);
    await screenshot(first, '01-result');
    return state;
  });

  await check('original panel preserves the exact captured source and whitespace', async () => {
    await first.getByRole('button', { name: '显示原文', exact: true }).click();
    assert.equal(await first.locator('.original-text').textContent(), firstText);
    assert.equal(await first.locator('.original-text').evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
    await first.getByRole('button', { name: '隐藏原文', exact: true }).click();
    await expect(first.locator('.original-text')).toHaveCount(0);
  });

  let second;
  await check('pin retains original window and sets native always-on-top', async () => {
    await first.getByRole('button', { name: '置顶窗口', exact: true }).click();
    await expect(first.getByRole('button', { name: '取消置顶', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await assertNativePinned(first, true);
    second = await submit(manual, secondText);
    await assertVisibleAndFocused(second);
    assert.equal(first.isClosed(), false);
    assert.equal((await initial(first)).text, firstText);
    assert.equal(await first.locator('.translation-result').innerText(), firstContent);
    await assertNativePinned(first, true);
    await completed(second);
    await screenshot(first, '02-pinned');
  });

  let third;
  await check('new result replaces only unpinned result', async () => {
    const closed = second.waitForEvent('close');
    third = await submit(manual, thirdText);
    await closed;
    await assertVisibleAndFocused(third);
    assert.equal(second.isClosed(), true);
    assert.equal(first.isClosed(), false);
    assert.equal((await initial(first)).text, firstText);
    assert.equal(await first.locator('.translation-result').innerText(), firstContent);
    await completed(third);
    assert.equal(app.windows().length, 3, 'Only the manual window, pinned result and latest result should remain');
    return { remainingWindows: app.windows().length };
  });

  await check('native resizing and narrow layout without horizontal overflow', async () => {
    const state = await nativeState(third);
    assert.equal(state.resizable, true, 'Result BrowserWindow must be genuinely resizable');
    const wide = await resize(third, 780, 660);
    await assertNoHorizontalOverflow(third);
    await screenshot(third, '03-wide');
    const width = Math.max(360, state.minimum[0]);
    const height = Math.max(320, state.minimum[1]);
    assert.ok(width <= 480, `Minimum width ${width} prevents narrow-window validation`);
    const narrow = await resize(third, width, height);
    await third.getByRole('button', { name: '显示原文', exact: true }).click();
    await third.getByRole('button', { name: '语言偏好', exact: true }).click();
    const metrics = await assertNoHorizontalOverflow(third);
    await screenshot(third, '04-narrow-with-settings');
    return { wide, narrow, metrics };
  });

  await check('cancel one concurrent translation without interrupting another', async () => {
    await Promise.all([first.getByRole('button', { name: 'R 重试', exact: true }).click(), third.getByRole('button', { name: 'R 重试', exact: true }).click()]);
    await expect(first.locator('.translation-result')).toHaveAttribute('aria-busy', 'true');
    await expect(third.locator('.translation-result')).toHaveAttribute('aria-busy', 'true');
    await first.getByRole('button', { name: 'Esc 停止', exact: true }).click();
    await expect(first.locator('.translation-result')).toHaveAttribute('aria-busy', 'false');
    await expect(first.locator('.translation-result')).toContainText(/已停止/);
    const stoppedContent = await first.locator('.translation-result').innerText();
    await completed(third);
    assert.equal(await first.locator('.translation-result').innerText(), stoppedContent, 'Canceled window must not receive subsequent chunks');
    assert.equal((await initial(first)).text, firstText);
    assert.equal((await initial(third)).text, thirdText);
    await screenshot(first, '05-independent-cancel');
  });

  await check('close one streaming window without interrupting another', async () => {
    await Promise.all([first.getByRole('button', { name: 'R 重试', exact: true }).click(), third.getByRole('button', { name: 'R 重试', exact: true }).click()]);
    await expect(first.locator('.translation-result')).toHaveAttribute('aria-busy', 'true');
    await expect(third.locator('.translation-result')).toHaveAttribute('aria-busy', 'true');
    const closed = first.waitForEvent('close');
    await first.getByRole('button', { name: '关闭', exact: true }).click();
    await closed;
    assert.equal(first.isClosed(), true);
    assert.equal(third.isClosed(), false);
    await completed(third);
    await screenshot(third, '06-surviving-result');
    assert.equal(manual.isClosed(), false);
  });

  // All translation-behavior checks have finished. Replace only this isolated
  // demo instance's handler to exercise Electron's real error serialization.
  await check('real preload bridge removes the Electron HTTP 402 error prefix', async () => {
    const safeMessage = '翻译服务拒绝了付费请求（HTTP 402），请检查该服务账户的余额或配额。';
    await app.evaluate(({ ipcMain }, message) => {
      ipcMain.removeHandler('lt:translate');
      ipcMain.handle('lt:translate', () => { throw new Error(message); });
    }, safeMessage);
    const result = await third.evaluate(async () => {
      try {
        await window.lightTranslate.translate({ id: 'smoke-http-402', text: 'Fixed offline regression text.', target: 'en-us' });
        return { rejected: false, message: '' };
      } catch (error) {
        return { rejected: true, message: error && typeof error.message === 'string' ? error.message : String(error) };
      }
    });
    assert.equal(result.rejected, true, 'The renderer bridge must reject the mocked HTTP 402 failure');
    assert.equal(result.message, safeMessage, 'The actual preload bridge must preserve only the safe application message');
    assert.ok(!result.message.includes('Error invoking remote method'), 'Electron transport details must not reach the renderer message');
    return result;
  });

  await check('renderer stays local and reports no uncaught errors', async () => {
    assert.equal(rendererNetworkAttempts, 0, 'Demo renderers must make no HTTP requests');
    assert.deepEqual(pageErrors, []);
    return { rendererNetworkAttempts, uncaughtErrors: pageErrors.length };
  });
  report.passed = true;
  report.warnings.push('No real global selection, clipboard, provider network calls, or existing user configuration are exercised. HTTP observation covers renderers, not Node main-process traffic. Narrow checks resize real windows; they do not change the monitor resolution.');
}

(async () => {
  try { await main(); }
  catch (error) {
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
    if (app) {
      for (const [index, page] of app.windows().entries()) {
        if (!page.isClosed()) await screenshot(page, `failure-${index}`).catch(() => {});
      }
    }
  } finally {
    if (app) await app.close().catch(error => { report.warnings.push(`Electron cleanup failed: ${error.message}`); process.exitCode = 1; report.passed = false; });
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${path.join(artifacts, 'report.json')}`);
  }
})();
