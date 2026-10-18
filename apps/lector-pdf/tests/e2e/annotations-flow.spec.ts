import { expect, test, type Page } from '@playwright/test';
import { pageFrame } from './helpers.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import { liveAnnotations } from './annotations-live.ts';
import {
  AUTHOR,
  commentDialog,
  commentField,
  commentRows,
  dragOverLine,
  optionName,
  drawStroke,
  createNoteWithText,
  openCommentsPanel,
  openFixtureWithDownloads,
  openInNewPage,
  pickTool,
  saveWithCtrlS,
  visiblePart,
  wordBox,
  zigzagFrom,
  zoneOf,
} from './annotations-kit.ts';

/**
 * Flujo completo de anotaciones (PDF-039): subrayar y hacer notas, guardar dentro del PDF y volver a verlas.
 * Cada guardado descarga el PDF; se valida con qpdf y se reabre en una pestaña nueva con la app.
 */

const HIGHLIGHT_COMMENT = 'Revisar la cifra del resaltado';
const NOTE_TEXT = 'Revisar esta cifra';
const NOTE_EDITED = 'Cifra revisada';
const FREETEXT = 'Texto libre de prueba';

/** Filas del panel con su nombre accesible completo (tipo y autor, página). */
const SIX_ROWS = [
  `Resaltado de ${AUTHOR}, página 1`,
  `Subrayado de ${AUTHOR}, página 1`,
  `Tachado de ${AUTHOR}, página 1`,
  `Nota de ${AUTHOR}, página 1`,
  `Texto de ${AUTHOR}, página 1`,
  `Dibujo de ${AUTHOR}, página 1`,
] as const;

/** Subtipos de anotación que debe escribir el guardado (el comentario de las marcas y de la nota añade Popup). */
const EXPECTED_SUBTYPES = ['FreeText', 'Highlight', 'Ink', 'Popup', 'StrikeOut', 'Text', 'Underline'];

/** Subtipos distintos de un fichero, ordenados. */
function subtypesOf(path: string): string[] {
  return [...new Set(liveAnnotations(path).map((a) => a.subtype))].sort();
}

/** Crea en la página 1 las seis anotaciones del flujo (resaltado, subrayado, tachado, nota, texto y dibujo). */
async function createSixAnnotations(page: Page): Promise<void> {
  // Resaltado: doble clic en una palabra, barra de la selección, «Resaltar».
  const word = await wordBox(page, 1, 'murciélago');
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, 1, 'Resaltado de')).toHaveCount(1);

  // Comentario en el resaltado: doble clic en su zona y texto en la ventana.
  await zoneOf(page, 1, 'Resaltado de').dblclick();
  await expect(commentDialog(page)).toBeVisible();
  await commentField(page).fill(HIGHLIGHT_COMMENT);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(commentDialog(page)).toHaveCount(0);

  // Subrayado y tachado: herramienta activa y arrastre sobre una línea distinta cada uno.
  await pickTool(page, 'Subrayar');
  await dragOverLine(page, 2);
  await expect(zoneOf(page, 1, 'Subrayado de')).toHaveCount(1);
  await pickTool(page, 'Tachar');
  await dragOverLine(page, 1);
  await expect(zoneOf(page, 1, 'Tachado de')).toHaveCount(1);

  // Nota con texto (la herramienta vuelve a «ninguna» tras crearla).
  await createNoteWithText(page, NOTE_TEXT);
  await expect(zoneOf(page, 1, 'Nota de')).toHaveCount(1);

  // Texto libre: clic, teclear y Esc.
  await pickTool(page, 'Texto');
  await pageFrame(page, 1).click({ position: { x: 150, y: 420 } });
  await page.keyboard.type(FREETEXT);
  await page.keyboard.press('Escape');
  await expect(zoneOf(page, 1, 'Texto de')).toHaveCount(1);

  // Dibujo a mano: un zigzag en la parte visible de la página.
  await pickTool(page, 'Dibujar');
  const part = await visiblePart(page, 1);
  await drawStroke(page, zigzagFrom({ x: part.x + part.width * 0.25, y: part.y + part.height * 0.5 }, 40));
  await expect(zoneOf(page, 1, 'Dibujo de')).toHaveCount(1);
}

test('subrayar y hacer notas, deshacer y rehacer, guardar, validar con qpdf y reabrir con los cambios', async ({ page }, testInfo) => {
  await openFixtureWithDownloads(page, 'basic-5.pdf');
  await createSixAnnotations(page);

  // El panel refleja las seis anotaciones.
  await openCommentsPanel(page);
  await expect(page.locator('p', { hasText: '6 comentarios' })).toBeVisible();
  for (const name of SIX_ROWS) {
    await expect(page.getByRole('option', { name: optionName(name) })).toHaveCount(1);
  }

  // Deshacer dos veces (quita el dibujo y el texto libre) y rehacer dos veces; el panel lo confirma.
  const rows = commentRows(page);
  const list = page.getByRole('listbox', { name: 'Comentarios del documento' });
  await list.focus();
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(5);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole('option', { name: optionName(`Dibujo de ${AUTHOR}, página 1`) })).toHaveCount(0);
  await expect(page.getByRole('option', { name: optionName(`Texto de ${AUTHOR}, página 1`) })).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(rows).toHaveCount(5);
  await page.keyboard.press('Control+y');
  await expect(rows).toHaveCount(6);

  // Guardar (Ctrl+S) descarga el PDF con las anotaciones dentro.
  const first = await saveWithCtrlS(page, testInfo, 'basic-5-anotado.pdf');
  const check = qpdfCheck(first);
  expect(check.code, check.output).toBe(0);
  expect(subtypesOf(first)).toEqual(EXPECTED_SUBTYPES);
  expect(liveAnnotations(first).filter((a) => a.subtype !== 'Popup')).toHaveLength(6);

  // Reabrir el guardado: seis elementos, comentarios y autor correctos.
  const reopened = await openInNewPage(page, first);
  await openCommentsPanel(reopened);
  await expect(reopened.locator('p', { hasText: '6 comentarios' })).toBeVisible();
  for (const name of SIX_ROWS) {
    await expect(reopened.getByRole('option', { name: optionName(name) })).toHaveCount(1);
  }
  await expect(commentRows(reopened).filter({ hasText: HIGHLIGHT_COMMENT })).toHaveCount(1);
  await expect(commentRows(reopened).filter({ hasText: NOTE_TEXT })).toHaveCount(1);

  // Editar el comentario de la nota, borrar el dibujo y guardar de nuevo.
  await zoneOf(reopened, 1, 'Nota de').dblclick();
  await expect(commentDialog(reopened)).toBeVisible();
  await commentField(reopened).fill(NOTE_EDITED);
  await reopened.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(commentDialog(reopened)).toHaveCount(0);

  const ink = zoneOf(reopened, 1, 'Dibujo de');
  await ink.click();
  await ink.focus();
  await reopened.keyboard.press('Delete');
  await expect(ink).toHaveCount(0);

  const second = await saveWithCtrlS(reopened, testInfo, 'basic-5-revisado.pdf');
  const recheck = qpdfCheck(second);
  expect(recheck.code, recheck.output).toBe(0);
  expect(liveAnnotations(second).filter((a) => a.subtype === 'Ink')).toHaveLength(0);

  // Abrir la segunda versión: la nota tiene el texto editado y el dibujo ya no está.
  const final = await openInNewPage(reopened, second);
  await openCommentsPanel(final);
  await expect(final.locator('p', { hasText: '5 comentarios' })).toBeVisible();
  await expect(final.getByRole('option', { name: optionName(`Dibujo de ${AUTHOR}, página 1`) })).toHaveCount(0);
  await expect(commentRows(final).filter({ hasText: NOTE_EDITED })).toHaveCount(1);
  await expect(commentRows(final).filter({ hasText: NOTE_TEXT })).toHaveCount(0);
});
