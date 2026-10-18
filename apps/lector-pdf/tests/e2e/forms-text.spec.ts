import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, pageFrame, waitPageRendered } from './helpers.ts';
import { openWithDownloads } from './annotations-kit.ts';

/**
 * Formularios de texto, combos y listas sobre la página (PDF-041, form-full.pdf). Los controles HTML van encima del
 * lienzo: se rellenan con ratón y teclado, el lienzo muestra el valor que pinta pdf.js y Ctrl+Z lo deshace.
 */

/** Píxeles que cambian como mínimo para dar por repintado el valor de un campo en el lienzo. */
const MIN_CHANGED_PIXELS = 20;
/** Tolerancia de centrado de un control sobre su widget, en píxeles CSS. */
const CENTER_TOLERANCE_PX = 2;
/** Ancho del campo «nombre» en puntos PDF (rect [72, 760, 300, 780]) y su alto. */
const NOMBRE_RECT = { x1: 72, y1: 760, x2: 300, y2: 780 } as const;
/** Puntos PDF por píxel CSS a 100 % (1 pt = 96/72 px): el zoom escala sobre esta base. */
const CSS_UNITS = 96 / 72;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Píxeles RGBA del lienzo de la página `n` (1-based) bajo un control, leídos en este momento (el visor puede haber
 * hecho scroll desde la última lectura).
 */
async function canvasPixels(page: Page, n: number, control: Locator): Promise<number[]> {
  const area = await boxOf(control);
  return page.evaluate(
    ({ index, area }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `[data-testid="viewer"] [data-page-index="${String(index)}"] canvas`,
      );
      const context = canvas?.getContext('2d');
      if (canvas === null || canvas === undefined || context === null || context === undefined) return [];
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const data = context.getImageData(
        Math.round((area.x - rect.left) * scale),
        Math.round((area.y - rect.top) * scale),
        Math.max(1, Math.round(area.width * scale)),
        Math.max(1, Math.round(area.height * scale)),
      ).data;
      return Array.from(data);
    },
    { index: n - 1, area },
  );
}

/** Cuántos píxeles (RGB) distintos hay entre dos lecturas del mismo tamaño. */
function changedPixels(before: readonly number[], after: readonly number[]): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i + 2 < length; i += 4) {
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) changed += 1;
  }
  return changed;
}

/** Caja de un locator ya visible, en coordenadas de ventana. */
async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('El control no tiene caja visible');
  return box;
}

test('escribir «Luis» en nombre y salir con Tab: el lienzo de la p2 cambia y se puede deshacer', async ({ page }) => {
  await openWithDownloads(page, fixture('form-full.pdf'));
  await pageFrame(page, 2).scrollIntoViewIfNeeded();
  await waitPageRendered(page, 2);

  const nameP1 = pageFrame(page, 1).getByRole('textbox', { name: 'nombre' });
  const nameP2 = pageFrame(page, 2).getByRole('textbox', { name: 'nombre' });
  await expect(nameP2).toHaveValue('Ana');
  const before = await canvasPixels(page, 2, nameP2);

  // Clic y teclado: se borra «Ana» y se escribe «Luis».
  await nameP1.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Luis');
  await page.keyboard.press('Tab');

  await expect(nameP1).toHaveValue('Luis');
  await expect(page).toHaveTitle(/• /);
  await expect
    .poll(async () => changedPixels(before, await canvasPixels(page, 2, nameP2)))
    .toBeGreaterThanOrEqual(MIN_CHANGED_PIXELS);

  // Ctrl+Z con el foco en el visor: vuelven «Ana» en las dos páginas y el lienzo se repinta sin el «Luis».
  // (El «Ana» original viene de la apariencia del fichero; al deshacer lo pinta pdf.js desde el valor: no son iguales píxel a píxel.)
  const edited = await canvasPixels(page, 2, nameP2);
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+z');
  await expect(nameP1).toHaveValue('Ana');
  await expect(nameP2).toHaveValue('Ana');
  await expect
    .poll(async () => changedPixels(edited, await canvasPixels(page, 2, nameP2)))
    .toBeGreaterThanOrEqual(MIN_CHANGED_PIXELS);
});

test('elegir «Portugal» en pais con el teclado guarda pt; Ctrl+Z vuelve a «España»', async ({ page }) => {
  await openWithDownloads(page, fixture('form-full.pdf'));
  const country = pageFrame(page, 1).getByRole('combobox', { name: 'pais' });
  await expect(country).toHaveValue('España');

  // Foco en la lista y tecla «p»: la búsqueda por inicial elige Portugal (una sola confirmación).
  await country.focus();
  await page.keyboard.press('p');
  await expect(country).toHaveValue('pt');

  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+z');
  await expect(country).toHaveValue('España');
});

test('con zoom 200 % y giro de 90° cada control sigue sobre su widget (±2 px)', async ({ page }) => {
  await openWithDownloads(page, fixture('form-full.pdf'));
  const name = pageFrame(page, 1).getByRole('textbox', { name: 'nombre' });

  await page.getByRole('textbox', { name: 'Zoom' }).fill('200');
  await page.getByRole('textbox', { name: 'Zoom' }).press('Enter');
  await waitPageRendered(page, 1);

  // Escala en píxeles CSS por punto PDF, medida en el control sin girar: su ancho es (x2 − x1) × escala.
  const scale = (await boxOf(name)).width / (NOMBRE_RECT.x2 - NOMBRE_RECT.x1);
  expect(scale).toBeCloseTo(2 * CSS_UNITS, 1);

  /** Centro del control respecto al marco de la página (que cambia de posición al girar). */
  const centerInFrame = async (): Promise<{ x: number; y: number }> => {
    const frame = await boxOf(pageFrame(page, 1));
    const box = await boxOf(name);
    return { x: box.x + box.width / 2 - frame.x, y: box.y + box.height / 2 - frame.y };
  };
  const midX = (NOMBRE_RECT.x1 + NOMBRE_RECT.x2) / 2;
  const midY = (NOMBRE_RECT.y1 + NOMBRE_RECT.y2) / 2;

  // Sin girar: el centro está en (x, altura − y) escalado; la página mide 792 puntos de alto.
  const unrotated = await centerInFrame();
  expect(Math.abs(unrotated.x - midX * scale)).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
  expect(Math.abs(unrotated.y - (792 - midY) * scale)).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);

  // Girado a la derecha (90°, en el sentido de las agujas): (x, y) pasa a (y, x).
  await page.getByRole('button', { name: 'Girar a la derecha' }).click();
  await expect
    .poll(async () => {
      const rotated = await centerInFrame();
      return Math.max(Math.abs(rotated.x - midY * scale), Math.abs(rotated.y - midX * scale));
    })
    .toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
});

test('la p1 de form-full.pdf no tiene incidencias de axe serious ni critical', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('form-full.pdf'));
  const results = await new AxeBuilder({ page }).include('[data-testid="viewer"] [data-page-index="0"]').analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({
    type: 'axe',
    description: `p1 de form-full: ${String(results.violations.length)} violaciones en total, ${String(serious.length)} serious/critical`,
  });
  expect(serious.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help}`)).toEqual([]);
});
