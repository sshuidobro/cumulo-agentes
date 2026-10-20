import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { tabsMsg } from '../../src/ui/messages-tabs.ts';
import { fixture } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';
import { createNoteWithText, openCommentsPanel, storeDownload } from './annotations-kit.ts';

/*
 * PDF-111: exportar comentarios no debe tocar «Recientes». Los recientes son reales (handles en IndexedDB):
 * el selector de apertura se sustituye por uno que devuelve ficheros de OPFS, y el de guardado se elimina
 * para que «Exportar» sea una descarga.
 */

async function installPickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __nextPick?: string; showOpenFilePicker?: unknown; showSaveFilePicker?: unknown };
    w.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      return [await root.getFileHandle(w.__nextPick ?? '')];
    };
    Reflect.deleteProperty(w, 'showSaveFilePicker');
  });
}

async function putInOpfs(page: Page, name: string): Promise<void> {
  const bytes = [...readFileSync(fixture(name))];
  await page.evaluate(async ({ fileName, data }) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();
  }, { fileName: name, data: bytes });
}

async function pick(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    (window as unknown as { __nextPick?: string }).__nextPick = n;
  }, name);
  await page.getByRole('toolbar').getByRole('button', { name: 'Abrir…' }).click();
  await expect(page).toHaveTitle(new RegExp(name.replace('.', '\\.')));
  await expectViewerReady(page);
}

function recentNames(page: Page): Locator {
  return page.getByRole('region', { name: tabsMsg.recentTitle }).getByRole('listitem').getByRole('button');
}

test('exportar comentarios no añade ni reordena «Recientes» (se comprueba tras recargar)', async ({ page }, testInfo: TestInfo) => {
  await installPickers(page);
  await page.goto('/');
  await putInOpfs(page, 'links.pdf');
  await putInOpfs(page, 'basic-5.pdf');
  await pick(page, 'links.pdf');
  await pick(page, 'basic-5.pdf');
  await page.reload();
  await expect(recentNames(page)).toHaveText(['basic-5.pdf', 'links.pdf']);

  await pick(page, 'basic-5.pdf');
  await createNoteWithText(page, 'Nota para exportar');
  await openCommentsPanel(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Más opciones de comentarios', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Exportar comentarios…', exact: true }).click();
  const file = await storeDownload(await download, testInfo, 'recientes.xfdf');
  expect(readFileSync(file, 'utf8')).toContain('Nota para exportar');

  await page.reload();
  await expect(recentNames(page)).toHaveText(['basic-5.pdf', 'links.pdf']);
});
