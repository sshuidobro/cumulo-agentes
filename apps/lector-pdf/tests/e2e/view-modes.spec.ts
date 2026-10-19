import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openFixture, pageFrame, waitPageVisible } from './helpers.ts';

/** Elige una opción del menú «Vista» (PDF-050). */
async function chooseView(page: Page, option: string): Promise<void> {
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
  await expect(page.locator('[data-testid=viewer] [data-page-index]').first()).toBeVisible();
}

/** Caja de la página `n` (1-based) en la página; falla si no está montada. */
async function frameBox(page: Page, n: number) {
  await expect(pageFrame(page, n)).toBeVisible();
  const box = await pageFrame(page, n).boundingBox();
  if (box === null) throw new Error(`La página ${String(n)} no tiene caja`);
  return box;
}

test('doble página: las páginas 1 y 2 están en la misma fila y centradas en el visor', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página');
  const first = await frameBox(page, 1);
  const second = await frameBox(page, 2);
  const viewer = await page.getByTestId('viewer').boundingBox();
  if (viewer === null) throw new Error('El visor no tiene caja');
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
  const rowCenter = (first.x + second.x + second.width) / 2;
  expect(Math.abs(rowCenter - (viewer.x + viewer.width / 2))).toBeLessThanOrEqual(2);
});

test('doble página con portada: la 1 sola y centrada en la columna; la 2 y la 3 juntas', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página con portada');
  const cover = await frameBox(page, 1);
  // La columna ocupa todo el espaciador del visor (su ancho de desplazamiento); la portada va en su centro.
  const scroll = await page.getByTestId('viewer').evaluate((el) => ({ x: el.getBoundingClientRect().x, w: el.scrollWidth }));
  expect(Math.abs(cover.x + cover.width / 2 - (scroll.x + scroll.w / 2))).toBeLessThanOrEqual(2);
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+PageDown');
  await waitPageVisible(page, 2, 5);
  const second = await frameBox(page, 2);
  const third = await frameBox(page, 3);
  expect(Math.abs(second.y - third.y)).toBeLessThanOrEqual(1);
  expect(second.x).toBeLessThan(third.x);
});

test('doble página: Ctrl+AvPág pasa de la fila 1-2 a la 3-4 y el indicador muestra «3 de 5»', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página');
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+PageDown');
  await waitPageVisible(page, 3, 5);
  await expect(pageFrame(page, 3)).toBeVisible();
  await expect(pageFrame(page, 4)).toBeVisible();
});

test('doble página con Ctrl+0: la fila completa cabe en el visor', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página');
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+0');
  const first = await frameBox(page, 1);
  const second = await frameBox(page, 2);
  const viewer = await page.getByTestId('viewer').boundingBox();
  if (viewer === null) throw new Error('El visor no tiene caja');
  expect(second.x + second.width - first.x).toBeLessThanOrEqual(viewer.width);
  expect(Math.max(first.height, second.height)).toBeLessThanOrEqual(viewer.height);
});

test('una página a la vez a 200 %: la rueda recorre la página y luego pasa a la siguiente arriba', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Una página a la vez');
  await page.getByRole('textbox', { name: 'Zoom' }).fill('200');
  await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
  const viewer = page.getByTestId('viewer');
  await viewer.hover();
  await expect(pageFrame(page, 2)).toHaveCount(0);

  // Rueda hasta el final de la primera página; después, más rueda pasa a la segunda.
  for (let i = 0; i < 60 && (await pageFrame(page, 2).count()) === 0; i++) {
    await page.mouse.wheel(0, 200);
  }
  await expect(pageFrame(page, 2)).toBeVisible();
  await expect(pageFrame(page, 1)).toHaveCount(0);

  // Rueda hacia arriba al principio de la segunda vuelve a la primera.
  for (let i = 0; i < 60 && (await pageFrame(page, 1).count()) === 0; i++) {
    await page.mouse.wheel(0, -200);
  }
  await expect(pageFrame(page, 1)).toBeVisible();
});

test('el modo elegido persiste tras recargar', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página con portada');
  await page.reload();
  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Doble página con portada', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('el menú «Vista» abierto en doble página no tiene incidencias de accesibilidad graves', async ({ page }, testInfo) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página');
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({ type: 'axe', description: JSON.stringify(severe.map((v) => v.id)) });
  expect(severe).toEqual([]);
});
