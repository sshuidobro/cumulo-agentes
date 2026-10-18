import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { msg } from '../../src/ui/messages.ts';
import { expectViewerReady } from './viewer-ready.ts';

const EXTERNAL_URL = 'https://example.org/ruta?x=1';

async function openLinks(page: Page): Promise<void> {
  // Registra window.open antes de que la app cargue: cada llamada queda en `window.__opened`.
  await page.addInitScript(() => {
    (window as unknown as { __opened: unknown[][] }).__opened = [];
    window.open = (...args: unknown[]) => {
      (window as unknown as { __opened: unknown[][] }).__opened.push(args);
      return null;
    };
  });
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'links.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

async function openedCalls(page: Page): Promise<unknown[][]> {
  return page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened);
}

test('links.pdf: enlace interno, Alt+← y Alt+→ con el historial', async ({ page }) => {
  await openLinks(page);
  await expect(page.getByRole('group', { name: msg.pageOf(1, 5) })).toBeVisible();

  // (a) es el primer enlace interno de la página 1.
  await page.getByRole('link', { name: msg.internalLink }).first().click();
  await expect(page.getByRole('group', { name: 'Página 3 de 5' })).toBeVisible();

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('group', { name: 'Página 1 de 5' })).toBeVisible();

  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByRole('group', { name: 'Página 3 de 5' })).toBeVisible();
});

test('links.pdf: el enlace externo pide confirmación; «Cancelar» no abre nada', async ({ page }) => {
  await openLinks(page);

  await page.getByRole('link', { name: EXTERNAL_URL }).click();
  const dialog = page.getByRole('dialog', { name: msg.confirmExternalTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(EXTERNAL_URL);

  await dialog.getByRole('button', { name: msg.cancel }).click();
  await expect(dialog).toBeHidden();
  expect(await openedCalls(page)).toEqual([]);
});

test('links.pdf: «Abrir» en el diálogo abre la URL con noopener,noreferrer', async ({ page }) => {
  await openLinks(page);

  await page.getByRole('link', { name: EXTERNAL_URL }).click();
  const dialog = page.getByRole('dialog', { name: msg.confirmExternalTitle });
  await dialog.getByRole('button', { name: msg.openLink }).click();

  await expect.poll(() => openedCalls(page)).toEqual([[EXTERNAL_URL, '_blank', 'noopener,noreferrer']]);
  await expect(dialog).toBeHidden();
});

test('links.pdf: los enlaces bloqueados no hacen nada (ni diálogo ni navegación)', async ({ page }) => {
  await openLinks(page);

  const blocked = page.getByTitle(msg.linkBlocked);
  await expect(blocked).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await blocked.nth(i).click();
  }

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Página 1 de 5' })).toBeVisible();
  expect(await openedCalls(page)).toEqual([]);
});
