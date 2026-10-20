/**
 * Envoltorio de `pdfsig` (poppler, herramienta de desarrollo, PDF-066) para validar las firmas que escribe la
 * app con un lector independiente. Si `pdfsig` no está en el PATH, lanza con la instrucción de instalación.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Salida de `pdfsig` sobre `bytes` (stdout y stderr juntos) y su código de salida. */
export function pdfsig(bytes: Uint8Array): { readonly code: number; readonly output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cumulo-pdfsig-'));
  try {
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, bytes);
    const result = spawnSync('pdfsig', [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error !== undefined) {
      throw new Error('Instala poppler: apt-get install -y poppler-utils');
    }
    return { code: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
