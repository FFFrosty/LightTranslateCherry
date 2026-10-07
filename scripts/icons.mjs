import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('assets/logo.svg');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
await writeFile('assets/icon.png', png);
await writeFile('assets/icon.ico', await pngToIco(png));
console.log('Generated application icon from assets/logo.svg');
