// Opt-in live check. Uses the existing encrypted model profile and sends only
// this fixed sentence; never prints secrets or arbitrary selected content.
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const root = path.resolve(__dirname, '..');
const sentence = 'The meeting starts at nine tomorrow morning. Please bring the project notes.';
async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const artifact = path.join(root, '.artifacts/live');
  await fs.mkdir(artifact, { recursive: true });
  const executablePath = process.env.LT_TEST_EXE || require('electron');
  const app = await electron.launch({ executablePath, args: process.env.LT_TEST_EXE ? [] : ['.'], cwd: root, env, timeout: 30000 });
  try {
    const manual = await app.firstWindow();
    await manual.waitForFunction(() => Boolean(window.lightTranslate));
    const initial = await manual.evaluate(() => window.lightTranslate.getInitial());
    assert.ok(initial.profile?.configured, 'No usable profile imported');
    assert.deepEqual(Object.keys(initial.profile).sort(), ['configured','model','provider']);
    await manual.getByLabel('输入或粘贴要翻译的文字').fill(sentence);
    const pending = app.waitForEvent('window');
    await manual.getByRole('button', { name: '翻译', exact: true }).click();
    const result = await pending;
    await result.waitForFunction(() => {
      if (document.querySelector('.translation-error')) return true;
      const view = document.querySelector('.translation-result');
      return view?.getAttribute('aria-busy') === 'false' && Boolean(view.querySelector('p:not(.empty-state):not(.stream-status)'));
    }, undefined, { timeout: 60000 });
    const errors = await result.locator('.translation-error').allTextContents();
    assert.equal(errors.length, 0, errors.join('; '));
    const text = await result.locator('.translation-result').innerText();
    assert.ok(/[\u4e00-\u9fff]/.test(text) && !/译文将在这里|等待输入文字|等待模型响应/.test(text), 'No real Chinese translation');
    await result.screenshot({ path: path.join(artifact, 'translation.png') });
    const evidence = { ok: true, provider: initial.profile.provider, model: initial.profile.model, translation: text };
    await fs.writeFile(path.join(artifact, 'report.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
