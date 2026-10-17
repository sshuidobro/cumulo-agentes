import { test } from 'vitest';
import { findInPage } from '../../src/core/search/find';
import { normalizeText, type NormalizeOptions } from '../../src/core/search/normalize';
import { buildPageText, type TextItemLike } from '../../src/core/search/page-text';

// Benchmarks informativos (pnpm exec vitest bench --run); no son puerta de calidad.
const OPTS: NormalizeOptions = { matchCase: false, matchDiacritics: false };

const items: TextItemLike[] = Array.from({ length: 40 }, (_, i) => ({
  str: `Línea ${String(i)} con texto de búsqueda y murciélagos, ñandúes y ﬁnes.`,
  hasEOL: true,
}));
const pt = buildPageText(items);
const norm = normalizeText(pt.raw, OPTS);

test('búsqueda por página de 40 líneas', async ({ bench }) => {
  await bench('buildPageText', () => {
    buildPageText(items);
  }).run();

  await bench('normalizeText', () => {
    normalizeText(pt.raw, OPTS);
  }).run();

  await bench('findInPage «busqueda»', () => {
    findInPage(0, pt, norm, 'busqueda', false);
  }).run();
});
