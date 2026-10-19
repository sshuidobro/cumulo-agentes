import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { msg } from '../../src/ui/messages.ts';
import { viewMsg } from '../../src/ui/messages-view.ts';
import { chooseView, openFixture, pageFrame, waitPageVisible } from './helpers.ts';

/** Página actual que indica el visor (1-based). */
async function currentPage(page: Page): Promise<string | null> {
  return page.getByTestId('viewer').getAttribute('data-current-page');
}

/** Entra en pantalla completa con Ctrl+L y espera a que la barra principal desaparezca. */
async function enterFullscreen(page: Page): Promise<void> {
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+l');
  await expect(page.getByRole('button', { name: viewMsg.view, exact: true })).toHaveCount(0);
}

/** Caja de la página `n` (1-based); falla si no está montada. */
async function frameBox(page: Page, n: number) {
  await expect(pageFrame(page, n)).toBeVisible();
  const box = await pageFrame(page, n).boundingBox();
  if (box === null) throw new Error(`La página ${String(n)} no tiene caja`);
  return box;
}

test('Ctrl+L: sin barras ni panel, la página 1 centrada sobre fondo negro y con el aviso', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.keyboard.press('F4');
  await expect(page.getByRole('tab', { name: 'Miniaturas' })).toBeVisible();

  await enterFullscreen(page);
  await expect(page.getByRole('tab', { name: 'Miniaturas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: msg.open }).first()).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: viewMsg.fullscreenHint })).toBeVisible();

  const viewer = page.getByTestId('viewer');
  await expect(viewer).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  const box = await frameBox(page, 1);
  const area = await viewer.boundingBox();
  if (area === null) throw new Error('El visor no tiene caja');
  expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - (area.y + area.height / 2))).toBeLessThanOrEqual(2);
});

test('en pantalla completa: clic, →, Av Pág, Espacio avanzan; ←, Re Pág retroceden; Fin va a la última', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await enterFullscreen(page);
  await waitPageVisible(page, 1, 5);
  expect(await currentPage(page)).toBe('1');

  await pageFrame(page, 1).click({ position: { x: 20, y: 20 } });
  expect(await currentPage(page)).toBe('2');
  await page.keyboard.press('ArrowRight');
  expect(await currentPage(page)).toBe('3');
  await page.keyboard.press('PageDown');
  expect(await currentPage(page)).toBe('4');
  await page.keyboard.press('Space');
  expect(await currentPage(page)).toBe('5');

  await page.keyboard.press('ArrowLeft');
  expect(await currentPage(page)).toBe('4');
  await page.keyboard.press('PageUp');
  expect(await currentPage(page)).toBe('3');

  await page.keyboard.press('End');
  expect(await currentPage(page)).toBe('5');
});

test('Esc vuelve a la vista anterior: modo, zoom, panel y pestaña; la preferencia no cambia', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.keyboard.press('F4');
  const thumbnails = page.getByRole('tab', { name: 'Miniaturas' });
  await expect(thumbnails).toBeVisible();
  await page.keyboard.press('Control+2');
  await chooseView(page, 'Desplazamiento continuo');

  await enterFullscreen(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: viewMsg.view, exact: true })).toBeVisible();
  await expect(thumbnails).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: viewMsg.view, exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: viewMsg.continuous })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: viewMsg.paged })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  const stored = await page.evaluate(() => JSON.stringify(Object.entries(window.localStorage)));
  expect(stored).not.toContain('"scroll":"paged"');
});

test('con «Doble página» activo, en pantalla completa las filas son de dos y → avanza de fila en fila', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, viewMsg.spreadPairs);
  await enterFullscreen(page);
  await waitPageVisible(page, 2, 5);
  const first = await frameBox(page, 1);
  const second = await frameBox(page, 2);
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
  expect(await currentPage(page)).toBe('1');

  await page.keyboard.press('ArrowRight');
  expect(await currentPage(page)).toBe('3');
  await page.keyboard.press('ArrowRight');
  expect(await currentPage(page)).toBe('5');
});

test('en pantalla completa, un enlace interno de links.pdf funciona y arrastrar no crea anotaciones', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'links.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await waitPageVisible(page, 1, 5);
  await enterFullscreen(page);

  await page.getByRole('link', { name: msg.internalLink }).first().click();
  await expect(page.getByRole('group', { name: msg.pageOf(3, 5) })).toBeVisible();

  const box = await frameBox(page, 3);
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 160, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-annot-id]')).toHaveCount(0);
});

test('en pantalla completa no hay incidencias de accesibilidad graves', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await enterFullscreen(page);
  await waitPageVisible(page, 1, 5);
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(severe).toEqual([]);
});
