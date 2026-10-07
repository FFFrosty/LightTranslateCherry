import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const entries = [];
async function scan(root) {
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const directory = path.join(root, item.name);
    if (item.name.startsWith('@')) { await scan(directory); continue; }
    let pkg;
    try { pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); } catch { continue; }
    const names = await readdir(directory);
    const licenses = names.filter(name => /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(name));
    const texts = [];
    for (const name of licenses) { try { texts.push(`### ${name}\n\n${await readFile(path.join(directory, name), 'utf8')}`); } catch {} }
    entries.push(`## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'See package source')}\n\n${texts.join('\n\n')}`);
    try { await scan(path.join(directory, 'node_modules')); } catch {}
  }
}
await scan('node_modules');
await writeFile('THIRD_PARTY_NOTICES.md', '# Third-party software notices\n\nGenerated from the locked dependencies, including build/test tools. Cherry Studio attribution is in NOTICE.md. Electron also ships its own LICENSE.electron.txt and Chromium notices with the application.\n\n' + entries.sort().join('\n\n---\n\n'));
console.log(`Recorded ${entries.length} dependency notices`);
