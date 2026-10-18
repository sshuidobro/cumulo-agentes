import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Presupuesto de PDF-015: la primera miniatura de un documento de 5 000 páginas se dibuja en menos de 3 s. */
const THUMB_BUDGET_MS = 3000;
/** Miniaturas (lienzos) que puede haber en el DOM a la vez, aunque se recorra la lista entera. */
const MAX_THUMB_CANVASES = 20;

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

function thumbnails(page: Page) {
  return page.getByRole('listbox', { name: 'Miniaturas' });
}

function pageField(page: Page) {
  return page.getByRole('textbox', { name: 'Número de página' });
}

/** `true` si el lienzo tiene algún píxel que no sea blanco. */
async function hasInk(canvas: Locator): Promise<boolean> {
  return canvas.evaluate((node) => {
    const el = node as HTMLCanvasElement;
    const ctx = el.getContext('2d');
    if (ctx === null || el.width === 0 || el.height === 0) return false;
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 250 || (data[i + 1] ?? 255) < 250 || (data[i + 2] ?? 255) < 250) return true;
    }
    return false;
  });
}

test('pages-5000.pdf: con el panel abierto (F4) la miniatura 1 se dibuja en menos de 3 s; recorrer la lista deja ≤ 20 lienzos; clic en la última muestra «de 5000»', async ({
  page,
}) => {
  await openFixture(page, 'pages-5000.pdf');

  const started = Date.now();
  await page.keyboard.press('F4');
  await expect(thumbnails(page)).toBeVisible();
  const first = page.getByRole('option', { name: 'Página 1 de 5000' });
  await expect(first).toHaveAttribute('data-rendered', 'true', { timeout: THUMB_BUDGET_MS });
  expect(Date.now() - started).toBeLessThan(THUMB_BUDGET_MS);
  expect(await hasInk(first.locator('canvas'))).toBe(true);

  // Recorrer la lista hasta el final: la lista monta solo las miniaturas visibles.
  await thumbnails(page).evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  await expect(page.getByRole('option', { name: 'Página 5000 de 5000' })).toBeAttached();
  const canvases = await page.locator('[role="option"] canvas').count();
  expect(canvases).toBeLessThanOrEqual(MAX_THUMB_CANVASES);

  // Clic en la última miniatura: el visor va a la página 5000.
  await page.getByRole('option', { name: 'Página 5000 de 5000' }).click();
  await expect(page.getByRole('group', { name: 'Página 5000 de 5000' })).toBeVisible();
  await expect(page.getByText('de 5000', { exact: true })).toBeVisible();
});

test('pages-5000.pdf: al ir a la página 40 desde el campo de página, la miniatura 40 queda marcada', async ({
  page,
}) => {
  await openFixture(page, 'pages-5000.pdf');
  await page.keyboard.press('F4');
  await expect(thumbnails(page)).toBeVisible();

  await pageField(page).fill('40');
  await pageField(page).press('Enter');

  await expect(page.getByRole('group', { name: 'Página 40 de 5000' })).toBeVisible();
  const thumb40 = page.getByRole('option', { name: 'Página 40 de 5000' });
  await expect(thumb40).toHaveAttribute('aria-selected', 'true');
  await expect(thumb40).toBeInViewport();
  await expect(thumbnails(page)).toHaveAttribute('aria-activedescendant', 'thumb-39');
});

test('pages-5000.pdf: el teclado de la lista (flecha abajo) cambia la página del visor', async ({ page }) => {
  await openFixture(page, 'pages-5000.pdf');
  await page.keyboard.press('F4');
  await expect(thumbnails(page)).toBeVisible();

  await thumbnails(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('group', { name: 'Página 2 de 5000' })).toBeVisible();
  await expect(thumbnails(page)).toHaveAttribute('aria-activedescendant', 'thumb-1');
});
