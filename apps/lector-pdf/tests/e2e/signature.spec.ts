import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { goToPageByKeyboard, pageField, pageFrame } from './helpers.ts';
import { qpdfAnnotations, qpdfCheck, qpdfObjects } from '../support/qpdf.ts';
import {
  drawStroke,
  openFixtureWithDownloads,
  openInNewPage,
  saveWithCtrlS,
  zigzagFrom,
  zoneOf,
  type Box,
} from './annotations-kit.ts';

/**
 * Firma visual (PDF-043): crear una firma dibujada, colocarla con clic, moverla, redimensionarla (con la proporción),
 * deshacer, guardarla dentro del PDF y reabrirla; firma guardada y colocación con teclado. Sin red.
 */

const SIGNATURE_KIND = 'Firma';
/** Anchura de una firma recién colocada, en puntos PDF; a escala 1 es 150 px. */
const SIGNATURE_WIDTH_PT = 150;

/** Caja de un elemento en coordenadas de ventana. */
async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('sin caja');
  return box;
}

/** Crea una firma dibujada con «Firmar» → «Crear firma…» → Dibujar → Aceptar. Se guarda para otras veces por defecto. */
async function createDrawnSignature(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Crear firma…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear firma' });
  await expect(dialog).toBeVisible();
  const canvas = dialog.getByLabel('Área para dibujar la firma');
  const box = await boxOf(canvas);
  const start = { x: box.x + 40, y: box.y + box.height / 2 };
  await drawStroke(page, zigzagFrom(start, 20));
  await dialog.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Coloca la firma pendiente con un clic en la página `n`, en la posición indicada dentro de la página. */
async function placeWithClick(page: Page, n: number, at: { x: number; y: number }): Promise<void> {
  const frame = pageFrame(page, n);
  await expect(frame).toBeVisible();
  const box = await boxOf(frame);
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

test.describe('firma visual', () => {
  test('crear, colocar, mover, redimensionar (con proporción) y deshacer; sin red', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://localhost')) requests.push(request.url());
    });
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await createDrawnSignature(page);

    await placeWithClick(page, 1, { x: 200, y: 200 });
    const zone = zoneOf(page, 1, SIGNATURE_KIND);
    await expect(zone).toHaveCount(1);
    const placed = await boxOf(zone);

    // Arrastrar 50 px a la derecha mueve la firma 50 px (±2).
    await page.mouse.move(placed.x + placed.width / 2, placed.y + placed.height / 2);
    await page.mouse.down();
    await page.mouse.move(placed.x + placed.width / 2 + 25, placed.y + placed.height / 2, { steps: 4 });
    await page.mouse.move(placed.x + placed.width / 2 + 50, placed.y + placed.height / 2, { steps: 4 });
    await page.mouse.up();
    const moved = await boxOf(zone);
    expect(Math.abs(moved.x - placed.x - 50)).toBeLessThanOrEqual(2);

    // El tirador agranda la firma manteniendo la proporción (ancho y alto ±1 %).
    const handle = page.getByRole('button', { name: 'Cambiar tamaño', exact: true });
    const handleBox = await boxOf(handle);
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 30, handleBox.y + handleBox.height / 2 + 10, { steps: 6 });
    await page.mouse.up();
    const resized = await boxOf(zone);
    expect(resized.width).toBeGreaterThan(moved.width + 20);
    expect(Math.abs(resized.width / resized.height - moved.width / moved.height) / (moved.width / moved.height)).toBeLessThanOrEqual(0.01);

    // Ctrl+Z: deshace el tamaño, luego la posición, luego la firma.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Math.round((await boxOf(zone)).width)).toBe(Math.round(moved.width));
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Math.round((await boxOf(zone)).x)).toBe(Math.round(placed.x));
    await page.keyboard.press('Control+z');
    await expect(zone).toHaveCount(0);

    expect(requests).toEqual([]);
  });

  test('la firma guardada se ve en el menú tras recargar y se coloca en la página 3 solo con teclado', async ({ page }) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await createDrawnSignature(page);

    await page.reload();
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await page.getByRole('button', { name: 'Firmar', exact: true }).focus();
    await page.keyboard.press('Enter');
    const saved = page.getByRole('menuitem', { name: 'Firma guardada 1', exact: true });
    await expect(saved).toBeVisible();
    await saved.click();

    // Página 3 con el teclado: Intro en el visor coloca la firma pendiente a un tercio de lo visible.
    await page.getByTestId('viewer').focus();
    await goToPageByKeyboard(page, 3, 5);
    await expect(pageField(page)).toHaveValue('3');
    await page.getByTestId('viewer').focus();
    await page.keyboard.press('Enter');

    await expect(zoneOf(page, 3, SIGNATURE_KIND)).toHaveCount(1);
    await expect(zoneOf(page, 1, SIGNATURE_KIND)).toHaveCount(0);
  });

  test('Ctrl+S guarda la firma como Stamp validado por qpdf; al reabrir sigue visible', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await createDrawnSignature(page);
    await placeWithClick(page, 1, { x: 200, y: 200 });
    await expect(zoneOf(page, 1, SIGNATURE_KIND)).toHaveCount(1);

    const saved = await saveWithCtrlS(page, testInfo, 'basic-5-firmado.pdf');
    expect(qpdfCheck(saved).code).toBe(0);

    const stamps = qpdfAnnotations(saved).filter((a) => a.subtype === 'Stamp');
    expect(stamps).toHaveLength(1);
    const objects = qpdfObjects(saved);
    const dict = objects[`obj:${stamps[0]?.ref ?? ''}`]?.value as { readonly '/Rect'?: unknown } | undefined;
    const rect = dict?.['/Rect'];
    const coords = Array.isArray(rect) ? rect.map((v) => Number(v)) : [];
    expect(coords).toHaveLength(4);
    expect(Math.abs((coords[2] ?? 0) - (coords[0] ?? 0) - SIGNATURE_WIDTH_PT)).toBeLessThanOrEqual(1);

    const reopened = await openInNewPage(page, saved);
    await expect(zoneOf(reopened, 1, SIGNATURE_KIND)).toHaveCount(1);
  });

  test('el diálogo «Crear firma» y el menú «Firmar» no tienen incidencias serias ni críticas', async ({ page }) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await page.getByRole('button', { name: 'Firmar', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Firmar' });
    await expect(menu).toBeVisible();
    const menuResults = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
    expect(menuResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

    await page.getByRole('menuitem', { name: 'Crear firma…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Crear firma' });
    await expect(dialog).toBeVisible();
    const dialogResults = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(dialogResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
