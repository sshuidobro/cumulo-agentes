import { readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { memorySource } from '@suite/platform';
import { msg } from '../../src/ui/messages.ts';
import { signatureMsg } from '../../src/ui/messages-signature.ts';
import { loadPdf } from '../../src/engine/index.ts';
import { nodeAssetBase } from '../helpers/pdfjs-node.ts';
import { goToPageByKeyboard, pageField, pageFrame } from './helpers.ts';
import { qpdfAnnotations, qpdfCheck, qpdfObjects } from '../support/qpdf.ts';
import {
  commentRows,
  drawStroke,
  openCommentsPanel,
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
/** Punto de colocación de la firma en la página 1, en píxeles dentro de la página (a escala 1 o más). */
const PLACE_AT = { x: 200, y: 200 };

/** Caja de un elemento en coordenadas de ventana. */
async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('sin caja');
  return box;
}

/** Pulsa Tab hasta que `target` tenga el foco (como mucho `max` veces). */
async function tabUntil(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
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

/** Caja de la firma `placed` (medida en `pageBefore`) en otra ventana, con la misma posición relativa a su página. */
function samePlaceIn(frame: Box, placed: Box, pageBefore: Box): Box {
  return { x: frame.x + placed.x - pageBefore.x, y: frame.y + placed.y - pageBefore.y, width: placed.width, height: placed.height };
}

/** Fracción de píxeles oscuros de una zona de la ventana (la tinta de la firma es negra). */
async function darkShare(page: Page, box: Box): Promise<number> {
  const png = await page.screenshot({
    clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(1, box.width), height: Math.max(1, box.height) },
  });
  return page.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('sin contexto 2D');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let dark = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total++;
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) < 200) dark++;
    }
    return total === 0 ? 0 : dark / total;
  }, png.toString('base64'));
}

/** Color (RGB) de un píxel de la ventana, medido en una captura decodificada en el navegador. */
async function pixelAt(page: Page, x: number, y: number): Promise<readonly number[]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  return page.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('sin contexto 2D');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  }, png.toString('base64'));
}

test.describe('firma visual', () => {
  test('crear, colocar, mover, redimensionar (con proporción) y deshacer; sin red', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://localhost')) requests.push(request.url());
    });
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await createDrawnSignature(page);

    await placeWithClick(page, 1, PLACE_AT);
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

    // Tab hasta «Firmar», Intro abre el menú (el primer elemento queda con el foco), flechas y Intro eligen la firma.
    const firmar = page.getByRole('button', { name: 'Firmar', exact: true });
    await tabUntil(page, firmar);
    await page.keyboard.press('Enter');
    const saved = page.getByRole('menuitem', { name: 'Firma guardada 1', exact: true });
    await expect(saved).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Crear firma…' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(saved).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(saved).toBeHidden();

    // Página 3 con el teclado: Intro en el visor coloca la firma pendiente a un tercio de lo visible.
    await page.getByTestId('viewer').focus();
    await goToPageByKeyboard(page, 3, 5);
    await expect(pageField(page)).toHaveValue('3');
    await page.getByTestId('viewer').focus();
    await page.keyboard.press('Enter');

    await expect(zoneOf(page, 3, SIGNATURE_KIND)).toHaveCount(1);
    await expect(zoneOf(page, 1, SIGNATURE_KIND)).toHaveCount(0);
  });

  test('Ctrl+S guarda la firma como Stamp con apariencia en el rectángulo esperado, validado por qpdf; al reabrir sigue visible y es de solo lectura', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await createDrawnSignature(page);
    await placeWithClick(page, 1, PLACE_AT);
    await expect(zoneOf(page, 1, SIGNATURE_KIND)).toHaveCount(1);
    const pageBox = await boxOf(pageFrame(page, 1));
    const placed = await boxOf(zoneOf(page, 1, SIGNATURE_KIND));

    const saved = await saveWithCtrlS(page, testInfo, 'basic-5-firmado.pdf');
    expect(qpdfCheck(saved).code).toBe(0);

    const stamps = qpdfAnnotations(saved).filter((a) => a.subtype === 'Stamp');
    expect(stamps).toHaveLength(1);
    const objects = qpdfObjects(saved);
    const dict = objects[`obj:${stamps[0]?.ref ?? ''}`]?.value as { readonly '/Rect'?: unknown } | undefined;
    const rect = dict?.['/Rect'];
    const coords = Array.isArray(rect) ? rect.map((v) => Number(v)) : [];
    expect(coords).toHaveLength(4);
    const [x1 = NaN, y1 = NaN, x2 = NaN, y2 = NaN] = coords;
    expect(Math.abs(x2 - x1 - SIGNATURE_WIDTH_PT)).toBeLessThanOrEqual(1);

    // Lectura con pdf.js en Node: la anotación es un Stamp con apariencia y su rectángulo está donde se hizo clic.
    const loaded = await loadPdf(memorySource(readFileSync(saved)), { assetBaseUrl: nodeAssetBase() });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const page1 = await loaded.value.doc.getPage(1);
      const viewport = page1.getViewport({ scale: 1 });
      const anns = await page1.getAnnotations();
      const stamp = anns.find((a: { subtype: string }) => a.subtype === 'Stamp') as
        | { readonly hasAppearance: boolean; readonly rect: readonly number[] }
        | undefined;
      expect(stamp?.hasAppearance).toBe(true);
      const [sx1 = NaN, sy1 = NaN, sx2 = NaN, sy2 = NaN] = stamp?.rect ?? [];
      // Un píxel de la ventana equivale a viewport.width / pageBox.width puntos; el clic cae en PLACE_AT.
      const scale = pageBox.width / viewport.width;
      const cx = PLACE_AT.x / scale;
      const cy = viewport.height - PLACE_AT.y / scale;
      expect(Math.abs((sx1 + sx2) / 2 - cx)).toBeLessThanOrEqual(1);
      expect(Math.abs((sy1 + sy2) / 2 - cy)).toBeLessThanOrEqual(1);
      expect(Math.abs(sx2 - sx1 - SIGNATURE_WIDTH_PT)).toBeLessThanOrEqual(1);
      expect(Math.abs(sy2 - sy1 - (y2 - y1))).toBeLessThanOrEqual(1);
    } finally {
      await loaded.value.destroy();
    }

    // Al reabrir, la firma es una anotación ajena: la pinta pdf.js (tinta negra en su sitio) y no es editable.
    const reopened = await openInNewPage(page, saved);
    const reopenedAt = samePlaceIn(await boxOf(pageFrame(reopened, 1)), placed, pageBox);
    await expect.poll(() => darkShare(reopened, reopenedAt)).toBeGreaterThan(0.01);
    await expect(zoneOf(reopened, 1, SIGNATURE_KIND)).toHaveCount(0);
    await openCommentsPanel(reopened);
    const row = commentRows(reopened).filter({ hasText: SIGNATURE_KIND });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(msg.commentReadOnly);
  });

  test('firma con imagen PNG con transparencia: tras guardar y reabrir, la zona transparente deja ver el papel', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');

    // PNG de 40 × 20: mitad superior roja y mitad inferior transparente, generado con canvas de la página.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 20;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('sin contexto 2D');
      ctx.fillStyle = 'rgb(200, 30, 30)';
      ctx.fillRect(0, 0, 40, 10);
      return canvas.toDataURL('image/png');
    });
    const file = testInfo.outputPath('firma-transparente.png');
    writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));

    await page.getByRole('button', { name: 'Firmar', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Crear firma…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Crear firma' });
    await dialog.getByRole('tab', { name: signatureMsg.tabImage, exact: true }).click();
    await dialog.locator('input[type="file"]').setInputFiles(file);
    await expect(dialog.getByText(signatureMsg.imageSelected)).toBeVisible();
    await dialog.getByRole('button', { name: 'Aceptar', exact: true }).click();
    await expect(dialog).toBeHidden();

    await placeWithClick(page, 1, PLACE_AT);
    await expect(zoneOf(page, 1, SIGNATURE_KIND)).toHaveCount(1);
    const pageBox = await boxOf(pageFrame(page, 1));
    const placed = await boxOf(zoneOf(page, 1, SIGNATURE_KIND));

    const saved = await saveWithCtrlS(page, testInfo, 'firma-png.pdf');
    expect(qpdfCheck(saved).code).toBe(0);
    const reopened = await openInNewPage(page, saved);
    const at = samePlaceIn(await boxOf(pageFrame(reopened, 1)), placed, pageBox);
    const paper = await boxOf(pageFrame(reopened, 1));

    // La mitad superior es roja (la firma se ve); en la inferior, transparente, sale el blanco del papel (±5).
    const top = await pixelAt(reopened, at.x + at.width / 2, at.y + at.height * 0.25);
    expect(top[0] ?? 0).toBeGreaterThan((top[1] ?? 0) + 60);
    const bottom = await pixelAt(reopened, at.x + at.width / 2, at.y + at.height * 0.75);
    const reference = await pixelAt(reopened, paper.x + paper.width - 20, paper.y + 20);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs((bottom[c] ?? 0) - (reference[c] ?? 0))).toBeLessThanOrEqual(5);
    }
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
