import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio (tests/fixtures → tests → lector-pdf → apps → raíz). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Fixtures generados por código; no versionados (ver .gitignore). */
export const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'pdf', 'generated');

/** Corpus público versionado (PDF-004). */
export const CORPUS_DIR = join(REPO_ROOT, 'fixtures', 'pdf', 'corpus');
