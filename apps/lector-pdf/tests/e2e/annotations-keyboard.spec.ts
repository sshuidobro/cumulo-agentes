import { expect, test, type Locator, type Page } from '@playwright/test';
import { pageField, pageFrame } from './helpers.ts';
import {
  commentDialog,
  commentField,
  commentRows,
  openFixtureWithDownloads,
  optionName,
  zoneOf,
} from './annotations-kit.ts';

/**
 * Anotaciones solo con teclado (PDF-039): la barra «Comentar» se abre y se recorre con flechas sin cambiar de página
 * (PDF-071); el resaltado se crea con Ctrl+A e Intro; la nota se crea con Intro en «Nota» (PDF-072); el panel se
 * recorre con flechas y las filas se borran con Supr. Ningún paso usa el ratón.
 */

/** Abre la barra «Comentar» con el conmutador enfocado y Intro (si no estaba abierta). */
async function openBarByKeyboard(page: Page): Promise<Locator> {
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  if ((await bar.count()) === 0) {
    await page.getByRole('button', { name: 'Comentar', exact: true }).focus();
    await page.keyboard.press('Enter');
  }
  await expect(bar).toBeVisible();
  return bar;
}

/** Abre el panel lateral en «Comentarios» con F4 (si hace falta), el foco en la pestaña y Intro. */
async function openCommentsPanelByKeyboard(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Comentarios' });
  if (!(await tab.isVisible())) await page.keyboard.press('F4');
  await tab.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Comentarios del documento' })).toBeVisible();
}

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

test('resaltar, crear una nota, navegar y borrar solo con el teclado', async ({ page }) => {
  await openFixtureWithDownloads(page, 'basic-5.pdf');
  const bar = await openBarByKeyboard(page);

  // Las flechas recorren la barra y no cambian de página (PDF-071).
  await bar.getByRole('button', { name: 'Resaltar', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Subrayar', exact: true })).toBeFocused();
  await expect(pageField(page)).toHaveValue('1');
  await page.keyboard.press('ArrowLeft');
  await expect(bar.getByRole('button', { name: 'Resaltar', exact: true })).toBeFocused();
  await expect(pageField(page)).toHaveValue('1');

  // Resaltado: Ctrl+A selecciona el texto y «Resaltar» (Intro) lo marca.
  await page.keyboard.press('Control+a');
  await bar.getByRole('button', { name: 'Resaltar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(zoneOf(page, 1, 'Resaltado de')).toHaveCount(1);

  // Nota: Intro en «Nota» la crea en la página actual y abre su ventana con el foco en el texto (PDF-072).
  await bar.getByRole('button', { name: 'Nota', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(commentDialog(page)).toBeVisible();
  await expect(commentField(page)).toBeFocused();
  await page.keyboard.type('Nota solo con teclado');
  await page.keyboard.press('Escape');
  await expect(commentDialog(page)).toHaveCount(0);
  await expect(zoneNamed(page, 'Nota de Usuario')).toBeFocused();

  // Las flechas mueven la nota seleccionada (hacia la derecha, su caja crece en x).
  const noteBefore = await zoneNamed(page, 'Nota de Usuario').boundingBox();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await zoneNamed(page, 'Nota de Usuario').boundingBox())?.x ?? 0).toBeGreaterThan(noteBefore?.x ?? Infinity);
  await expect(zoneNamed(page, 'Nota de Usuario')).toBeFocused();

  // Panel con flechas: dos filas. Intro abre la ventana de la nota; Esc la cierra; Supr borra la anotación.
  await openCommentsPanelByKeyboard(page);
  await expect(commentRows(page)).toHaveCount(2);
  const note = 'Nota de Usuario, página 1';
  const highlight = 'Resaltado de Usuario, página 1';
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
