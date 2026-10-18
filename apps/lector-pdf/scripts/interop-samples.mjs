// Escribe las muestras de interoperabilidad (PDF-029) en interop-samples/. Carga el código TypeScript de
// tests/support con el servidor de Vite en modo SSR (ya es dependencia de desarrollo; no hace falta tsx).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(appRoot, 'interop-samples');

const server = await createServer({
  root: appRoot,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
});
try {
  const { writeInteropSamples } = await server.ssrLoadModule('/tests/support/interop-samples.ts');
  mkdirSync(outDir, { recursive: true });
  const paths = await writeInteropSamples(outDir);
  for (const path of paths) process.stdout.write(`${path}\n`);
} finally {
  await server.close();
}
