/* Build first. Uses an isolated, offline --demo --demo-toolbar process only. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron, expect } = require('playwright/test');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.artifacts', 'toolbar-smoke');
const report = { passed: false, checks: [] };
let app;
async function run() {
  await fs.mkdir(artifacts, { recursive: true });
  const data = await fs.mkdtemp(path.join(artifacts, 'user-data-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: require('electron'), args: ['.', '--demo', '--demo-toolbar', `--user-data-dir=${data}`], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow();
  await expect(page.locator('[data-ui="selection.toolbar"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const initial = await page.evaluate(() => window.lightTranslate.getInitial());
  assert.equal(initial.kind, 'toolbar');
  const native = await app.browserWindow(page);
  try {
    await expect.poll(() => native.evaluate(win => win.isVisible()), { timeout: 10000 }).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await native.evaluate(win => ({ bounds: win.getBounds(), contentBounds: win.getContentBounds(), background: win.getBackgroundColor(), focusable: win.isFocusable(), focused: win.isFocused(), resizable: win.isResizable(), shadow: win.hasShadow() }));
    report.native = state;
    // Windows can enforce a slightly taller native minimum at fractional DPI.
    // The renderer still fills the actual content bounds; alpha is tested below.
    assert.ok(Math.abs(state.bounds.width - 120) <= 4 && Math.abs(state.bounds.height - 42) <= 4, 'Native toolbar must stay within 4 DIP of compact 120 × 42 bounds');
    assert.ok(['#00000000', '#000000'].includes(state.background.toLowerCase()));
    assert.equal(state.focusable, false);
    assert.equal(state.focused, false);
    assert.equal(state.resizable, false);
    assert.equal(state.shadow, false);
    report.checks.push('Compact transparent native window without activation or system shadow');

    const metrics = await page.evaluate(() => {
      const toolbar = document.querySelector('.selection-toolbar');
      const rect = toolbar.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        toolbar: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        overflow: [document.documentElement, document.body, document.querySelector('.toolbar-container'), toolbar, document.querySelector('.toolbar-action')].map(el => ({ name: el.className || el.tagName, width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight })),
        backgrounds: [document.documentElement, document.body, document.querySelector('.toolbar-container')].map(el => getComputedStyle(el).backgroundColor)
      };
    });
    report.layout = metrics;
    assert.equal(metrics.toolbar.x, 3); assert.equal(metrics.toolbar.y, 3);
    assert.equal(metrics.toolbar.width, metrics.viewport.width - 6);
    assert.equal(metrics.toolbar.height, metrics.viewport.height - 6);
    for (const item of metrics.overflow) {
      assert.ok(item.scrollWidth <= item.width + 1, `${item.name} horizontal overflow`);
      assert.ok(item.scrollHeight <= item.height + 1, `${item.name} vertical overflow`);
    }
    for (const color of metrics.backgrounds) assert.equal(color, 'rgba(0, 0, 0, 0)');
    report.checks.push('Renderer fills native bounds with exactly 3 px inset and no overflow');

    const capture = await native.evaluate(async win => {
      const image = await win.webContents.capturePage();
      const size = image.getSize(), bitmap = image.toBitmap();
      const alpha = (x, y) => bitmap[(y * size.width + x) * 4 + 3];
      return { size, corners: [alpha(0, 0), alpha(size.width - 1, 0), alpha(0, size.height - 1), alpha(size.width - 1, size.height - 1)], center: alpha(Math.floor(size.width / 2), Math.floor(size.height / 2)), png: image.toPNG().toString('base64') };
    });
    await fs.writeFile(path.join(artifacts, 'toolbar-native.png'), Buffer.from(capture.png, 'base64'));
    delete capture.png;
    report.pixels = capture;
    assert.ok(capture.corners.every(alpha => alpha === 0), 'All native screenshot corner pixels must be fully transparent');
    assert.equal(capture.center, 255, 'Toolbar content must stay opaque');
    report.checks.push('Native capture confirms transparent corner alpha and opaque toolbar content');
  } finally { await native.dispose(); }

  const next = app.waitForEvent('window');
  await page.getByRole('button', { name: '翻译选中文字', exact: true }).click();
  const result = await next;
  await expect(result.locator('.translation-result')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect(result.locator('.translation-error')).toHaveCount(0);
  assert.equal((await result.evaluate(() => window.lightTranslate.getInitial())).text, initial.text);
  await expect(result.locator('.translation-result')).toContainText('Toolbar demo selection.');
  report.checks.push('Actual translate button opens result with captured toolbar text and finishes demo translation');
  report.passed = true;
}
run().catch(error => { report.error = String(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
