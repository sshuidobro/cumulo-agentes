import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAP, DEFAULT_PADDING } from '../../src/core/layout.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

/** Tolerancia relativa en el ancho de las páginas tras cambiar el zoom (criterio de PDF-011). */
const WIDTH_TOLERANCE = 0.02;

function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

function pageFrame(page: Page, index: number) {
  return page.locator(`[data-testid=viewer] [data-page-index="${index}"]`);
}

async function frameWidth(page: Page, index: number): Promise<number> {
  const box = await pageFrame(page, index).boundingBox();
  if (box === null) throw new Error(`La página ${index + 1} no está montada`);
  return box.width;
}

/**
 * Desplaza el visor para que la mitad vertical de la página `index` quede en el centro del visor. Usa la
 * geometría del layout (página 1 montada como referencia): la página objetivo puede no estar montada aún.
 */
async function scrollToMiddleOfPage(page: Page, index: number): Promise<void> {
  const first = await pageFrame(page, 0).boundingBox();
  if (first === null) throw new Error('La página 1 no está montada');
  const stride = first.height + DEFAULT_GAP;
  await page.getByTestId('viewer').evaluate(
    (viewer, [target, pitch, height, padding]) => {
      viewer.scrollTop = padding + target * pitch + height / 2 - viewer.clientHeight / 2;
    },
    [index, stride, first.height, DEFAULT_PADDING] as const,
  );
  await expect(pageFrame(page, index)).toBeVisible();
}

test('Tamaño real, después Ctrl++ tres veces (100 → 110 → 125 → 150 %): la página 3 sigue visible y se escala ×1,5', async ({
  page,
}) => {
  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('combobox', { name: 'Ajuste de zoom' }).selectOption({ label: 'Tamaño real' });
  await expect(page.getByRole('textbox', { name: 'Zoom' })).toHaveValue('100 %');

  await scrollToMiddleOfPage(page, 2);
  await expect(pageFrame(page, 2)).toBeVisible();
  const before = await frameWidth(page, 2);

  for (let step = 0; step < 3; step++) {
    await page.keyboard.press('Control+Equal');
  }

  await expect(page.getByRole('textbox', { name: 'Zoom' })).toHaveValue('150 %');
  // La página 3 sigue en el tercio superior del visor (la página actual no cambia).
  const viewerBox = await page.getByTestId('viewer').boundingBox();
  if (viewerBox === null) throw new Error('Sin visor');
  const frameBox = await pageFrame(page, 2).boundingBox();
  if (frameBox === null) throw new Error('La página 3 no está montada');
  expect(frameBox.y).toBeLessThan(viewerBox.y + viewerBox.height / 3);
  expect(frameBox.y + frameBox.height).toBeGreaterThan(viewerBox.y + viewerBox.height / 3);

  const after = await frameWidth(page, 2);
  expect(after / before).toBeGreaterThan(1.5 * (1 - WIDTH_TOLERANCE));
  expect(after / before).toBeLessThan(1.5 * (1 + WIDTH_TOLERANCE));
});

test('Ctrl+rueda sobre la mitad inferior de la página 2 mantiene el punto bajo el cursor y no hace zoom del navegador', async ({
  page,
}) => {
  await openFixture(page, 'basic-5.pdf');
  await scrollToMiddleOfPage(page, 1);

  const frame = pageFrame(page, 1);
  const box = await frame.boundingBox();
  if (box === null) throw new Error('La página 2 no está montada');
  const viewer = await page.getByTestId('viewer').boundingBox();
  if (viewer === null) throw new Error('El visor no tiene caja');
  const x = box.x + box.width / 2;
  // Dentro del visor: la barra puede ocupar dos filas en anchos pequeños (PDF-050) y encoger el visor.
  const y = Math.min(box.y + box.height * 0.75, viewer.y + viewer.height - 20);
  const pageUnderCursor = (): Promise<string | null> =>
    page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.closest('[data-page-index]')?.getAttribute('data-page-index') ?? null,
      [x, y] as const,
    );

  const pageBefore = await pageUnderCursor();
  const dprBefore = await page.evaluate(() => window.devicePixelRatio);
  const zoomBefore = await page.getByRole('textbox', { name: 'Zoom' }).inputValue();

  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');

  await expect(page.getByRole('textbox', { name: 'Zoom' })).not.toHaveValue(zoomBefore);
  expect(await pageUnderCursor()).toBe(pageBefore);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dprBefore);
});

test('girar a la derecha en basic-5: la página 1 pasa a ser más ancha que alta y se vuelve a dibujar', async ({
  page,
}, testInfo) => {
  await openFixture(page, 'basic-5.pdf');
  await expect(page.locator('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]')).toBeVisible();
  const portrait = await pageFrame(page, 0).boundingBox();
  if (portrait === null) throw new Error('La página 1 no está montada');
  expect(portrait.height).toBeGreaterThan(portrait.width);

  await page.getByRole('button', { name: 'Girar a la derecha' }).click();

  await expect(page.locator('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]')).toBeVisible();
  const landscape = await pageFrame(page, 0).boundingBox();
  if (landscape === null) throw new Error('La página 1 no está montada tras girar');
  expect(landscape.width).toBeGreaterThan(landscape.height);

  const screenshot = await page.getByTestId('viewer').screenshot();
  await testInfo.attach('basic-5-girada', { body: screenshot, contentType: 'image/png' });
});
