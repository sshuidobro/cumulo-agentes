import { expect } from '@playwright/test';
import { test } from './perf-fixture.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks, pageNow, settleFrames } from './helpers.ts';
import { openWithDownloads, storeDownload } from './annotations-kit.ts';
import { dragCell, openOrganize, openSavedPdf, pageCell } from './organize-kit.ts';

/**
 * Presupuestos de «Organizar páginas» con 5 000 páginas (PDF-126, Plan de Lector PDF): sin tareas largas de más de
 * 100 ms al arrastrar tras desplazarse al final, y guardar en menos de 3 s sin tareas largas (el trabajo va en el Worker).
 */
const LONG_TASK_MS = 100;
const SAVE_MS = 3_000;

test('pages-5000 en Organizar: desplazar al final, arrastrar una página sin long tasks > 100 ms; guardar en < 3 s', { tag: '@perf' }, async ({ page }, testInfo) => {
  await installPerfProbes(page);
  await openWithDownloads(page, fixture('pages-5000.pdf'));
  const grid = await openOrganize(page);

  // Desplazamiento al final y arrastre de la última página hasta la mitad de las celdas visibles.
  await grid.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await settleFrames(page);
  const visible = grid.getByRole('option');
  const count = await visible.count();
  const middle = visible.nth(Math.floor(count / 2));
  const last = visible.last();
  await clearLongTasks(page);
  await dragCell(page, last, middle, 'left');
  await settleFrames(page);
  const dragLongTasks = await longTasks(page);
  expect(Math.max(0, ...dragLongTasks)).toBeLessThan(LONG_TASK_MS);

  // Página 1 seleccionada con un clic y movida al final con Alt+Fin; luego se guarda.
  await grid.evaluate((el) => {
    el.scrollTop = 0;
  });
  await pageCell(grid, 1).click();
  await page.keyboard.press('Alt+End');
  await clearLongTasks(page);
  const start = await pageNow(page);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const saved = await storeDownload(await download, testInfo, 'pages-5000-perf.pdf');
  const elapsed = (await pageNow(page)) - start;
  testInfo.annotations.push({ type: 'medida', description: `Guardar pages-5000 desde Organizar: ${String(Math.round(elapsed))} ms` });
  expect(elapsed).toBeLessThan(SAVE_MS);
  const saveLongTasks = await longTasks(page);
  expect(Math.max(0, ...saveLongTasks)).toBeLessThan(LONG_TASK_MS);

  const check = await openSavedPdf(saved);
  expect(check.numPages).toBe(5000);
  expect(await check.textOf(5000)).toContain('Página 1 de 5000');
  await check.close();
});
