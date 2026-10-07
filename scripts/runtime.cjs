// Install the pinned official Windows x64 runtime without Electron's fetch downloader.
// Proxy values stay in the child environment and are never printed or passed in argv.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronDir = path.dirname(require.resolve('electron/package.json'));
const dist = path.join(electronDir, 'dist');
const pathFile = path.join(electronDir, 'path.txt');
const installingFile = path.join(electronDir, '.runtime-installing');
const { version } = require(path.join(electronDir, 'package.json'));
const cacheDir = path.join(root, '.artifacts', 'downloads');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function matchesChecksum(file, expected) {
  try { return await sha256(file) === expected; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function hasRuntime() {
  try {
    const installedVersion = (await fsp.readFile(path.join(dist, 'version'), 'utf8')).trim().replace(/^v/, '');
    return installedVersion === version && (await fsp.stat(path.join(dist, 'electron.exe'))).isFile();
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function curlDownload(url, destination) {
  const env = { ...process.env };
  // curl's HTTPS requests do not use HTTP_PROXY by default. Reuse the configured
  // proxy for this HTTPS download, preserving a more specific HTTPS setting.
  const proxy = env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY;
  if (proxy) env.HTTPS_PROXY = proxy;
  const curl = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(curl, [
      '--disable', // Do not load a personal curlrc that can change TLS or destinations.
      '--fail', '--location', '--silent', '--show-error',
      '--proto', '=https', '--proto-redir', '=https',
      '--connect-timeout', '30', '--max-time', '600', '--continue-at', '-',
      '--output', destination, url
    ], { env, shell: false, windowsHide: true, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(new Error(error.code === 'ENOENT' ? 'Windows curl.exe is unavailable. Install the Windows curl component and retry.' : 'Could not start curl.exe for the official Electron download.'));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut || code === 28) return reject(new Error('Electron download timed out after 600 seconds. The partial archive is retained; check the configured proxy/network and retry.'));
      if (code === 0) return resolve();
      const reasons = { 5: 'proxy hostname could not be resolved', 6: 'download hostname could not be resolved', 7: 'connection failed', 22: 'server returned an HTTP error', 33: 'server does not support continuing this partial download', 35: 'TLS connection failed', 60: 'TLS certificate verification failed' };
      reject(new Error(`Official Electron download failed (curl ${code ?? 'terminated'}${reasons[code] ? `: ${reasons[code]}` : ''}). Check the configured proxy/network and retry.`));
    });
  });
}

async function ensureRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This runtime installer supports Windows x64 only.');
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('The installed Electron package version is invalid.');
  let interrupted = false;
  try { await fsp.access(installingFile); interrupted = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!interrupted && await hasRuntime()) {
    // Repair an absent/stale pointer without downloading an already-present runtime.
    await fsp.writeFile(pathFile, 'electron.exe');
    console.log(`Electron ${version} Windows x64 runtime is ready.`);
    return;
  }

  const archive = `electron-v${version}-win32-x64.zip`;
  const checksums = JSON.parse(await fsp.readFile(path.join(electronDir, 'checksums.json'), 'utf8'));
  const expected = checksums[archive];
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('The Electron npm package does not contain a valid SHA256 for this runtime.');
  const checksum = expected.toLowerCase();
  await fsp.mkdir(cacheDir, { recursive: true });
  const cache = path.join(cacheDir, archive);
  if (!await matchesChecksum(cache, checksum)) {
    // Only this explicit .partial file may be resumed. A complete cache file with
    // a bad hash is never used as the base for a continued download.
    const temporary = path.join(cacheDir, `${archive}.partial`);
    const reservation = await fsp.open(temporary, 'a');
    await reservation.close();
    if (!await matchesChecksum(temporary, checksum)) {
      console.log(`Downloading official Electron ${version} Windows x64 runtime…`);
      await curlDownload(`https://github.com/electron/electron/releases/download/v${version}/${archive}`, temporary);
    }
    if (!await matchesChecksum(temporary, checksum)) {
      await fsp.unlink(temporary);
      throw new Error('Electron archive SHA256 does not match the npm package checksum. The partial archive was discarded and nothing was extracted.');
    }
    await fsp.rename(temporary, cache);
  } else console.log(`Using SHA256-verified cached Electron ${version} archive.`);

  // A marker prevents an interrupted extraction from passing the version/exe
  // shortcut on the next run. No runtime directory is recursively deleted.
  await fsp.writeFile(installingFile, version);
  const { extract } = await import('@electron-internal/extract-zip');
  await fsp.mkdir(dist, { recursive: true });
  await extract(cache, { dir: dist });
  if (!await hasRuntime()) throw new Error('Extracted Electron runtime is missing its executable or has an unexpected version.');
  await fsp.writeFile(pathFile, 'electron.exe');
  await fsp.unlink(installingFile);
  console.log(`Electron ${version} Windows x64 runtime is ready.`);
}

if (require.main === module) {
  ensureRuntime().catch(error => {
    // Do not print child stderr, environment, or a stack containing proxy URLs.
    console.error(`Runtime installation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { ensureRuntime, sha256, matchesChecksum };
