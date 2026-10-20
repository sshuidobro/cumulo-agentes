import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { exportMsg } from '../../src/ui/messages-export.ts';
import { expect, test } from './perf-fixture.ts';
import { openWithDownloads, pickTool, dragOverLine } from './annotations-kit.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks, openFixture } from './helpers.ts';

/** Lo que devuelve `decodeImage` en el navegador: tamaño real y píxeles amarillos del resaltado. */
interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly yellow: number;
}

/** Decodifica una imagen en el navegador (PNG o JPEG) y cuenta los píxeles amarillos del resaltado. */
async function decodeImage(page: Page, bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): Promise<DecodedImage> {
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('el navegador no da contexto 2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let yellow = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) > 180 && (data[i + 2] ?? 0) < 160) yellow += 1;
    }
    return { width: img.naturalWidth, height: img.naturalHeight, yellow };
  }, dataUrl);
}

/** Abre «Más acciones» → «Exportar…» con el ratón y devuelve el diálogo. */
async function openExport(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click();
  await page.getByRole('menuitem', { name: exportMsg.menuItem, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: exportMsg.title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Violaciones de axe dentro del diálogo (el informe completo se ve en el fallo). */
async function dialogViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  return results.violations;
}

test.describe('exportar (basic-5.pdf)', () => {
  test('páginas 1-3 en PNG a 150 ppp: un ZIP con tres PNG de 1275×1650', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    const dialog = await openExport(page);
    await dialog.getByRole('radio', { name: exportMsg.png, exact: true }).check();
    await dialog.getByRole('combobox', { name: exportMsg.resolution }).selectOption('150');
    await dialog.getByRole('radio', { name: exportMsg.rangePages, exact: true }).check();
    await dialog.getByRole('textbox', { name: exportMsg.rangeField }).fill('1-3');

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: exportMsg.export, exact: true }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe('basic-5-imagenes.zip');
    const entries = unzipSync(readFileSync(await file.path()));
    expect(Object.keys(entries)).toEqual(['basic-5-p0001.png', 'basic-5-p0002.png', 'basic-5-p0003.png']);
    for (const name of Object.keys(entries)) {
      const bytes = entries[name] ?? new Uint8Array();
      const decoded = await decodeImage(page, bytes, 'image/png');
      expect({ name, width: decoded.width, height: decoded.height }).toEqual({ name, width: 1275, height: 1650 });
    }
    await expect(dialog).toBeHidden();
  });

  test('página actual en JPEG a 72 ppp: 612×792; el resaltado sin guardar sale con comentarios y no sin ellos', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await pickTool(page, 'Resaltar');
    await dragOverLine(page, 0);

    let dialog = await openExport(page);
    await dialog.getByRole('radio', { name: exportMsg.jpeg, exact: true }).check();
    await dialog.getByRole('combobox', { name: exportMsg.resolution }).selectOption('72');
    await dialog.getByRole('radio', { name: exportMsg.currentPage(1), exact: true }).check();
    await dialog.getByRole('checkbox', { name: exportMsg.withComments, exact: true }).check();
    let download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: exportMsg.export, exact: true }).click();
    let file = await download;
    expect(file.suggestedFilename()).toBe('basic-5-p1.jpg');
    const withComments = await decodeImage(page, readFileSync(await file.path()), 'image/jpeg');
    expect({ width: withComments.width, height: withComments.height }).toEqual({ width: 612, height: 792 });
    expect(withComments.yellow).toBeGreaterThan(0);

    dialog = await openExport(page);
    await dialog.getByRole('radio', { name: exportMsg.currentPage(1), exact: true }).check();
    await dialog.getByRole('checkbox', { name: exportMsg.withComments, exact: true }).uncheck();
    download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: exportMsg.export, exact: true }).click();
    file = await download;
    const withoutComments = await decodeImage(page, readFileSync(await file.path()), 'image/jpeg');
    expect(withoutComments.yellow).toBe(0);
  });

  test('texto: basic-5.txt con BOM, «Página 1 de 5» antes de «Página 2 de 5» y 4 saltos de página \\f', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    const dialog = await openExport(page);
    await dialog.getByRole('radio', { name: exportMsg.txt, exact: true }).check();

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: exportMsg.export, exact: true }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe('basic-5.txt');
    const bytes = readFileSync(await file.path());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    // ignoreBOM: el BOM se conserva en el texto para poder comprobarlo.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    const first = text.indexOf('Página 1 de 5');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Página 2 de 5')).toBeGreaterThan(first);
    expect(text.split('\f').length - 1).toBe(4);
  });

  test('con Intro desde el menú: foco en el primer control, Escape cierra, Intro exporta; sin violaciones de axe', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await page.getByRole('button', { name: 'Más acciones', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: exportMsg.menuItem, exact: true }).focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: exportMsg.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: exportMsg.png, exact: true })).toBeFocused();
    expect(await dialogViolations(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Más acciones', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: exportMsg.menuItem, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    const download = page.waitForEvent('download');
    await dialog.getByRole('radio', { name: exportMsg.png, exact: true }).focus();
    await page.keyboard.press('Enter');
    expect((await download).suggestedFilename()).toBe('basic-5-imagenes.zip');
  });

  test.describe('tema oscuro', () => {
    test.use({ colorScheme: 'dark' });

    test('el diálogo usa fondo oscuro y no tiene violaciones de axe', async ({ page }) => {
      await openWithDownloads(page, fixture('basic-5.pdf'));
      const dialog = await openExport(page);

      const background = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).not.toBe('rgb(255, 255, 255)');
      expect(await dialogViolations(page)).toEqual([]);
    });
  });
});

test.describe('exportar con permisos restringidos (encrypted-owner-only.pdf)', () => {
  test('«Exportar…» deshabilitado con su explicación', async ({ page }) => {
    await openFixture(page, 'encrypted-owner-only.pdf');
    await page.getByRole('button', { name: 'Más acciones', exact: true }).click();

    const item = page.getByRole('menuitem', { name: exportMsg.menuItem, exact: true });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute('title', exportMsg.blocked);
  });
});

test.describe('exportar pages-5000.pdf (@perf)', () => {
  test('@perf 20 páginas a 150 ppp sin long tasks de más de 100 ms', { tag: '@perf' }, async ({ page }) => {
    await installPerfProbes(page);
    await openWithDownloads(page, fixture('pages-5000.pdf'));
    await clearLongTasks(page);

    const dialog = await openExport(page);
    await dialog.getByRole('radio', { name: exportMsg.rangePages, exact: true }).check();
    await dialog.getByRole('textbox', { name: exportMsg.rangeField }).fill('1-20');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: exportMsg.export, exact: true }).click();
    expect((await download).suggestedFilename()).toBe('pages-5000-imagenes.zip');

    const slowest = Math.max(0, ...(await longTasks(page)));
    expect(slowest).toBeLessThanOrEqual(100);
  });

  test('@perf «Cancelar» a mitad no descarga nada', { tag: '@perf' }, async ({ page }) => {
    await openWithDownloads(page, fixture('pages-5000.pdf'));

    const dialog = await openExport(page);
    await dialog.getByRole('radio', { name: exportMsg.rangePages, exact: true }).check();
    await dialog.getByRole('textbox', { name: exportMsg.rangeField }).fill('1-20');
    let downloaded = false;
    page.once('download', () => { downloaded = true; });
    await dialog.getByRole('button', { name: exportMsg.export, exact: true }).click();

    const progress = page.getByRole('dialog', { name: exportMsg.progressTitle, exact: true });
    await expect(progress).toBeVisible();
    await progress.getByRole('button', { name: exportMsg.cancel, exact: true }).click();
    await expect(progress).toBeHidden();

    // Con la cancelación no se llega a guardar: ni descarga ni aviso de «terminada».
    expect(downloaded).toBe(false);
    await expect(page.getByText(exportMsg.done, { exact: true })).toHaveCount(0);
  });
});
