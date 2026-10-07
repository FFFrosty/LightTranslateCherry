import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await import('../../scripts/build-selection-copy.mjs');
const directory = path.join(root, '.artifacts/selection-copy-tests');
mkdirSync(directory, { recursive: true });
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const fixture = path.join(directory, 'msedge.exe');
const report = path.join(directory, 'results.json');
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/main:LightTranslate.SelectionCopy.Tests.EntryPoint', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', `/out:${fixture}`, path.join(root, 'native/SelectionCopy/Program.cs'), path.join(root, 'tests/selection-copy/Fixture.cs')], { windowsHide: true, stdio: 'pipe' });
let failure;
try { execFileSync(fixture, [path.join(root, 'dist/native/SelectionCopy.exe'), report], { stdio: 'pipe' }); } catch (error) { failure = error; }
console.log(readFileSync(report, 'utf8'));
if (failure) process.exitCode = 1;
