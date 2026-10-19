import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { printMsg } from '../../src/ui/messages-print.ts';
import { propertiesMsg } from '../../src/ui/messages-properties.ts';
import { securityMsg } from '../../src/ui/messages-security.ts';
import { disableFileSystemAccess, saveWithCtrlS, wordBox, zoneOf } from './annotations-kit.ts';
import { fixture, openFixture, waitPageRendered } from './helpers.ts';
import { qpdfCheck } from '../support/qpdf.ts';

/**
 * Permisos del documento (PDF-048), como Adobe Reader: si el PDF prohíbe copiar o imprimir, esas acciones quedan
 * deshabilitadas con su explicación; anotar y rellenar se permiten siempre, con un aviso una vez por documento.
 * Los PDF son los de `fixtures/` (cifrados con qpdf; ver `tests/fixtures/catalog.ts`).
 */

const OWNER_ONLY = 'encrypted-owner-only.pdf';
const RC4_40 = 'encrypted-rc4-40.pdf';
const USER = 'usuario';
/** Palabra del texto de `encrypted-owner-only.pdf` (mismo contenido que basic-5). */
const OWNER_WORD = 'Página';
/** Segunda palabra (otra línea) para el segundo resaltado: la primera ya tiene una marca encima. */
const OWNER_SECOND_WORD = 'murciélago';
/** Palabra del texto de `basic-5.pdf`. */
const BASIC_WORD = 'murciélago';
/** Texto de la página 1 de `basic-5.pdf` que copia la palabra doble-pulsada. */
const SENTINEL = 'portapapeles previo';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

function passwordDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: securityMsg.title });
}

/** Abre un PDF cifrado con la contraseña de usuario (o sin ella si `password` es `null`). */
async function openEncrypted(page: Page, name: string, password: string | null): Promise<void> {
  await disableFileSystemAccess(page);
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  if (password === null) {
    await waitPageRendered(page, 1);
    return;
  }
  const dialog = passwordDialog(page);
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('textbox', { name: securityMsg.field });
  await field.fill(password);
  await field.press('Enter');
  await expect(dialog).toBeHidden();
  await waitPageRendered(page, 1);
}

/** Doble clic en una palabra de la página 1: deja la selección y aparece la barra de acciones. */
async function selectWord(page: Page, word: string): Promise<void> {
  const box = await wordBox(page, 1, word);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

function selectionBar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Acciones de la selección' });
}

/** Resalta la palabra doble-pulsada con el botón «Resaltar» de la barra de selección. */
async function highlightWord(page: Page, word: string): Promise<void> {
  await selectWord(page, word);
  await selectionBar(page).getByRole('button', { name: 'Resaltar' }).click();
}

function propertiesDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: propertiesMsg.title });
}

/** Valor de la fila «label» de la pestaña abierta del diálogo de propiedades. */
function valueRow(dialog: Locator, label: string): Locator {
  return dialog.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
}

test.describe('PDF que prohíbe copiar, imprimir y comentar (encrypted-owner-only.pdf)', () => {
  test('seleccionar y Ctrl+C no cambia el portapapeles, avisa, y el botón «Copiar» queda deshabilitado con su explicación', async ({ page }) => {
    await openEncrypted(page, OWNER_ONLY, null);
    await page.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);

    await selectWord(page, OWNER_WORD);
    const copy = selectionBar(page).getByRole('button', { name: 'Copiar' });
    await expect(copy).toBeDisabled();
    await expect(copy).toHaveAttribute('title', new RegExp(securityMsg.copyBlocked.replace(/\./g, '\\.')));

    await page.keyboard.press('Control+c');
    await expect(page.getByRole('status').filter({ hasText: securityMsg.copyBlocked })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SENTINEL);
  });

  test('«Imprimir» está deshabilitado en la barra y en el menú; Ctrl+P avisa y no abre el diálogo', async ({ page }) => {
    // Cuenta las llamadas a la impresión del navegador (no deben producirse).
    await page.addInitScript(() => {
      (window as unknown as { __printCount: number }).__printCount = 0;
      window.print = (): void => {
        (window as unknown as { __printCount: number }).__printCount += 1;
      };
    });
    await openEncrypted(page, OWNER_ONLY, null);

    const toolbarPrint = page.getByRole('button', { name: printMsg.print, exact: true });
    await expect(toolbarPrint).toBeDisabled();

    await page.keyboard.press('Control+p');
    await expect(page.getByRole('status').filter({ hasText: securityMsg.printBlocked })).toBeVisible();
    await expect(page.getByRole('dialog', { name: printMsg.title, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __printCount: number }).__printCount)).toBe(0);

    await page.getByRole('button', { name: propertiesMsg.moreActions }).click();
    await expect(page.getByRole('menuitem', { name: printMsg.menuItem })).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('crear un resaltado avisa una vez por documento; Ctrl+S guarda y el fichero valida con qpdf', async ({ page }, testInfo: TestInfo) => {
    await openEncrypted(page, OWNER_ONLY, null);
    const notice = page.getByRole('status').filter({ hasText: securityMsg.annotateAnyway });

    await highlightWord(page, OWNER_WORD);
    await expect(zoneOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
    await expect(notice).toBeVisible();

    // El aviso dura unos segundos; tras desaparecer, un segundo resaltado no lo vuelve a mostrar.
    await expect(notice).toBeHidden({ timeout: 10_000 });
    await highlightWord(page, OWNER_SECOND_WORD);
    await expect(zoneOf(page, 1, 'Resaltado de Usuario')).toHaveCount(2);
    await expect(notice).toHaveCount(0);

    const saved = await saveWithCtrlS(page, testInfo, 'owner-only-anotado.pdf');
    const check = qpdfCheck(saved);
    expect(check.code, check.output).toBe(0);
  });
});

test.describe('PDF con cifrado y permisos (propiedades)', () => {
  test('Propiedades › Seguridad: AES 256 bits y Imprimir, Copiar y Comentar «No permitido»', async ({ page }) => {
    await openEncrypted(page, OWNER_ONLY, null);
    await page.getByTestId('viewer').focus();
    await page.keyboard.press('Control+d');
    const dialog = propertiesDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: securityMsg.tabSecurity }).click();

    await expect(valueRow(dialog, securityMsg.cipherLabel)).toHaveText(securityMsg.ciphers['aes-256']);
    await expect(valueRow(dialog, securityMsg.permissionRows.print)).toHaveText(securityMsg.notAllowed);
    await expect(valueRow(dialog, securityMsg.permissionRows.copy)).toHaveText(securityMsg.notAllowed);
    await expect(valueRow(dialog, securityMsg.permissionRows.annotate)).toHaveText(securityMsg.notAllowed);

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test('Propiedades › Seguridad de encrypted-rc4-40.pdf: RC4 40 bits', async ({ page }) => {
    await openEncrypted(page, RC4_40, USER);
    await page.getByTestId('viewer').focus();
    await page.keyboard.press('Control+d');
    const dialog = propertiesDialog(page);
    await dialog.getByRole('tab', { name: securityMsg.tabSecurity }).click();

    await expect(valueRow(dialog, securityMsg.cipherLabel)).toHaveText(securityMsg.ciphers['rc4-40']);
  });
});

test.describe('PDF sin restricciones (basic-5.pdf)', () => {
  test('copiar funciona, el botón «Copiar» está habilitado y anotar no avisa', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await page.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);

    await selectWord(page, BASIC_WORD);
    await expect(selectionBar(page).getByRole('button', { name: 'Copiar' })).toBeEnabled();
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(BASIC_WORD);

    await highlightWord(page, BASIC_WORD);
    await expect(zoneOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: securityMsg.annotateAnyway })).toHaveCount(0);
    await expect(page.getByRole('button', { name: printMsg.print, exact: true })).toBeEnabled();
  });
});
