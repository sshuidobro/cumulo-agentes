import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copia los recursos de pdf.js (cmaps, fuentes estándar, wasm, iccs) a public/pdfjs/ (idempotente).
const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');
const folders = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

mkdirSync(publicDir, { recursive: true });
for (const folder of folders) {
  cpSync(join(pdfjsDir, folder), join(publicDir, folder), { recursive: true });
}
process.stdout.write(`pdf.js: copiado ${folders.join(', ')} a public/pdfjs/\n`);
