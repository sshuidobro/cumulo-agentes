import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, name));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

const field = (page: Page) => page.getByRole('textbox', { name: 'Número de página' });

test('QA: botones, flechas, Inicio/Fin y extremos en basic-5', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  const prev = page.getByRole('button', { name: /Página anterior/ });
  const next = page.getByRole('button', { name: /Página siguiente/ });
  await expect(prev).toBeDisabled();
  await next.click();
  await expect(field(page)).toHaveValue('2');
  await expect(prev).toBeEnabled();
  await page.getByTestId('viewer').focus();
  await page.keyboard.press('ArrowRight');
  await expect(field(page)).toHaveValue('3');
  await page.keyboard.press('ArrowLeft');
  await expect(field(page)).toHaveValue('2');
  await page.keyboard.press('End');
  await expect(field(page)).toHaveValue('5');
  await expect(next).toBeDisabled();
  await page.keyboard.press('Control+Shift+PageUp');
  await expect(field(page)).toHaveValue('1');
});

test('QA: campo inválido, Esc, espacios, selección y flechas dentro del campo', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.keyboard.press('Control+Shift+N');
  await expect(field(page)).toBeFocused();
  expect(await field(page).evaluate((e: HTMLInputElement) => e.selectionStart === 0 && e.selectionEnd === e.value.length)).toBe(true);
  await field(page).fill('99');
  await field(page).press('Enter');
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Escribe un número de página entre 1 y 5')).toBeVisible();
  await expect(field(page)).toHaveValue('99');
  await field(page).press('Escape');
  await expect(field(page)).toHaveValue('1');
  await expect(field(page)).not.toHaveAttribute('aria-invalid', 'true');
  await field(page).fill('  3 ');
  await field(page).press('Enter');
  await expect(page.getByRole('group', { name: 'Página 3 de 5' })).toBeVisible();
  await field(page).fill('1.5');
  await field(page).press('Enter');
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
  await field(page).fill('');
  await field(page).press('Enter');
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
  await field(page).fill('4');
  await field(page).press('ArrowLeft');
  await field(page).press('ArrowRight');
  await expect(field(page)).toHaveValue('4');
  // salir del campo restaura
  await field(page).fill('77');
  await page.getByTestId('viewer').focus();
  await expect(field(page)).toHaveValue('3');
});
