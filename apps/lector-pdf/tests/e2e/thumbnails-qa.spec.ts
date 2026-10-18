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

const list = (page: Page) => page.getByRole('listbox', { name: 'Miniaturas' });

test('QA: sin documento F4 no abre nada; con documento abre, cierra y el visor conserva la página', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('F4');
  await expect(list(page)).toHaveCount(0);

  await openFixture(page, 'pages-5000.pdf');
  await page.getByRole('textbox', { name: 'Número de página' }).fill('77');
  await page.getByRole('textbox', { name: 'Número de página' }).press('Enter');
  await expect(page.getByRole('group', { name: 'Página 77 de 5000' })).toBeVisible();
  await page.getByRole('button', { name: /Panel lateral/ }).click();
  await expect(list(page)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Página 77 de 5000' })).toBeVisible();
  await page.getByRole('button', { name: /Panel lateral/ }).click();
  await expect(list(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Página 77 de 5000' })).toBeVisible();
});

test('QA: al desplazar el visor con la rueda, la miniatura de la página actual queda visible y marcada', async ({ page }) => {
  await openFixture(page, 'pages-5000.pdf');
  await page.keyboard.press('F4');
  await expect(list(page)).toBeVisible();
  await page.getByTestId('viewer').hover();
  for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, 1500);
  const selected = list(page).getByRole('option', { selected: true });
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeInViewport();
  const label = await selected.getAttribute('aria-label');
  await expect(page.getByRole('group', { name: label ?? '' })).toBeVisible();
});

test('QA: teclado: Fin/Inicio/AvPág en la lista y flechas entre pestañas; el foco es visible', async ({ page }) => {
  await openFixture(page, 'pages-100000.pdf');
  await page.keyboard.press('F4');
  const tab = page.getByRole('tab', { name: 'Miniaturas' });
  await tab.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await list(page).focus();
  const outline = await list(page).evaluate((el) => getComputedStyle(el).outlineStyle + '|' + getComputedStyle(el).boxShadow);
  expect(outline).not.toBe('none|none');
  await page.keyboard.press('End');
  await expect(page.getByRole('group', { name: 'Página 100000 de 100000' })).toBeVisible();
  await expect(list(page).getByRole('option', { name: 'Página 100000 de 100000' })).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).getByRole('option')).not.toHaveCount(0);
  expect(await list(page).getByRole('option').count()).toBeLessThanOrEqual(12);
  await page.keyboard.press('Home');
  await expect(list(page).getByRole('option', { name: 'Página 1 de 100000' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('PageDown');
  await expect(list(page).getByRole('option', { selected: true })).not.toHaveAttribute('aria-label', 'Página 1 de 100000');
});

test('QA: sizes-mixed (páginas apaisadas y giradas) muestra todas las miniaturas con lienzo', async ({ page }) => {
  await openFixture(page, 'sizes-mixed.pdf');
  await page.keyboard.press('F4');
  const options = list(page).getByRole('option');
  await expect(options.first()).toHaveAttribute('data-rendered', 'true');
  const n = await options.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i += 1) {
    const box = await options.nth(i).locator('canvas').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(10);
    expect(box?.width ?? 0).toBeLessThanOrEqual(300); // escala común: las apaisadas son más anchas que 128 (ficha)
  }
});
