import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { FIXTURES_DIR, CORPUS_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Presupuesto de PDF-013: como mucho 12 capas de texto en el DOM, sea cual sea el total de páginas. */
const MAX_TEXT_LAYERS = 12;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

async function openFile(page: Page, path: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

/** Rectángulo en pantalla de `needle` dentro de la capa de texto de la página `pageIndex` (0-based). Espera a que exista. */
async function boxOf(page: Page, pageIndex: number, needle: string): Promise<Box> {
  let found: Box | null = null;
  await expect(async () => {
    found = await measureBox(page, pageIndex, needle);
    expect(found).not.toBeNull();
  }).toPass();
  if (found === null) throw new Error(`No se encuentra «${needle}» en la página ${pageIndex + 1}`);
  return found;
}

async function measureBox(page: Page, pageIndex: number, needle: string): Promise<Box | null> {
  return page.evaluate(
    ({ index, text }) => {
      const layer = document.querySelector(`[data-page-index="${index}"] .textLayer`);
      if (layer === null) return null;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const start = node.textContent?.indexOf(text) ?? -1;
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        const r = range.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      return null;
    },
    { index: pageIndex, text: needle },
  );
}

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('capa de texto', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('doble clic sobre una palabra la selecciona en basic-5.pdf', async ({ page }) => {
    await openFile(page, fixture('basic-5.pdf'));
    const word = await boxOf(page, 0, 'murciélago');

    await page.mouse.dblclick((word.left + word.right) / 2, (word.top + word.bottom) / 2);

    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('murciélago');
  });

  test('arrastrar desde «Página» hasta «marcador-1» y Ctrl+C copia ambos textos', async ({ page }) => {
    await openFile(page, fixture('basic-5.pdf'));
    const start = await boxOf(page, 0, 'Página');
    const end = await boxOf(page, 0, 'marcador-1');

    await page.mouse.move(start.left + 1, (start.top + start.bottom) / 2);
    await page.mouse.down();
    await page.mouse.move(end.right - 1, (end.top + end.bottom) / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Control+C');

    const copied = await clipboardText(page);
    expect(copied).toContain('Página 1 de 5');
    expect(copied).toContain('marcador-1');
  });

  test('con zoom 200 % y la vista girada 90°, la selección de una línea cubre el texto dibujado', async ({
    page,
  }, testInfo: TestInfo) => {
    await openFile(page, fixture('basic-5.pdf'));
    for (let step = 0; step < 10; step++) {
      if ((await page.getByRole('textbox', { name: 'Zoom' }).inputValue()) === '200 %') break;
      await page.keyboard.press('Control+Equal');
    }
    await expect(page.getByRole('textbox', { name: 'Zoom' })).toHaveValue('200 %');
    await page.getByRole('button', { name: 'Girar a la derecha' }).click();
    // Dos fotogramas: el visor recoloca el scroll y la capa de texto tras el giro.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const line = 'El veloz murciélago hindú';
    // Tras el giro la línea puede quedar fuera del visor: se lleva a la vista antes de medirla.
    await page.locator('[data-page-index="0"] .textLayer span', { hasText: 'murciélago' }).first().scrollIntoViewIfNeeded();
    const text = await boxOf(page, 0, line);
    await page.mouse.click((text.left + text.right) / 2, (text.top + text.bottom) / 2, { clickCount: 3 });

    const selected = await page.evaluate(
      ({ index, needle }) => {
        const layer = document.querySelector(`[data-page-index="${index}"] .textLayer`);
        const selection = window.getSelection();
        if (layer === null || selection === null || selection.rangeCount === 0) return null;
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const start = node.textContent?.indexOf(needle) ?? -1;
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + needle.length);
          const glyphs = range.getBoundingClientRect();
          const covered = selection.getRangeAt(0).getBoundingClientRect();
          return {
            selection: selection.toString(),
            glyphs: { left: glyphs.left, top: glyphs.top, right: glyphs.right, bottom: glyphs.bottom },
            covered: { left: covered.left, top: covered.top, right: covered.right, bottom: covered.bottom },
          };
        }
        return null;
      },
      { index: 0, needle: line },
    );

    expect(selected).not.toBeNull();
    if (selected === null) return;
    expect(selected.selection).toContain(line);
    const { glyphs, covered } = selected;
    const tolerance = 2;
    expect(covered.left).toBeLessThanOrEqual(glyphs.left + tolerance);
    expect(covered.right).toBeGreaterThanOrEqual(glyphs.right - tolerance);
    expect(covered.top).toBeLessThanOrEqual(glyphs.top + tolerance);
    expect(covered.bottom).toBeGreaterThanOrEqual(glyphs.bottom - tolerance);

    const shot = await page.screenshot();
    await testInfo.attach('seleccion-zoom-200-girada', { body: shot, contentType: 'image/png' });
  });

  test('Ctrl+A en la página 3 selecciona su texto y no la barra de herramientas', async ({ page }) => {
    await openFile(page, fixture('basic-5.pdf'));
    // La página 3 no está montada hasta que el visor se desplaza: se lleva su marco arriba.
    await page.getByTestId('viewer').evaluate((viewer) => {
      viewer.scrollTop = viewer.scrollHeight * 0.4;
    });
    await expect(page.locator('[data-page-index="2"]')).toBeAttached();
    await page.locator('[data-page-index="2"]').evaluate((frame) => {
      const viewer = frame.closest('[data-testid="viewer"]');
      if (viewer instanceof HTMLElement) viewer.scrollTop = (frame as HTMLElement).offsetTop;
    });
    await expect(page.locator('[data-page-index="2"] .textLayer span').first()).toBeVisible();

    await page.keyboard.press('Control+A');

    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected).toContain('BUSQUEDA');
    expect(selected).not.toContain('Abrir');
    expect(selected).not.toContain('Herramienta');
  });

  test('en multilingue.pdf, copiar la línea rusa da «Привет, мир»', async ({ page }) => {
    await openFile(page, join(CORPUS_DIR, 'libreoffice', 'multilingue.pdf'));
    const russian = await boxOf(page, 0, 'Привет, мир');

    await page.mouse.move(russian.left + 1, (russian.top + russian.bottom) / 2);
    await page.mouse.down();
    await page.mouse.move(russian.right - 1, (russian.top + russian.bottom) / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Control+C');

    expect((await clipboardText(page)).trim()).toBe('Привет, мир');
  });
});

/** Generador determinista (LCG) para que los saltos sean reproducibles. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('en pages-5000.pdf hay como mucho 12 capas de texto tras 20 saltos', async ({ page }) => {
  await openFile(page, fixture('pages-5000.pdf'));
  await expect(page.getByRole('group', { name: 'Página 1 de 5000' })).toBeVisible();

  const random = seeded(1313);
  const viewer = page.getByTestId('viewer');
  for (let jump = 0; jump < 20; jump++) {
    const roll = random();
    if (roll < 0.4) {
      await page.keyboard.press(roll < 0.2 ? 'End' : 'Home');
    } else {
      await viewer.hover();
      await page.mouse.wheel(0, Math.floor(random() * 4000) - 1500);
    }
    expect(await page.locator('.textLayer').count()).toBeLessThanOrEqual(MAX_TEXT_LAYERS);
  }
});
