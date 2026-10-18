import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { msg } from '../../src/ui/messages.ts';
import { CORPUS_DIR } from '../fixtures/paths.ts';
import { fixture, goToPageByKeyboard } from './helpers.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import {
  commentRows,
  createNoteWithText,
  openCommentsPanel,
  openWithDownloads,
  openInNewPage,
  saveWithCtrlS,
  zoneOf,
} from './annotations-kit.ts';
import { liveAnnotations } from './annotations-live.ts';

/**
 * Anotaciones escritas por otros programas (PDF-024, PDF-029): se ven, se listan y sobreviven a un guardado
 * con una nota nueva. Las del tipo no editable (Square, Link) se comprueban con qpdf tras guardar.
 */

const NOTE_TEXT = 'Nota añadida a un PDF ajeno';
const EXTERNAL_URL = 'https://example.org/';

/** Stub de `window.open` antes de cargar la app: cada llamada queda en `window.__opened`. */
function stubWindowOpen(): void {
  (window as unknown as { __opened: unknown[][] }).__opened = [];
  window.open = (...args: unknown[]) => {
    (window as unknown as { __opened: unknown[][] }).__opened.push(args);
    return null;
  };
}

async function openedCalls(page: Page): Promise<unknown[][]> {
  return page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened);
}

test('annotated.pdf: las seis anotaciones ajenas se listan; una nota nueva y guardar conserva Square y Link, y el enlace funciona', async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, fixture('annotated.pdf'));
  await openCommentsPanel(page);
  await expect(page.locator('p', { hasText: '6 comentarios' })).toBeVisible();
  await expect(commentRows(page)).toHaveCount(6);
  await expect(zoneOf(page, 1, 'Resaltado de Otra persona')).toHaveCount(1);

  await createNoteWithText(page, NOTE_TEXT);
  await expect(page.locator('p', { hasText: '7 comentarios' })).toBeVisible();

  const saved = await saveWithCtrlS(page, testInfo, 'annotated-con-nota.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);

  const live = liveAnnotations(saved).map((a) => a.subtype);
  expect(live).toContain('Square');
  expect(live).toContain('Link');
  expect(live).toContain('Highlight');
  expect(live.filter((s) => s === 'Text')).toHaveLength(2);

  // El enlace del fichero guardado sigue pidiendo confirmación y abre su URL.
  const reopened = await openInNewPage(page, saved, stubWindowOpen);
  // El enlace está en la página 3 de 3: se lleva al visor antes de pulsarlo.
  await goToPageByKeyboard(reopened, 3, 3);
  await reopened.getByRole('link', { name: EXTERNAL_URL }).click();
  const dialog = reopened.getByRole('dialog', { name: msg.confirmExternalTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: msg.openLink }).click();
  await expect.poll(() => openedCalls(reopened)).toEqual([[EXTERNAL_URL, '_blank', 'noopener,noreferrer']]);
});

test('corpus veraPDF 7.18.1-t02-pass-a.pdf: el resaltado y su Popup de otro productor se ven y se listan; guardar con una nota los conserva', async ({
  page,
}, testInfo) => {
  await openWithDownloads(page, join(CORPUS_DIR, 'verapdf', '7.18.1-t02-pass-a.pdf'));
  await openCommentsPanel(page);
  await expect(commentRows(page)).not.toHaveCount(0);
  await expect(zoneOf(page, 1, 'Resaltado de')).toHaveCount(1);

  await createNoteWithText(page, NOTE_TEXT);

  const saved = await saveWithCtrlS(page, testInfo, 'verapdf-con-nota.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);

  const live = liveAnnotations(saved).map((a) => a.subtype);
  expect(live).toContain('Highlight');
  expect(live).toContain('Popup');
  expect(live).toContain('Text');

  const reopened = await openInNewPage(page, saved);
  await openCommentsPanel(reopened);
  await expect(zoneOf(reopened, 1, 'Resaltado de')).toHaveCount(1);
  await expect(commentRows(reopened).filter({ hasText: NOTE_TEXT })).toHaveCount(1);
});
