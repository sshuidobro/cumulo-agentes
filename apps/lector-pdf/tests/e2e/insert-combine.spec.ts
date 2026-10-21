import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { organizeMsg } from '../../src/ui/messages-organize.ts';
import { disableFileSystemAccess, openWithDownloads, storeDownload } from './annotations-kit.ts';
import { openOrganize, openSavedPdf, pageCell } from './organize-kit.ts';
import { fixture } from './helpers.ts';

/**
 * Insertar desde archivo y combinar archivos (PDF-128): la vista Organizar, el diálogo «Combinar archivos» desde
 * el documento y desde la pantalla de inicio. Los PDF que se descargan se leen con pdf.js en Node.
 */

const USER_PASSWORD = 'usuario';

/**
 * Sin el selector de apertura del sistema (File System Access): «Insertar» y «Combinar» usan el `<input type=file>`
 * que Playwright atiende con `filechooser`.
 */
async function useInputPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });
}

/** Próximas respuestas del selector de ficheros: `trigger` lo abre y `files` se entregan con `setFiles`. */
async function chooseFiles(page: Page, trigger: () => Promise<void>, files: readonly string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await trigger();
  await (await chooser).setFiles([...files]);
}

/** Ejecuta `action` (que dispara una descarga) y guarda la descarga: ruta y nombre sugerido. */
async function downloaded(
  page: Page,
  testInfo: TestInfo,
  action: () => Promise<void>,
  outName: string,
): Promise<{ path: string; name: string }> {
  const download = page.waitForEvent('download');
  await action();
  const file = await download;
  return { path: await storeDownload(file, testInfo, outName), name: file.suggestedFilename() };
}

/** Títulos de primer nivel del índice de un PDF (pdf.js en Node). */
async function outlineTitles(path: string): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  const doc = await task.promise;
  const outline = (await doc.getOutline()) ?? [];
  const titles = outline.map((item) => item.title);
  await task.destroy();
  return titles;
}

/** Resumen de la barra de Organizar («N páginas · …»). */
function organizeCount(page: Page, pages: number): Locator {
  return page.getByRole('toolbar', { name: organizeMsg.toolbar, exact: true }).getByText(new RegExp(`^${String(pages)} páginas`));
}

/** Botón «Guardar» de la barra de Organizar (el visor también tiene uno). */
function organizeSave(page: Page): Locator {
  return page.getByRole('toolbar', { name: organizeMsg.toolbar, exact: true }).getByRole('button', { name: organizeMsg.save, exact: true });
}

/** Filas de la lista del diálogo «Combinar archivos». */
function rowsOf(dialog: Locator): Locator {
  return dialog.getByRole('listbox').getByRole('option');
}

/** Abre «Combinar archivos…» desde «Más acciones» (con un documento abierto). */
async function openCombineFromMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click();
  await page.getByRole('menuitem', { name: organizeMsg.combine, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: organizeMsg.combineTitle, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Insertar desde archivo después de la 2.ª página, desde el menú «Insertar». */
async function insertAfterSecond(page: Page, file: string): Promise<void> {
  const grid = page.getByRole('listbox', { name: organizeMsg.title, exact: true });
  await pageCell(grid, 2).click();
  await chooseFiles(
    page,
    async () => {
      await page.getByRole('button', { name: organizeMsg.insertBlank, exact: true }).click();
      await page.getByRole('menuitem', { name: organizeMsg.fromFileAfter, exact: true }).click();
    },
    [file],
  );
}

test('basic-5.pdf: insertar outline.pdf después de la 2.ª y guardar da 35 páginas, con «Página 1 de 30» en la 3.ª', async ({ page }, testInfo) => {
  await useInputPicker(page);
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await openOrganize(page);
  await insertAfterSecond(page, fixture('outline.pdf'));
  await expect(organizeCount(page, 35)).toBeVisible();

  const { path } = await downloaded(
    page,
    testInfo,
    () => organizeSave(page).click(),
    'insertado.pdf',
  );
  const saved = await openSavedPdf(path);
  expect(saved.numPages).toBe(35);
  expect(await saved.textOf(3)).toContain('Página 1 de 30');
  await saved.close();
});

test('encrypted-aes-256.pdf: insertar pide la contraseña; cancelar no inserta y con «usuario» inserta sus 5 páginas', async ({ page }) => {
  await useInputPicker(page);
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await openOrganize(page);

  await insertAfterSecond(page, fixture('encrypted-aes-256.pdf'));
  const prompt = page.getByRole('dialog', { name: 'Contraseña necesaria', exact: true });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(prompt).toBeHidden();
  await expect(organizeCount(page, 5)).toBeVisible();

  await insertAfterSecond(page, fixture('encrypted-aes-256.pdf'));
  await expect(prompt).toBeVisible();
  const field = prompt.getByRole('textbox', { name: 'Contraseña', exact: true });
  await field.fill(USER_PASSWORD);
  await field.press('Enter');
  await expect(prompt).toBeHidden();
  await expect(organizeCount(page, 10)).toBeVisible();
});

test('Ctrl+Z tras insertar quita las páginas insertadas', async ({ page }) => {
  await useInputPicker(page);
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await openOrganize(page);
  await insertAfterSecond(page, fixture('outline.pdf'));
  await expect(organizeCount(page, 35)).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(organizeCount(page, 5)).toBeVisible();
});

test('basic-5.pdf abierto + outline.pdf: combinar guarda un PDF de 35 páginas con las ramas «basic-5» y «outline»', async ({ page }, testInfo) => {
  await useInputPicker(page);
  await openWithDownloads(page, fixture('basic-5.pdf'));
  const dialog = await openCombineFromMenu(page);
  await expect(rowsOf(dialog)).toHaveCount(1);
  await chooseFiles(page, () => dialog.getByRole('button', { name: organizeMsg.addFiles, exact: true }).click(), [fixture('outline.pdf')]);
  await expect(rowsOf(dialog)).toHaveCount(2);

  const { path, name } = await downloaded(
    page,
    testInfo,
    () => dialog.getByRole('button', { name: organizeMsg.combineAction, exact: true }).click(),
    'combinado.pdf',
  );
  expect(name).toBe('basic-5-combinado.pdf');
  expect(await outlineTitles(path)).toEqual(['basic-5', 'outline']);
  const saved = await openSavedPdf(path);
  expect(saved.numPages).toBe(35);
  await saved.close();
});

test('desde la pantalla de inicio, combinar con «Bajar» conserva el orden de la lista en el resultado', async ({ page }, testInfo) => {
  await useInputPicker(page);
  await disableFileSystemAccess(page);
  await page.goto('/');
  await page.getByRole('button', { name: organizeMsg.combine, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: organizeMsg.combineTitle, exact: true });
  await expect(dialog).toBeVisible();
  await chooseFiles(
    page,
    () => dialog.getByRole('button', { name: organizeMsg.addFiles, exact: true }).click(),
    [fixture('basic-5.pdf'), fixture('outline.pdf')],
  );
  await expect(rowsOf(dialog)).toHaveCount(2);
  await dialog.getByRole('button', { name: `${organizeMsg.moveDown} basic-5.pdf`, exact: true }).click();

  const { path, name } = await downloaded(
    page,
    testInfo,
    () => dialog.getByRole('button', { name: organizeMsg.combineAction, exact: true }).click(),
    'combinado.pdf',
  );
  expect(name).toBe('outline-combinado.pdf');
  expect(await outlineTitles(path)).toEqual(['outline', 'basic-5']);
});

const A11Y_THEMES = [
  { theme: 'claro', scheme: 'light' },
  { theme: 'oscuro', scheme: 'dark' },
] as const;

for (const { theme, scheme } of A11Y_THEMES) {
  test.describe(`accesibilidad, tema ${theme}`, () => {
    test.use({ colorScheme: scheme });

    test('diálogo «Combinar archivos» y vista Organizar con PDF importado: axe sin violaciones y lista operable con teclado', async ({ page }) => {
      await useInputPicker(page);
      await openWithDownloads(page, fixture('basic-5.pdf'));
      const dialog = await openCombineFromMenu(page);
      await chooseFiles(page, () => dialog.getByRole('button', { name: organizeMsg.addFiles, exact: true }).click(), [fixture('outline.pdf')]);
      await expect(rowsOf(dialog)).toHaveCount(2);
      expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
      const dialogAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(dialogAxe.violations.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help} (${String(v.nodes.length)} nodos)`)).toEqual([]);

      // Con el foco en la primera fila, Alt+↓ la baja (sin ratón).
      await rowsOf(dialog).first().focus();
      await page.keyboard.press('Alt+ArrowDown');
      await expect(rowsOf(dialog).nth(1)).toHaveAttribute('aria-selected', 'false');
      await expect(rowsOf(dialog).nth(1)).toBeFocused();
      await expect(rowsOf(dialog).nth(1)).toContainText('basic-5.pdf');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await openOrganize(page);
      await insertAfterSecond(page, fixture('outline.pdf'));
      await expect(organizeCount(page, 35)).toBeVisible();
      const viewAxe = await new AxeBuilder({ page }).include('[role="listbox"][aria-label="Organizar páginas"]').analyze();
      expect(viewAxe.violations.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help} (${String(v.nodes.length)} nodos)`)).toEqual([]);
    });
  });
}

