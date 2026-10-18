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

test.describe('QA capa de texto y mano', () => {
  test('QA: con la mano, arrastrar desplaza el visor y no selecciona; con V vuelve a seleccionar', async ({ page }) => {
    await open(page);
    const viewer = page.getByTestId('viewer');
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: /Herramienta mano/ })).toHaveAttribute('aria-pressed', 'true');
    const before = await viewer.evaluate((v) => v.scrollTop);
    const box = await viewer.boundingBox();
    if (box === null) throw new Error('El visor no tiene caja visible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.7;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100, { steps: 5 });
    await page.mouse.up();
    const after = await viewer.evaluate((v) => v.scrollTop);
    expect(after - before).toBeGreaterThanOrEqual(90);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: /Herramienta de selección/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('QA: Ctrl+A en un campo de texto no selecciona el texto del PDF y H se escribe en Zoom', async ({ page }) => {
    await open(page);
    const zoom = page.getByRole('textbox', { name: 'Zoom' });
    await zoom.focus();
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: /Herramienta de selección/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+A');
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toContain('Página 1 de 5');
  });
});
