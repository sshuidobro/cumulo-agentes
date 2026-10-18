import { statSync } from 'node:fs';
import { type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { fixture, goToPageByKeyboard, installPerfProbes, longTasks, pageNow, recordMeasure, seeded, waitPageRendered } from './helpers.ts';
import { msg } from '../../src/ui/messages.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import { liveAnnotations } from './annotations-live.ts';
import {
  openCommentsPanel,
  openWithDownloads,
  storeDownload,
  wordBox,
  zoneOf,
} from './annotations-kit.ts';

/**
 * Presupuestos de anotaciones (PDF-039, Plan «Presupuestos»): escaneo del panel, creación y guardado en documentos
 * grandes. Medidas en el reloj de la página (`performance.now()`); los umbrales no se relajan.
 */

const PAGES_5000 = 5000;
const PAGES_100000 = 100000;
/** Presupuesto del escaneo completo de anotaciones en 5 000 páginas (ms). */
const SCAN_BUDGET_MS = 10_000;
/** Presupuesto de una tarea larga: ninguna long task por encima de este valor (ms). */
const LONG_TASK_BUDGET_MS = 100;
/** Presupuesto de guardar en 5 000 páginas, desde Ctrl+S hasta la descarga (ms). */
const SAVE_5000_BUDGET_MS = 1_000;
/** Presupuesto de guardar en 100 000 páginas, desde Ctrl+S hasta la descarga (ms). */
const SAVE_100000_BUDGET_MS = 3_000;
/** Crecimiento máximo del fichero por 10 anotaciones (bytes). */
const GROWTH_BUDGET_BYTES = 50 * 1024;
/** Páginas aleatorias (semilla fija) donde se crea un resaltado. */
const RANDOM_PAGES = 10;
const SEED = 20261018;

/** Páginas distintas, elegidas con un generador de semilla fija (reproducible), en 1..total. */
function randomPages(total: number, count: number): number[] {
  const next = seeded(SEED);
  const picked = new Set<number>();
  while (picked.size < count) picked.add(1 + Math.floor(next() * total));
  return [...picked];
}

/** Crea un resaltado sobre la primera palabra «Página» de la página `n` (1-based), ya montada. */
async function highlightFirstWord(page: Page, n: number): Promise<void> {
  await waitPageRendered(page, n);
  const word = await wordBox(page, n, 'Página');
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, n, 'Resaltado de')).toHaveCount(1);
}

test('pages-5000.pdf: escaneo de anotaciones < 10 s sin long tasks > 100 ms; 10 resaltados y guardar < 1 s con < 50 KB de crecimiento', { tag: '@perf' }, async ({
  page,
}, testInfo: TestInfo) => {
  await installPerfProbes(page);
  const originalSize = statSync(fixture('pages-5000.pdf')).size;

  // Escaneo completo de anotaciones: en 5 000 páginas el panel lo hace solo al abrir el documento (sin botón).
  // Se mide desde que se abre el fichero (cota superior: incluye la carga) hasta que el panel dice que no hay
  // comentarios. Las long tasks se cuentan desde el inicio del documento, así que incluyen carga y escaneo.
  // Reloj de Node: `performance.now()` de la página se reinicia al cargar la app (`goto`), así que no sirve aquí.
  const scanStart = Date.now();
  await openWithDownloads(page, fixture('pages-5000.pdf'));
  await openCommentsPanel(page);
  await expect(page.getByText(msg.commentsEmpty)).toBeVisible({ timeout: SCAN_BUDGET_MS });
  const scanMs = Date.now() - scanStart;
  recordMeasure(testInfo, `escaneo completo pages-5000 (desde abrir hasta el panel listo): ${scanMs.toFixed(0)} ms (presupuesto < ${String(SCAN_BUDGET_MS)} ms)`);
  expect(scanMs).toBeLessThan(SCAN_BUDGET_MS);
  const scanTasks = await longTasks(page);
  recordMeasure(testInfo, `long tasks desde el inicio del documento (carga y escaneo): ${String(scanTasks.length)}, máxima ${Math.max(0, ...scanTasks).toFixed(0)} ms`);
  expect(scanTasks.filter((d) => d > LONG_TASK_BUDGET_MS)).toEqual([]);

  // Diez resaltados en páginas aleatorias de todo el documento.
  for (const n of randomPages(PAGES_5000, RANDOM_PAGES)) {
    await goToPageByKeyboard(page, n, PAGES_5000);
    await highlightFirstWord(page, n);
  }

  // Guardar: desde Ctrl+S hasta que llega la descarga.
  const download = page.waitForEvent('download');
  const saveStart = await pageNow(page);
  await page.keyboard.press('Control+s');
  const file = await download;
  const saveMs = (await pageNow(page)) - saveStart;
  recordMeasure(testInfo, `guardar 10 anotaciones en pages-5000: ${saveMs.toFixed(0)} ms (presupuesto < ${String(SAVE_5000_BUDGET_MS)} ms)`);
  expect(saveMs).toBeLessThan(SAVE_5000_BUDGET_MS);

  const saved = await storeDownload(file, testInfo, 'pages-5000-anotado.pdf');
  const growth = statSync(saved).size - originalSize;
  recordMeasure(testInfo, `crecimiento del fichero por 10 anotaciones: ${String(growth)} bytes (presupuesto < ${String(GROWTH_BUDGET_BYTES)})`);
  expect(growth).toBeLessThan(GROWTH_BUDGET_BYTES);
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);
});

test('pages-100000.pdf: anotar la página 99 999 y guardar < 3 s', async ({ page }, testInfo: TestInfo) => {
  await openWithDownloads(page, fixture('pages-100000.pdf'));
  await goToPageByKeyboard(page, 99_999, PAGES_100000);
  await highlightFirstWord(page, 99_999);

  const download = page.waitForEvent('download');
  const saveStart = await pageNow(page);
  await page.keyboard.press('Control+s');
  const file = await download;
  const saveMs = (await pageNow(page)) - saveStart;
  recordMeasure(testInfo, `guardar en pages-100000 (página 99 999): ${saveMs.toFixed(0)} ms (presupuesto < ${String(SAVE_100000_BUDGET_MS)} ms)`);
  expect(saveMs).toBeLessThan(SAVE_100000_BUDGET_MS);

  const saved = await storeDownload(file, testInfo, 'pages-100000-anotado.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);
  expect(liveAnnotations(saved).filter((a) => a.subtype === 'Highlight')).toHaveLength(1);
});
