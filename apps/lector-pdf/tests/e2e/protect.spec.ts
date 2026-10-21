import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { propertiesMsg } from '../../src/ui/messages-properties.ts';
import { securityMsg } from '../../src/ui/messages-security.ts';
import { qpdfAnnotations } from '../support/qpdf.ts';
import { disableFileSystemAccess, openFixtureWithDownloads, storeDownload, wordBox } from './annotations-kit.ts';
import { fixture, waitPageRendered } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * Proteger con contraseña y quitar protección (PDF-132). En web «Guardar» descarga una copia y el documento abierto
 * sigue siendo el original: lo que se comprueba es el fichero descargado (con qpdf y pdf.js) y la app al reabrirlo.
 */

const OPEN_PASSWORD = 'abc';
const OWNER = 'propietario';

async function moreAction(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: propertiesMsg.moreActions, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Abre un PDF cifrado con contraseña de usuario y espera al visor. */
async function openWithPassword(page: Page, name: string, password: string): Promise<void> {
  await disableFileSystemAccess(page);
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
  await passwordDialog(page).getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await passwordDialog(page).getByRole('textbox', { name: 'Contraseña', exact: true }).press('Enter');
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
}

function protectDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: securityMsg.protectTitle, exact: true });
}

function passwordDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Contraseña necesaria' });
}

function propertiesDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: propertiesMsg.title });
}

/** Valor de la fila «label» de la pestaña abierta de Propiedades. */
function valueRow(dialog: Locator, label: string): Locator {
  return dialog.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
}

/** Ejecuta qpdf y devuelve el código de salida y la salida (sin lanzar si falla). */
function qpdf(args: readonly string[]): { readonly status: number; readonly out: string } {
  const result = spawnSync('qpdf', [...args], { encoding: 'utf8' });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

/**
 * Pulsa «Proteger» del diálogo y guarda la descarga resultante. La carpeta es solo ASCII: Chromium no acepta
 * `setInputFiles` con rutas que contengan caracteres como «» (el título del test de «solo restricciones» los tiene).
 */
async function protectAndDownload(page: Page, testInfo: TestInfo, outName: string): Promise<string> {
  const download = page.waitForEvent('download');
  await protectDialog(page).getByRole('button', { name: securityMsg.protect, exact: true }).click();
  const dir = mkdtempSync(join(tmpdir(), `pdf132-${testInfo.testId}-`));
  const path = join(dir, outName);
  await (await download).saveAs(path);
  return path;
}

/** Violaciones de axe con impacto grave o crítico, con el diálogo abierto. */
async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${String(v.impact)}): ${v.help}`);
}

test.describe('Proteger con contraseña (basic-5.pdf)', () => {
  test('contraseña de apertura: el fichero es AES-256, qpdf y pdf.js la piden, y la app lo abre con ella', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await moreAction(page, securityMsg.protectMenu);
    const dialog = protectDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: securityMsg.requireOpen }).check();
    await dialog.getByLabel(securityMsg.openField, { exact: true }).fill(OPEN_PASSWORD);
    await dialog.getByLabel(securityMsg.confirmField, { exact: true }).fill(OPEN_PASSWORD);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    const path = await protectAndDownload(page, testInfo, 'basic-5-protegido.pdf');

    const shown = qpdf(['--show-encryption', `--password=${OPEN_PASSWORD}`, path]);
    expect(shown.status).toBe(0);
    expect(shown.out).toMatch(/R = 6/);
    expect(shown.out).toMatch(/AESv3/);
    // Sin contraseña, qpdf no puede leer el documento (con --show-encryption mostraría los datos igualmente).
    expect(qpdf(['--check', path]).status).not.toBe(0);
    expect(qpdf(['--check', `--password=${OPEN_PASSWORD}`, path]).status).toBe(0);

    // Sin la contraseña no hay visor: pdf.js (y la app) piden la contraseña de apertura.
    const fresh = await page.context().newPage();
    await disableFileSystemAccess(fresh);
    await fresh.goto('/');
    await fresh.locator('[data-testid=open-input]').setInputFiles(path);
    await expect(passwordDialog(fresh)).toBeVisible();
    await fresh.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(OPEN_PASSWORD);
    await fresh.getByRole('textbox', { name: 'Contraseña', exact: true }).press('Enter');
    await expect(fresh.getByTestId('viewer')).toBeVisible();
    await expectViewerReady(fresh);
    await waitPageRendered(fresh, 1);
  });

  test('solo restricciones (sin copiar ni imprimir): al reabrir, Imprimir y Copiar quedan «No permitido» y el cifrado es AES 256', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await moreAction(page, securityMsg.protectMenu);
    const dialog = protectDialog(page);
    await dialog.getByRole('checkbox', { name: securityMsg.restrict }).check();
    await dialog.getByLabel(securityMsg.ownerField, { exact: true }).fill(OWNER);
    await dialog.getByLabel(securityMsg.confirmField, { exact: true }).fill(OWNER);
    await dialog.getByRole('combobox', { name: securityMsg.printLabel }).selectOption('none');
    await dialog.getByRole('checkbox', { name: securityMsg.allowCopy }).uncheck();

    const path = await protectAndDownload(page, testInfo, 'basic-5-restringido.pdf');

    const shown = qpdf(['--show-encryption', path]);
    expect(shown.status).toBe(0);
    expect(shown.out).toMatch(/R = 6/);
    expect(shown.out).toMatch(/print low resolution: not allowed/);

    // Pestaña nueva con el fichero protegido; la espera al visor es más larga porque el equipo va compartido.
    const fresh = await page.context().newPage();
    await disableFileSystemAccess(fresh);
    await fresh.goto('/');
    await fresh.locator('[data-testid=open-input]').setInputFiles(path);
    await expect(fresh.getByTestId('viewer')).toBeVisible({ timeout: 30_000 });
    await expectViewerReady(fresh);
    await fresh.getByTestId('viewer').focus();
    await fresh.keyboard.press('Control+d');
    const props = propertiesDialog(fresh);
    await expect(props).toBeVisible();
    await props.getByRole('tab', { name: securityMsg.tabSecurity }).click();
    await expect(valueRow(props, securityMsg.cipherLabel)).toHaveText(securityMsg.ciphers['aes-256']);
    await expect(valueRow(props, securityMsg.permissionRows.print)).toHaveText(securityMsg.notAllowed);
    await expect(valueRow(props, securityMsg.permissionRows.copy)).toHaveText(securityMsg.notAllowed);
  });

  test('con un resaltado sin guardar, proteger deja el resaltado en el documento protegido', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    const word = await wordBox(page, 1, 'murciélago');
    await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
    await page.getByRole('toolbar', { name: 'Acciones de la selección' }).getByRole('button', { name: 'Resaltar' }).click();

    await moreAction(page, securityMsg.protectMenu);
    const dialog = protectDialog(page);
    await dialog.getByRole('checkbox', { name: securityMsg.requireOpen }).check();
    await dialog.getByLabel(securityMsg.openField, { exact: true }).fill(OPEN_PASSWORD);
    await dialog.getByLabel(securityMsg.confirmField, { exact: true }).fill(OPEN_PASSWORD);

    const protectedPath = await protectAndDownload(page, testInfo, 'basic-5-resaltado-protegido.pdf');

    const plain = join(testInfo.outputPath(), 'basic-5-resaltado-sin-cifrar.pdf');
    expect(qpdf(['--password=' + OPEN_PASSWORD, '--decrypt', protectedPath, plain]).status).toBe(0);
    const subtypes = qpdfAnnotations(plain).map((a) => a.subtype);
    expect(subtypes).toContain('Highlight');
  });

  test('el diálogo es accesible con tema oscuro y se cierra con Esc', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await moreAction(page, securityMsg.protectMenu);
    const dialog = protectDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: securityMsg.requireOpen }).check();
    expect(await seriousViolations(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('Quitar protección', () => {
  test('sin cifrar, «Quitar protección» está deshabilitado', async ({ page }) => {
    await openFixtureWithDownloads(page, 'basic-5.pdf');
    await page.getByRole('button', { name: propertiesMsg.moreActions, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: securityMsg.unprotectMenu, exact: true })).toBeDisabled();
  });

  test('con la contraseña de permisos (encrypted-owner-only.pdf): la pide, avisa si se equivoca y deja el fichero sin cifrar', async ({ page }, testInfo) => {
    await openFixtureWithDownloads(page, 'encrypted-owner-only.pdf');
    await moreAction(page, securityMsg.unprotectMenu);

    const dialog = passwordDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(securityMsg.ownerPasswordPrompt('encrypted-owner-only.pdf'));
    const field = dialog.getByRole('textbox', { name: 'Contraseña', exact: true });
    await field.fill('mal');
    await field.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText('La contraseña no es correcta.');

    const download = page.waitForEvent('download');
    await field.fill(OWNER);
    await field.press('Enter');
    const path = await storeDownload(await download, testInfo, 'encrypted-owner-only-sin-proteccion.pdf');
    await expect(dialog).toBeHidden();
    expect(qpdf(['--show-encryption', path]).out).toMatch(/not encrypted/);
  });

  test('con permisos completos (encrypted-aes-256.pdf) la contraseña de usuario basta: PDF-131 no pide la de permisos', async ({ page }, testInfo) => {
    await openWithPassword(page, 'encrypted-aes-256.pdf', 'usuario');
    const download = page.waitForEvent('download');
    await moreAction(page, securityMsg.unprotectMenu);
    await expect(passwordDialog(page)).toHaveCount(0);
    const path = await storeDownload(await download, testInfo, 'aes-256-sin-proteccion.pdf');
    expect(qpdf(['--show-encryption', path]).out).toMatch(/not encrypted/);
  });
});
