import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  canvasCount,
  clearLongTasks,
  fixture,
  frameCount,
  goToPageByKeyboard,
  heapMB,
  installPerfProbes,
  longTasks,
  openFixture,
  pageNow,
  recordMeasure,
  seeded,
  thumbnailCanvasCount,
  waitPageRendered,
  waitPageVisible,
} from './helpers.ts';

/**
 * Una prueba por fila de la tabla de presupuestos del Plan del Lector PDF (sección «Presupuestos»).
 * Los umbrales son los del Plan: si una medida no se cumple, la prueba falla; no se relajan.
 * Cada prueba anota su medida en el informe con `recordMeasure`.
 */
const OPEN_SMALL_MS = 1_000;
const OPEN_HUGE_MS = 5_000;
const END_MS = 1_500;
const MAX_CANVASES = 12;
const MAX_FRAMES = 12;
const HEAP_LIMIT_MB = 400;
const JUMPS_FOR_HEAP = 30;
const SEARCH_FIRST_MS = 1_000;
const SEARCH_FULL_MS = 15_000;
const LONG_TASK_MS = 100;

/** Coincidencias de «marcador-1» en pages-5000: páginas 1, 10-19, 100-199 y 1000-1999 (una por página). */
const MARCADOR_1_MATCHES = 1_111;

const HUGE_FIXTURES = ['pages-5000.pdf', 'pages-100000.pdf'] as const;

function totalOf(name: string): number {
  return name.includes('100000') ? 100_000 : 5_000;
}

/** Abre el fichero y espera a que la página 1 se dibuje; devuelve el tiempo (ms) del reloj de la página. */
async function timeToFirstPage(page: Page, name: string): Promise<number> {
  await page.goto('/');
  const started = await pageNow(page);
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  await waitPageRendered(page, 1);
  return (await pageNow(page)) - started;
}

/** Recuento de lienzos y marcos del visor; los lienzos de miniaturas se suman como indica el Plan. */
async function assertBoundedDom(page: Page, context: string): Promise<{ canvases: number; frames: number }> {
  const canvases = await canvasCount(page);
  const frames = await frameCount(page);
  const thumbs = await thumbnailCanvasCount(page);
  expect(canvases, `lienzos del visor (${context})`).toBeLessThanOrEqual(MAX_CANVASES);
  expect(canvases - thumbs, `lienzos de página sin miniaturas (${context})`).toBeLessThanOrEqual(MAX_CANVASES);
  expect(frames, `marcos de página (${context})`).toBeLessThanOrEqual(MAX_FRAMES);
  return { canvases, frames };
}

test('abrir un PDF de ≤ 20 páginas (basic-5) muestra la página 1 en menos de 1 s', async ({ page }, testInfo) => {
  const elapsed = await timeToFirstPage(page, 'basic-5.pdf');
  recordMeasure(testInfo, `abrir basic-5 (5 páginas) hasta ver la página 1: ${elapsed.toFixed(0)} ms`);
  expect(elapsed).toBeLessThan(OPEN_SMALL_MS);
});

for (const name of HUGE_FIXTURES) {
  test(`abrir ${name} muestra la página 1 en menos de 5 s`, async ({ page }, testInfo) => {
    const elapsed = await timeToFirstPage(page, name);
    recordMeasure(testInfo, `abrir ${name} hasta ver la página 1: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(OPEN_HUGE_MS);
  });

  test(`${name}: Fin muestra la última página visible en menos de 1,5 s`, async ({ page }, testInfo) => {
    await openFixture(page, name);
    const total = totalOf(name);
    await waitPageRendered(page, 1);

    const started = await pageNow(page);
    await page.keyboard.press('End');
    await waitPageVisible(page, total, total);
    await waitPageRendered(page, total);
    const elapsed = (await pageNow(page)) - started;

    recordMeasure(testInfo, `${name}: Fin hasta ver la página ${String(total)} dibujada: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(END_MS);
  });

  test(`${name}: como mucho 12 lienzos y 12 marcos de página vivos tras saltos aleatorios`, async ({ page }, testInfo) => {
    await openFixture(page, name);
    const total = totalOf(name);
    await waitPageRendered(page, 1);

    const random = seeded(total);
    let peak = await assertBoundedDom(page, 'tras abrir');
    for (let jump = 0; jump < 15; jump++) {
      await goToPageByKeyboard(page, 1 + Math.floor(random() * total), total);
      const now = await assertBoundedDom(page, `salto ${String(jump + 1)}`);
      peak = { canvases: Math.max(peak.canvases, now.canvases), frames: Math.max(peak.frames, now.frames) };
    }
    recordMeasure(
      testInfo,
      `${name}: máximo lienzos ${String(peak.canvases)} (≤ ${String(MAX_CANVASES)}), marcos ${String(peak.frames)} (≤ ${String(MAX_FRAMES)})`,
    );
  });
}

test('pages-5000: heap JS < 400 MB tras 30 saltos aleatorios', async ({ page }, testInfo) => {
  await openFixture(page, 'pages-5000.pdf');
  await waitPageRendered(page, 1);

  const random = seeded(5000);
  let last = 1;
  for (let jump = 0; jump < JUMPS_FOR_HEAP; jump++) {
    last = 1 + Math.floor(random() * 5_000);
    await goToPageByKeyboard(page, last, 5_000);
  }
  await waitPageRendered(page, last);

  const heap = await heapMB(page);
  recordMeasure(testInfo, `heap JS tras ${String(JUMPS_FOR_HEAP)} saltos en pages-5000: ${heap.toFixed(1)} MB (< ${String(HEAP_LIMIT_MB)})`);
  expect(heap).toBeLessThan(HEAP_LIMIT_MB);
});

function searchField(page: Page) {
  return page.getByRole('searchbox', { name: 'Buscar en el documento' });
}

/** Contador «N de M» de la barra de búsqueda (N es la coincidencia actual; M, el total hasta ahora). */
function counterText(page: Page): Locator {
  return page.getByRole('search').getByText(/ de [\d.]+$/);
}

/**
 * Espera al final de la búsqueda de «marcador-1»: el total llega a 1111 solo cuando ya se han visto
 * todas las coincidencias, y la barra de progreso (solo visible mientras busca) desaparece al terminar.
 */
async function waitSearchComplete(page: Page): Promise<void> {
  const total = MARCADOR_1_MATCHES.toLocaleString('es-ES');
  await expect(page.getByRole('search').getByText(new RegExp(` de ${total}$`))).toBeVisible({ timeout: SEARCH_FULL_MS });
  await expect(page.getByRole('search').locator('progress')).toHaveCount(0, { timeout: SEARCH_FULL_MS });
}

test('pages-5000: la 1.ª coincidencia de «marcador-1» aparece en menos de 1 s y el recorrido completo en menos de 15 s', async ({
  page,
}, testInfo) => {
  await openFixture(page, 'pages-5000.pdf');
  await waitPageRendered(page, 1);

  const started = await pageNow(page);
  await page.keyboard.press('Control+f');
  await expect(searchField(page)).toBeFocused();
  await searchField(page).fill('marcador-1');
  await expect(counterText(page)).toBeVisible();
  const firstMatch = (await pageNow(page)) - started;

  await waitSearchComplete(page);
  const full = (await pageNow(page)) - started;

  recordMeasure(testInfo, `búsqueda «marcador-1» en 5 000 páginas: 1.ª coincidencia ${firstMatch.toFixed(0)} ms, recorrido completo ${full.toFixed(0)} ms`);
  expect(firstMatch).toBeLessThan(SEARCH_FIRST_MS);
  expect(full).toBeLessThan(SEARCH_FULL_MS);
});

test('pages-5000: ninguna long task supera 100 ms durante scroll, zoom y búsqueda', { tag: '@perf' }, async ({ page }, testInfo) => {
  await installPerfProbes(page);
  await openFixture(page, 'pages-5000.pdf');
  await waitPageRendered(page, 1);

  await clearLongTasks(page);
  const viewer = page.getByTestId('viewer');
  await viewer.hover();
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, i % 4 === 0 ? 2500 : 600);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+=');
  }
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+f');
  await searchField(page).fill('marcador-1');
  await waitSearchComplete(page);

  const tasks = await longTasks(page);
  const worst = tasks.length === 0 ? 0 : Math.max(...tasks);
  recordMeasure(testInfo, `long tasks en scroll, zoom y búsqueda: ${String(tasks.length)} tareas, la mayor ${worst.toFixed(0)} ms`);
  expect(worst).toBeLessThan(LONG_TASK_MS);
});
