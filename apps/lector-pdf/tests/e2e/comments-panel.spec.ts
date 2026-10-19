import { expect, test, type Page } from '@playwright/test';
import { fixture, openFixture, pageFrame } from './helpers.ts';
import { commentDialog, commentRows, createNoteWithText, openCommentsPanel, zoneOf } from './annotations-kit.ts';

/** Abre el panel lateral (F4) si hace falta y elige la pestaña «Comentarios». */
async function openCommentsTab(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Comentarios' });
  if (!(await tab.isVisible())) await page.keyboard.press('F4');
  await tab.click();
  await expect(page.getByRole('listbox', { name: 'Comentarios del documento' })).toBeVisible();
}

/** Filas de comentario (solo las de la lista del panel). */
function comments(page: Page) {
  return page.getByRole('listbox', { name: 'Comentarios del documento' }).getByRole('option');
}

test.describe('panel de comentarios (PDF-036)', () => {
  test('annotated.pdf: 6 comentarios; clic en «Nota previa» lleva a la página 2 con su ventana abierta; borrar el resaltado lo quita de la lista y de la página', async ({ page }) => {
    await openFixture(page, 'annotated.pdf');
    await openCommentsTab(page);

    await expect(page.locator('p', { hasText: '6 comentarios' })).toBeVisible();
    await expect(comments(page)).toHaveCount(6);

    // Clic en la nota: navega a la página 2 y abre su comentario.
    await comments(page).filter({ hasText: 'Nota previa' }).click();
    await expect(pageFrame(page, 2)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Comentario de Otra persona' })).toBeVisible();

    // Borrar el resaltado desde el panel.
    const highlight = comments(page).filter({ hasText: 'Comentario previo' });
    await highlight.getByTestId('comment-row-delete').click();
    await expect(comments(page)).toHaveCount(5);
    await expect(page.locator('[data-annot-id="ref:9R"]')).toHaveCount(0);
  });

  test('pages-100000.pdf: aviso de documento grande; el botón inicia el escaneo con progreso y se puede cancelar', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid=open-input]').setInputFiles(fixture('pages-100000.pdf'));
    await expect(page.getByTestId('viewer')).toBeVisible();
    await openCommentsTab(page);

    await expect(page.getByText('Documento muy grande: se muestran los comentarios de las páginas visitadas.')).toBeVisible();
    await page.getByRole('button', { name: 'Buscar en todo el documento' }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText('Cargando comentarios');
    await expect(status).toContainText('de 100.000 páginas');
    await page.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.getByRole('button', { name: 'Buscar en todo el documento' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});

test.describe('respuestas y estados en el panel (PDF-116)', () => {
  test('nota con respuesta y Aceptado: el panel muestra la respuesta sangrada y «Aceptado»; filtrar por «Rechazado» la oculta', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await createNoteWithText(page, 'Revisar esta cifra');

    await zoneOf(page, 1, 'Nota de').dblclick();
    const dialog = commentDialog(page);
    await dialog.getByRole('textbox', { name: 'Escribe una respuesta' }).fill('Primera respuesta');
    await dialog.getByRole('button', { name: 'Responder', exact: true }).click();
    await dialog.getByRole('button', { name: 'Estado', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Aceptado', exact: true }).click();
    await expect(dialog.getByText('Estado: Aceptado')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await openCommentsPanel(page);
    await expect(commentRows(page)).toHaveCount(2);
    await expect(commentRows(page).nth(0)).toContainText('Aceptado');
    await expect(commentRows(page).nth(1)).toContainText('Primera respuesta');

    await page.getByRole('button', { name: 'Filtrar' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Rechazado' }).click();
    await expect(commentRows(page)).toHaveCount(0);
    await expect(page.getByText('Ningún comentario coincide con el filtro.')).toBeVisible();
  });
});
