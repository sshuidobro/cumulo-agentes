import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

async function openFile(page: Page, path: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

function searchField(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Buscar en el documento' });
}

/** Abre la búsqueda con Ctrl+F y escribe la consulta. La búsqueda empieza tras el *debounce*. */
async function search(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+f');
  await expect(searchField(page)).toBeFocused();
  await searchField(page).fill(query);
}

/** Rectángulo en pantalla de `needle` dentro de la capa de texto de la página `pageIndex` (0-based). Espera a que exista. */
async function boxOf(page: Page, pageIndex: number, needle: string): Promise<Box> {
  let found: Box | null = null;
  await expect(async () => {
    found = await measureBox(page, pageIndex, needle);
    expect(found).not.toBeNull();
  }).toPass();
  if (found === null) throw new Error(`No se encuentra «${needle}» en la página ${pageIndex + 1}`);
  return found;
}

async function measureBox(page: Page, pageIndex: number, needle: string): Promise<Box | null> {
  return page.evaluate(
    ({ index, text }) => {
      const layer = document.querySelector(`[data-page-index="${index}"] .textLayer`);
      if (layer === null) return null;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const start = node.textContent?.indexOf(text) ?? -1;
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        const r = range.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      return null;
    },
    { index: pageIndex, text: needle },
  );
}

/** Rectángulos de los resaltados actuales, en pantalla. */
async function currentHitBoxes(page: Page): Promise<readonly Box[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.search-highlights .hit-current')).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
  );
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

test.describe('búsqueda en la interfaz', () => {
  test('basic-5.pdf: «busqueda» da «1 de 5», resalta sobre la palabra y «Palabras completas» da «1 de 4»', async ({
    page,
  }) => {
    await openFile(page, fixture('basic-5.pdf'));

    await search(page, 'busqueda');

    await expect(page.getByText('1 de 5', { exact: true })).toBeVisible();
    // El visor solo monta las páginas cercanas a la vista; el total (5) lo confirma el contador de arriba.
    await expect(page.locator('.search-highlights .hit').first()).toBeVisible();
    await expect(page.locator('[data-page-index="1"]')).toBeInViewport({ ratio: 0.2 });

    // El resaltado actual cubre la palabra «búsqueda» de la página 2.
    const word = await boxOf(page, 1, 'búsqueda');
    await expect(async () => {
      const [hit] = await currentHitBoxes(page);
      expect(hit).toBeDefined();
      if (hit === undefined) return;
      expect(intersects(hit, word)).toBe(true);
    }).toPass();

    await page.getByRole('button', { name: 'Palabras completas' }).click();
    await expect(page.getByText('1 de 4', { exact: true })).toBeVisible();
  });

  test('pages-5000.pdf: «aguja» da «1 de 2» con la página 1234 visible y F3 lleva a la 4999', async ({ page }) => {
    await openFile(page, fixture('pages-5000.pdf'));

    await search(page, 'aguja');

    // Solo comportamiento: el tiempo de búsqueda se mide en tests/perf/search.perf.test.ts (ADR-0012).
    await expect(page.getByText('1 de 2', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-page-index="1233"]')).toBeInViewport({ ratio: 0.1, timeout: 15_000 });

    await page.keyboard.press('F3');
    await expect(page.getByText('2 de 2', { exact: true })).toBeVisible();
    await expect(page.locator('[data-page-index="4998"]')).toBeInViewport({ ratio: 0.1 });
  });

  test('durante la búsqueda el visor y el campo de página siguen respondiendo', { tag: '@perf' }, async ({ page }, testInfo: TestInfo) => {
    // El observador se instala antes de cargar la página, para registrar también las long tasks de la apertura.
    await page.addInitScript(() => {
      const longTasks: number[] = [];
      (window as unknown as { longTasks: number[] }).longTasks = longTasks;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
    });
    await openFile(page, fixture('pages-5000.pdf'));
    // Sin este chequeo, un navegador sin soporte de longtask daría 0 ms y el criterio sería vacuo.
    expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask'))).toBe(true);

    await search(page, 'marcador');
    const stop = page.getByRole('button', { name: 'Detener' });
    await expect(stop).toBeVisible({ timeout: 3_000 });

    // Scroll con la rueda del ratón mientras la búsqueda sigue en curso.
    const viewer = page.getByTestId('viewer');
    const scrollBefore = await viewer.evaluate((v) => v.scrollTop);
    await viewer.hover();
    await page.mouse.wheel(0, 3_000);
    await expect.poll(() => viewer.evaluate((v) => v.scrollTop)).toBeGreaterThan(scrollBefore);
    await expect(stop).toBeVisible();

    // Campo de página mientras sigue en curso.
    const pageField = page.getByRole('textbox', { name: 'Número de página' });
    await pageField.fill('3000');
    await pageField.press('Enter');
    await expect(page.locator('[data-page-index="2999"]')).toBeInViewport({ ratio: 0.1 });
    await expect(stop).toBeVisible();

    const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
    const worst = Math.max(0, ...longTasks);
    testInfo.annotations.push({ type: 'long-task-max-ms', description: `${worst.toFixed(1)} (${longTasks.length} tareas)` });
    expect(worst).toBeLessThanOrEqual(100);
  });

  test('con zoom 200 % y vista girada, los resaltados siguen sobre el texto', async ({ page }, testInfo: TestInfo) => {
    await openFile(page, fixture('basic-5.pdf'));
    for (let step = 0; step < 10; step++) {
      if ((await page.getByRole('textbox', { name: 'Zoom' }).inputValue()) === '200 %') break;
      await page.keyboard.press('Control+Equal');
    }
    await expect(page.getByRole('textbox', { name: 'Zoom' })).toHaveValue('200 %');
    await page.getByRole('button', { name: 'Girar a la derecha' }).click();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    await search(page, 'murciélago');
    await expect(page.getByText('1 de 1', { exact: true })).toBeVisible();
    await expect(page.locator('.search-highlights .hit-current')).toHaveCount(1);

    const word = await boxOf(page, 0, 'murciélago');
    await expect(async () => {
      const [hit] = await currentHitBoxes(page);
      expect(hit).toBeDefined();
      if (hit === undefined) return;
      expect(intersects(hit, word)).toBe(true);
    }).toPass();

    await page.screenshot({ path: testInfo.outputPath('search-zoom-200-girado.png') });
  });

  test('«Detener» en pages-100000.pdf deja de buscar y conserva lo encontrado', async ({ page }) => {
    await openFile(page, fixture('pages-100000.pdf'));
    await search(page, 'marcador');
    const stop = page.getByRole('button', { name: 'Detener' });
    await expect(stop).toBeVisible({ timeout: 3_000 });

    await stop.click();

    const status = page.getByRole('search').locator('[aria-live="polite"]');
    await expect(stop).toBeHidden();
    const frozen = await status.textContent();
    // Espera negativa legítima: se comprueba que, tras Detener, el estado no cambia (nada que esperar).
    await page.waitForTimeout(1_000);
    expect(await status.textContent()).toBe(frozen);
    expect(frozen).not.toContain('Buscando');
    expect(frozen).toMatch(/\d+ de \d+|Más de 100\.000/);
  });
});
