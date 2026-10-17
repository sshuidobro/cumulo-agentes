import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';

/** Presupuesto de PDF-008 para abrir 100 000 páginas hasta mostrar el recuento. */
const BUDGET_100K_MS = 5_000;

function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

test('abrir basic-5 con el selector muestra 5 páginas y el título de la ventana', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('basic-5.pdf'));

  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expect(page).toHaveTitle('basic-5.pdf — Lector PDF');
});

test('un fichero que no es PDF muestra el mensaje de error', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('corrupt-not-pdf.pdf'));

  await expect(page.getByRole('alert')).toContainText('Este fichero no es un PDF.');
});

test('un fichero vacío muestra el mensaje de error', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('corrupt-empty.pdf'));

  await expect(page.getByRole('alert')).toContainText('El fichero está vacío (0 bytes).');
});

test('abrir un PDF de 100 000 páginas muestra el recuento dentro del presupuesto', async ({ page }, testInfo) => {
  await page.goto('/');
  const started = Date.now();
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('pages-100000.pdf'));

  await expect(page.getByTestId('document-ready')).toHaveText('100.000 páginas', { timeout: BUDGET_100K_MS });
  const elapsed = Date.now() - started;
  testInfo.annotations.push({ type: 'rendimiento', description: `100.000 páginas visibles en ${String(elapsed)} ms` });
  expect(elapsed).toBeLessThan(BUDGET_100K_MS);
});
