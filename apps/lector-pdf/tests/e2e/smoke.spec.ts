import { expect, test } from '@playwright/test';

test('la app carga sin errores y muestra el estado vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Abre un PDF para empezar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir…' })).toBeVisible();
  expect(errors).toEqual([]);
});
