import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { waitDraftSaved } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';


async function openAnnotated(page: Page): Promise<void> {
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'annotated.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

/** Zona activa de la anotación del tipo indicado en la página 1 (nombre accesible que empieza por el tipo). */
function highlightZone(page: Page) {
  return page.locator('[data-testid=viewer] [data-page-index="0"]').locator('[role="button"][aria-label^="Resaltado"]');
}

test('una supresión sin guardar se ofrece para recuperar tras recargar; «Recuperar» la aplica', async ({ page }) => {
  await page.goto('/');
  await openAnnotated(page);

  const zone = highlightZone(page);
  await expect(zone).toHaveCount(1);
  await zone.click();
  await zone.focus();
  await page.keyboard.press('Delete');
  await expect(zone).toHaveCount(0);
  await waitDraftSaved(page);

  await page.reload();
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'annotated.pdf'));

  const dialog = page.getByRole('dialog', { name: /Hay cambios sin guardar de la última vez en «annotated\.pdf»/ });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-page-index="0"]').first()).toBeVisible();
  await expect(zone).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Recuperar' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(zone).toHaveCount(0);
});
