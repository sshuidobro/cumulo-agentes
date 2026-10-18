import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { DEFAULT_PADDING } from '../../src/core/layout.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { settleFrames } from './helpers.ts';

/** Presupuestos de PDF-010 (ver la ficha). */
const FIRST_PAGE_BUDGET_MS = 1_000;
const HUGE_FIRST_PAGE_BUDGET_MS = 5_000;
const MAX_CANVASES = 12;
const HEAP_BUDGET_BYTES = 400 * 1024 * 1024;
const LONG_TASK_BUDGET_MS = 100;
/** Ancho CSS de una página US Letter (612 pt) a zoom 100 %: 612 × 96 / 72. */
const LETTER_WIDTH_AT_100 = 816;
const LETTER_HEIGHT_AT_100 = 1056;
/** Margen que el modo «ajustar ancho» descuenta al visor (igual que `FIT_MARGIN` en Viewer.tsx). */
const FIT_MARGIN_WIDTH = 2 * DEFAULT_PADDING + 16;

function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

function pageSelector(index: number): string {
  return `[data-testid=viewer] [data-page-index="${index}"]`;
}

async function openFixture(page: Page, name: string): Promise<number> {
  await page.goto('/');
  const started = Date.now();
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  return started;
}

/** Ancho CSS del marco de la página 1 (0 si aún no existe). */
async function firstFrameWidth(page: Page): Promise<number> {
  return page.locator(pageSelector(0)).evaluate((el) => el.getBoundingClientRect().width).catch(() => 0);
}

/**
 * Ajusta la ventana para que la página 1 mida 816 px (zoom 100 %). El modo automático ajusta al ancho del
 * visor sin pasar del 125 %, así que el ancho de la ventana se calcula a partir del margen del visor.
 */
async function setZoomHundred(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('la ventana no tiene tamaño');
  const viewerWidth = await page.getByTestId('viewer').evaluate((el) => el.clientWidth);
  const chrome = viewport.width - viewerWidth;
  // Alto suficiente para que la página entera (1056 px) quede en pantalla y la captura no se corte.
  await page.setViewportSize({ width: LETTER_WIDTH_AT_100 + FIT_MARGIN_WIDTH + chrome, height: LETTER_HEIGHT_AT_100 + 144 });
  await expect
    .poll(() => firstFrameWidth(page), { message: 'la página 1 debe medir 816 px (zoom 100 %)' })
    .toBeCloseTo(LETTER_WIDTH_AT_100, 0);
}

async function mountedCanvases(page: Page): Promise<number> {
  return page.locator('[data-testid=viewer] canvas').count();
}

/** Generador determinista (LCG) para que los saltos aleatorios sean reproducibles. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('basic-5: la página 1 se dibuja en menos de 1 s desde que se elige el fichero', async ({ page }) => {
  const started = await openFixture(page, 'basic-5.pdf');
  await expect(page.locator(`${pageSelector(0)}[data-rendered="true"]`)).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: 'tiempo-primera-pagina-ms', description: String(elapsed) });
  expect(elapsed).toBeLessThan(FIRST_PAGE_BUDGET_MS);
});

test('basic-5 a zoom 100 %: la página 1 coincide con la referencia visual', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await expect(page.locator(`${pageSelector(0)}[data-rendered="true"]`)).toBeVisible();
  await setZoomHundred(page);
  await expect(page.locator(`${pageSelector(0)}[data-rendered="true"]`)).toBeVisible();
  const frame = page.locator(pageSelector(0));
  await expect(frame).toHaveScreenshot('basic-5-pagina-1-zoom-100.png', { maxDiffPixelRatio: 0.01 });
});

test('pages-5000: la página 1 se dibuja en menos de 5 s y, tras 20 saltos, no hay más de 12 lienzos', async ({ page }) => {
  const started = await openFixture(page, 'pages-5000.pdf');
  await expect(page.locator(`${pageSelector(0)}[data-rendered="true"]`)).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: 'tiempo-primera-pagina-5000-ms', description: String(elapsed) });
  expect(elapsed).toBeLessThan(HUGE_FIRST_PAGE_BUDGET_MS);

  const viewer = page.getByTestId('viewer');
  await viewer.focus();
  const random = seeded(9010);
  const keys = ['End', 'Home'] as const;
  for (let jump = 0; jump < 20; jump++) {
    const roll = random();
    if (roll < 0.4) {
      await viewer.press(keys[jump % 2] ?? 'End');
    } else {
      await page.mouse.move(400, 300);
      await page.mouse.wheel(0, Math.floor(random() * 6000) - 3000);
    }
    await settleFrames(page);
    expect(await mountedCanvases(page)).toBeLessThanOrEqual(MAX_CANVASES);
  }

  const heap = await page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory?.usedJSHeapSize ?? -1;
  });
  test.info().annotations.push({ type: 'heap-js-bytes', description: String(heap) });
  if (heap >= 0) expect(heap).toBeLessThan(HEAP_BUDGET_BYTES);
});

test('images-200: al recorrer las 20 primeras páginas, las visibles se dibujan sin tareas largas', { tag: '@perf' }, async ({ page }) => {
  await page.addInitScript(() => {
    const tasks: number[] = [];
    (window as Window & { __longTasks?: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  await openFixture(page, 'images-200.pdf');
  await expect(page.locator(`${pageSelector(0)}[data-rendered="true"]`)).toBeVisible();

  const viewer = page.getByTestId('viewer');
  await viewer.focus();
  for (let step = 0; step < 20; step++) {
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 900);
    await settleFrames(page);
  }

  const visible = page.locator('[data-testid=viewer] [data-page-index][data-rendered]');
  await expect
    .poll(async () => {
      const count = await page.locator('[data-testid=viewer] [data-page-index]').count();
      const pending = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=viewer] [data-page-index]'));
        return frames.filter((f) => f.dataset.rendered !== 'true' && !f.textContent?.includes('No se ha podido')).length;
      });
      return count > 0 ? pending : -1;
    })
    .toBe(0);
  expect(await visible.count()).toBeGreaterThan(0);

  const longest = await page.evaluate(() => {
    const tasks = (window as Window & { __longTasks?: number[] }).__longTasks ?? [];
    return tasks.length === 0 ? 0 : Math.max(...tasks);
  });
  test.info().annotations.push({ type: 'tarea-larga-maxima-ms', description: String(Math.round(longest)) });
  expect(longest).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS);
});

test('annotated: la página 1 muestra el resaltado amarillo del fichero', async ({ page }) => {
  await openFixture(page, 'annotated.pdf');
  await expect(page.locator(`${pageSelector(0)}[data-rendered="true"]`)).toBeVisible();

  const yellow = await page.locator(`${pageSelector(0)} canvas`).evaluate((canvas) => {
    const cv = canvas as HTMLCanvasElement;
    const ctx = cv.getContext('2d');
    if (ctx === null) return -1;
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > 230 && g > 200 && b < 120) count++;
    }
    return count;
  });
  test.info().annotations.push({ type: 'pixeles-amarillos', description: String(yellow) });
  expect(yellow).toBeGreaterThan(100);
});
