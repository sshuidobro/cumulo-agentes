import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { draftCount, waitDraftSaved } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

const file = join(FIXTURES_DIR, 'annotated.pdf');
const zoneOf = (page: Page) =>
  page.locator('[data-testid=viewer] [data-page-index="0"]').locator('[role="button"][aria-label^="Resaltado"]');
const dialogOf = (page: Page) => page.getByRole('dialog', { name: /Hay cambios sin guardar/ });

async function open(page: Page): Promise<void> {
  await page.locator('[data-testid=open-input]').setInputFiles(file);
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

async function deleteAndWait(page: Page): Promise<void> {
  await page.goto('/');
  await open(page);
  const zone = zoneOf(page);
  await zone.click();
  await zone.focus();
  await page.keyboard.press('Delete');
  await expect(zone).toHaveCount(0);
  await waitDraftSaved(page);
  await page.reload();
}

test('«Descartar» borra el borrador: al reabrir no vuelve a preguntar', async ({ page }) => {
  await deleteAndWait(page);
  await page.locator('[data-testid=open-input]').setInputFiles(file);
  await dialogOf(page).getByRole('button', { name: 'Descartar' }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(zoneOf(page)).toHaveCount(1);
  await page.reload();
  await open(page);
  await expect(dialogOf(page)).toHaveCount(0);
  await expect(zoneOf(page)).toHaveCount(1);
});

test('tras «Recuperar», Ctrl+Z restaura el estado original en un solo paso', async ({ page }) => {
  await deleteAndWait(page);
  await page.locator('[data-testid=open-input]').setInputFiles(file);
  await dialogOf(page).getByRole('button', { name: 'Recuperar' }).click();
  await expect(zoneOf(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(zoneOf(page)).toHaveCount(1);
});

test('sin cambios no se ofrece nada al recargar', async ({ page }) => {
  // Reloj falso: `runFor` dispara el debounce de 2 s del autoguardado de forma determinista.
  await page.clock.install();
  await page.goto('/');
  await open(page);
  await page.clock.runFor(2_500);
  // Un borrador sin cambios no debe escribirse; la comprobación va después del `runFor`, que ya ha disparado el debounce.
  expect(await draftCount(page)).toBe(0);
  await page.reload();
  await open(page);
  await expect(dialogOf(page)).toHaveCount(0);
});
