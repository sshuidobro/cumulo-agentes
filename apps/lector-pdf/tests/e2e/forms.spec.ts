import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { msg } from '../../src/ui/messages.ts';
import { fixture, pageFrame, waitDraftSaved, waitPageRendered } from './helpers.ts';
import { openInNewPage, openWithDownloads, saveWithCtrlS } from './annotations-kit.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import { readFormFields } from '../support/form-fields.ts';

/**
 * Formularios completos sobre form-full.pdf (PDF-083): casillas, botones de opción, Tab entre páginas, firma no
 * rellenable y el ciclo rellenar → guardar → reabrir, todo con el teclado cuando el criterio lo pide.
 */

/** Píxeles que cambian como mínimo para dar por repintado el valor de un control en el lienzo. */
const MIN_CHANGED_PIXELS = 20;
/** Diferencia máxima por canal para considerar un píxel igual tras deshacer. */
const CHANNEL_TOLERANCE = 2;
const FILE_NAME = 'form-full.pdf';

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

/** Cuántos píxeles (RGB) difieren entre dos lecturas; `tolerance` es la diferencia tolerada por canal. */
function differingPixels(before: readonly number[], after: readonly number[], tolerance = 0): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i + 2 < length; i += 4) {
    const differs = [0, 1, 2].some((c) => Math.abs((before[i + c] ?? 0) - (after[i + c] ?? 0)) > tolerance);
    if (differs) changed += 1;
  }
  return changed;
}

/** Caja de un locator ya visible, en coordenadas de ventana. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('El control no tiene caja visible');
  return box;
}

/** Pulsa Tab hasta que `target` tenga el foco (como mucho `max` veces). */
async function tabUntil(page: Page, target: Locator, max = 15): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('solo con teclado: rellenar form-full.pdf, guardar, reabrir y ver los valores', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture(FILE_NAME));
  const p1 = (role: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'listbox', name: string) =>
    pageFrame(page, 1).getByRole(role, { name, exact: true });

  // Desde el visor, Tab hasta «nombre» y escribir.
  await page.getByTestId('viewer').focus();
  const nombre = p1('textbox', 'nombre');
  await tabUntil(page, nombre);
  await page.keyboard.type('María José');
  await page.keyboard.press('Tab');

  // «comentarios» (multilínea): dos líneas; Intro dentro de él es un salto de línea.
  await expect(p1('textbox', 'comentarios')).toBeFocused();
  await page.keyboard.type('Línea uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Línea dos');
  await page.keyboard.press('Tab');

  // «codigo» (máximo 6), luego «importe» y «acepto».
  await expect(p1('textbox', 'codigo')).toBeFocused();
  await page.keyboard.type('ABC123');
  await page.keyboard.press('Tab');
  await expect(p1('textbox', 'importe')).toBeFocused();
  await page.keyboard.press('Tab');

  // Casilla: Espacio la marca.
  const acepto = p1('checkbox', 'acepto');
  await expect(acepto).toBeFocused();
  await page.keyboard.press(' ');
  await expect(acepto).toBeChecked();

  // Botones de opción: el grupo entra por el marcado (Verde); una flecha pasa a Azul.
  await page.keyboard.press('Tab');
  await expect(p1('radio', 'Verde')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(p1('radio', 'Azul')).toBeChecked();

  // Combo «pais»: la inicial elige Portugal; lista «idiomas»: la inicial elige Francés.
  await page.keyboard.press('Tab');
  await expect(p1('combobox', 'pais')).toBeFocused();
  await page.keyboard.press('p');
  await expect(p1('combobox', 'pais')).toHaveValue('pt');
  await page.keyboard.press('Tab');
  await expect(p1('listbox', 'idiomas')).toBeFocused();
  await page.keyboard.press('F');

  // El último campo rellenable de la p1 lleva el foco a «nombre» de la p2 (página visible).
  const nombreP2 = pageFrame(page, 2).getByRole('textbox', { name: 'nombre', exact: true });
  await tabUntil(page, nombreP2, 12);
  await waitPageRendered(page, 2);
  await expect(pageFrame(page, 2)).toBeInViewport({ ratio: 0.2 });

  // Ctrl+S descarga el fichero: tiene los valores, es válido para qpdf.
  const saved = await saveWithCtrlS(page, testInfo, 'form-full-rellenado.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);
  const fields = await readFormFields(new Uint8Array(readFileSync(saved)));
  expect(fields.get('nombre')?.initial).toEqual({ kind: 'text', text: 'María José' });
  expect(fields.get('acepto')?.initial).toEqual({ kind: 'checkbox', checked: true });
  expect(fields.get('color')?.initial).toEqual({ kind: 'radio', selected: 'Azul' });
  expect(fields.get('pais')?.initial).toEqual({ kind: 'choice', selected: ['pt'] });
  expect(fields.get('idiomas')?.initial).toEqual({ kind: 'choice', selected: ['Francés'] });
  expect(fields.get('codigo')?.initial).toEqual({ kind: 'text', text: 'ABC123' });
  const comentarios = fields.get('comentarios')?.initial;
  expect(comentarios?.kind === 'text' && comentarios.text).toContain('Línea uno');

  // Reabrir el guardado: los controles muestran los valores y el título no marca cambios.
  const reopened = await openInNewPage(page, saved);
  await expect(reopened.getByRole('textbox', { name: 'nombre', exact: true }).first()).toHaveValue('María José');
  await expect(pageFrame(reopened, 1).getByRole('checkbox', { name: 'acepto' })).toBeChecked();
  await expect(pageFrame(reopened, 1).getByRole('radio', { name: 'Azul' })).toBeChecked();
  await expect(reopened).not.toHaveTitle(/• /);
});

test('marcar «acepto» y Ctrl+Z con el foco en el visor la desmarca; el lienzo vuelve a «Off»', async ({ page }) => {
  await openWithDownloads(page, fixture(FILE_NAME));
  const box = pageFrame(page, 1).getByRole('checkbox', { name: 'acepto' });
  const initial = await canvasPixels(page, 1, box);

  await box.focus();
  await page.keyboard.press(' ');
  await expect(box).toBeChecked();
  await expect
    .poll(async () => differingPixels(initial, await canvasPixels(page, 1, box)))
    .toBeGreaterThanOrEqual(MIN_CHANGED_PIXELS);

  await page.getByTestId('viewer').focus();
  await page.keyboard.press('Control+z');
  await expect(box).not.toBeChecked();
  await expect
    .poll(async () => differingPixels(initial, await canvasPixels(page, 1, box), CHANNEL_TOLERANCE))
    .toBe(0);
});

test('cerrar con campos cambiados (abrir otro fichero) pregunta «¿Guardar los cambios…?»', async ({ page }) => {
  await openWithDownloads(page, fixture(FILE_NAME));
  const nombre = pageFrame(page, 1).getByRole('textbox', { name: 'nombre', exact: true });
  await nombre.fill('Luis');
  await nombre.press('Tab');
  await expect(page).toHaveTitle(/• /);

  await page.locator('[data-testid=open-input]').setInputFiles(fixture('form.pdf'));
  const dialog = page.getByRole('dialog', { name: msg.unsavedQuestion(FILE_NAME) });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: msg.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(nombre).toHaveValue('Luis');
});

test('tras cerrar sin guardar, «nombre» se recupera del borrador al abrir el mismo fichero', async ({ page }) => {
  await openWithDownloads(page, fixture(FILE_NAME));
  const nombre = pageFrame(page, 1).getByRole('textbox', { name: 'nombre', exact: true });
  await nombre.fill('María José');
  await nombre.press('Tab');

  // El autoguardado escribe el borrador tras el cambio: esperamos a verlo en IndexedDB.
  await waitDraftSaved(page);

  await page.reload();
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(FILE_NAME));
  const dialog = page.getByRole('dialog', {
    name: new RegExp(`Hay cambios sin guardar de la última vez en «${FILE_NAME.replace('.', '\\.')}»`),
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: msg.draftRecover, exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(pageFrame(page, 1).getByRole('textbox', { name: 'nombre', exact: true })).toHaveValue('María José');
});

test('la p1 de form-full.pdf con el foco en un campo no tiene incidencias de axe serious ni critical', async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, fixture(FILE_NAME));
  await pageFrame(page, 1).getByRole('textbox', { name: 'nombre', exact: true }).focus();
  const results = await new AxeBuilder({ page }).include('[data-testid="viewer"] [data-page-index="0"]').analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({
    type: 'axe',
    description: `p1 de form-full con foco: ${String(results.violations.length)} violaciones en total, ${String(serious.length)} serious/critical`,
  });
  expect(serious.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help}`)).toEqual([]);
});

