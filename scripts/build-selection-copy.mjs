import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
mkdirSync(path.join(root, 'dist/native'), { recursive: true });
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${path.join(root, 'dist/native/SelectionCopy.exe')}`, path.join(root, 'native/SelectionCopy/Program.cs')], { cwd: root, windowsHide: true, stdio: 'pipe' });
