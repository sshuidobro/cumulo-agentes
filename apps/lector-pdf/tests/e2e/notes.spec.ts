import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openFixture, pageFrame } from './helpers.ts';
import { qpdfCheck, qpdfObjects } from '../support/qpdf.ts';
import { commentDialog, commentField, openCommentBar, openFixtureWithDownloads, saveWithCtrlS } from './annotations-kit.ts';

/** Color de la herramienta Nota por defecto (amarillo de `DEFAULT_TOOL_COLORS`), en RGB de 0 a 255. */
const NOTE_RGB: readonly [number, number, number] = [255, 235, 59];
/** Tolerancia por canal para contar píxeles del color de la nota (el icono se suaviza al dibujarse). */
const COLOR_TOLERANCE = 40;
/** Píxeles mínimos del color de la nota para dar por visible el icono (el bocadillo tiene mucha más área). */
const MIN_ICON_PIXELS = 30;

/** Ventana de comentario abierta (no modal): su nombre accesible incluye el autor por defecto. */
function dialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Comentario de Usuario' });
}

function comment(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Comentario' });
}

/** Zona activa de la nota de la página 1 (nombre accesible «Nota de Usuario…»). */
function noteZone(page: Page): Locator {
  return pageFrame(page, 1).locator('[role="button"][aria-label^="Nota"]');
}

/** Activa la herramienta «Nota» de la barra Comentar (la abre si está cerrada). */
async function pickNoteTool(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Comentar' });
  await toggle.click();
  await expect(page.getByRole('toolbar', { name: 'Comentar' })).toBeVisible();
  await page.getByRole('toolbar', { name: 'Comentar' }).getByRole('button', { name: 'Nota', exact: true }).click();
}

/** Crea una nota en la página 1 con un clic en (150, 150) px de la página. */
async function createNote(page: Page): Promise<void> {
  await pickNoteTool(page);
  await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
  await expect(dialog(page)).toBeVisible();
  await expect(comment(page)).toBeFocused();
}

/** Número de píxeles de la captura de `locator` cuyo color está cerca de `NOTE_RGB` (se cuentan en el navegador). */
async function countNoteColorPixels(page: Page, locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) return 0;
  const png = await page.screenshot({ clip: box });
  return page.evaluate(
    async ({ base64, rgb, tolerance }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return 0;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r = 0, g = 0, b = 0] = [data[i], data[i + 1], data[i + 2]];
        if (Math.abs(r - (rgb[0] ?? 0)) <= tolerance && Math.abs(g - (rgb[1] ?? 0)) <= tolerance && Math.abs(b - (rgb[2] ?? 0)) <= tolerance) {
          count += 1;
        }
      }
      return count;
    },
    { base64: png.toString('base64'), rgb: NOTE_RGB, tolerance: COLOR_TOLERANCE },
  );
}

test('crear una nota, escribir, cerrar y reabrir con doble clic: el texto sigue y el icono se ve', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await createNote(page);
  await page.keyboard.type('Revisar esta cifra');

  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);

  await noteZone(page).dblclick();
  await expect(dialog(page)).toBeVisible();
  await expect(comment(page)).toHaveValue('Revisar esta cifra');

  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => countNoteColorPixels(page, noteZone(page))).toBeGreaterThan(MIN_ICON_PIXELS);
});

test('la ventana es un diálogo no modal con nombres accesibles; Tab recorre comentario, Borrar, Cerrar y sale', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await createNote(page);

  await expect(dialog(page)).toHaveAttribute('aria-label', 'Comentario de Usuario');
  await expect(dialog(page)).not.toHaveAttribute('aria-modal', 'true');
  await expect(comment(page)).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Borrar', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'Borrar', exact: true })).not.toBeFocused();
});

test('Esc cierra la ventana y devuelve el foco a la zona activa de la nota', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await createNote(page);

  await page.keyboard.press('Escape');

  await expect(dialog(page)).toHaveCount(0);
  await expect(noteZone(page)).toBeFocused();
});

test('Ctrl+Z con el foco fuera del comentario deja la nota con el texto vacío', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await createNote(page);
  await page.keyboard.type('hola');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);

  await page.keyboard.press('Control+z');

  await noteZone(page).dblclick();
  await expect(comment(page)).toHaveValue('');
});

test('doble clic en un resaltado del fichero muestra su comentario y su autor', async ({ page }) => {
  await openFixture(page, 'annotated.pdf');
  const highlight = pageFrame(page, 1).locator('[role="button"][aria-label^="Resaltado"]');
  await expect(highlight).toHaveCount(1);

  await highlight.dblclick();

  await expect(page.getByRole('dialog', { name: 'Comentario de Otra persona' })).toBeVisible();
  await expect(comment(page)).toHaveValue('Comentario previo');
});

test('escribir en la nota y guardar descarga un PDF con /Text, su /Contents y su /Popup que pdf.js relee', async ({ page }) => {
  // Sin File System Access: Guardar como descarga una copia.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  await openFixture(page, 'basic-5.pdf');
  await createNote(page);
  await page.keyboard.type('Revisar esta cifra');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+Shift+S');
  const file = await download;
  const path = await file.path();
  const saved = readFileSync(path);
  const text = saved.toString('latin1');

  // Anotación Text con su contenido y un Popup hijo (estándar de Adobe).
  expect(text).toMatch(/\/Subtype\s*\/Text\b/);
  expect(text).toMatch(/\/Subtype\s*\/Popup\b/);
  expect(text).toMatch(/\/Parent\s+\d+\s+\d+\s+R/);
  expect(text).toMatch(/\/Popup\s+\d+\s+\d+\s+R/);
  const literal = text.includes('(Revisar esta cifra)');
  const utf16 = text.toUpperCase().includes(Buffer.from('Revisar esta cifra', 'utf16le').swap16().toString('hex').toUpperCase());
  expect(literal || utf16).toBe(true);

  // Releer el fichero guardado en la propia app (pdf.js): la nota sigue ahí con su texto.
  expect(await readSavedNoteText(page, saved)).toBe('Revisar esta cifra');
});

/** Abre los bytes guardados en una pestaña nueva y devuelve el texto de la nota de la página 1. */
async function readSavedNoteText(page: Page, bytes: Buffer): Promise<string> {
  const fresh = await page.context().newPage();
  try {
    await fresh.goto('/');
    await fresh.locator('[data-testid=open-input]').setInputFiles({ name: 'guardado.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(fresh.getByTestId('viewer')).toBeVisible();
    const zone = pageFrame(fresh, 1).locator('[role="button"][aria-label^="Nota"]');
    await expect(zone).toHaveCount(1);
    await zone.dblclick();
    return await fresh.getByRole('textbox', { name: 'Comentario' }).inputValue();
  } finally {
    await fresh.close();
  }
}

test('nota solo con teclado (PDF-072): Intro crea la nota, Esc devuelve el foco a su zona, las flechas la mueven y el guardado la incluye', async ({ page }, testInfo) => {
  await openFixtureWithDownloads(page, 'basic-5.pdf');
  const bar = await openCommentBar(page);
  await bar.getByRole('button', { name: 'Nota', exact: true }).focus();
  await page.keyboard.press('Enter');

  await expect(commentDialog(page)).toBeVisible();
  await expect(commentField(page)).toBeFocused();
  await page.keyboard.type('Hola');
  await page.keyboard.press('Escape');
  await expect(commentDialog(page)).toHaveCount(0);
  await expect(noteZone(page)).toBeFocused();

  // El texto escrito y la creación son entradas de deshacer distintas: Ctrl+Z quita primero el texto y luego la nota.
  await page.keyboard.press('Control+z');
  await expect(noteZone(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(noteZone(page)).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(noteZone(page)).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await noteZone(page).focus();

  const before = await noteZone(page).boundingBox();
  expect(before).not.toBeNull();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await noteZone(page).boundingBox())?.x ?? 0).toBeGreaterThan(before?.x ?? 0);

  const saved = await saveWithCtrlS(page, testInfo, 'nota-teclado.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);
  expect(textNoteContents(saved)).toEqual(['Hola']);
});

/** Contenidos `/Contents` de los diccionarios `/Text` del fichero, según qpdf (las cadenas de texto llevan prefijo `u:`). */
function textNoteContents(path: string): string[] {
  const out: string[] = [];
  for (const object of Object.values(qpdfObjects(path))) {
    const value: unknown = object.value;
    if (!isDict(value)) continue;
    if (value['/Type'] !== '/Annot' || value['/Subtype'] !== '/Text') continue;
    const contents = value['/Contents'];
    out.push(typeof contents === 'string' ? contents.replace(/^u:/, '') : '');
  }
  return out;
}

function isDict(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
