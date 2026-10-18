import { expect, test } from '@playwright/test';
import { openFixture, pageField } from './helpers.ts';

test('barra Comentar: conmutador, herramientas, teclado y menú de color en navegador real', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  const toggle = page.getByRole('button', { name: 'Comentar' });
  await toggle.click();
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  await expect(bar).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await bar.getByRole('button', { name: 'Resaltar' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Subrayar' })).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await expect(bar.getByRole('button', { name: 'Resaltar' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(bar.getByRole('button', { name: 'Tamaño de letra' })).toHaveCount(0);

  await bar.getByRole('button', { name: 'Dibujar' }).click();
  await expect(bar.getByRole('button', { name: 'Grosor' })).toBeVisible();
  await bar.getByRole('button', { name: 'Color' }).click();
  await page.getByRole('menuitemradio', { name: 'Verde' }).click();
  await bar.getByRole('button', { name: 'Color' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Verde' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  await toggle.click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
});

test('barra Comentar: las flechas no cambian de página (PDF-071)', async ({ page }) => {
  await openFixture(page, 'basic-5.pdf');
  await page.getByRole('button', { name: 'Comentar' }).click();
  const bar = page.getByRole('toolbar', { name: 'Comentar' });
  await expect(bar).toBeVisible();

  await bar.getByRole('button', { name: 'Resaltar' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Tachar' })).toBeFocused();
  await expect(pageField(page)).toHaveValue('1');
});
