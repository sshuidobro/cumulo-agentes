import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, GENERATOR_VERSION } from './catalog.ts';
import { FIXTURES_DIR } from './paths.ts';

const VERSION_FILE = '.version';

/**
 * Genera los fixtures en `FIXTURES_DIR`. Si la versión del generador cambió o se pide `force`,
 * regenera todo; si no, crea solo los que faltan (así no se tocan los ficheros existentes).
 */
export function ensureFixtures(opts: { readonly force?: boolean } = {}): { readonly generated: string[] } {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const versionPath = join(FIXTURES_DIR, VERSION_FILE);
  const storedVersion = existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : null;
  const regenerateAll = opts.force === true || storedVersion !== String(GENERATOR_VERSION);

  const generated: string[] = [];
  for (const fixture of FIXTURES) {
    const target = join(FIXTURES_DIR, fixture.name);
    if (!regenerateAll && existsSync(target)) {
      continue;
    }
    // Escritura en un temporal y renombrado: un proceso interrumpido no deja un fixture a medias.
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, fixture.build());
    renameSync(temporary, target);
    generated.push(fixture.name);
  }

  writeFileSync(versionPath, `${GENERATOR_VERSION}\n`);
  return { generated };
}
