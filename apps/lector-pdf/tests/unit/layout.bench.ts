import { test } from 'vitest';
import { PageDimsTable } from '../../src/core/page-dims';
import { computeLayout, DEFAULT_GAP, DEFAULT_PADDING, pageAtY, scrollMap } from '../../src/core/layout';

const params = { scale: 1, rotation: 0, gap: DEFAULT_GAP, padding: DEFAULT_PADDING } as const;
const dims1M = PageDimsTable.uniform(1_000_000, 612, 792, 0);
const layout1M = computeLayout(dims1M, params);
const ys = new Float64Array(1_000_000);
for (let i = 0; i < ys.length; i++) {
  ys[i] = ((i * 2654435761) % 1_000_003) / 1_000_003 * layout1M.totalHeight;
}

test('layout de 1 000 000 páginas y consultas pageAtY', async ({ bench }) => {
  const compute = computeLayout;
  await bench('computeLayout 1 000 000 páginas', () => {
    compute(dims1M, params);
  }).run();

  const lookup = pageAtY;
  await bench('1 000 000 consultas pageAtY', () => {
    let sum = 0;
    for (let i = 0; i < ys.length; i++) sum += lookup(layout1M, ys[i] ?? 0);
    return sum;
  }).run();

  await bench('scrollMap con 100 000 páginas', () => {
    scrollMap(computeLayout(PageDimsTable.uniform(100_000, 612, 1056, 0), params), 800);
  }).run();
});
