import { expect, test } from '@playwright/test';
import { fixture, showSidebarTab, waitPageVisible } from './helpers.ts';
import { openInNewPage, openWithDownloads, saveWithCtrlS } from './annotations-kit.ts';
import { dragCell, openOrganize, openSavedPdf, pageCell } from './organize-kit.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * «Organizar páginas» de punta a punta (PDF-126): arrastrar, girar, borrar, mover con el teclado, guardar y
 * reabrir el resultado para comprobar páginas, índice y enlaces. Cada guardado se descarga (web, ADR-0035).
 */

test('basic-5: arrastrar la página 1 detrás de la 3 y guardar; luego girar la 2, borrar la 5 y guardar', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  const grid = await openOrganize(page);

  await dragCell(page, pageCell(grid, 1), pageCell(grid, 3), 'right');
  await expect(pageCell(grid, 3)).toContainText('(antes 1)');
  const first = await saveWithCtrlS(page, testInfo, 'basic-5-orden.pdf');

  const moved = await openSavedPdf(first);
  expect(moved.numPages).toBe(5);
  expect(await moved.textOf(1)).toContain('Página 2 de 5');
  expect(await moved.textOf(3)).toContain('Página 1 de 5');
  await moved.close();

  // Segunda sesión sobre el resultado: girar la 2, borrar la 5 y guardar.
  const second = await openInNewPage(page, first);
  const grid2 = await openOrganize(second);
  await pageCell(grid2, 2).click();
  await second.keyboard.press('Control+]');
  await expect(grid2.getByRole('option', { name: 'Página 2, girada 90°', exact: true })).toBeVisible();
  await pageCell(grid2, 5).click();
  await second.keyboard.press('Delete');
  await expect(grid2.getByRole('option')).toHaveCount(4);
  const final = await saveWithCtrlS(second, testInfo, 'basic-5-girada.pdf');

  const result = await openSavedPdf(final);
  expect(result.numPages).toBe(4);
  expect(await result.rotationOf(2)).toBe(90);
  expect(await result.textOf(1)).toContain('Página 2 de 5');
  await result.close();
});

test('outline.pdf: mover el Capítulo 2 (página 11) al principio; el índice del resultado lo lleva a la página 1', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('outline.pdf'));
  const grid = await openOrganize(page);
  await expect(grid).toBeFocused();

  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(pageCell(grid, 11)).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await expect(pageCell(grid, 1)).toContainText('(antes 11)');
  const saved = await saveWithCtrlS(page, testInfo, 'outline-orden.pdf');

  const check = await openSavedPdf(saved);
  expect(check.numPages).toBe(30);
  expect(await check.textOf(1)).toContain('Página 11 de 30');
  await check.close();

  const reopened = await openInNewPage(page, saved);
  await showSidebarTab(reopened, 'Marcadores');
  await reopened.getByRole('treeitem', { name: 'Capítulo 2' }).click();
  await waitPageVisible(reopened, 1, 30);
  await reopened.getByRole('treeitem', { name: 'Capítulo 1' }).click();
  await waitPageVisible(reopened, 2, 30);
});

test('links.pdf: mover la página 3 al final; el enlace «(a) Destino explícito a la página 3» lleva a la última', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('links.pdf'));
  const grid = await openOrganize(page);
  await expect(grid).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(pageCell(grid, 3)).toBeVisible();
  await page.keyboard.press('Alt+End');
  await expect(pageCell(grid, 5)).toContainText('(antes 3)');
  const saved = await saveWithCtrlS(page, testInfo, 'links-orden.pdf');

  const check = await openSavedPdf(saved);
  expect(check.numPages).toBe(5);
  expect(await check.textOf(5)).toContain('Página 3 de 5');
  await check.close();

  const reopened = await openInNewPage(page, saved);
  await reopened.getByRole('link', { name: 'Ir al destino del enlace' }).first().click();
  await waitPageVisible(reopened, 5, 5);
});

test('pages-5000: la página 1 al final con Alt+Fin; guardar deja «Página 1 de 5000» al final', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('pages-5000.pdf'));
  const grid = await openOrganize(page);
  await expect(grid).toBeFocused();

  await page.keyboard.press('Home');
  await expect(pageCell(grid, 1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Alt+End');
  await expect(pageCell(grid, 5000)).toContainText('(antes 1)');
  const saved = await saveWithCtrlS(page, testInfo, 'pages-5000-orden.pdf');

  const check = await openSavedPdf(saved);
  expect(check.numPages).toBe(5000);
  expect(await check.textOf(1)).toContain('Página 2 de 5000');
  expect(await check.textOf(5000)).toContain('Página 1 de 5000');
  await check.close();
});

test('Escape con cambios y «No guardar»: el documento no cambia y no se descarga nada', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  let downloads = 0;
  page.on('download', () => {
    downloads += 1;
  });
  const grid = await openOrganize(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(pageCell(grid, 3)).toContainText('(antes 2)');

  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'No guardar' }).click();

  await expect(grid).toBeHidden();
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expectViewerReady(page);
  expect(downloads).toBe(0);
});
