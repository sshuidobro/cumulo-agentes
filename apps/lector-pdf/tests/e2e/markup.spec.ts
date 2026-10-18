import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFixture, pageFrame, waitPageRendered } from './helpers.ts';

/** Caja de un elemento en coordenadas de ventana (CSS px). */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Caja de una palabra de la capa de texto de la página `n` (1-based), o falla si no está montada. */
async function wordBox(page: Page, n: number, word: string): Promise<Box> {
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

/**
 * Fracción de píxeles amarillos de la zona de la ventana. El resaltado nuevo lo dibuja la capa SVG encima del
 * lienzo, así que se mide en una captura de la pantalla, decodificada en el navegador.
 */
async function yellowShare(page: Page, box: Box): Promise<number> {
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
    let yellow = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total++;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r >= 230 && g >= 200 && b <= 140) yellow++;
    }
    return total === 0 ? 0 : yellow / total;
  }, png.toString('base64'));
}

/** Zonas de anotaciones de un tipo (nombre accesible que empieza así) en la página `n` (1-based). */
function zonesOf(page: Page, n: number, kind: string): Locator {
  return pageFrame(page, n).locator(`[role="button"][aria-label^="${kind}"]`);
}

/** Abre la barra «Comentar» con el conmutador de la barra principal. */
async function openCommentBar(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Comentar' }).click();
  return page.getByRole('toolbar', { name: 'Comentar' });
}

/** Cajas de los fragmentos de texto (`span`) de la página `n`, en coordenadas de ventana, agrupadas por línea. */
async function textLines(page: Page, n: number): Promise<Box[][]> {
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

test.describe('resaltar, subrayar y tachar', () => {
  test('doble clic en una palabra muestra la barra; «Resaltar» la marca en amarillo y Ctrl+Z la quita', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    const word = await wordBox(page, 1, 'murciélago');

    await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
    const bar = page.getByRole('toolbar', { name: 'Acciones de la selección' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Resaltar' }).click();

    const zone = zonesOf(page, 1, 'Resaltado de Usuario');
    await expect(zone).toHaveCount(1);
    await expect.poll(() => yellowShare(page, word)).toBeGreaterThan(0.3);

    await page.keyboard.press('Control+z');
    await expect(zone).toHaveCount(0);
    await expect.poll(() => yellowShare(page, word)).toBeLessThan(0.05);
  });

  test('con «Subrayar» activo, arrastrar sobre la línea 3 crea un subrayado que cubre la línea', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    const toolbar = await openCommentBar(page);
    await toolbar.getByRole('button', { name: 'Subrayar' }).click();

    const line = (await textLines(page, 1))[2];
    if (line === undefined) throw new Error('la página 1 no tiene tres líneas de texto');
    const left = Math.min(...line.map((b) => b.x));
    const right = Math.max(...line.map((b) => b.x + b.width));
    const top = Math.min(...line.map((b) => b.y));
    const height = Math.max(...line.map((b) => b.height));
    const middle = top + height / 2;

    // El arrastre empieza dentro del primer carácter: un clic en el hueco a la izquierda no inicia selección.
    await page.mouse.move(left + 1, middle);
    await page.mouse.down();
    await page.mouse.move(right + 3, middle, { steps: 8 });
    await page.mouse.up();

    const zone = zonesOf(page, 1, 'Subrayado de Usuario');
    await expect(zone).toHaveCount(1);
    // La zona agrupa la forma visible del subrayado: su caja ancha cubre la línea.
    const drawn = await zone.boundingBox();
    if (drawn === null) throw new Error('sin caja para el subrayado');
    expect(drawn.width).toBeGreaterThanOrEqual(0.8 * (right - left));
  });

  test('seleccionar desde la mitad de la página 1 hasta la mitad de la 2 y tachar crea una anotación por página', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await waitPageRendered(page, 2);
    await page.getByRole('textbox', { name: 'Zoom' }).fill('50');
    await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
    await waitPageRendered(page, 2);

    const first = (await textLines(page, 1)).flat();
    const second = (await textLines(page, 2)).flat();
    const from = first[Math.floor(first.length / 2)];
    const to = second[Math.floor(second.length / 2)];
    if (from === undefined || to === undefined) throw new Error('faltan fragmentos de texto en las páginas 1 o 2');

    const toolbar = await openCommentBar(page);
    await toolbar.getByRole('button', { name: 'Tachar' }).click();

    await page.mouse.move(from.x + 1, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(zonesOf(page, 1, 'Tachado de Usuario')).toHaveCount(1);
    await expect(zonesOf(page, 2, 'Tachado de Usuario')).toHaveCount(1);
  });

  test('con zoom 150 % y rotación de 90°, el resaltado cae sobre la palabra', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await page.getByRole('textbox', { name: 'Zoom' }).fill('150');
    await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
    await page.getByRole('button', { name: 'Girar a la derecha' }).click();
    await waitPageRendered(page, 1);

    const word = await wordBox(page, 1, 'murciélago');
    await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
    await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Resaltar' }).click();

    await expect(zonesOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
    await expect.poll(() => yellowShare(page, word)).toBeGreaterThan(0.3);
  });

  test('teclado: Ctrl+A y el botón «Resaltar» de la barra «Comentar» con Intro crean el resaltado', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    const toolbar = await openCommentBar(page);

    await page.keyboard.press('Control+a');
    const highlight = toolbar.getByRole('button', { name: 'Resaltar' });
    await highlight.focus();
    await page.keyboard.press('Enter');

    await expect(zonesOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
  });

  test('clic de ratón en «Resaltar» de «Comentar» con texto seleccionado marca la selección sin cambiar la herramienta', async ({
    page,
  }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    const toolbar = await openCommentBar(page);

    await page.keyboard.press('Control+a');
    await toolbar.getByRole('button', { name: 'Resaltar' }).click();

    await expect(zonesOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
    await expect(toolbar.getByRole('button', { name: 'Resaltar' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('selección de la mitad de la página 1 a la mitad de la 3 (la 2 entera) y «Tachar»: cada marcado cae sobre el texto de su página', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await page.getByRole('textbox', { name: 'Zoom' }).fill('50');
    await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
    for (const n of [1, 2, 3]) await waitPageRendered(page, n);

    const toolbar = await openCommentBar(page);
    await selectMiddleOfPagesRange(page, 1, 3);
    await toolbar.getByRole('button', { name: 'Tachar' }).click();

    for (const n of [1, 2, 3]) {
      const zone = zonesOf(page, n, 'Tachado de Usuario');
      await expect(zone).toHaveCount(1);
      const drawn = await zone.boundingBox();
      const text = await textBounds(page, n);
      if (drawn === null || text === null) throw new Error(`sin cajas en la página ${String(n)}`);
      // Ni la página entera ni nada fuera del texto: la caja del marcado cabe en la del texto (margen de 3 px).
      expect(drawn.x).toBeGreaterThanOrEqual(text.x - 3);
      expect(drawn.y).toBeGreaterThanOrEqual(text.y - 3);
      expect(drawn.x + drawn.width).toBeLessThanOrEqual(text.x + text.width + 3);
      expect(drawn.y + drawn.height).toBeLessThanOrEqual(text.y + text.height + 3);
    }
  });
});

/** Caja que envuelve todos los fragmentos de texto de la página `n` (1-based), o `null` si no hay. */
async function textBounds(page: Page, n: number): Promise<Box | null> {
  const boxes = (await textLines(page, n)).flat();
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Selección del DOM desde el fragmento central de la página `from` hasta el central de la página `to` (1-based),
 * con todo el texto intermedio. Se fija por código para no depender del desplazamiento del ratón entre páginas.
 */
async function selectMiddleOfPagesRange(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(
    ({ a, b }) => {
      const middleSpan = (index: number): Text => {
        const spans = Array.from(
          document.querySelectorAll(`[data-testid=viewer] [data-page-index="${String(index)}"] .textLayer span`),
        ).filter((s) => (s.textContent ?? '').trim() !== '');
        const span = spans[Math.floor(spans.length / 2)];
        const text = span?.firstChild;
        if (!(text instanceof Text)) throw new Error(`sin texto central en la página ${String(index + 1)}`);
        return text;
      };
      const start = middleSpan(a - 1);
      const end = middleSpan(b - 1);
      const selection = document.getSelection();
      if (selection === null) throw new Error('sin API de selección');
      selection.setBaseAndExtent(start, 0, end, end.length);
    },
    { a: from, b: to },
  );
}
