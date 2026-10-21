import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { editMsg } from '../../src/ui/messages-edit.ts';
import { editTextMsg } from '../../src/ui/messages-edit-text.ts';
import { openWithDownloads, storeDownload, wordBox } from './annotations-kit.ts';
import { fixture, waitPageRendered } from './helpers.ts';

const ORIGINAL = 'Texto de búsqueda en la página dos.';
const NEW_TEXT = 'Texto de búsqueda en la hoja dos.';

/** Texto de todas las páginas, con `pdftotext` (sobre el fichero descargado). */
function pdfText(path: string): string {
  return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
}

/** Pulsa «Editar» y «Editar texto» con el ratón; devuelve la barra «Editar». */
async function activateEditText(page: Page) {
  await page.getByRole('button', { name: editMsg.editButton, exact: true }).click();
  const bar = page.getByRole('toolbar', { name: editMsg.editButton });
  await bar.getByRole('button', { name: editTextMsg.tool, exact: true }).click();
  await expect(bar.getByRole('button', { name: editTextMsg.tool, exact: true })).toHaveAttribute('aria-pressed', 'true');
  return bar;
}

/** Doble clic sobre la palabra `word` de la página `n`. */
async function doubleClickWord(page: Page, n: number, word: string): Promise<void> {
  // La palabra puede quedar fuera de la ventana: se lleva al centro del visor antes de medir su caja.
  await page.evaluate(
    ({ index, text }) => {
      const layer = document.querySelector(`[data-testid=viewer] [data-page-index="${String(index)}"] .textLayer`);
      const walker = document.createTreeWalker(layer ?? document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? '').includes(text)) {
          node.parentElement?.scrollIntoView({ block: 'center' });
          return;
        }
      }
    },
    { index: n - 1, text: word },
  );
  const box = await wordBox(page, n, word);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

/** Cuadro de edición de la página 2 (nombre accesible del `input`). */
function editor(page: Page) {
  return page.getByRole('textbox', { name: editTextMsg.editorLabel(2), exact: true });
}

test.describe('editar texto en basic-5.pdf (PDF-147)', () => {
  test('criterio original: doble clic, corregir la línea, guardar y comprobar con pdftotext', async ({ page }, testInfo) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await activateEditText(page);

    await doubleClickWord(page, 2, 'búsqueda');
    await expect(editor(page)).toHaveValue(ORIGINAL);
    await editor(page).fill(NEW_TEXT);
    await editor(page).press('Enter');
    await expect(page.getByRole('button', { name: editTextMsg.editBoxLabel(2, NEW_TEXT), exact: true })).toBeVisible();

    const downloaded = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: editTextMsg.save, exact: true }).click();
    const copy = await storeDownload(await downloaded, testInfo, 'texto-editado.pdf');

    const text = pdfText(copy);
    expect(text).toContain('la hoja dos');
    expect(text).not.toContain('la página dos');
    expect(text).toContain('Página 2 de 5');
    expect(text).toContain('marcador-2');
  });

  test('Escape no crea edición; Ctrl+Z quita la edición y Ctrl+Y la repone', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await activateEditText(page);

    await doubleClickWord(page, 2, 'búsqueda');
    await expect(editor(page)).toBeFocused();
    await editor(page).press('Escape');
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: editTextMsg.edited(1) })).toHaveCount(0);

    await doubleClickWord(page, 2, 'búsqueda');
    await editor(page).fill(NEW_TEXT);
    await editor(page).press('Enter');
    await expect(page.getByText(editTextMsg.edited(1), { exact: true })).toBeVisible();

    await page.locator('[data-testid=viewer]').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Control+z');
    await expect(page.getByText(editTextMsg.edited(1), { exact: true })).toHaveCount(0);

    await page.keyboard.press('Control+y');
    await expect(page.getByText(editTextMsg.edited(1), { exact: true })).toBeVisible();
  });

  test('«Cancelar» en la confirmación no cambia el fichero y deja las ediciones', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await activateEditText(page);
    await doubleClickWord(page, 2, 'búsqueda');
    await editor(page).fill(NEW_TEXT);
    await editor(page).press('Enter');

    await page.keyboard.press('Control+s');
    await page.getByRole('dialog').getByRole('button', { name: editTextMsg.cancel, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(editTextMsg.edited(1), { exact: true })).toBeVisible();
  });

  test('con ediciones sin guardar, cerrar la pestaña pide confirmación', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await activateEditText(page);
    await doubleClickWord(page, 2, 'búsqueda');
    await editor(page).fill(NEW_TEXT);
    await editor(page).press('Enter');

    await page.keyboard.press('Control+w');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('escribir un emoji muestra el aviso y Enter no cierra el cuadro', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await activateEditText(page);
    await doubleClickWord(page, 2, 'búsqueda');

    await editor(page).fill('Feliz 😀');
    await editor(page).press('Enter');
    await expect(page.getByRole('alert')).toHaveText(editTextMsg.unsupportedChar('😀'));
    await expect(editor(page)).toBeVisible();
  });

  test('F2 con un resultado de búsqueda abre el cuadro de su línea', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await page.keyboard.press('Control+f');
    const field = page.getByRole('searchbox', { name: 'Buscar en el documento' });
    await expect(field).toBeFocused();
    await field.fill('Texto de búsqueda en la página dos');
    await expect(page.getByText('1 de 1', { exact: true })).toBeVisible();
    // F2 no llega desde el campo de búsqueda (es editable): se pasa el foco al visor.
    await page.locator('[data-testid=viewer]').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('F2');
    await expect(editor(page)).toHaveValue(ORIGINAL);
  });

  test('axe sin violaciones con la herramienta activa y el cuadro abierto', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await activateEditText(page);
    await doubleClickWord(page, 2, 'búsqueda');
    await expect(editor(page)).toBeVisible();
    await waitPageRendered(page, 2);

    const results = await new AxeBuilder({ page }).analyze();
    // Las dos reglas de página («un único h1» y «regiones») describen la estructura de la aplicación, no la herramienta:
    // se excluyen aquí y se siguen midiendo en las demás pruebas de accesibilidad. Cualquier otra violación cuenta.
    const APP_SHELL_RULES = ['page-has-heading-one', 'region'];
    const own = results.violations.filter((v) => !APP_SHELL_RULES.includes(v.id));
    expect(own.map((v) => `${v.id} (${String(v.nodes.length)})`)).toEqual([]);
  });
});
