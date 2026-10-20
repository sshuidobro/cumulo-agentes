import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CORPUS_DIR, FIXTURES_DIR } from '../fixtures/paths.ts';
import { showSidebarTab } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Altura de página de los fixtures (carta, 792 pt) y la posición del destino «Sección 1.1» (y = 500 pt). */
const PAGE_HEIGHT_PT = 792;
const SECTION_Y_PT = 500;

async function openFile(page: Page, path: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

/**
 * Abre el panel (F4) si está cerrado y elige la pestaña «Marcadores». Un PDF con `/PageMode /UseOutlines` ya
 * abre el panel en esa pestaña, así que F4 solo se pulsa si el panel está cerrado (ver `showSidebarTab`).
 */
async function openBookmarks(page: Page): Promise<void> {
  await showSidebarTab(page, 'Marcadores');
}

test('outline.pdf: clic en «Anexo» va a la página 30; Alt+← vuelve a la página 1', async ({ page }) => {
  await openFile(page, join(FIXTURES_DIR, 'outline.pdf'));
  await openBookmarks(page);

  await page.getByRole('treeitem', { name: 'Anexo' }).click();
  await expect(page.getByRole('group', { name: 'Página 30 de 30' })).toBeVisible();

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('group', { name: 'Página 1 de 30' })).toBeVisible();
});

test('outline.pdf: «Sección 1.1» deja arriba de la vista el punto y = 500 de la página 3', async ({ page }) => {
  await openFile(page, join(FIXTURES_DIR, 'outline.pdf'));
  await openBookmarks(page);

  // «Capítulo 1» viene abierto en el PDF: «Sección 1.1» es la primera fila hija.
  await page.getByRole('treeitem', { name: 'Sección 1.1' }).click();
  const pageThree = page.locator('[data-page-index="2"]');
  await expect(page.getByRole('group', { name: 'Página 3 de 30' })).toBeVisible();

  const offsets = await page.evaluate((selector: string) => {
    const viewer = document.querySelector('[data-testid="viewer"]');
    const target = document.querySelector(selector);
    if (viewer === null || target === null) return null;
    const v = viewer.getBoundingClientRect();
    const p = target.getBoundingClientRect();
    return { viewerTop: v.top, pageTop: p.top, pageHeight: p.height };
  }, '[data-page-index="2"]');
  expect(offsets).not.toBeNull();
  if (offsets === null) return;
  // Distancia desde el borde de la página hasta el punto y = 500 pt (origen abajo), en píxeles.
  const expected = offsets.pageHeight * ((PAGE_HEIGHT_PT - SECTION_Y_PT) / PAGE_HEIGHT_PT);
  const actual = offsets.viewerTop - offsets.pageTop;
  expect(Math.abs(actual - expected)).toBeLessThan(0.05 * offsets.pageHeight);
  await expect(pageThree).toBeVisible();
});

test('compressed.pdf y libreoffice/informe.pdf muestran su índice como árbol', async ({ page }) => {
  await openFile(page, join(FIXTURES_DIR, 'compressed.pdf'));
  await openBookmarks(page);
  await expect(page.getByRole('tree', { name: 'Marcadores' })).toBeVisible();
  await expect(page.getByRole('treeitem').first()).toBeVisible();

  await openFile(page, join(CORPUS_DIR, 'libreoffice', 'informe.pdf'));
  await openBookmarks(page);
  await expect(page.getByRole('tree', { name: 'Marcadores' })).toBeVisible();
  await expect(page.getByRole('treeitem').first()).toBeVisible();
});

test('basic-5.pdf (sin marcadores) muestra «Este documento no tiene marcadores.»', async ({ page }) => {
  await openFile(page, join(FIXTURES_DIR, 'basic-5.pdf'));
  await openBookmarks(page);
  await expect(page.getByText('Este documento no tiene marcadores.')).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Marcadores' })).toHaveCount(0);
});
