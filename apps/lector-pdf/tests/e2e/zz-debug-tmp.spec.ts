import { expect, test } from '@playwright/test';
import { fixture } from './helpers.ts';
import { openWithDownloads, saveWithCtrlS } from './annotations-kit.ts';
import { openOrganize, pageCell } from './organize-kit.ts';
import { expect as ex } from '@playwright/test';

test('debug links flow', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('links.pdf'));
  const grid = await openOrganize(page);
  await ex(grid).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+End');
  await ex(pageCell(grid, 5)).toContainText('(antes 3)');
  const saved = await saveWithCtrlS(page, testInfo, 'dbg.pdf');
  const fresh = await page.context().newPage();
  const logs: string[] = [];
  fresh.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  fresh.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await fresh.addInitScript(() => { Reflect.deleteProperty(window, 'showSaveFilePicker'); });
  await fresh.goto('/');
  await fresh.locator('[data-testid=open-input]').setInputFiles(saved);
  await fresh.waitForTimeout(4000);
  console.log('VIEWER COUNT', await fresh.getByTestId('viewer').count(), await fresh.getByTestId('document-ready').count());
  console.log('LOGS\n' + logs.join('\n').slice(0, 3000));
  expect(1).toBe(1);
});
