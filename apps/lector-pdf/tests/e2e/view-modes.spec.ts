import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openCommentsPanel, openFixtureWithDownloads, saveWithCtrlS, wordBox, zoneOf } from './annotations-kit.ts';
import { chooseView, fixture, openFixture, pageFrame, thumbnailCanvasCount, waitPageRendered, waitPageVisible } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Opciones del menú «Vista» de desplazamiento y de páginas por fila (PDF-050): los seis modos. */
const SCROLL_OPTIONS = ['Desplazamiento continuo', 'Una página a la vez'] as const;
const SPREAD_OPTIONS = ['Página simple', 'Doble página', 'Doble página con portada'] as const;

/** Subtipos de las anotaciones de la página `n` (1-based), leídos con pdf.js en Node. */
async function annotationSubtypes(path: string, n: number): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  try {
    const doc = await task.promise;
    const annotations = await (await doc.getPage(n)).getAnnotations();
    return annotations.map((annotation) => annotation.subtype);
  } finally {
    await task.destroy();
  }
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

test('doble página y el menú «Vista» abierto no tienen incidencias de accesibilidad graves', async ({ page }, testInfo) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página');
  const onViewer = await new AxeBuilder({ page }).analyze();
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  const onMenu = await new AxeBuilder({ page }).analyze();
  const severe = [...onViewer.violations, ...onMenu.violations].filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({ type: 'axe', description: JSON.stringify(severe.map((v) => v.id)) });
  expect(severe).toEqual([]);
});

test('el menú «Vista» se navega con flechas y el modo activo tiene aria-checked', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Desplazamiento continuo', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'Página simple', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Una página a la vez', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Página simple', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Doble página con portada', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pageFrame(page, 2)).toBeVisible();
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Doble página con portada', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'Doble página', exact: true })).toHaveAttribute('aria-checked', 'false');
});

test('una página a la vez: Av Pág y Re Pág pasan de página solo al llegar al final o al principio', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Una página a la vez');
  await page.getByRole('textbox', { name: 'Zoom' }).fill('200');
  await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
  await page.getByTestId('viewer').focus();
  for (let i = 0; i < 60 && (await pageFrame(page, 2).count()) === 0; i++) {
    await page.keyboard.press('PageDown');
  }
  await expect(pageFrame(page, 2)).toBeVisible();
  await expect(pageFrame(page, 1)).toHaveCount(0);
  for (let i = 0; i < 60 && (await pageFrame(page, 1).count()) === 0; i++) {
    await page.keyboard.press('PageUp');
  }
  await expect(pageFrame(page, 1)).toBeVisible();
  await expect(pageFrame(page, 2)).toHaveCount(0);
});

test('doble página: F3 lleva a una coincidencia de otra fila y la muestra', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Una página a la vez');
  await chooseView(page, 'Doble página');
  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox', { name: 'Buscar en el documento' }).fill('marcador-');
  await expect(page.getByRole('search').getByText('1 de 5', { exact: true })).toBeVisible();
  await expect(pageFrame(page, 1)).toBeVisible();
  await page.keyboard.press('F3');
  await expect(page.getByRole('search').getByText('2 de 5', { exact: true })).toBeVisible();
  await page.keyboard.press('F3');
  await expect(page.getByRole('search').getByText('3 de 5', { exact: true })).toBeVisible();
  await expect(pageFrame(page, 3)).toBeVisible();
  await expect(pageFrame(page, 1)).toHaveCount(0);
});

test('paged + doble página: F3 salta a la coincidencia de otra fila y solo queda montada su fila', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Una página a la vez');
  await chooseView(page, 'Doble página');
  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox', { name: 'Buscar en el documento' }).fill('marcador-');
  await expect(page.getByRole('search').getByText('1 de 5', { exact: true })).toBeVisible();
  await page.keyboard.press('F3');
  await page.keyboard.press('F3');
  await expect(page.getByRole('search').getByText('3 de 5', { exact: true })).toBeVisible();
  await expect(pageFrame(page, 3)).toBeVisible();
  await expect(pageFrame(page, 1)).toHaveCount(0);
  await expect(pageFrame(page, 2)).toHaveCount(0);
});

test('doble página: el resaltado de la página derecha de la fila queda en esa página al guardar', async ({ page }, testInfo) => {
  await openFixtureWithDownloads(page, 'basic-5.pdf');
  await chooseView(page, 'Doble página');
  await waitPageRendered(page, 2);
  const word = await wordBox(page, 2, 'búsqueda');
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, 2, 'Resaltado de')).toHaveCount(1);

  const saved = await saveWithCtrlS(page, testInfo, 'doble-pagina-resaltado.pdf');
  expect(await annotationSubtypes(saved, 2)).toEqual(['Highlight']);
  expect(await annotationSubtypes(saved, 1)).toEqual([]);
});

test('los seis modos: miniaturas, panel de comentarios y búsqueda con F3 funcionan', async ({ page }) => {
  for (const scroll of SCROLL_OPTIONS) {
    for (const spread of SPREAD_OPTIONS) {
      // Cada modo se prueba en una carga limpia del documento (el modo se mantiene entre cargas, PDF-050).
      await openFixture(page, 'basic-5.pdf');
      await chooseView(page, scroll);
      await chooseView(page, spread);

      const sidebar = page.getByRole('button', { name: /Panel lateral/ });
      if ((await sidebar.getAttribute('aria-pressed')) !== 'true') await sidebar.click();
      await expect(page.getByRole('listbox', { name: 'Miniaturas' }).getByRole('option')).toHaveCount(5);
      await expect.poll(() => thumbnailCanvasCount(page)).toBeGreaterThan(0);

      await openCommentsPanel(page);
      await page.getByRole('tab', { name: 'Miniaturas' }).click();

      await page.keyboard.press('Control+f');
      await page.getByRole('searchbox', { name: 'Buscar en el documento' }).fill('marcador-');
      // La búsqueda empieza en la página visible (el visor recuerda la posición): «marcador-N» está en la página N.
      const counter = page.getByRole('search').getByText(/^\d de 5$/);
      await expect(counter).toBeVisible();
      const current = Number((await counter.textContent())?.charAt(0));
      const next = (current % 5) + 1;
      await page.keyboard.press('F3');
      await expect(page.getByRole('search').getByText(`${String(next)} de 5`, { exact: true })).toBeVisible();
      await expect(pageFrame(page, next)).toBeVisible();
    }
  }
});

test('el modo elegido se mantiene al abrir otro documento en la misma sesión', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await chooseView(page, 'Una página a la vez');
  await chooseView(page, 'Doble página con portada');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('sizes-mixed.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
  await expect(pageFrame(page, 2)).toHaveCount(0);
  await page.getByRole('button', { name: 'Vista', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Una página a la vez', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: 'Doble página con portada', exact: true })).toHaveAttribute('aria-checked', 'true');
});
