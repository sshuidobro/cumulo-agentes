import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixture, pageFrame } from './helpers.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import {
  AUTHOR,
  commentDialog,
  commentField,
  commentRows,
  createNoteWithText,
  drawStroke,
  openCommentsPanel,
  openInNewPage,
  openWithDownloads,
  optionName,
  pickTool,
  saveWithCtrlS,
  storeDownload,
  visiblePart,
  wordBox,
  zigzagFrom,
  zoneOf,
  type Box,
  type Point,
} from './annotations-kit.ts';

/** Textos de la app para el menú del panel de comentarios (PDF-111). */
const MENU = 'Más opciones de comentarios';
const EXPORT = 'Exportar comentarios…';
const IMPORT = 'Importar comentarios…';

const NOTE_TEXT = 'Revisar esta cifra';
const REPLY = 'Respuesta que debe sobrevivir';
const FREETEXT = 'Texto libre de prueba';
const HIGHLIGHT_COMMENT = 'Revisar la cifra del resaltado';
/** Seis comentarios de primer nivel (resaltado, nota, texto, dibujo, rectángulo, sello) y la respuesta y el estado de la nota. */
const TOP_LEVEL = 6;
const IMPORTED = 8;

/** Caja de un punto en coordenadas de ventana (la parte visible de la página 1). */
async function at(page: Page, fx: number, fy: number): Promise<Point> {
  const part: Box = await visiblePart(page, 1);
  return { x: part.x + part.width * fx, y: part.y + part.height * fy };
}

/** Arrastre con el ratón desde un punto hasta otro, en pasos intermedios. */
async function dragBetween(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** Crea en la página 1 un resaltado, una nota con respuesta y estado «Aceptado», texto libre, dibujo, rectángulo y sello. */
async function createAllKinds(page: Page): Promise<void> {
  // Resaltado: doble clic en una palabra y «Resaltar» en la barra de la selección.
  const word = await wordBox(page, 1, 'murciélago');
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, 1, 'Resaltado de')).toHaveCount(1);
  await zoneOf(page, 1, 'Resaltado de').dblclick();
  await expect(commentDialog(page)).toBeVisible();
  await commentField(page).fill(HIGHLIGHT_COMMENT);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(commentDialog(page)).toHaveCount(0);

  // Nota con texto, luego una respuesta y el estado «Aceptado» desde su ventana.
  await createNoteWithText(page, NOTE_TEXT);
  await zoneOf(page, 1, 'Nota de').dblclick();
  const dialog = commentDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Escribe una respuesta' }).fill(REPLY);
  await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
  await dialog.getByRole('button', { name: 'Estado', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Aceptado', exact: true }).click();
  await expect(dialog.getByText('Estado: Aceptado')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Texto libre: clic, teclear y Esc.
  await pickTool(page, 'Texto');
  await pageFrame(page, 1).click({ position: { x: 150, y: 420 } });
  await page.keyboard.type(FREETEXT);
  await page.keyboard.press('Escape');
  await expect(zoneOf(page, 1, 'Texto de')).toHaveCount(1);

  // Dibujo a mano.
  await pickTool(page, 'Dibujar');
  const part = await visiblePart(page, 1);
  await drawStroke(page, zigzagFrom({ x: part.x + part.width * 0.25, y: part.y + part.height * 0.5 }, 40));
  await expect(zoneOf(page, 1, 'Dibujo de')).toHaveCount(1);

  // Rectángulo.
  await pickTool(page, 'Rectángulo');
  await dragBetween(page, await at(page, 0.55, 0.6), await at(page, 0.85, 0.75));
  await expect(zoneOf(page, 1, 'Rectángulo')).toHaveCount(1);

  // Sello «APROBADO» con un clic.
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  await bar.getByRole('button', { name: 'Sello', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'APROBADO', exact: true }).click();
  await page.mouse.click((await at(page, 0.2, 0.9)).x, (await at(page, 0.2, 0.9)).y);
  await expect(zoneOf(page, 1, 'Sello')).toHaveCount(1);
}

/** Pulsa «Más opciones de comentarios» y elige la entrada con ese nombre. */
async function chooseMenuEntry(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: MENU, exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Nombres de las entradas del menú «Abrir recientes» (vacío si está deshabilitado). */
async function recentNames(page: Page): Promise<string[]> {
  const button = page.getByRole('button', { name: 'Abrir recientes', exact: true });
  if ((await button.count()) === 0 || (await button.isDisabled())) return [];
  await button.click();
  const names = await page.getByRole('menuitem').allTextContents();
  await page.keyboard.press('Escape');
  return names;
}

test.describe('comentarios en XFDF desde el panel (PDF-111)', () => {
  test('sin comentarios, «Exportar comentarios…» está deshabilitado y «Importar comentarios…» no', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await openCommentsPanel(page);

    await page.getByRole('button', { name: MENU, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: EXPORT, exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: IMPORT, exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
  });

  test('sin pérdidas: exportar, abrir el original limpio, importar el XFDF y guardar; el panel conserva todo', async ({ page }, testInfo: TestInfo) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await createAllKinds(page);
    await openCommentsPanel(page);
    await expect(page.locator('p', { hasText: `${String(TOP_LEVEL)} comentarios` })).toBeVisible();

    // Exportar: descarga «basic-5.xfdf» sin diálogo; la lista de recientes no cambia.
    const recentsBefore = await recentNames(page);
    const download = page.waitForEvent('download');
    await chooseMenuEntry(page, EXPORT);
    const xfdf = await storeDownload(await download, testInfo, 'basic-5-comentarios.xfdf');
    expect((await download).suggestedFilename()).toBe('basic-5.xfdf');
    expect(await recentNames(page)).toEqual(recentsBefore);
    const xml = readFileSync(xfdf, 'utf8');
    expect(xml).toContain('<f href="basic-5.pdf"/>');

    // Documento original limpio en otra pestaña: importar el XFDF.
    // Sin selector nativo: la importación usa un <input type=file> y el test recibe el «filechooser».
    const fresh = await openInNewPage(page, fixture('basic-5.pdf'), () => {
      Reflect.deleteProperty(window, 'showOpenFilePicker');
    });
    await openCommentsPanel(fresh);
    await expect(commentRows(fresh)).toHaveCount(0);
    const [chooser] = await Promise.all([fresh.waitForEvent('filechooser'), chooseMenuEntry(fresh, IMPORT)]);
    await chooser.setFiles(xfdf);
    await expect(fresh.getByText(`Se han importado ${String(IMPORTED)} comentarios.`, { exact: true })).toBeVisible();

    // Mismos tipos, autor y textos; la respuesta bajo su nota y «Aceptado».
    const rows = commentRows(fresh);
    for (const kind of ['Resaltado', 'Nota', 'Texto', 'Dibujo', 'Rectángulo', 'Sello']) {
      await expect(fresh.getByRole('option', { name: optionName(`${kind} de ${AUTHOR}, página 1`) })).toHaveCount(1);
    }
    await expect(rows.filter({ hasText: REPLY })).toHaveCount(1);
    await expect(rows.filter({ hasText: NOTE_TEXT })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Aceptado' })).toHaveCount(1);
    await expect(rows.filter({ hasText: FREETEXT })).toHaveCount(1);
    await expect(fresh.locator('p', { hasText: `${String(TOP_LEVEL)} comentarios` })).toBeVisible();

    // Ctrl+S y reabrir: se conserva todo.
    const saved = await saveWithCtrlS(fresh, testInfo, 'basic-5-importado.pdf');
    const check = qpdfCheck(saved);
    expect(check.code, check.output).toBe(0);
    const reopened = await openInNewPage(page, saved);
    await openCommentsPanel(reopened);
    await expect(reopened.locator('p', { hasText: `${String(TOP_LEVEL)} comentarios` })).toBeVisible();
    await expect(commentRows(reopened).filter({ hasText: REPLY })).toHaveCount(1);
    await expect(commentRows(reopened).filter({ hasText: 'Aceptado' })).toHaveCount(1);
  });
});
