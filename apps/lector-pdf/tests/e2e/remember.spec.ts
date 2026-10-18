import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Presupuesto de PDF-019: volver al punto guardado en menos de 5 s. */
const RESTORE_BUDGET_MS = 5000;

async function openFixture(page: Page, name: string): Promise<void> {
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

function pageField(page: Page) {
  return page.getByRole('textbox', { name: 'Número de página' });
}

test('pages-5000.pdf: página 2345 y zoom 150 % se recuerdan tras recargar y reabrir en menos de 5 s', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page, 'pages-5000.pdf');

  await pageField(page).fill('2345');
  await pageField(page).press('Enter');
  await expect(page.getByRole('group', { name: 'Página 2345 de 5000' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Zoom' }).fill('150');
  await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Zoom' })).toHaveValue('150 %');

  // Recargar la página: el guardado al ocultarla (pagehide) es lo que deja la posición ya escrita.
  await page.reload();
  const started = Date.now();
  await openFixture(page, 'pages-5000.pdf');

  await expect(pageField(page)).toHaveValue('2345');
  await expect(page.getByRole('textbox', { name: 'Zoom' })).toHaveValue('150 %');
  expect(Date.now() - started).toBeLessThan(RESTORE_BUDGET_MS);
});

test('basic-5.pdf por primera vez empieza en la página 1', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'basic-5.pdf');

  await expect(page.getByRole('group', { name: 'Página 1 de 5' })).toBeVisible();
});
