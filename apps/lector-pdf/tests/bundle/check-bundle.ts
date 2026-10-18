/* eslint-disable no-console -- salida de un script de línea de comandos */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkBundle, ENTRY_JS_BUDGET_BYTES, type Manifest } from './bundle-budget.ts';

const dir = process.argv[2] ?? 'dist';
const manifestPath = join(dir, '.vite', 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(`Falta ${manifestPath}: ejecuta antes el build.`);
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const report = checkBundle(manifest, (file) => statSync(join(dir, file)).size);
  console.log(
    `Arranque: ${report.entryBytes} bytes en ${report.staticFiles.length} ficheros JS (máximo ${ENTRY_JS_BUDGET_BYTES}).`,
  );
  for (const error of report.errors) console.error(error);
  process.exitCode = report.ok ? 0 : 1;
}
