import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Presupuesto de PDF-012: «Fin» en un documento de 5 000 páginas muestra la última en menos de 1,5 s. */
const END_BUDGET_MS = 1500;

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

function pageField(page: Page) {
  return page.getByRole('textbox', { name: 'Número de página' });
}

test('page-labels.pdf: el campo muestra «i» y «(1 de 12)»; escribir A-1 e Intro muestra la página 12', async ({
  page,
}) => {
  await openFixture(page, 'page-labels.pdf');

  await expect(pageField(page)).toHaveValue('i');
  await expect(page.getByText('(1 de 12)')).toBeVisible();

  await pageField(page).fill('A-1');
  await pageField(page).press('Enter');

  await expect(page.getByRole('group', { name: 'Página 12 de 12' })).toBeVisible();
  await expect(pageField(page)).toHaveValue('A-1');
});

test('pages-5000.pdf: Fin muestra «de 5000» en menos de 1,5 s; Inicio vuelve a la página 1; Ctrl+Mayús+N y 4321 muestran la página 4321', async ({
  page,
}) => {
  await openFixture(page, 'pages-5000.pdf');

  const started = Date.now();
  await page.keyboard.press('End');
  await expect(page.getByRole('group', { name: 'Página 5000 de 5000' })).toBeVisible();
  await expect(page.getByText('de 5000', { exact: true })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(END_BUDGET_MS);

  await page.keyboard.press('Home');
  await expect(page.getByRole('group', { name: 'Página 1 de 5000' })).toBeVisible();

  await page.keyboard.press('Control+Shift+N');
  await expect(pageField(page)).toBeFocused();
  await pageField(page).fill('4321');
  await pageField(page).press('Enter');

  await expect(page.getByRole('group', { name: 'Página 4321 de 5000' })).toBeVisible();
});
