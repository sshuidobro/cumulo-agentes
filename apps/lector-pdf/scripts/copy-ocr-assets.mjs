import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copia el worker, el núcleo WASM y los datos de idioma de tesseract.js a public/ocr/ (idempotente).
// Así el OCR funciona sin red: ninguna URL externa (ADR-0038).
const require = createRequire(import.meta.url);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'ocr');
const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const spaDir = dirname(require.resolve('@tesseract.js-data/spa/package.json'));
const engDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tesseractDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(coreDir, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(spaDir, '4.0.0_best_int', 'spa.traineddata.gz'), 'spa.traineddata.gz'],
  [join(engDir, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

mkdirSync(publicDir, { recursive: true });
for (const [from, name] of files) {
  copyFileSync(from, join(publicDir, name));
}
process.stdout.write(`ocr: copiados ${files.length} ficheros a public/ocr/\n`);
