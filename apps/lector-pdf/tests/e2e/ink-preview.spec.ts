import { expect, test, type Page } from '@playwright/test';
import { openFixture, pageFrame, waitPageRendered } from './helpers.ts';

/** Rectángulo en coordenadas de ventana (CSS px). */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Activa «Dibujar» de la barra Comentar (la abre si está cerrada). */
async function pickInkTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Comentar' }).click();
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  await expect(bar).toBeVisible();
  const ink = bar.getByRole('button', { name: 'Dibujar', exact: true });
  await ink.click();
  await expect(ink).toHaveAttribute('aria-pressed', 'true');
}

/** Fija el zoom escribiendo en el campo de zoom de la barra. */
async function setZoom(page: Page, value: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Zoom' });
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveValue(`${value} %`);
}

/** Parte de la página `n` que cae dentro del visor (la página puede ser más grande que la ventana con zoom alto). */
async function visiblePart(page: Page, n: number): Promise<Box> {
  const frame = await pageFrame(page, n).boundingBox();
  const viewer = await page.getByTestId('viewer').boundingBox();
  if (frame === null || viewer === null) throw new Error('página o visor sin caja');
  const x = Math.max(frame.x, viewer.x);
  const y = Math.max(frame.y, viewer.y);
  const right = Math.min(frame.x + frame.width, viewer.x + viewer.width);
  const bottom = Math.min(frame.y + frame.height, viewer.y + viewer.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** Cuadro de píxeles rojos (trazo por defecto: rojo de la paleta) dentro de la captura de `clip`: número de píxeles. */
async function redPixels(page: Page, clip: Box): Promise<number> {
  const png = await page.screenshot({
    clip: {
      x: Math.max(0, clip.x),
      y: Math.max(0, clip.y),
      width: Math.max(1, clip.width),
      height: Math.max(1, clip.height),
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
    let red = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      // Rojo de la paleta (0.9, 0.22, 0.21) con antialias: dominante y claramente por encima de verde y azul.
      if (r >= 150 && r - Math.max(g, b) >= 60) red++;
    }
    return red;
  }, png.toString('base64'));
}

for (const zoom of ['50', '300']) {
  test(`con zoom ${zoom} % la vista previa se ve bajo el puntero antes de soltar`, async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await setZoom(page, zoom);
    await waitPageRendered(page, 1);
    await pickInkTool(page);

    const part = await visiblePart(page, 1);
    const start = { x: part.x + part.width * 0.2, y: part.y + part.height * 0.4 };
    const end = { x: start.x + 120, y: start.y };
    const middle = { x: start.x + 60, y: start.y };

    // Sin soltar el puntero: la vista previa del trazo debe verse ya bajo el puntero.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await expect
      .poll(() => redPixels(page, { x: middle.x - 3, y: middle.y - 3, width: 7, height: 7 }), {
        message: `píxeles rojos a 3 px de (${String(middle.x)}, ${String(middle.y)}) durante el trazo`,
      })
      .toBeGreaterThan(0);

    await page.mouse.up();
    await expect(pageFrame(page, 1).locator('[role="button"][aria-label^="Dibujo"]')).toHaveCount(1);
  });
}
