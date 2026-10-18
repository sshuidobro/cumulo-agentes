import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Luminancia relativa (WCAG) de un color `rgb(r, g, b)` de CSS. */
function luminance(css: string): number {
  const [r = 0, g = 0, b = 0] = (css.match(/\d+(\.\d+)?/g) ?? []).map((v) => Number(v) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

async function toolbarLuminance(page: Page): Promise<number> {
  const background = await page.getByRole('toolbar').evaluate((el) => getComputedStyle(el).backgroundColor);
  return luminance(background);
}

async function openAppearance(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('menuitemradio', { name: item }).click();
}

/** Lado del bloque de la imagen que se compara píxel a píxel (las bandas del gradiente miden ~20 px). */
const BLOCK = 8;

interface Probe {
  /** Color del píxel de la esquina (fondo de la página). */
  readonly corner: readonly number[];
  /** Esquina superior izquierda del bloque de la imagen. */
  readonly x: number;
  readonly y: number;
  /** RGB de cada píxel del bloque, en orden de lectura. */
  readonly block: readonly number[];
}

/**
 * Lee del lienzo de la página 1 el píxel de la esquina y un bloque de BLOCK × BLOCK píxeles dentro de la imagen.
 * El bloque se busca homogéneo y de tono medio, así no cae en el texto ni en el fondo de la página.
 * Si se pasa `at`, lee el bloque en esa posición.
 */
async function readPixels(page: Page, at?: { readonly x: number; readonly y: number }): Promise<Probe> {
  return page.evaluate(
    ([size, target]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid=viewer] [data-page-index="0"] canvas');
      if (canvas === null) throw new Error('la página 1 no tiene lienzo');
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('lienzo sin contexto 2d');
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      const pixel = (x: number, y: number): number[] => {
        const i = (y * width + x) * 4;
        return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      };
      const blockAt = (x0: number, y0: number): number[] => {
        const out: number[] = [];
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push(...pixel(x0 + dx, y0 + dy));
        return out;
      };
      /**
       * Bloque plano (cada canal varía poco) y sin negro de texto (algún canal > 100 en cada píxel) ni blanco de
       * página (ningún canal > 245).
       */
      const midTone = (x0: number, y0: number): boolean => {
        const lo = [255, 255, 255];
        const hi = [0, 0, 0];
        for (let dy = 0; dy < size; dy++) {
          for (let dx = 0; dx < size; dx++) {
            const p = pixel(x0 + dx, y0 + dy);
            if (Math.max(...p) < 100 || Math.max(...p) > 245) return false;
            for (let c = 0; c < 3; c++) {
              lo[c] = Math.min(lo[c] ?? 255, p[c] ?? 0);
              hi[c] = Math.max(hi[c] ?? 0, p[c] ?? 0);
            }
          }
        }
        return [0, 1, 2].every((c) => (hi[c] ?? 0) - (lo[c] ?? 0) <= 12);
      };
      let x = target?.x ?? -1;
      let y = target?.y ?? -1;
      if (x < 0) {
        const found = (() => {
          for (let py = 4; py + size < height; py += 4) {
            for (let px = 4; px + size < width; px += 4) {
              if (midTone(px, py)) return { x: px, y: py };
            }
          }
          return null;
        })();
        if (found === null) throw new Error('no hay un bloque de la imagen en tono medio');
        x = found.x;
        y = found.y;
      }
      return { corner: pixel(4, 4), x, y, block: blockAt(x, y) };
    },
    [BLOCK, at ?? null] as const,
  );
}

/** Espera a que el lienzo de la página 1 esté dibujado (el marco tiene `data-rendered`). */
async function pageOneRendered(page: Page): Promise<void> {
  await expect(page.locator('[data-testid=viewer] [data-page-index="0"]')).toHaveAttribute('data-rendered', 'true');
}

const IMAGES_PDF = join(FIXTURES_DIR, 'images-200.pdf');
const BASIC_PDF = join(FIXTURES_DIR, 'basic-5.pdf');

test.describe('Apariencia · tema según el sistema', () => {
  test.use({ colorScheme: 'dark' });

  test('con «Sistema» la barra es oscura si el navegador está en oscuro; con «Claro», clara', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('toolbar')).toBeVisible();
    await expect.poll(() => toolbarLuminance(page)).toBeLessThan(0.2);

    await openAppearance(page, 'Tema: Claro');
    await expect.poll(() => toolbarLuminance(page)).toBeGreaterThan(0.5);
  });
});

test('modo noche: el fondo de la página es oscuro y las imágenes conservan sus colores', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(IMAGES_PDF);
  await expectViewerReady(page);
  await pageOneRendered(page);

  const before = await readPixels(page);
  expect(before.corner[0]).toBeGreaterThan(200);

  await page.getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' }).click();

  // El dibujo nuevo llega de forma asíncrona: se espera a que el fondo de la página cambie.
  await expect
    .poll(async () => {
      const after = await readPixels(page, { x: before.x, y: before.y });
      return after.corner.every((channel) => channel < 60);
    }, { message: 'el fondo de la página 1 debe oscurecerse' })
    .toBe(true);

  const after = await readPixels(page, { x: before.x, y: before.y });
  expect(after.block.length).toBe(before.block.length);
  const worst = before.block.reduce((max, value, i) => Math.max(max, Math.abs((after.block[i] ?? 0) - value)), 0);
  expect(worst, 'los píxeles de la imagen no deben cambiar más de 10 por canal').toBeLessThanOrEqual(10);
});

test('tema y modo noche se mantienen tras recargar', async ({ page }) => {
  await page.goto('/');
  await openAppearance(page, 'Tema: Oscuro');
  await page.getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' }).click();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Apariencia' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Tema: Oscuro' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test.describe('escalado 125 % y 150 %', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });

  test('la barra muestra todos sus botones sin cortarse ni solaparse; la página se dibuja a 1,5 ×', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid=open-input]').setInputFiles(BASIC_PDF);
    await expectViewerReady(page);
    await pageOneRendered(page);

    const report = await page.evaluate(() => {
      const bar = document.querySelector('[role="toolbar"]');
      if (bar === null) throw new Error('sin barra');
      const barBox = bar.getBoundingClientRect();
      const controls = Array.from(bar.querySelectorAll<HTMLElement>('button, input, select'));
      const boxes = controls.map((el) => ({ name: el.getAttribute('aria-label') ?? el.tagName, box: el.getBoundingClientRect() }));
      const outside = boxes.filter(({ box }) => box.left < barBox.left || box.right > barBox.right || box.height === 0);
      const overlapping: string[] = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]?.box;
          const b = boxes[j]?.box;
          if (a === undefined || b === undefined) continue;
          const sharesX = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5;
          const sharesY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
          if (sharesX && sharesY) overlapping.push(`${boxes[i]?.name ?? i} / ${boxes[j]?.name ?? j}`);
        }
      }
      return { count: controls.length, outside: outside.map((o) => o.name), overlapping };
    });
    expect(report.count).toBeGreaterThan(10);
    expect(report.outside, 'botones cortados por la barra').toEqual([]);
    expect(report.overlapping, 'botones solapados').toEqual([]);

    const ratio = await page.locator('[data-testid=viewer] [data-page-index="0"] canvas').evaluate((el) => {
      if (!(el instanceof HTMLCanvasElement)) throw new Error('no es un lienzo');
      return el.width / el.getBoundingClientRect().width;
    });
    expect(ratio).toBeGreaterThan(1.45);
    expect(ratio).toBeLessThan(1.55);
  });
});

/** Color del píxel (4, 4) del lienzo de la miniatura `index`, o `null` si aún no hay lienzo. */
async function thumbnailCorner(page: Page, index: number): Promise<readonly number[] | null> {
  return page.evaluate((i) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-thumb-index="${String(i)}"] canvas`);
    if (canvas === null) return null;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('lienzo sin contexto 2d');
    const data = ctx.getImageData(4, 4, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  }, index);
}

test('modo noche: la miniatura de la página 1 también tiene la esquina oscura', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(IMAGES_PDF);
  await expectViewerReady(page);
  await page.keyboard.press('F4');
  await expect(page.getByRole('listbox', { name: 'Miniaturas' })).toBeVisible();
  await expect(page.locator('[data-thumb-index="0"]')).toHaveAttribute('data-rendered', 'true');

  const before = await thumbnailCorner(page, 0);
  expect(before?.[0] ?? 0).toBeGreaterThan(200);

  await page.getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Modo noche de las páginas' }).click();

  await expect
    .poll(async () => {
      const corner = await thumbnailCorner(page, 0);
      return corner !== null && corner.every((channel) => channel < 60);
    }, { message: 'la esquina de la miniatura 1 debe oscurecerse' })
    .toBe(true);
});
