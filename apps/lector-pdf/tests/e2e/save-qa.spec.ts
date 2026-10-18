import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { expectViewerReady } from './viewer-ready.ts';

const FIXTURE = join(FIXTURES_DIR, 'basic-5.pdf');

async function openBasic(page: Page): Promise<void> {
  // Sin File System Access: «Guardar como» descarga una copia.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(FIXTURE);
  await expect(page.getByTestId('document-ready')).toHaveText('5 páginas');
  await expectViewerReady(page);
}

test('Ctrl+Mayús+S descarga una copia idéntica en un PDF sin cambios y avisa', async ({ page }) => {
  await openBasic(page);
  await expect(page.getByRole('button', { name: /^Guardar como/ })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+Shift+S');
  const file = await download;
  expect(file.suggestedFilename()).toBe('basic-5.pdf');
  const path = await file.path();
  expect(readFileSync(path).equals(readFileSync(FIXTURE))).toBe(true);
  await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toContainText('descargado');
});

test('Ctrl+S sin cambios no descarga nada y no deja el título con aviso de cambios', async ({ page }) => {
  await openBasic(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  await expect(page).toHaveTitle('basic-5.pdf — Lector PDF');
});
