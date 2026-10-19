import { expect, test } from '@playwright/test';
import { pageFrame, fixture } from './helpers.ts';
import { qpdfCheck, qpdfObjects, type QpdfObjects } from '../support/qpdf.ts';
import {
  commentDialog,
  createNoteWithText,
  openInNewPage,
  openWithDownloads,
  saveWithCtrlS,
  zoneOf,
} from './annotations-kit.ts';

/**
 * Respuestas y estados de revisión desde la ventana de la nota (PDF-109, ADR-0030): se escriben como `/Text` con
 * `/IRT` a la nota (`/RT /R` y `/F 28` para las respuestas; `/State`, `/StateModel` y `/F 30` para el estado).
 */

const NOTE_TEXT = 'Revisar esta cifra';
const FIRST = 'Primera respuesta';
const SECOND = 'Segunda respuesta';

/** Diccionarios de anotación del fichero con su referencia (`"n g R"`). Las cadenas de qpdf llevan prefijo «u:». */
function annotDicts(path: string): { ref: string; dict: Record<string, unknown> }[] {
  const out: { ref: string; dict: Record<string, unknown> }[] = [];
  const objects: QpdfObjects = qpdfObjects(path);
  for (const [key, object] of Object.entries(objects)) {
    const value: unknown = object.value;
    if (typeof value !== 'object' || value === null || !('/Type' in value)) continue;
    if ((value as Record<string, unknown>)['/Type'] !== '/Annot') continue;
    out.push({ ref: key.replace(/^obj:/, ''), dict: value as Record<string, unknown> });
  }
  return out;
}

/** Valor de texto de qpdf (sin el prefijo «u:» de las cadenas Unicode). */
function text(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/^u:/, '') : value;
}

test('nota con dos respuestas y Aceptado: se guarda, se reabre y no crea iconos en la pagina', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await createNoteWithText(page, NOTE_TEXT);
  const zonesBefore = await pageFrame(page, 1).locator('[data-annot-id]').count();

  await zoneOf(page, 1, 'Nota de').dblclick();
  const dialog = commentDialog(page);
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('textbox', { name: 'Escribe una respuesta' });
  await field.fill(FIRST);
  await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
  await field.fill(SECOND);
  await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Respuestas' }).getByRole('listitem')).toHaveCount(2);
  await expect(pageFrame(page, 1).locator('[data-annot-id]')).toHaveCount(zonesBefore);

  await dialog.getByRole('button', { name: 'Estado', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Aceptado', exact: true }).click();
  await expect(dialog.getByText('Estado: Aceptado')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const saved = await saveWithCtrlS(page, testInfo, 'basic-5-respuestas.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);

  const reopened = await openInNewPage(page, saved);
  await zoneOf(reopened, 1, 'Nota de').dblclick();
  await expect(commentDialog(reopened)).toBeVisible();
  const items = reopened.getByRole('list', { name: 'Respuestas' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(FIRST);
  await expect(items.nth(1)).toContainText(SECOND);
  await expect(commentDialog(reopened).getByText('Estado: Aceptado')).toBeVisible();
  await expect(pageFrame(reopened, 1).locator('[data-annot-id]')).toHaveCount(zonesBefore);

  // Oráculo independiente (qpdf): las respuestas cuelgan de la nota y el estado es oculto (/F 30).
  const dicts = annotDicts(saved);
  const note = dicts.find((a) => text(a.dict['/Contents']) === NOTE_TEXT);
  if (note === undefined) throw new Error('no se encuentra la nota en el fichero guardado');
  const replies = dicts.filter((a) => a.dict['/IRT'] === note.ref && a.dict['/RT'] === '/R');
  expect(replies.map((a) => text(a.dict['/Contents']))).toEqual([FIRST, SECOND]);
  for (const reply of replies) expect(reply.dict['/F']).toBe(28);
  const states = dicts.filter((a) => a.dict['/IRT'] === note.ref && a.dict['/StateModel'] !== undefined);
  expect(states).toHaveLength(1);
  expect(text(states[0]?.dict['/State'])).toBe('Accepted');
  expect(states[0]?.dict['/F']).toBe(30);
});
