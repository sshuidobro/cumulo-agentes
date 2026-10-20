import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './perf-fixture.ts';
import { compareMsg } from '../../src/ui/messages-compare.ts';
import { propertiesMsg } from '../../src/ui/messages-properties.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks, openFixture } from './helpers.ts';

/*
 * Comparar con otro PDF (PDF-112). El selector de la plataforma web se fuerza a su variante de `<input type="file">`
 * (sin File System Access), así el segundo PDF se elige con un selector de ficheros real de Playwright.
 */

const DIALOG = { name: /^Comparar «/ };

/** Quita el selector de File System Access antes de cargar la app: la plataforma usa el `<input>`. */
async function useInputPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
  });
}

/** Desde «Más acciones», elige `name` como segundo PDF. */
async function compareWith(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: propertiesMsg.moreActions, exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: compareMsg.menuItem, exact: true }).click();
  await (await chooser).setFiles(fixture(name));
}

test.describe('Comparar con otro PDF (PDF-112)', () => {
  test.beforeEach(async ({ page }) => {
    await useInputPicker(page);
  });

  test('basic-5 contra basic-5-changed: «1 cambio en 1 página» y la fila de la página 2', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5-changed.pdf');

    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1 cambio en 1 página', { exact: true })).toBeVisible();
    const rows = dialog.getByRole('option');
    await expect(rows).toHaveCount(1);
    await expect(rows).toHaveText('Página 2 · Se ha cambiado “página” por “hoja”.');

    const violations = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const serious = violations.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test('basic-5 consigo mismo: «No hay diferencias de texto entre los dos documentos.»', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5.pdf');

    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog.getByText(compareMsg.noChanges, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(0);
  });

  test('con el teclado: flechas y Intro en la lista; Escape cierra y devuelve el foco al visor', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5-changed.pdf');

    const list = page.getByRole('listbox', { name: compareMsg.listLabel });
    await expect(list).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: /Página 2/ })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', DIALOG)).toBeHidden();
    await expect(page.getByTestId('viewer')).toBeFocused();
  });

  test('@perf pages-5000 contra sí mismo: progreso, Cancelar en < 500 ms y sin long tasks > 100 ms', { tag: '@perf' }, async ({ page }) => {
    await installPerfProbes(page);
    await openFixture(page, 'pages-5000.pdf');
    await clearLongTasks(page);
    await compareWith(page, 'pages-5000.pdf');

    const dialog = page.getByRole('dialog', DIALOG);
    await expect(dialog.getByText(/^Comparando página/)).toBeVisible();

    const started = Date.now();
    await dialog.getByRole('button', { name: compareMsg.cancel, exact: true }).click();
    await expect(dialog.getByText(/^Comparación cancelada/)).toBeVisible();
    expect(Date.now() - started, 'Cancelar detiene la comparación en menos de 500 ms').toBeLessThan(500);

    const slowest = Math.max(0, ...(await longTasks(page)));
    expect(slowest, 'ninguna long task > 100 ms durante la comparación').toBeLessThan(100);
  });
});

/** Texto de la palabra de la capa de texto que cae en el centro del resaltado (por coordenadas, no por DOM). */
async function wordUnder(mark: Locator, region: Locator): Promise<string> {
  const box = await mark.boundingBox();
  if (box === null) throw new Error('resaltado sin caja');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Un ítem de pdf.js puede contener varias palabras: cada una se mide con su propio Range.
  const words = await region.locator('.textLayer span').evaluateAll((spans, p) => {
    const hits: string[] = [];
    for (const el of spans) {
      const node = el.firstChild;
      if (node === null || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? '';
      for (const m of text.matchAll(/\S+/g)) {
        const start = m.index ?? 0;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + m[0].length);
        const under = Array.from(range.getClientRects()).some(
          (r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom,
        );
        if (under) hits.push(m[0]);
      }
    }
    return hits;
  }, point);
  return words[0] ?? '';
}

/** Páginas ya comparadas, según el texto «Comparando página N de M…» (0 si ya no se muestra). */
async function pagesDone(dialog: Locator): Promise<number> {
  const text = (await dialog.getByText(/^Comparando página/).textContent()) ?? '';
  const match = /página (\d+) de/.exec(text);
  return match?.[1] === undefined ? 0 : Number(match[1]) - 1;
}

test.describe('Páginas del cambio (PDF-117)', () => {
  test.beforeEach(async ({ page }) => {
    await useInputPicker(page);
  });

  test('basic-5 contra basic-5-changed: «página» resaltada a la izquierda y «hoja» a la derecha', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5-changed.pdf');
    const dialog = page.getByRole('dialog', DIALOG);
    await page.getByRole('button', { name: compareMsg.nextChange, exact: true }).click();

    const left = dialog.getByRole('region', { name: compareMsg.openDocument, exact: true });
    const right = dialog.getByRole('region', { name: 'basic-5-changed.pdf', exact: true });
    const leftMarks = left.locator('[data-change="removed"], [data-change="replaced"]');
    const rightMarks = right.locator('[data-change="added"], [data-change="replaced"]');
    await expect(leftMarks).toHaveCount(1);
    await expect(rightMarks).toHaveCount(1);
    expect(await wordUnder(leftMarks, left)).toBe('página');
    expect(await wordUnder(rightMarks, right)).toBe('hoja');
  });

  test('superposición: lo igual sale negro y la palabra cambiada tiene color', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await compareWith(page, 'basic-5-changed.pdf');
    const dialog = page.getByRole('dialog', DIALOG);
    await page.getByRole('button', { name: compareMsg.nextChange, exact: true }).click();

    const left = dialog.getByRole('region', { name: compareMsg.openDocument, exact: true });
    const mark = left.locator('[data-change="replaced"]');
    await expect(mark).toHaveCount(1);
    const canvasBox = await left.locator('canvas').boundingBox();
    const markBox = await mark.boundingBox();
    if (canvasBox === null || markBox === null) throw new Error('sin cajas de la página o del resaltado');
    const fraction = {
      x: (markBox.x - canvasBox.x) / canvasBox.width,
      y: (markBox.y - canvasBox.y) / canvasBox.height,
      w: markBox.width / canvasBox.width,
      h: markBox.height / canvasBox.height,
    };

    await dialog.getByRole('button', { name: compareMsg.overlay, exact: true }).click();
    const canvas = dialog.getByTestId('compare-pages').locator('canvas');
    await expect(canvas).toHaveCount(1);
    const pixels = await canvas.evaluate((el, f) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (ctx === null) throw new Error('lienzo sin contexto 2d');
      const corner = ctx.getImageData(2, 2, 1, 1).data;
      const x = Math.floor(f.x * c.width);
      const y = Math.floor(f.y * c.height);
      const w = Math.max(1, Math.ceil(f.w * c.width));
      const h = Math.max(1, Math.ceil(f.h * c.height));
      const inside = ctx.getImageData(x, y, w, h).data;
      let colored = false;
      for (let i = 0; i < inside.length; i += 4) {
        if ((inside[i] ?? 0) >= 16 || (inside[i + 1] ?? 0) >= 16 || (inside[i + 2] ?? 0) >= 16) {
          colored = true;
          break;
        }
      }
      return { corner: Math.max(corner[0] ?? 0, corner[1] ?? 0, corner[2] ?? 0), colored };
    }, fraction);
    expect(pixels.corner, 'una zona sin texto es negra').toBeLessThan(16);
    expect(pixels.colored, 'la palabra cambiada tiene píxeles de color').toBe(true);
  });

  test('@perf pages-5000 contra pages-20000-flat: como mucho 3 lienzos y sin long tasks > 100 ms al pasar 20 cambios', { tag: '@perf' }, async ({ page }) => {
    await installPerfProbes(page);
    await openFixture(page, 'pages-5000.pdf');
    await clearLongTasks(page);
    await compareWith(page, 'pages-20000-flat.pdf');
    const dialog = page.getByRole('dialog', DIALOG);

    await expect.poll(() => pagesDone(dialog), { timeout: 120_000 }).toBeGreaterThanOrEqual(200);
    await dialog.getByRole('button', { name: compareMsg.cancel, exact: true }).click();
    await expect(dialog.getByText(/^Comparación cancelada/)).toBeVisible();

    const next = page.getByRole('button', { name: compareMsg.nextChange, exact: true });
    const pages = dialog.getByTestId('compare-pages');
    let maxCanvases = 0;
    for (let i = 0; i < 20; i += 1) {
      await next.click();
      maxCanvases = Math.max(maxCanvases, await pages.locator('canvas').count());
    }
    expect(maxCanvases, 'como mucho 3 lienzos vivos en la vista').toBeLessThanOrEqual(3);

    const slowest = Math.max(0, ...(await longTasks(page)));
    expect(slowest, 'ninguna long task > 100 ms al cambiar de cambio').toBeLessThan(100);
  });
});
