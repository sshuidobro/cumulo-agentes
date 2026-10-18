import { type Locator, type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import {
  clearLongTasks,
  fixture,
  installPerfProbes,
  longTasks,
  openFixture,
  pageFrame,
  pageNow,
  recordMeasure,
  waitPageRendered,
} from './helpers.ts';
import { openWithDownloads, storeDownload } from './annotations-kit.ts';
import { qpdfCheck } from '../support/qpdf.ts';

/**
 * Presupuestos de rendimiento de la iteración 3 (PDF-090). Las pruebas `@perf` miden *long tasks* y se ejecutan en
 * el proyecto `chromium-perf`, en serie y con la CPU en reposo (ADR-0016). Las medidas se anotan en el informe.
 */

/** Una *long task* es cualquier tarea del hilo principal de más de 100 ms (presupuesto de la iteración). */
const LONG_TASK_BUDGET_MS = 100;
/** Guardar los formularios de `form-full.pdf`, desde Ctrl+S hasta la descarga (ms). */
const SAVE_FORMS_BUDGET_MS = 1_000;
/** Imprimir 20 páginas de `pages-5000.pdf`, desde «Imprimir» hasta la llamada a `window.print` (ms). */
const PRINT_20_BUDGET_MS = 20_000;
const PRINT_PAGES = 20;

/** Sustituye `window.print` por una función que cuenta las llamadas (no imprime nada). */
async function installPrintCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printCount: number };
    w.__printCount = 0;
    window.print = (): void => {
      w.__printCount += 1;
    };
  });
}

async function printCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __printCount: number }).__printCount);
}

/** Campo de formulario de la p1 por rol y nombre exacto; los controles de `form-full.pdf` van en la página. */
function p1(page: Page, role: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'listbox', name: string): Locator {
  return pageFrame(page, 1).getByRole(role, { name, exact: true });
}

test(
  'form-full.pdf: abrir y rellenar 10 campos seguidos sin long tasks > 100 ms',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await installPerfProbes(page);
    await openFixture(page, 'form-full.pdf');
    await waitPageRendered(page, 1);

    await p1(page, 'textbox', 'nombre').fill('María José');
    await p1(page, 'textbox', 'comentarios').fill('Línea uno');
    await p1(page, 'textbox', 'codigo').fill('ABC123');
    await p1(page, 'textbox', 'importe').fill('12,50');
    await p1(page, 'checkbox', 'acepto').check();
    await p1(page, 'radio', 'color: Azul').check();
    await p1(page, 'combobox', 'pais').focus();
    await page.keyboard.press('p');
    await p1(page, 'listbox', 'idiomas').focus();
    await page.keyboard.press('F');
    await p1(page, 'textbox', 'persona.apellido').fill('Núñez');
    await p1(page, 'textbox', 'rotado').fill('Hola');

    const tasks = await longTasks(page);
    recordMeasure(testInfo, `long tasks al abrir y rellenar 10 campos: ${String(tasks.length)}, máxima ${Math.max(0, ...tasks).toFixed(0)} ms (presupuesto ≤ ${String(LONG_TASK_BUDGET_MS)} ms)`);
    expect(tasks.filter((d) => d > LONG_TASK_BUDGET_MS)).toEqual([]);
  },
);

test(
  'form-full.pdf: guardar los formularios < 1 s desde Ctrl+S hasta la descarga',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await openWithDownloads(page, fixture('form-full.pdf'));
    await p1(page, 'textbox', 'nombre').fill('María José');
    await p1(page, 'checkbox', 'acepto').check();
    await p1(page, 'radio', 'color: Azul').check();

    const download = page.waitForEvent('download');
    const saveStart = await pageNow(page);
    await page.keyboard.press('Control+s');
    const file = await download;
    const saveMs = (await pageNow(page)) - saveStart;
    recordMeasure(testInfo, `guardar formularios en form-full: ${saveMs.toFixed(0)} ms (presupuesto < ${String(SAVE_FORMS_BUDGET_MS)} ms)`);
    expect(saveMs).toBeLessThan(SAVE_FORMS_BUDGET_MS);

    const saved = await storeDownload(file, testInfo, 'form-full-medido.pdf');
    const check = qpdfCheck(saved);
    expect(check.code, check.output).toBe(0);
  },
);

test(
  'pages-5000.pdf: imprimir 20 páginas < 20 s y sin long tasks > 100 ms',
  { tag: '@perf' },
  async ({ page }, testInfo: TestInfo) => {
    await installPerfProbes(page);
    await installPrintCounter(page);
    await openWithDownloads(page, fixture('pages-5000.pdf'));
    await clearLongTasks(page);

    await page.keyboard.press('Control+P');
    const dialog = page.getByRole('dialog', { name: 'Imprimir', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: 'Páginas', exact: true }).check();
    await dialog.getByRole('textbox', { name: 'Rango de páginas' }).fill(`1-${String(PRINT_PAGES)}`);

    const before = await printCount(page);
    const printStart = await pageNow(page);
    await dialog.getByRole('button', { name: 'Imprimir', exact: true }).click();
    await expect.poll(() => printCount(page), { timeout: PRINT_20_BUDGET_MS + 10_000 }).toBe(before + 1);
    const printMs = (await pageNow(page)) - printStart;
    recordMeasure(testInfo, `imprimir ${String(PRINT_PAGES)} páginas de pages-5000: ${printMs.toFixed(0)} ms (presupuesto < ${String(PRINT_20_BUDGET_MS)} ms)`);
    expect(printMs).toBeLessThan(PRINT_20_BUDGET_MS);

    const tasks = await longTasks(page);
    recordMeasure(testInfo, `long tasks al imprimir: ${String(tasks.length)}, máxima ${Math.max(0, ...tasks).toFixed(0)} ms (presupuesto ≤ ${String(LONG_TASK_BUDGET_MS)} ms)`);
    expect(tasks.filter((d) => d > LONG_TASK_BUDGET_MS)).toEqual([]);
  },
);
