import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { msg } from '../../src/ui/messages.ts';
import { tabsMsg } from '../../src/ui/messages-tabs.ts';
import { expectViewerReady } from './viewer-ready.ts';
import { fixture, goToPageByKeyboard, pageFrame, waitPageVisible } from './helpers.ts';

/*
 * Documentos recientes (PDF-049). El selector de ficheros del navegador se sustituye por uno que devuelve el
 * `FileSystemFileHandle` de un fichero de OPFS: así los recientes son handles reales (IndexedDB) y se reabren tras recargar.
 */

const RECENT_REGION = { name: tabsMsg.recentTitle };
const MENU_BUTTON = { name: tabsMsg.recentMenu };

/** Instala el selector falso antes de cargar la página: devuelve el fichero de OPFS que indique `__nextPick`. */
async function installPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __nextPick?: string;
      showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
    };
    w.showOpenFilePicker = async () => {
      const name = w.__nextPick;
      if (name === undefined) throw new DOMException('Cancelado', 'AbortError');
      const root = await navigator.storage.getDirectory();
      return [await root.getFileHandle(name)];
    };
  });
}

/** Copia un fixture a OPFS (la página ya está cargada en su origen). */
async function putInOpfs(page: Page, name: string): Promise<void> {
  const bytes = [...readFileSync(fixture(name))];
  await page.evaluate(async ({ fileName, data }) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();
  }, { fileName: name, data: bytes });
}

/** Abre un fichero de OPFS con el botón «Abrir…» de la barra y espera a que el visor esté listo. */
async function pick(page: Page, name: string): Promise<void> {
  await page.evaluate((fileName) => {
    (window as unknown as { __nextPick?: string }).__nextPick = fileName;
  }, name);
  await page.getByRole('toolbar').getByRole('button', { name: msg.open }).click();
  await expect(page).toHaveTitle(new RegExp(name.replace('.', '\\.')));
  await expectViewerReady(page);
}

/** Página nueva con los fixtures en OPFS y el selector falso. */
async function startPage(page: Page, files: readonly string[]): Promise<void> {
  await installPicker(page);
  await page.goto('/');
  for (const name of files) await putInOpfs(page, name);
}

/** Nombres de la sección de recientes, en orden. */
function recentNames(page: Page): Locator {
  return page.getByRole('region', RECENT_REGION).getByRole('listitem').getByRole('button');
}

/** Deja `links.pdf` y `basic-5.pdf` como recientes (basic-5 el más reciente) y recarga: pantalla de inicio. */
async function seedRecents(page: Page): Promise<void> {
  await startPage(page, ['links.pdf', 'basic-5.pdf']);
  await pick(page, 'links.pdf');
  await pick(page, 'basic-5.pdf');
  await page.reload();
  await expect(recentNames(page)).toHaveText(['basic-5.pdf', 'links.pdf']);
}

test('los recientes sobreviven a cerrar y recargar, y reabren basic-5 en la p3', async ({ page }) => {
  await startPage(page, ['links.pdf', 'basic-5.pdf']);
  await pick(page, 'links.pdf');
  await pick(page, 'basic-5.pdf');
  await goToPageByKeyboard(page, 3, 5);

  // La aplicación no tiene un botón para cerrar el documento: recargar la página lo cierra y guarda la posición.
  await page.reload();
  await expect(recentNames(page)).toHaveText(['basic-5.pdf', 'links.pdf']);
  await page.reload();
  await expect(recentNames(page)).toHaveText(['basic-5.pdf', 'links.pdf']);

  await page.getByRole('region', RECENT_REGION).getByRole('button', { name: 'basic-5.pdf' }).click();
  await expect(page).toHaveTitle(/basic-5\.pdf/);
  await expectViewerReady(page);
  await waitPageVisible(page, 3, 5);
  await expect(pageFrame(page, 3)).toBeVisible();
});

test('«Abrir recientes» con teclado (Tab, Intro, flecha, Intro) abre links.pdf', async ({ page }) => {
  await seedRecents(page);

  const menuButton = page.getByRole('toolbar').getByRole('button', MENU_BUTTON);
  for (let i = 0; i < 15 && !(await menuButton.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(menuButton).toBeFocused();
  await page.keyboard.press('Enter');
  // El menú abre con el foco en el primer elemento (basic-5.pdf); una flecha baja a links.pdf.
  await expect(page.getByRole('menuitem', { name: 'basic-5.pdf' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'links.pdf' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveTitle(/links\.pdf/);
  await expectViewerReady(page);
});

test('un fichero borrado avisa, queda como «No disponible» y «Quitar de la lista» lo elimina', async ({ page }) => {
  await startPage(page, ['links.pdf']);
  await pick(page, 'links.pdf');
  await page.reload();
  await expect(recentNames(page)).toHaveText(['links.pdf']);

  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('links.pdf');
  });

  await page.getByRole('region', RECENT_REGION).getByRole('button', { name: 'links.pdf' }).click();
  await expect(page.getByText('No se encuentra “links.pdf”. Puede que se haya movido o borrado.')).toBeVisible();
  const item = page.getByRole('region', RECENT_REGION).getByRole('listitem');
  await expect(item.getByRole('button', { name: 'links.pdf' })).toBeDisabled();
  await expect(item.getByText(tabsMsg.recentUnavailable)).toBeVisible();

  await item.getByRole('button', { name: tabsMsg.recentRemove }).click();
  await expect(page.getByRole('region', RECENT_REGION)).toHaveCount(0);
});

test('«Borrar la lista de recientes» vacía la lista, la sección desaparece y el menú se deshabilita', async ({ page }) => {
  await seedRecents(page);

  await page.getByRole('toolbar').getByRole('button', MENU_BUTTON).click();
  await page.getByRole('menuitem', { name: tabsMsg.recentClear }).click();

  await expect(page.getByRole('region', RECENT_REGION)).toHaveCount(0);
  await expect(page.getByRole('toolbar').getByRole('button', MENU_BUTTON)).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('region', RECENT_REGION)).toHaveCount(0);
});

test('abrir un reciente con cambios sin guardar pregunta antes, como «Abrir»', async ({ page }) => {
  await startPage(page, ['links.pdf', 'form-full.pdf']);
  await pick(page, 'links.pdf');
  await pick(page, 'form-full.pdf');
  const nombre = pageFrame(page, 1).getByRole('textbox', { name: 'nombre', exact: true });
  await nombre.fill('Luis');
  await nombre.press('Tab');
  await expect(page).toHaveTitle(/• /);

  await page.getByRole('toolbar').getByRole('button', MENU_BUTTON).click();
  await page.getByRole('menuitem', { name: 'links.pdf' }).click();

  const dialog = page.getByRole('dialog', { name: msg.unsavedQuestion('form-full.pdf') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: msg.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(nombre).toHaveValue('Luis');
  await expect(page).toHaveTitle(/• form-full\.pdf/);
});

test('la pantalla de inicio con recientes y el menú abierto no tienen incidencias serias de accesibilidad', async ({ page }, testInfo) => {
  await seedRecents(page);

  const home = await new AxeBuilder({ page }).analyze();
  await page.getByRole('toolbar').getByRole('button', MENU_BUTTON).click();
  await expect(page.getByRole('menu', MENU_BUTTON)).toBeVisible();
  const menu = await new AxeBuilder({ page }).analyze();

  const serious = [...home.violations, ...menu.violations].filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({ type: 'axe', description: `incidencias serias o críticas: ${String(serious.length)}` });
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
