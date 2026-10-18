import { join } from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Ruta absoluta de un fixture generado (`fixtures/pdf/generated/`). */
export function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

/** Abre un fixture con el selector de la web y espera a que el visor pueda recibir teclas. */
export async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

/** Campo «Número de página» de la barra. */
export function pageField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Número de página' });
}

/** Marco de la página `n` (1-based). Solo existe si el visor la tiene montada. */
export function pageFrame(page: Page, n: number): Locator {
  return page.locator(`[data-testid=viewer] [data-page-index="${String(n - 1)}"]`);
}

/** Espera a que la página `n` (1-based) esté dibujada en su lienzo. */
export async function waitPageRendered(page: Page, n: number): Promise<void> {
  await expect(page.locator(`[data-testid=viewer] [data-page-index="${String(n - 1)}"][data-rendered="true"]`)).toBeVisible();
}

/** Espera a que el marco «Página n de total» esté montado. */
export async function waitPageVisible(page: Page, n: number, total: number): Promise<void> {
  await expect(page.getByRole('group', { name: `Página ${String(n)} de ${String(total)}` })).toBeVisible();
}

/** Salta a la página `n` con Ctrl+Mayús+N, escribiendo el número e Intro. */
export async function goToPageByKeyboard(page: Page, n: number, total: number): Promise<void> {
  await page.keyboard.press('Control+Shift+N');
  await expect(pageField(page)).toBeFocused();
  await pageField(page).fill(String(n));
  await pageField(page).press('Enter');
  await waitPageVisible(page, n, total);
}

/** Reloj de la página (`performance.now()`), para medir intervalos sin el ruido de Node. */
export function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/**
 * Inyecta antes de cualquier script de la página un observador de *long tasks* (> 50 ms según el navegador).
 * Las duraciones quedan en `window.__longTasks`; `longTasks()` las lee y `clearLongTasks()` las vacía.
 */
export async function installPerfProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tasks: number[] = [];
    (window as Window & { __longTasks?: number[] }).__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
}

/** Duraciones (ms) de las long tasks registradas desde la última limpieza. */
export function longTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as Window & { __longTasks?: number[] }).__longTasks?.slice() ?? []);
}

/** Vacía el registro de long tasks (para medir solo lo que venga después). */
export async function clearLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tasks = (window as Window & { __longTasks?: number[] }).__longTasks;
    if (tasks !== undefined) tasks.length = 0;
  });
}

/** Heap JS usado en MB (`performance.memory`, Chromium). Falla si el navegador no lo expone. */
export async function heapMB(page: Page): Promise<number> {
  const bytes = await page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory?.usedJSHeapSize ?? null;
  });
  if (bytes === null) throw new Error('performance.memory no está disponible en este navegador');
  return bytes / (1024 * 1024);
}

/** Lienzos `<canvas>` de páginas del visor. */
export function canvasCount(page: Page): Promise<number> {
  return page.locator('[data-testid=viewer] canvas').count();
}

/** Marcos de página montados en el visor (nodos `data-page-index`). */
export function frameCount(page: Page): Promise<number> {
  return page.locator('[data-testid=viewer] [data-page-index]').count();
}

/** Lienzos de las miniaturas visibles (el presupuesto de lienzos suma las miniaturas). */
export function thumbnailCanvasCount(page: Page): Promise<number> {
  return page.locator('[data-testid=thumbnails] canvas').count();
}

/** Registra una medida en el informe de Playwright (`--reporter` la muestra en la salida). */
export function recordMeasure(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: 'medida', description });
}

/** Generador determinista (LCG): los saltos aleatorios son reproducibles de una ejecución a otra. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Ancho y alto CSS de un marco de página montado. */
export async function frameSize(page: Page, n: number): Promise<{ width: number; height: number }> {
  return pageFrame(page, n).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
}

/** Espera a que el navegador haya pintado dos fotogramas: el desplazamiento y el dibujo pendientes ya se han procesado. */
export async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); }),
  );
}

/** Espera a que el autoguardado (PDF-038) haya escrito un borrador en IndexedDB (`lector-pdf` / `drafts`). */
export async function waitDraftSaved(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open('lector-pdf');
              open.onerror = () => { resolve(0); };
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains('drafts')) { db.close(); resolve(0); return; }
                const count = db.transaction('drafts', 'readonly').objectStore('drafts').count();
                count.onsuccess = () => { db.close(); resolve(count.result); };
                count.onerror = () => { db.close(); resolve(0); };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}
