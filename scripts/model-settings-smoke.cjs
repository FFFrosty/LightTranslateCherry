// Headless renderer checks with fake IPC and fake credentials. No user profile or network service.
const { chromium, expect } = require('playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist/renderer');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(dist, `.${requested === '/' ? '/index.html' : requested}`);
    if (!file.startsWith(dist + path.sep)) throw new Error();
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 620, height: 660 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.fixture = { profile: null, settings: null, saveCount: 0, failSave: false, importResult: null };
    window.lightTranslate = {
      getInitial: async () => ({ kind: 'manual', text: '', profile: null, profileError: '原配置无法读取，已保留原文件。', preferences: { primary: 'zh-cn', alternate: 'en-us' } }),
      getModelSettings: async () => window.fixture.settings,
      saveModelSettings: async value => {
        window.fixture.saveCount++;
        if (window.fixture.failSave) throw new Error('无法安全保存配置。');
        window.fixture.lastSave = value;
        window.fixture.settings = { provider: value.provider, model: value.model, baseUrl: value.baseUrl, hasApiKey: true };
        return window.fixture.profile = { provider: value.provider, model: value.model, configured: true };
      },
      importProfileFile: async () => window.fixture.importResult,
      reimportProfile: async () => { throw new Error('测试旧版导入失败。'); },
      onChunk: () => () => {}, cancel: async () => {}, saveLanguages: async () => {},
      setPinned: async () => {}, setOpacity: async () => {}, minimize: async () => {}, close: async () => {}
    };
  });
  await page.goto(url);
  const panel = page.getByRole('region', { name: '模型设置', exact: true });
  if (!await panel.isVisible()) await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('模型预设').selectOption('deepseek');
  await expect(page.getByLabel('API 地址', { exact: true })).toHaveValue('https://api.deepseek.com');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixture.saveCount), 0);
  await page.getByLabel('API Key', { exact: true }).fill('FAKE-TEST-KEY');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.locator('.profile-bar')).toContainText('DeepSeek');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.locator('.window-error')).toHaveCount(0);
  console.log('PASS preset requires key; save updates profile and clears key');
  await page.getByLabel('Model ID', { exact: true }).fill('other-test-model');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.lastSave.model)).toBe('other-test-model');
  assert.equal(await page.evaluate(() => 'apiKey' in window.fixture.lastSave), false);
  const before = await page.locator('.profile-bar').innerText();
  await page.getByRole('button', { name: '导入已有配置文件', exact: true }).click();
  await expect(panel).toHaveAttribute('aria-busy', 'false');
  assert.equal(await page.locator('.profile-bar').innerText(), before);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  console.log('PASS blank key preserves existing credential; canceled import preserves profile');
  await page.getByLabel('API 地址', { exact: true }).fill('https://different.example.invalid');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('required', '');
  await page.getByLabel('API Key', { exact: true }).fill('FAKE-NEW-KEY');
  await page.evaluate(() => { window.fixture.failSave = true; });
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('无法安全保存');
  assert.equal(await page.locator('.profile-bar').innerText(), before);
  await page.getByRole('button', { name: '收起设置', exact: true }).click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  console.log('PASS changed endpoint requires key; failed save preserves profile; close clears key');
  await page.setViewportSize({ width: 360, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await fs.mkdir(path.join(root, '.artifacts/model-settings'), { recursive: true });
  await page.screenshot({ path: path.join(root, '.artifacts/model-settings/narrow.png') });
  assert.deepEqual(errors, []);
  console.log('PASS narrow layout and no uncaught renderer errors');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
