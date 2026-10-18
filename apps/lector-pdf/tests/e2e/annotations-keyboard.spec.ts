import { expect, test, type Locator, type Page } from '@playwright/test';
import { pageFrame } from './helpers.ts';
import {
  commentDialog,
  commentRows,
  openCommentBar,
  openCommentsPanel,
  openFixtureWithDownloads,
  optionName,
  zoneOf,
} from './annotations-kit.ts';

/**
 * Anotaciones solo con teclado (PDF-039): resaltado con Ctrl+A e Intro en la barra «Comentar»; navegación desde el
 * panel con flechas y borrado con Supr.
 *
 * Limitaciones documentadas en el Registro de PDF-039 (no se resuelven aquí):
 * - Colocar una nota exige un clic en la página (`createNoteAt` solo responde al puntero): el paso de la nota
 *   activa «Nota» con teclado y coloca con el ratón.
 * - Las flechas dentro de la barra «Comentar» también cambian de página (el atajo global de la página actúa a la
 *   vez): la barra se recorre por foco directo, no con ←→.
 */

/** Texto de la fila activa del panel (la del foco de teclado, `aria-activedescendant`), o `''` si no hay. */
async function activeRowText(list: Locator): Promise<string> {
  return list.evaluate((el) => {
    const id = el.getAttribute('aria-activedescendant');
    return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
  });
}

/** Pulsa ↓ en el panel hasta que la fila `name` es la activa (la lista no garantiza el orden de creación). */
async function selectRowByKeyboard(page: Page, name: string): Promise<void> {
  const list = page.getByRole('listbox', { name: 'Comentarios del documento' });
  await list.focus();
  const total = await commentRows(page).count();
  for (let i = 0; i <= total; i++) {
    if (optionName(name).test(await activeRowText(list))) return;
    await page.keyboard.press('ArrowDown');
  }
  await expect.poll(() => activeRowText(list)).toMatch(optionName(name));
}

/** Zona de anotación de la página 1 con su nombre accesible (prefijo: el nombre puede añadir el texto de la anotación). */
function zoneNamed(page: Page, name: string): Locator {
  return pageFrame(page, 1).locator(`[role="button"][aria-label^="${name}"]`);
}

test('resaltar todo el texto y crear una nota solo con la barra «Comentar», después navegar y borrar con el panel', async ({
  page,
}) => {
  await openFixtureWithDownloads(page, 'basic-5.pdf');
  const bar = await openCommentBar(page);

  // Resaltado con teclado: Ctrl+A selecciona el texto y «Resaltar» (Intro) lo marca.
  await page.keyboard.press('Control+a');
  await bar.getByRole('button', { name: 'Resaltar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(zoneOf(page, 1, 'Resaltado de')).toHaveCount(1);

  // Nota: se enfoca el botón y se activa con Intro; la página la recibe con un clic (ver la nota de cabecera).
  await bar.getByRole('button', { name: 'Nota', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(bar.getByRole('button', { name: 'Nota', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pageFrame(page, 1)).toBeVisible();
  await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
  await expect(commentDialog(page)).toBeVisible();
  await page.keyboard.type('Nota solo con teclado');
  await page.keyboard.press('Escape');
  await expect(commentDialog(page)).toHaveCount(0);

  // Panel con flechas: dos filas. Intro abre la ventana de la nota; Esc devuelve el foco a su zona; Supr la borra.
  await openCommentsPanel(page);
  await expect(commentRows(page)).toHaveCount(2);
  const note = `Nota de Usuario, página 1`;
  const highlight = `Resaltado de Usuario, página 1`;
  const noteZone = 'Nota de Usuario';
  const highlightZone = 'Resaltado de Usuario';

  await selectRowByKeyboard(page, note);
  await page.keyboard.press('Enter');
  await expect(commentDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commentDialog(page)).toHaveCount(0);
  await zoneNamed(page, noteZone).focus();
  await page.keyboard.press('Delete');
  await expect(zoneNamed(page, noteZone)).toHaveCount(0);
  await expect(commentRows(page)).toHaveCount(1);

  // Lo mismo con el resaltado: la fila queda como la única y su borrado vacía el panel.
  await selectRowByKeyboard(page, highlight);
  await page.keyboard.press('Enter');
  await expect(commentDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commentDialog(page)).toHaveCount(0);
  await zoneNamed(page, highlightZone).focus();
  await page.keyboard.press('Delete');
  await expect(commentRows(page)).toHaveCount(0);
});
