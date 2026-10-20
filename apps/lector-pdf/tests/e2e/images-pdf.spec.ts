import AxeBuilder from '@axe-core/playwright';
import { createCanvas } from '@napi-rs/canvas';
import { expect, test as plain, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { imagesMsg } from '../../src/ui/messages-images.ts';
import { disableFileSystemAccess, storeDownload } from './annotations-kit.ts';
import { test as perfTest } from './perf-fixture.ts';
import { clearLongTasks, installPerfProbes, longTasks, seeded } from './helpers.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * Crear PDF desde imágenes (PDF-129): diálogo desde la pantalla de inicio, orden de la lista, JPEG con sus bytes
 * intactos, aviso con un PNG corrupto, accesibilidad con tema oscuro y presupuesto de tareas largas con 20 JPEG.
 * Las imágenes de prueba se generan en el propio test; los PDF descargados se leen con pdf.js en Node.
 */

/** Sin el selector de apertura del sistema (File System Access): «Añadir imágenes» usa el `<input type=file>`. */
async function useInputPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });
}

function jpegOf(width: number, height: number, color: string): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.encodeSync('jpeg', 90);
}

/** PNG con transparencia: la mitad del lienzo es semitransparente. */
function pngWithAlpha(): Buffer {
  const canvas = createCanvas(120, 120);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 128, 0, 0.5)';
  ctx.fillRect(0, 0, 60, 120);
  return canvas.encodeSync('png');
}

/** JPEG de unos 2 MB: ruido pseudoaleatorio determinista en un lienzo de 1600 × 1200. */
function heavyJpeg(seedValue: number): Buffer {
  const width = 1600;
  const height = 1200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const random = seeded(seedValue);
  for (let i = 0; i < image.data.length; i += 1) image.data[i] = Math.floor(random() * 256);
  ctx.putImageData(image, 0, 0);
  return canvas.encodeSync('jpeg', 95);
}

/** Abre «Crear PDF desde imágenes» desde la pantalla de inicio y entrega estos ficheros al selector. */
async function pickImages(page: Page, files: readonly { readonly name: string; readonly path: string }[]): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: imagesMsg.menuItem, exact: true }).click();
  await (await chooser).setFiles(files.map((file) => file.path));
}

function imagesDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: imagesMsg.title, exact: true });
}

/** Nombres de las imágenes de la lista, en orden. */
function imageNames(page: Page): Promise<string[]> {
  return imagesDialog(page).getByRole('listbox', { name: imagesMsg.list, exact: true }).getByRole('option').allTextContents();
}

/** Escribe los ficheros de prueba en la carpeta del test y devuelve sus rutas y bytes. */
function writeImages(testInfo: TestInfo): {
  readonly a: { readonly name: string; readonly path: string; readonly bytes: Buffer };
  readonly b: { readonly name: string; readonly path: string; readonly bytes: Buffer };
  readonly png: { readonly name: string; readonly path: string; readonly bytes: Buffer };
} {
  const make = (name: string, bytes: Buffer) => {
    const path = testInfo.outputPath(name);
    writeFileSync(path, bytes);
    return { name, path, bytes };
  };
  return {
    a: make('a.jpg', jpegOf(300, 200, '#cc2222')),
    b: make('b.jpg', jpegOf(200, 300, '#2244cc')),
    png: make('c.png', pngWithAlpha()),
  };
}

async function pageCountOf(path: string): Promise<number> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  const doc = await task.promise;
  const count = doc.numPages;
  await task.destroy();
  return count;
}

plain.describe('Crear PDF desde imágenes', () => {
  plain.beforeEach(async ({ page }) => {
    await useInputPicker(page);
    await disableFileSystemAccess(page);
  });

  plain('E2E: tres imágenes en el orden de la lista tras «Bajar»; el PDF tiene 3 páginas, la app lo abre y los JPEG van intactos', async ({ page }, testInfo) => {
    const { a, b, png } = writeImages(testInfo);
    await pickImages(page, [a, b, png]);
    const dialog = imagesDialog(page);
    await expect(dialog.getByRole('option')).toHaveCount(3);

    // La primera imagen (a.jpg) baja un puesto: el orden pasa a b.jpg, a.jpg, c.png.
    await dialog.getByRole('button', { name: `${imagesMsg.moveDown} a.jpg`, exact: true }).click();
    await expect.poll(() => imageNames(page)).toEqual(['b.jpg', 'a.jpg', 'c.png']);

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: imagesMsg.create, exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('b.pdf');
    const pdfPath = await storeDownload(file, testInfo, 'imagenes.pdf');

    expect(await pageCountOf(pdfPath)).toBe(3);
    const pdf = readFileSync(pdfPath);
    // Los JPEG se incrustan con sus bytes originales, en el orden de la lista.
    const posB = pdf.indexOf(b.bytes);
    const posA = pdf.indexOf(a.bytes);
    expect(posB).toBeGreaterThan(-1);
    expect(posA).toBeGreaterThan(posB);

    // La app abre el PDF descargado.
    await page.goto('/');
    await page.locator('[data-testid=open-input]').setInputFiles(pdfPath);
    await expect(page.getByTestId('viewer')).toBeVisible();
    await expectViewerReady(page);
  });

  plain('E2E: un PNG corrupto → aviso con su nombre y no se descarga nada', async ({ page }, testInfo) => {
    const { a } = writeImages(testInfo);
    const broken = testInfo.outputPath('roto.png');
    writeFileSync(broken, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x42]));
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });
    await pickImages(page, [a, { name: 'roto.png', path: broken }]);
    const dialog = imagesDialog(page);
    await expect(dialog.getByRole('option')).toHaveCount(2);

    await dialog.getByRole('button', { name: imagesMsg.create, exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: imagesMsg.cannotRead('roto.png') })).toBeVisible();
    expect(downloads).toBe(0);
  });

  plain('accesibilidad: el diálogo, con tema oscuro, no tiene violaciones de axe y se reordena solo con el teclado', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const { a, b } = writeImages(testInfo);
    await pickImages(page, [a, b]);
    const dialog = imagesDialog(page);
    await expect(dialog.getByRole('option')).toHaveCount(2);

    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations).toEqual([]);

    await dialog.getByRole('option', { name: 'a.jpg', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => imageNames(page)).toEqual(['b.jpg', 'a.jpg']);
    await expect(dialog.getByRole('option', { name: 'a.jpg', exact: true })).toBeFocused();
    await expect(dialog.getByRole('radio', { name: imagesMsg.a4, exact: true })).toBeChecked();
  });
});

perfTest('@perf: 20 JPEG de unos 2 MB sin tareas largas de más de 100 ms al crear el PDF', { tag: '@perf' }, async ({ page }, testInfo) => {
  await installPerfProbes(page);
  await useInputPicker(page);
  await disableFileSystemAccess(page);
  const files = Array.from({ length: 20 }, (_, i) => {
    const path = testInfo.outputPath(`foto-${String(i + 1)}.jpg`);
    writeFileSync(path, heavyJpeg(i + 1));
    return { name: `foto-${String(i + 1)}.jpg`, path };
  });
  await pickImages(page, files);
  const dialog = imagesDialog(page);
  await expect(dialog.getByRole('option')).toHaveCount(20);

  await clearLongTasks(page);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: imagesMsg.create, exact: true }).click();
  await download;
  const tasks = await longTasks(page);
  expect(Math.max(0, ...tasks)).toBeLessThan(100);
});
