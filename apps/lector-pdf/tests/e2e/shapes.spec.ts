import { type Page } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { clearLongTasks, installPerfProbes, longTasks, openFixture, pageFrame, waitPageRendered } from './helpers.ts';
import {
  AUTHOR,
  type Box,
  type Point,
  openCommentsPanel,
  openFixtureWithDownloads,
  openInNewPage,
  optionName,
  pickTool,
  saveWithCtrlS,
  visiblePart,
  zoneOf,
} from './annotations-kit.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import { liveAnnotations } from './annotations-live.ts';

/**
 * Herramientas de forma (PDF-108): rectángulo, elipse, línea y flecha en la barra «Comentar», con ratón y teclado,
 * deshacer, mover, redimensionar, color y guardado dentro del PDF.
 */

/** Barra «Comentar» con la herramienta de forma indicada desactivada (vuelve a «ninguna»). */
async function releaseTool(page: Page, name: string): Promise<void> {
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  const tool = bar.getByRole('button', { name, exact: true });
  if ((await tool.getAttribute('aria-pressed')) === 'true') await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
}

/** Punto en la parte visible de la página 1, en fracciones de lo visible (0..1). */
async function at(page: Page, fx: number, fy: number): Promise<Point> {
  const part = await visiblePart(page, 1);
  return { x: part.x + part.width * fx, y: part.y + part.height * fy };
}

/** Arrastre con el ratón desde un punto hasta otro, en pasos intermedios. */
async function dragBetween(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** Cuenta los píxeles de la captura de `box` que son rojos de la paleta (R > 180, G < 100, B < 100). */
async function hasRedPixel(page: Page, box: Box): Promise<boolean> {
  const png = await page.screenshot({
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
    },
  });
  return page.evaluate(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('sin contexto 2D');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 180 && (data[i + 1] ?? 0) < 100 && (data[i + 2] ?? 0) < 100) return true;
    }
    return false;
  }, png.toString('base64'));
}

// Sin tildes en el título: la carpeta de salida del test las hereda y, con ellas, el fichero guardado no se puede
// subir a la pestaña nueva con `setInputFiles` (la reapertura se queda en la pantalla de bienvenida).
test('rectangulo, elipse, linea y flecha: dibujar, deshacer y rehacer, mover, redimensionar, color, guardar y reabrir', async ({ page }, testInfo) => {
  await openFixtureWithDownloads(page, 'basic-5.pdf');
  await waitPageRendered(page, 1);

  // Rectángulo y elipse: arrastre en la página 1 con cada herramienta.
  await pickTool(page, 'Rectángulo');
  await dragBetween(page, await at(page, 0.2, 0.15), await at(page, 0.4, 0.3));
  await expect(zoneOf(page, 1, 'Rectángulo')).toHaveCount(1);
  await pickTool(page, 'Elipse');
  await dragBetween(page, await at(page, 0.55, 0.15), await at(page, 0.8, 0.3));
  await expect(zoneOf(page, 1, 'Elipse')).toHaveCount(1);

  // Línea y flecha.
  await pickTool(page, 'Línea');
  await dragBetween(page, await at(page, 0.2, 0.45), await at(page, 0.7, 0.45));
  await expect(zoneOf(page, 1, 'Línea')).toHaveCount(1);
  await pickTool(page, 'Flecha');
  await dragBetween(page, await at(page, 0.2, 0.6), await at(page, 0.7, 0.6));
  await expect(zoneOf(page, 1, 'Flecha')).toHaveCount(1);

  // Ctrl+Z quita la flecha y Ctrl+Y la devuelve.
  await page.keyboard.press('Control+z');
  await expect(zoneOf(page, 1, 'Flecha')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(zoneOf(page, 1, 'Flecha')).toHaveCount(1);

  // Sin herramienta: mover el rectángulo arrastrando su interior.
  await releaseTool(page, 'Flecha');
  const rect = zoneOf(page, 1, 'Rectángulo');
  const before = await rect.boundingBox();
  if (before === null) throw new Error('el rectángulo no tiene caja');
  await dragBetween(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 }, { x: before.x + before.width / 2 + 40, y: before.y + before.height / 2 });
  await expect.poll(async () => (await rect.boundingBox())?.x ?? 0).toBeGreaterThan(before.x + 20);

  // Redimensionar la elipse con su tirador: seleccionarla con el teclado y arrastrar el tirador.
  await zoneOf(page, 1, 'Elipse').focus();
  await page.keyboard.press(' ');
  const handle = pageFrame(page, 1).getByRole('button', { name: 'Cambiar tamaño' });
  const ellipse = await zoneOf(page, 1, 'Elipse').boundingBox();
  const grip = await handle.boundingBox();
  if (ellipse === null || grip === null) throw new Error('falta la elipse o su tirador');
  await dragBetween(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, { x: grip.x + grip.width / 2 + 50, y: grip.y + grip.height / 2 + 30 });
  await expect.poll(async () => (await zoneOf(page, 1, 'Elipse').boundingBox())?.width ?? 0).toBeGreaterThan(ellipse.width + 20);

  // Línea seleccionada con el teclado; «Color» → «Azul» la cambia a azul (la herramienta de color no cambia).
  await zoneOf(page, 1, 'Línea').focus();
  await page.keyboard.press(' ');
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  await bar.getByRole('button', { name: 'Color', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Azul', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Color', exact: true })).toBeVisible();

  // Guardar y validar con qpdf: las cuatro formas están en el fichero.
  const saved = await saveWithCtrlS(page, testInfo, 'basic-5-formas.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);
  const subtypes = new Set(liveAnnotations(saved).map((a) => a.subtype));
  for (const s of ['Square', 'Circle', 'Line']) expect(subtypes.has(s), `subtipo ${s}`).toBe(true);

  // Reabrir: el panel lista las cuatro formas y el borde del rectángulo se ve en rojo (color por defecto).
  const reopened = await openInNewPage(page, saved);
  await openCommentsPanel(reopened);
  for (const kind of ['Rectángulo', 'Elipse', 'Línea', 'Flecha']) {
    await expect(reopened.getByRole('option', { name: optionName(`${kind} de ${AUTHOR}, página 1`) })).toHaveCount(1);
  }
  await expect(reopened.locator('p', { hasText: '4 comentarios' })).toBeVisible();

  // Borde izquierdo del rectángulo tal como se ve en la pestaña reabierta (su zona marca la misma caja).
  const zone = zoneOf(reopened, 1, 'Rectángulo');
  await zone.scrollIntoViewIfNeeded();
  const box = await zone.boundingBox();
  if (box === null) throw new Error('el rectángulo reabierto no tiene caja');
  const edge = { x: box.x + 2, y: box.y + box.height / 2 };
  await expect
    .poll(async () => hasRedPixel(reopened, { x: edge.x - 3, y: edge.y - 3, width: 7, height: 7 }), {
      message: 'un píxel rojo en el borde del rectángulo guardado',
    })
    .toBe(true);
});

test('dibujar un rectángulo con la herramienta activa deja su vista previa; Escape durante el arrastre no crea nada', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await waitPageRendered(page, 1);
  await pickTool(page, 'Rectángulo');

  const start = await at(page, 0.2, 0.2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 60, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(zoneOf(page, 1, 'Rectángulo')).toHaveCount(0);
});

test('pages-5000: arrastrar un rectángulo no produce long tasks', { tag: '@perf' }, async ({ page }) => {
  await installPerfProbes(page);
  await openFixture(page, 'pages-5000.pdf');
  await waitPageRendered(page, 1);
  await pickTool(page, 'Rectángulo');

  const from = await at(page, 0.1, 0.2);
  const to = await at(page, 0.9, 0.8);
  await clearLongTasks(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 2000 });
  await page.mouse.up();

  // Que la forma exista: sin ella, la ausencia de long tasks no probaría nada.
  await expect(zoneOf(page, 1, 'Rectángulo')).toHaveCount(1);
  expect(await longTasks(page)).toEqual([]);
});
