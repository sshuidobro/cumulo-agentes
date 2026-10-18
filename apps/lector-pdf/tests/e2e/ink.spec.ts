import { type Page } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { clearLongTasks, installPerfProbes, longTasks, openFixture, pageFrame, waitPageRendered } from './helpers.ts';

/** Rectángulo en coordenadas de ventana (CSS px). */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Punto en coordenadas de ventana (CSS px). */
interface Point {
  readonly x: number;
  readonly y: number;
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

/** Recorre los puntos con el ratón: bajada en el primero, movimientos intermedios y subida en el último. */
async function drawStroke(page: Page, points: readonly Point[]): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) throw new Error('trazo vacío');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) {
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.up();
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

/** Zigzag de cinco segmentos de `step` px desde `origin` (dentro de la página visible). */
function zigzagFrom(origin: Point, step: number): Point[] {
  return [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
    [5, 1],
  ].map(([dx = 0, dy = 0]): Point => ({ x: origin.x + dx * step, y: origin.y + dy * step }));
}

test('un zigzag de 5 segmentos deja píxeles rojos a lo largo del trazo; Ctrl+Z los quita', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await waitPageRendered(page, 1);
  await pickInkTool(page);

  const part = await visiblePart(page, 1);
  const origin = { x: part.x + part.width * 0.25, y: part.y + part.height * 0.3 };
  const points = zigzagFrom(origin, 60);
  const area: Box = { x: origin.x - 10, y: origin.y - 10, width: 60 * 5 + 20, height: 60 + 20 };

  const before = await redPixels(page, area);
  await drawStroke(page, points);
  const drawn = await redPixels(page, area);
  expect(drawn - before, 'píxeles rojos añadidos por el trazo').toBeGreaterThan(40);

  await page.keyboard.press('Control+z');
  await expect.poll(() => redPixels(page, area)).toBeLessThanOrEqual(before + 2);
});

for (const zoom of ['50', '300']) {
  test(`con zoom ${zoom} % el trazo aparece bajo el puntero (punto medio, tolerancia 3 px)`, async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await setZoom(page, zoom);
    await waitPageRendered(page, 1);
    await pickInkTool(page);

    const part = await visiblePart(page, 1);
    const start = { x: part.x + part.width * 0.2, y: part.y + part.height * 0.4 };
    const end = { x: start.x + 120, y: start.y };
    const middle = { x: start.x + 60, y: start.y };
    await drawStroke(page, [start, end]);

    const near = await redPixels(page, { x: middle.x - 3, y: middle.y - 3, width: 7, height: 7 });
    expect(near, `píxeles rojos a 3 px de (${String(middle.x)}, ${String(middle.y)})`).toBeGreaterThan(0);
  });
}

test('dibujar un trazo de 2 000 eventos no produce long tasks', { tag: '@perf' }, async ({ page }) => {
  await installPerfProbes(page);
  await openFixture(page, 'basic-5.pdf');
  await waitPageRendered(page, 1);
  await pickInkTool(page);

  const part = await visiblePart(page, 1);
  const from = { x: part.x + part.width * 0.1, y: part.y + part.height * 0.2 };
  const to = { x: part.x + part.width * 0.9, y: part.y + part.height * 0.8 };
  await clearLongTasks(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 2000 });
  await page.mouse.up();

  // Que el trazo exista: sin él, la ausencia de long tasks no probaría nada.
  await expect(pageFrame(page, 1).locator('[role="button"][aria-label^="Dibujo"]')).toHaveCount(1);
  expect(await longTasks(page)).toEqual([]);
});
