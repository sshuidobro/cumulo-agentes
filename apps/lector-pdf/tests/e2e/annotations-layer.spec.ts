import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildDocument } from '../fixtures/document.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { textPage } from '../fixtures/pdf-builder.ts';
import { settleFrames } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Tamaño de la página 1 de annotated.pdf (US Letter). */
const PAGE_W = 612;
const PAGE_H = 792;
/** Resaltados de la página 1 del documento generado para el test de rendimiento. */
const MANY_HIGHLIGHTS = 500;
/** Centro del resaltado de la página 1 (72–300 × 700–720 pt). */
const HIGHLIGHT_CENTER = { x: 186, y: 710 };
/** La nota de texto (400–420 × 700–720 pt) está en la página 2 de annotated.pdf. */
const NOTE_PAGE = 1;
const NOTE_RECT = { x1: 400, y1: 700 } as const;

async function openAnnotated(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'annotated.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

function pageFrame(page: Page, index: number) {
  return page.locator(`[data-testid=viewer] [data-page-index="${index}"]`);
}

/** Zona activa de la anotación del tipo indicado en una página (nombre accesible que empieza por el tipo). */
function zoneOf(page: Page, index: number, kind: string) {
  return pageFrame(page, index).locator(`[role="button"][aria-label^="${kind}"]`);
}

/**
 * Color RGB del píxel del lienzo de la página 1 en un punto de la ventana (coordenadas CSS), o `null` si
 * todavía no hay lienzo visible (se pinta de nuevo tras cada cambio). Al cambiar de lienzo puede haber dos:
 * se usa el último que tiene tamaño en pantalla. Nunca lanza: dentro de `expect.poll` una excepción no se reintenta.
 */
async function pixelAt(page: Page, x: number, y: number): Promise<readonly [number, number, number] | null> {
  const point: [number, number] = [x, y];
  return pageFrame(page, 0)
    .locator('canvas')
    .evaluateAll((canvases: HTMLCanvasElement[], at: [number, number]): [number, number, number] | null => {
      const canvas = canvases.filter((c) => c.getBoundingClientRect().width > 0).at(-1);
      if (canvas === undefined) return null;
      const box = canvas.getBoundingClientRect();
      const px = Math.floor(((at[0] - box.left) * canvas.width) / box.width);
      const py = Math.floor(((at[1] - box.top) * canvas.height) / box.height);
      const ctx = canvas.getContext('2d');
      if (ctx === null) return null;
      const [r = 0, g = 0, b = 0] = ctx.getImageData(px, py, 1, 1).data;
      return [r, g, b];
    }, point);
}

/** Amarillo de resaltado sobre papel blanco (multiply): rojo y verde altos, azul bajo. `null` si no hay píxel aún. */
function isYellow(pixel: readonly [number, number, number] | null): boolean | null {
  if (pixel === null) return null;
  const [r, g, b] = pixel;
  return r >= 230 && g >= 200 && b <= 140;
}

/** Punto en coordenadas de ventana de una posición en puntos de una página sin rotar. */
async function pdfPointToWindow(page: Page, index: number, xPt: number, yPt: number): Promise<{ x: number; y: number }> {
  const box = await pageFrame(page, index).boundingBox();
  if (box === null) throw new Error('la página 1 no está montada');
  const scale = box.width / PAGE_W;
  return { x: box.x + xPt * scale, y: box.y + (PAGE_H - yPt) * scale };
}

test('borrar el resaltado con Supr quita su color del lienzo; Ctrl+Z lo devuelve', async ({ page }) => {
  await openAnnotated(page);
  const center = await pdfPointToWindow(page, 0, HIGHLIGHT_CENTER.x, HIGHLIGHT_CENTER.y);
  await expect.poll(async () => isYellow(await pixelAt(page, center.x, center.y))).toBe(true);

  const zone = zoneOf(page, 0, 'Resaltado');
  await zone.click();
  await expect(zone.locator('rect')).toHaveCSS('display', 'inline');
  await zone.focus();
  await page.keyboard.press('Delete');

  await expect(zone).toHaveCount(0);
  await expect.poll(async () => isYellow(await pixelAt(page, center.x, center.y))).toBe(false);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => isYellow(await pixelAt(page, center.x, center.y))).toBe(true);
});

test('arrastrar una nota con el ratón 50 px la mueve 50 px / escala en puntos', async ({ page }) => {
  await openAnnotated(page);
  const zone = zoneOf(page, NOTE_PAGE, 'Nota');
  await expect(zone).toHaveCount(1);
  // La página 2 está debajo del primer pliegue: se lleva al visor antes de medirla.
  await zone.scrollIntoViewIfNeeded();
  const box = await pageFrame(page, NOTE_PAGE).boundingBox();
  if (box === null) throw new Error('la página 2 no está montada');
  const scale = box.width / PAGE_W;

  const start = await pdfPointToWindow(page, NOTE_PAGE, NOTE_RECT.x1 + 10, NOTE_RECT.y1 + 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y, { steps: 3 });
  await page.mouse.move(start.x + 50, start.y, { steps: 5 });
  await page.mouse.up();

  const x = await zone.locator('rect').first().getAttribute('x');
  expect(Number(x)).toBeCloseTo(NOTE_RECT.x1 + 50 / scale, 0);
});

test('con zoom 200 % y rotación 90°, la zona del resaltado coincide con su píxel amarillo', async ({ page }) => {
  await openAnnotated(page);
  await page.getByRole('textbox', { name: 'Zoom' }).fill('200');
  await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
  await page.getByRole('button', { name: 'Girar a la derecha' }).click();

  const zone = zoneOf(page, 0, 'Resaltado');
  const box = await zone.boundingBox();
  if (box === null) throw new Error('sin zona activa para el resaltado');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await expect.poll(async () => isYellow(await pixelAt(page, cx, cy))).toBe(true);

  await zone.click();
  await expect(zone.locator('rect')).toHaveCSS('display', 'inline');
});

/**
 * PDF de 3 páginas; la página 1 lleva 500 resaltados (sin apariencia, escritos por otro programa).
 * Se genera en el test para no versionar un fichero grande.
 */
function manyHighlights(): Uint8Array {
  return buildDocument(3, (page) => ({ content: textPage([`Página ${page} de 3`]) }), {
    setup: ({ b }) => {
      const refs = Array.from({ length: MANY_HIGHLIGHTS }, (_, i) => {
        const x = 72 + (i % 10) * 50;
        const y = 740 - Math.floor(i / 10) * 14;
        return b.addObject(
          `<< /Type /Annot /Subtype /Highlight /Rect [${x} ${y} ${x + 40} ${y + 12}] ` +
            `/QuadPoints [${x} ${y + 12} ${x + 40} ${y + 12} ${x} ${y} ${x + 40} ${y}] ` +
            `/C [1 1 0] /T (Otra persona) /Contents (Resaltado ${i}) >>`,
        );
      });
      return { pageAnnots: new Map([[1, `/Annots [${refs.map((r) => `${r} 0 R`).join(' ')}]`]]) };
    },
  });
}

test('una página con 500 anotaciones se desplaza sin tareas largas de más de 100 ms', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const longTasks: { start: number; duration: number }[] = [];
    (window as unknown as { __longTasks: typeof longTasks }).__longTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles({
    name: 'quinientas-anotaciones.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(manyHighlights()),
  });
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await expect(zoneOf(page, 0, 'Resaltado')).toHaveCount(MANY_HIGHLIGHTS);

  // Solo cuentan las tareas que empiezan durante el desplazamiento: la carga inicial no es el criterio.
  const since = await page.evaluate(() => performance.now());
  await page.getByTestId('viewer').hover();
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 100);
  }
  await settleFrames(page);

  const longest = await page.evaluate((from: number) => {
    const tasks = (window as unknown as { __longTasks: { start: number; duration: number }[] }).__longTasks;
    return tasks.filter((t) => t.start >= from).reduce((max, t) => Math.max(max, t.duration), 0);
  }, since);
  testInfo.annotations.push({ type: 'rendimiento', description: `Tarea larga máxima al desplazar: ${Math.round(longest)} ms` });
  expect(longest).toBeLessThanOrEqual(100);
});
