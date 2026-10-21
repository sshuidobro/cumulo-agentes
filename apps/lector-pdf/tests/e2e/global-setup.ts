import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFixtures } from '../fixtures/ensure.ts';
import { writeSigningFixtures } from '../support/signing-fixtures.ts';

/** Carpeta temporal con los ficheros de la firma digital; la ruta llega a las pruebas por variable de entorno. */
export const SIGNING_DIR_ENV = 'CUMULO_E2E_SIGNING_DIR';

export default async function setup(): Promise<() => void> {
  ensureFixtures();
  const dir = mkdtempSync(join(tmpdir(), 'cumulo-firma-e2e-'));
  await writeSigningFixtures(dir);
  process.env[SIGNING_DIR_ENV] = dir;
  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
