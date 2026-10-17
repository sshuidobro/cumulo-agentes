import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

const MAX_MOUNTED = 12;

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

const mounted = (page: Page): Promise<number> => page.locator('[data-page-index]').count();
const indices = (page: Page): Promise<number[]> =>
  page.locator('[data-page-index]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-page-index'))));

for (const name of ['pages-5000.pdf', 'pages-100000.pdf']) {
  test(`${name}: scroll rápido, saltos y nodos DOM acotados`, async ({ page }, testInfo) => {
    await openFixture(page, name);
    const viewer = page.getByTestId('viewer');
    await viewer.hover();
    let peak = 0;
    // Ráfaga de ruedas grandes sin esperar entre ellas.
    for (let i = 0; i < 150; i++) {
      await page.mouse.wheel(0, i % 3 === 0 ? 3000 : 700);
      if (i % 10 === 0) peak = Math.max(peak, await mounted(page));
    }
    peak = Math.max(peak, await mounted(page));
    expect(peak).toBeLessThanOrEqual(MAX_MOUNTED);
    expect(await mounted(page)).toBeGreaterThan(0);

    // Fin, Inicio, Fin, AvPág/RePág repetidos.
    const total = name.includes('100000') ? 100000 : 5000;
    await page.keyboard.press('End');
    await expect(page.getByRole('group', { name: `Página ${String(total)} de ${String(total)}` })).toBeVisible();
    for (let i = 0; i < 15; i++) await page.keyboard.press('PageUp');
    expect(await mounted(page)).toBeLessThanOrEqual(MAX_MOUNTED);
    await page.keyboard.press('Home');
    await expect(page.getByRole('group', { name: `Página 1 de ${String(total)}` })).toBeVisible();
    for (let i = 0; i < 30; i++) await page.keyboard.press('PageDown');
    peak = Math.max(peak, await mounted(page));
    // Siempre hay páginas contiguas montadas (sin huecos blancos).
    const idx = await indices(page);
    expect(idx.length).toBeGreaterThan(0);
    expect(Math.max(...idx) - Math.min(...idx) + 1).toBe(idx.length);
    await page.keyboard.press('End');
    await expect(page.getByRole('group', { name: `Página ${String(total)} de ${String(total)}` })).toBeVisible();
    // Más allá del final no se monta nada fuera de rango.
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 5000);
    const after = await indices(page);
    expect(Math.max(...after)).toBeLessThanOrEqual(total - 1);
    const heap = await page.evaluate(() => document.getElementsByTagName('*').length);
    testInfo.annotations.push({ type: 'dom', description: `pico marcos ${String(peak)}, nodos totales ${String(heap)}` });
    expect(heap).toBeLessThan(400);
  });
}
