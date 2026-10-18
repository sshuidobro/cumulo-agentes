import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { msg } from '../../src/ui/messages.ts';
import { settle } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

interface Win {
  __opened: unknown[][];
}

async function openLinks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Win).__opened = [];
    window.open = (...args: unknown[]) => {
      (window as unknown as Win).__opened.push(args);
      return null;
    };
  });
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(join(FIXTURES_DIR, 'links.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
}

const opened = (page: Page): Promise<unknown[][]> => page.evaluate(() => (window as unknown as Win).__opened);

test('Esc cierra el diálogo externo sin abrir y devuelve el foco', async ({ page }) => {
  await openLinks(page);
  const link = page.getByRole('link', { name: 'https://example.org/ruta?x=1' });
  await link.click();
  const dialog = page.getByRole('dialog', { name: msg.confirmExternalTitle });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await opened(page)).toEqual([]);
});

test('clic de rueda y ctrl+clic en enlace externo no abren sin confirmar', async ({ page }) => {
  await openLinks(page);
  const link = page.getByRole('link', { name: 'https://example.org/ruta?x=1' });
  const popups: string[] = [];
  page.context().on('page', (p) => popups.push(p.url()));
  await link.click({ button: 'middle' });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await link.click({ modifiers: ['Control'] });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await settle(page);
  expect(popups).toEqual([]);
  expect(await opened(page)).toEqual([]);
  expect(page.url()).not.toContain('example.org');
});

test('mailto pide confirmación y Enter con teclado activa enlace interno', async ({ page }) => {
  await openLinks(page);
  const mail = page.getByRole('link', { name: /^mailto:/ });
  await mail.click();
  await expect(page.getByRole('dialog', { name: msg.confirmExternalTitle })).toContainText('mailto:');
  await page.keyboard.press('Escape');
  const internal = page.getByRole('link', { name: msg.internalLink }).first();
  await internal.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Página 3 de 5' })).toBeVisible();
  expect(page.url()).not.toMatch(/#$/);
});

test('enlaces (b) y (c) navegan y Alt+← encadena el historial', async ({ page }) => {
  await openLinks(page);
  const internals = page.getByRole('link', { name: msg.internalLink });
  // `count()` no espera: primero se espera al tercer enlace interno (la página 1 aún puede estar montándose).
  await expect(internals.nth(2)).toBeAttached();
  const n = await internals.count();
  expect(n).toBeGreaterThanOrEqual(3);
  await internals.nth(1).click();
  await expect(page.getByRole('group', { name: 'Página 5 de 5' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('group', { name: 'Página 1 de 5' })).toBeVisible();
  await expect(page.getByRole('button', { name: msg.back })).toBeDisabled();
  await expect(page.getByRole('button', { name: msg.forward })).toBeEnabled();
});
