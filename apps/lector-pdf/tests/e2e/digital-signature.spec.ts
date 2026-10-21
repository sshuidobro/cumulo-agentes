import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digitalSignMsg } from '../../src/ui/messages-digital-signature.ts';
import { propertiesMsg } from '../../src/ui/messages-properties.ts';
import { TEST_P12_PASSWORD } from '../support/certs.ts';
import { SIGNING_FILES } from '../support/signing-fixtures.ts';
import { openWithDownloads } from './annotations-kit.ts';
import { fixture, pageFrame, showSidebarTab, waitPageRendered } from './helpers.ts';
import { SIGNING_DIR_ENV } from './global-setup.ts';

/**
 * Firma digital con certificado (PDF-139, ADR-0040): firmar en la web, validar lo descargado con `pdfsig`, el panel
 * «Firmas», el banner de documentos firmados y la accesibilidad. Los ficheros de prueba los genera `global-setup`.
 */

const SEVERE = ['serious', 'critical'];

function signingFile(name: string): string {
  const dir = process.env[SIGNING_DIR_ENV];
  if (dir === undefined) throw new Error('Falta la carpeta de la firma: global-setup no se ha ejecutado.');
  return join(dir, name);
}

function signDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: digitalSignMsg.dialogTitle, exact: true });
}

function signButton(page: Page): Locator {
  return signDialog(page).getByRole('button', { name: digitalSignMsg.sign, exact: true });
}

// Sin el selector nativo del navegador, «Elegir certificado…» usa un <input type=file> que Playwright sí intercepta.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });
});

/** Abre «Firmar con certificado…» desde «Más acciones». */
async function openSignDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: propertiesMsg.moreActions, exact: true }).click();
  await page.getByRole('menuitem', { name: digitalSignMsg.menuItem, exact: true }).click();
  await expect(signDialog(page)).toBeVisible();
}

/** «Elegir certificado…» con el selector de ficheros del navegador. */
async function chooseCertificate(page: Page): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    signDialog(page).getByRole('button', { name: digitalSignMsg.chooseCertificate, exact: true }).click(),
  ]);
  await chooser.setFiles(signingFile(SIGNING_FILES.p12));
  await expect(signDialog(page).getByText('prueba.p12')).toBeVisible();
}

async function unlock(page: Page, password: string = TEST_P12_PASSWORD): Promise<void> {
  await signDialog(page).getByLabel(digitalSignMsg.passwordLabel, { exact: true }).fill(password);
  await signDialog(page).getByRole('button', { name: digitalSignMsg.unlock, exact: true }).click();
}

/**
 * Ejecuta `action` y devuelve la ruta del fichero que descarga (la copia firmada). Se guarda en una carpeta temporal con
 * ruta ASCII: con tildes o eñes en la ruta, Chromium no abre el fichero al reabrirlo con el selector.
 */
async function downloadSigned(page: Page, action: () => Promise<unknown>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  const dir = mkdtempSync(join(tmpdir(), 'cumulo-firma-descarga-'));
  const path = join(dir, 'firmado.pdf');
  await download.saveAs(path);
  // La app avisa al terminar la escritura: hasta entonces no se recarga la página.
  await expect(page.getByText(digitalSignMsg.signed, { exact: true })).toBeVisible();
  return path;
}

/** Salida de `pdfsig` sobre el fichero (la herramienta independiente de la comprobación). */
function pdfsig(path: string): string {
  const result = spawnSync('pdfsig', [path], { encoding: 'utf8' });
  return `${result.stdout}${result.stderr}`;
}

/** Violaciones de axe de impacto grave o crítico. */
async function severeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact !== null && v.impact !== undefined && SEVERE.includes(v.impact))
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help}`);
}

/** Certificado desbloqueado, con la firma visible elegida (o invisible si `visible` es falso). */
async function unlockedDialog(page: Page, visible: boolean): Promise<void> {
  await openSignDialog(page);
  await chooseCertificate(page);
  await unlock(page);
  await expect(signDialog(page).getByText(digitalSignMsg.unlocked)).toBeVisible();
  if (visible) await signDialog(page).getByRole('radio', { name: digitalSignMsg.visibleOption, exact: true }).check();
}

test('firma invisible: el PDF descargado valida con pdfsig y la pestaña Firmas lo muestra', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await unlockedDialog(page, false);
  const path = await downloadSigned(page, () => signButton(page).click());
  expect(pdfsig(path)).toContain('Signature is Valid.');

  await openWithDownloads(page, path);
  await showSidebarTab(page, digitalSignMsg.tabSignatures);
  await expect(page.getByText('Prueba Cúmulo', { exact: true })).toBeVisible();
  await expect(page.getByText(digitalSignMsg.validSignature)).toBeVisible();
});

test('contraseña del certificado errónea: mensaje en el diálogo y Firmar deshabilitado', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await openSignDialog(page);
  await chooseCertificate(page);
  await unlock(page, 'mala');
  await expect(signDialog(page).getByRole('alert')).toContainText(digitalSignMsg.unlockFailed);
  await expect(signButton(page)).toBeDisabled();
});

test('firma visible en la página 2: arrastrar dibuja el recuadro y queda en esa página', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await unlockedDialog(page, true);
  await signDialog(page).getByRole('button', { name: digitalSignMsg.placeAndSign, exact: true }).click();
  await expect(page.getByText(digitalSignMsg.placingHint)).toBeVisible();

  await waitPageRendered(page, 2);
  await pageFrame(page, 2).scrollIntoViewIfNeeded();
  const box = await pageFrame(page, 2).boundingBox();
  const view = page.viewportSize();
  if (box === null || view === null) throw new Error('La página 2 no tiene caja visible');
  // La página es más alta que la ventana: se arrastra sobre la parte visible de la página.
  const top = Math.max(box.y, 0) + 40;
  const bottom = Math.min(box.y + box.height, view.height) - 40;
  const height = bottom - top;
  const path = await downloadSigned(page, async () => {
    await page.mouse.move(box.x + box.width * 0.2, top + height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, top + height * 0.4, { steps: 8 });
    await page.mouse.up();
  });
  expect(pdfsig(path)).toContain('Signature is Valid.');
  expect(readFileSync(path).includes('Firmado digitalmente por')).toBe(true);

  await openWithDownloads(page, path);
  await showSidebarTab(page, digitalSignMsg.tabSignatures);
  await expect(page.getByRole('button', { name: /Prueba Cúmulo/ })).toHaveAttribute('title', digitalSignMsg.goToPage(2));
});

test('teclado: Escape cancela la colocación y Intro firma en el centro de la página actual', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await unlockedDialog(page, true);
  await signDialog(page).getByRole('button', { name: digitalSignMsg.placeAndSign, exact: true }).click();
  await expect(page.getByText(digitalSignMsg.placingHint)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(digitalSignMsg.placingHint)).toHaveCount(0);

  await unlockedDialog(page, true);
  await signDialog(page).getByRole('button', { name: digitalSignMsg.placeAndSign, exact: true }).click();
  const path = await downloadSigned(page, () => page.keyboard.press('Enter'));
  expect(pdfsig(path)).toContain('Signature is Valid.');
});

test('documento firmado y modificado después: banner y «Se han hecho cambios después de firmar.»', async ({ page }) => {
  await openWithDownloads(page, signingFile(SIGNING_FILES.modified));
  await expect(page.getByRole('status').filter({ hasText: digitalSignMsg.bannerSigned })).toBeVisible();
  await showSidebarTab(page, digitalSignMsg.tabSignatures);
  await expect(page.getByText(digitalSignMsg.changedAfter)).toBeVisible();
});

test('documento firmado con un byte alterado: banner en rojo y firma no válida', async ({ page }) => {
  await openWithDownloads(page, signingFile(SIGNING_FILES.altered));
  await expect(page.getByRole('status').filter({ hasText: digitalSignMsg.bannerInvalid })).toBeVisible();
  await showSidebarTab(page, digitalSignMsg.tabSignatures);
  await expect(page.getByText('El documento se ha modificado después de firmarlo.')).toBeVisible();
});

test('axe: diálogo de firma y pestaña Firmas sin incidencias graves', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await openSignDialog(page);
  expect(await severeViolations(page)).toEqual([]);
});

test.describe('tema oscuro', () => {
  test.use({ colorScheme: 'dark' });

  test('axe: diálogo de firma en tema oscuro sin incidencias graves', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await openSignDialog(page);
    expect(await severeViolations(page)).toEqual([]);
  });

  test('axe: pestaña Firmas en tema oscuro sin incidencias graves', async ({ page }) => {
    await openWithDownloads(page, signingFile(SIGNING_FILES.signed));
    await showSidebarTab(page, digitalSignMsg.tabSignatures);
    await expect(page.getByText(digitalSignMsg.validSignature)).toBeVisible();
    expect(await severeViolations(page)).toEqual([]);
  });
});
