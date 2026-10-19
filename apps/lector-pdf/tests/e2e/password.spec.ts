import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixture, pageFrame } from './helpers.ts';

/**
 * Abrir PDFs con contraseña (PDF-046): diálogo propio, reintento tras un error, cancelación y accesibilidad.
 */

const USER = 'usuario';
const OWNER = 'propietario';

/** Los cinco cifrados que piden contraseña de usuario, con el texto de su página 1. */
const CIPHERS: readonly { readonly name: string; readonly firstPage: string }[] = [
  { name: 'encrypted-rc4-40.pdf', firstPage: 'Página 1 de 5' },
  { name: 'encrypted-rc4-128.pdf', firstPage: 'Página 1 de 5' },
  { name: 'encrypted-aes-128.pdf', firstPage: 'Página 1 de 5' },
  { name: 'encrypted-aes-256.pdf', firstPage: 'Página 1 de 5' },
  { name: 'encrypted-aes-256-objstm.pdf', firstPage: 'Página 1 de 50' },
];

const AES128 = 'encrypted-aes-128.pdf';

/** Carga el PDF sin esperar al visor (con contraseña el visor no aparece hasta acertar). */
async function choose(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture(name));
}

function passwordDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Contraseña necesaria' });
}

function passwordField(page: Page) {
  return passwordDialog(page).getByRole('textbox', { name: 'Contraseña' });
}

/** Violaciones de axe con impacto grave o crítico (el diálogo debe estar abierto). */
async function seriousViolations(page: Page, testInfo: TestInfo, view: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({
    type: 'axe',
    description: `${view}: ${String(results.violations.length)} violaciones en total, ${String(serious.length)} serious/critical`,
  });
  return serious.map((v) => `${v.id} (${String(v.impact)}): ${v.help}`);
}

for (const cipher of CIPHERS) {
  test(`${cipher.name}: contraseña de usuario → diálogo → «usuario» + Intro → página 1 con su texto`, async ({ page }) => {
    await choose(page, cipher.name);

    await expect(passwordDialog(page)).toBeVisible();
    await passwordField(page).fill(USER);
    await passwordField(page).press('Enter');

    await expect(passwordDialog(page)).toBeHidden();
    await expect(page.getByTestId('viewer')).toBeVisible();
    await expect(pageFrame(page, 1)).toBeVisible();
    await expect(page.locator('body')).toContainText(cipher.firstPage);
  });
}

test('contraseña mal → aviso y campo vacío enfocado; después «propietario» también abre', async ({ page }) => {
  await choose(page, AES128);

  await passwordField(page).fill('mal');
  await passwordField(page).press('Enter');

  await expect(passwordDialog(page).getByRole('alert')).toHaveText('La contraseña no es correcta.');
  await expect(passwordField(page)).toHaveValue('');
  await expect(passwordField(page)).toBeFocused();

  await passwordField(page).fill(OWNER);
  await passwordField(page).press('Enter');
  await expect(page.getByTestId('viewer')).toBeVisible();
});

test('Cancelar → estado vacío «Abre un PDF para empezar», sin mensaje de error', async ({ page }) => {
  await choose(page, AES128);
  await passwordDialog(page).getByRole('button', { name: 'Cancelar' }).click();

  await expect(passwordDialog(page)).toBeHidden();
  await expect(page.getByText('Abre un PDF para empezar')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Esc también cancela la petición', async ({ page }) => {
  await choose(page, AES128);
  await expect(passwordDialog(page)).toBeVisible();
  await passwordField(page).press('Escape');

  await expect(passwordDialog(page)).toBeHidden();
  await expect(page.getByText('Abre un PDF para empezar')).toBeVisible();
});

test('encrypted-owner-only.pdf abre sin diálogo', async ({ page }) => {
  await choose(page, 'encrypted-owner-only.pdf');

  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(passwordDialog(page)).toHaveCount(0);
});

test('el diálogo, con y sin error, no tiene violaciones serious/critical de axe', async ({ page }, testInfo) => {
  await choose(page, AES128);
  await expect(passwordDialog(page)).toBeVisible();
  expect(await seriousViolations(page, testInfo, 'diálogo sin error')).toEqual([]);

  await passwordField(page).fill('mal');
  await passwordField(page).press('Enter');
  await expect(passwordDialog(page).getByRole('alert')).toBeVisible();
  expect(await seriousViolations(page, testInfo, 'diálogo con error')).toEqual([]);
});
