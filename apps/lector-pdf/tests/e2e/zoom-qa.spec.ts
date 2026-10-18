import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'basic-5.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

test('QA: el zoom se acota entre 10 % y 6 400 % y el campo lo refleja', async ({ page }) => {
  await open(page);
  const input = page.getByRole('textbox', { name: 'Zoom' });
  await input.fill('9000');
  await input.press('Enter');
  await expect(input).toHaveValue('6400 %');
  await input.fill('1');
  await input.press('Enter');
  await expect(input).toHaveValue('10 %');
});

test('QA: en el campo de zoom Ctrl+Mayús+Flecha no gira y los botones muestran el atajo', async ({ page }) => {
  await open(page);
  const before = await page.locator('[data-testid=viewer] [data-page-index="0"]').boundingBox();
  await page.getByRole('textbox', { name: 'Zoom' }).focus();
  await page.keyboard.press('Control+Shift+ArrowRight');
  const after = await page.locator('[data-testid=viewer] [data-page-index="0"]').boundingBox();
  expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);
  await expect(page.getByRole('button', { name: 'Ampliar' })).toHaveAttribute('title', /Ctrl\+\+/);
});

test('QA: captura de página girada y giro con atajo + deshacer foco', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await expect(page.locator('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]')).toBeVisible();
  const b = await page.locator('[data-testid=viewer] [data-page-index="0"]').boundingBox();
  if (b === null) throw new Error('La página 1 no está montada');
  expect(b.width).toBeGreaterThan(b.height);
  await page.getByTestId('viewer').screenshot({ path: 'test-results/rot.png' });
});
