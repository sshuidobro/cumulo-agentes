/**
 * Utilidades compartidas por las pruebas E2E de anotaciones (PDF-039): barra «Comentar», dibujo de trazos,
 * guardado por descarga, reapertura del fichero guardado y panel de comentarios.
 * Las consultas son por rol y nombre accesible; nunca por clases CSS.
 */
import { join } from 'node:path';
import { expect, type Download, type Locator, type Page, type TestInfo } from '@playwright/test';
import { fixture, pageFrame, waitPageRendered } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Autor por defecto de las anotaciones creadas en la app. */
export const AUTHOR = 'Usuario';

/** Caja en coordenadas de ventana (CSS px). */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Punto en coordenadas de ventana (CSS px). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Quita `showSaveFilePicker` antes de cargar la app: «Guardar» descarga una copia (y el test la espera como
 * descarga). Debe llamarse antes de `goto`.
 */
export async function disableFileSystemAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
}

/** Abre un PDF del disco con «Guardar» como descarga y espera a que el visor pueda recibir teclas. */
export async function openWithDownloads(page: Page, path: string): Promise<void> {
  await disableFileSystemAccess(page);
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
}

/** Abre un fixture generado (`fixtures/pdf/generated/`) con «Guardar» como descarga. */
export function openFixtureWithDownloads(page: Page, name: string): Promise<void> {
  return openWithDownloads(page, fixture(name));
}

/**
 * Abre un fichero del disco en una pestaña nueva del mismo contexto y devuelve esa pestaña.
 * `init` (opcional) se inyecta antes de cargar la app (p. ej. un stub de `window.open`).
 */
export async function openInNewPage(page: Page, path: string, init?: () => void): Promise<Page> {
  const fresh = await page.context().newPage();
  await disableFileSystemAccess(fresh);
  if (init !== undefined) await fresh.addInitScript(init);
  await fresh.goto('/');
  await fresh.locator('[data-testid=open-input]').setInputFiles(path);
  await expect(fresh.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(fresh);
  await waitPageRendered(fresh, 1);
  return fresh;
}

/**
 * Pulsa Ctrl+S, espera la descarga y la guarda en la carpeta de salida del test.
 * Devuelve la ruta del fichero descargado.
 */
export async function saveWithCtrlS(page: Page, testInfo: TestInfo, outName: string): Promise<string> {
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  return storeDownload(await download, testInfo, outName);
}

/** Guarda una descarga en la carpeta de salida del test y devuelve su ruta. */
export async function storeDownload(download: Download, testInfo: TestInfo, outName: string): Promise<string> {
  const path = join(testInfo.outputPath(), outName);
  await download.saveAs(path);
  return path;
}

/** Barra «Comentar» abierta (la abre con su conmutador si está cerrada). */
export async function openCommentBar(page: Page): Promise<Locator> {
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  if ((await bar.count()) === 0) {
    await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  }
  await expect(bar).toBeVisible();
  return bar;
}

/** Activa una herramienta de la barra «Comentar» (sin cambiarla si ya está activa). */
export async function pickTool(page: Page, name: string): Promise<void> {
  const bar = await openCommentBar(page);
  const tool = bar.getByRole('button', { name, exact: true });
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
}

/** Zona activa de un tipo de anotación en la página `n` (1-based); el nombre accesible empieza por el tipo. */
export function zoneOf(page: Page, n: number, kind: string): Locator {
  return pageFrame(page, n).locator(`[role="button"][aria-label^="${kind}"]`);
}

/** Lista de comentarios del panel lateral (solo las filas de la lista). */
export function commentRows(page: Page): Locator {
  return page.getByRole('listbox', { name: 'Comentarios del documento' }).getByRole('option');
}

/** Abre el panel lateral (F4 si hace falta) en la pestaña «Comentarios». */
export async function openCommentsPanel(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Comentarios' });
  if (!(await tab.isVisible())) await page.keyboard.press('F4');
  await tab.click();
  await expect(page.getByRole('listbox', { name: 'Comentarios del documento' })).toBeVisible();
}

/** Ventana de comentario de un autor (diálogo no modal). */
export function commentDialog(page: Page, author: string = AUTHOR): Locator {
  return page.getByRole('dialog', { name: `Comentario de ${author}` });
}

/** Campo de texto de la ventana de comentario abierta. */
export function commentField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Comentario', exact: true });
}

/** Caja de la palabra `word` en la capa de texto de la página `n` (1-based), o falla si no está. */
export async function wordBox(page: Page, n: number, word: string): Promise<Box> {
  const box = await page.evaluate(
    ({ index, text }) => {
      const layer = document.querySelector(`[data-testid=viewer] [data-page-index="${String(index)}"] .textLayer`);
      if (layer === null) return null;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = (node.textContent ?? '').indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return null;
    },
    { index: n - 1, text: word },
  );
  if (box === null) throw new Error(`no encuentro «${word}» en la página ${String(n)}`);
  return box;
}

/** Cajas de los fragmentos de texto de la página `n` (1-based), agrupadas por línea y ordenadas de arriba abajo. */
export async function textLines(page: Page, n: number): Promise<Box[][]> {
  return page.evaluate((index) => {
    const spans = Array.from(
      document.querySelectorAll(`[data-testid=viewer] [data-page-index="${String(index)}"] .textLayer span`),
    ).filter((s) => (s.textContent ?? '').trim() !== '');
    const lines: { top: number; boxes: { x: number; y: number; width: number; height: number }[] }[] = [];
    for (const span of spans) {
      const r = span.getBoundingClientRect();
      const box = { x: r.x, y: r.y, width: r.width, height: r.height };
      const line = lines.find((l) => Math.abs(l.top - box.y) < box.height / 2);
      if (line === undefined) lines.push({ top: box.y, boxes: [box] });
      else line.boxes.push(box);
    }
    lines.sort((a, b) => a.top - b.top);
    return lines.map((l) => l.boxes);
  }, n - 1);
}

/** Arrastra con el ratón sobre la línea `line` (0-based) de la página 1 de punta a punta del texto. */
export async function dragOverLine(page: Page, line: number): Promise<void> {
  const boxes = (await textLines(page, 1))[line];
  if (boxes === undefined) throw new Error(`la página 1 no tiene la línea ${String(line + 1)}`);
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const height = Math.max(...boxes.map((b) => b.height));
  const middle = top + height / 2;
  // El arrastre empieza dentro del primer carácter: un clic en el hueco a la izquierda no inicia selección.
  await page.mouse.move(left + 1, middle);
  await page.mouse.down();
  await page.mouse.move(right + 3, middle, { steps: 8 });
  await page.mouse.up();
}

/** Parte de la página `n` que cae dentro del visor (la página puede ser más grande que la ventana). */
export async function visiblePart(page: Page, n: number): Promise<Box> {
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
export async function drawStroke(page: Page, points: readonly Point[]): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) throw new Error('trazo vacío');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) {
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.up();
}

/** Zigzag de cinco segmentos de `step` px desde `origin`. */
export function zigzagFrom(origin: Point, step: number): Point[] {
  return [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
    [5, 1],
  ].map(([dx = 0, dy = 0]): Point => ({ x: origin.x + dx * step, y: origin.y + dy * step }));
}

/** Crea una nota en la página 1 con un clic en (150, 150) px de la página y escribe `text` en su ventana. */
export async function createNoteWithText(page: Page, text: string): Promise<void> {
  await pickTool(page, 'Nota');
  await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
  await expect(commentDialog(page)).toBeVisible();
  await expect(commentField(page)).toBeFocused();
  await page.keyboard.type(text);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(commentDialog(page)).toHaveCount(0);
}
