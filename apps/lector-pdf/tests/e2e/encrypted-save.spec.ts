import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { memorySource } from '@suite/platform';
import { printMsg } from '../../src/ui/messages-print.ts';
import { type ImportedPage } from '../../src/core/annotations/index.ts';
import { loadPdf, readPageAnnotations } from '../../src/engine/index.ts';
import { nodeAssetBase } from '../helpers/pdfjs-node.ts';
import { qpdfEncrypt } from '../fixtures/encrypted.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import { readFormFields } from '../support/form-fields.ts';
import { fixture, pageFrame, waitPageRendered } from './helpers.ts';
import {
  commentRows,
  createNoteWithText,
  openCommentsPanel,
  disableFileSystemAccess,
  dragOverLine,
  drawStroke,
  openWithDownloads,
  pickTool,
  saveWithCtrlS,
  wordBox,
  zigzagFrom,
  zoneOf,
} from './annotations-kit.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * Nota: los títulos van sin tildes ni «»: con esos caracteres Playwright crea carpetas de salida que la subida
 * de ficheros no abre (el reabrir fallaba sin mensaje).
 * Guardar con cifrado (PDF-047): Ctrl+S, Guardar como e Imprimir reutilizan la contraseña con la que se abrió el
 * PDF, sin volver a pedirla. Se comprueba con pdf.js en Node y con `qpdf --check`.
 */

const USER = 'usuario';
const NOTE_TEXT = 'Cifrado ñ €';
const FALLBACK_DATE = '2026-10-18T09:30:00.000Z';

/** Los cuatro cifrados que se guardan con la contraseña de usuario. */
const CIPHERS = [
  'encrypted-rc4-40.pdf',
  'encrypted-aes-128.pdf',
  'encrypted-aes-256.pdf',
  'encrypted-aes-256-objstm.pdf',
] as const;

/** Cuenta cuántas veces aparece el diálogo de contraseña en cada página (contexto: también las pestañas nuevas). */
async function countPasswordPrompts(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __passwordPrompts: number };
    w.__passwordPrompts = 0;
    const isPrompt = (el: Element): boolean =>
      el.getAttribute('role') === 'dialog' && (el.textContent ?? '').includes('Contraseña necesaria');
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (isPrompt(node) || Array.from(node.querySelectorAll('[role="dialog"]')).some(isPrompt)) {
            w.__passwordPrompts += 1;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

function passwordPrompts(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __passwordPrompts: number }).__passwordPrompts);
}

/** Abre un PDF cifrado con la contraseña de usuario en el diálogo y espera al visor. */
async function openEncrypted(page: Page, path: string, password: string = USER): Promise<void> {
  await disableFileSystemAccess(page);
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(path);
  const dialog = page.getByRole('dialog', { name: 'Contraseña necesaria' });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('textbox', { name: 'Contraseña' });
  await field.fill(password);
  await field.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
}

/** Resalta una palabra de la página 1 con doble clic y el botón «Resaltar» de la barra de selección. */
async function highlightWord(page: Page, word: string): Promise<void> {
  const box = await wordBox(page, 1, word);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const bar = page.getByRole('toolbar', { name: 'Acciones de la selección' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, 1, 'Resaltado de Usuario')).toHaveCount(1);
}

/** Anotaciones de la página 1 de un fichero, leídas con pdf.js en Node. */
async function firstPageOf(path: string, password?: string): Promise<{ readonly page: ImportedPage; readonly permissions: unknown }> {
  const loaded = await loadPdf(memorySource(new Uint8Array(readFileSync(path))), {
    assetBaseUrl: nodeAssetBase(),
    ...(password === undefined ? {} : { password }),
  });
  if (!loaded.ok) throw new Error(`pdf.js no abre el fichero: ${loaded.error.code}`);
  try {
    const page = await loaded.value.doc.getPage(1);
    return {
      page: await readPageAnnotations(page, FALLBACK_DATE),
      permissions: await loaded.value.doc.getPermissions(),
    };
  } finally {
    await loaded.value.destroy();
  }
}

/** Contenido de la nota y número de resaltados de la página 1. */
function summarize(imported: ImportedPage): { readonly notes: readonly string[]; readonly highlights: number } {
  const notes = imported.supported.flatMap((a) => (a.type === 'note' ? [a.contents] : []));
  const highlights = imported.supported.filter((a) => a.type === 'highlight' && a.quads.length > 0).length;
  return { notes, highlights };
}

/** Abre el fichero guardado en una pestaña nueva: pide la contraseña y muestra la página 1. */
async function reopenInNewTab(page: Page, path: string): Promise<Page> {
  const fresh = await page.context().newPage();
  await openEncrypted(fresh, path);
  return fresh;
}

for (const name of CIPHERS) {
  test(`${name}: anotar con usuario, Ctrl+S -> el fichero guardado tiene nota y resaltado, valida con qpdf y se reabre pidiendo contrasena`, async ({ page }, testInfo) => {
    await countPasswordPrompts(page.context());
    await openEncrypted(page, fixture(name));
    await highlightWord(page, 'Página');
    await createNoteWithText(page, NOTE_TEXT);

    const saved = await saveWithCtrlS(page, testInfo, `guardado-${name}`);
    const check = qpdfCheck(saved, USER);
    expect(check.code, check.output).toBe(0);
    expect(summarize((await firstPageOf(saved, USER)).page)).toEqual({ notes: [NOTE_TEXT], highlights: 1 });

    const fresh = await reopenInNewTab(page, saved);
    await expect(zoneOf(fresh, 1, 'Resaltado de Usuario')).toHaveCount(1);
    await expect(zoneOf(fresh, 1, 'Nota de Usuario')).toHaveCount(1);
    expect(await passwordPrompts(fresh)).toBe(1);
    expect(await passwordPrompts(page)).toBe(1);
  });
}

test('encrypted-owner-only.pdf: anotar y guardar sin pedir contrasena; el resultado conserva sus permisos', async ({ page }, testInfo) => {
  await countPasswordPrompts(page.context());
  const original = fixture('encrypted-owner-only.pdf');
  await openWithDownloads(page, original);
  await createNoteWithText(page, NOTE_TEXT);

  const saved = await saveWithCtrlS(page, testInfo, 'guardado-owner-only.pdf');
  expect(qpdfCheck(saved).code).toBe(0);
  const before = await firstPageOf(original);
  const after = await firstPageOf(saved);
  expect(after.permissions).toEqual(before.permissions);
  expect(summarize(after.page)).toEqual({ notes: [NOTE_TEXT], highlights: 0 });
  expect(await passwordPrompts(page)).toBe(0);
});

test('formularios cifrados (AES-256, form-full): rellenar y guardar con usuario -> pdf.js lee Cifrado y Si; qpdf valida', async ({ page }, testInfo) => {
  await countPasswordPrompts(page.context());
  const encrypted = join(testInfo.outputPath(), 'form-full-cifrado.pdf');
  const base = new Uint8Array(readFileSync(fixture('form-full.pdf')));
  writeFileSync(encrypted, qpdfEncrypt(base, ['--encrypt', USER, 'propietario', '256', '--']));
  await openEncrypted(page, encrypted);

  const p1 = (role: 'textbox' | 'checkbox', name: string): Locator =>
    pageFrame(page, 1).getByRole(role, { name, exact: true });
  await p1('textbox', 'nombre').fill('Cifrado');
  await p1('checkbox', 'acepto').check();

  const saved = await saveWithCtrlS(page, testInfo, 'form-full-cifrado-guardado.pdf');
  const check = qpdfCheck(saved, USER);
  expect(check.code, check.output).toBe(0);
  const fields = await readFormFields(new Uint8Array(readFileSync(saved)), USER);
  expect(fields.get('nombre')?.initial).toEqual({ kind: 'text', text: 'Cifrado' });
  expect(fields.get('acepto')?.initial).toEqual({ kind: 'checkbox', checked: true });
  expect(await passwordPrompts(page)).toBe(1);
});

/** Firma dibujada con «Firmar» → «Crear firma…» → Dibujar → Aceptar (como en signature.spec.ts). */
async function createDrawnSignature(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Crear firma…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear firma' });
  await expect(dialog).toBeVisible();
  const box = await dialog.getByLabel('Área para dibujar la firma').boundingBox();
  if (box === null) throw new Error('sin caja para dibujar');
  await drawStroke(page, zigzagFrom({ x: box.x + 40, y: box.y + box.height / 2 }, 20));
  await dialog.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('firma dibujada en encrypted-aes-128.pdf: se guarda con cifrado y sigue visible tras reabrir', async ({ page }, testInfo) => {
  await countPasswordPrompts(page.context());
  await openEncrypted(page, fixture('encrypted-aes-128.pdf'));
  await createDrawnSignature(page);
  const frame = await pageFrame(page, 1).boundingBox();
  if (frame === null) throw new Error('sin caja de la página 1');
  await page.mouse.click(frame.x + 200, frame.y + 200);
  await expect(zoneOf(page, 1, 'Firma')).toHaveCount(1);

  const saved = await saveWithCtrlS(page, testInfo, 'firma-cifrada.pdf');
  const check = qpdfCheck(saved, USER);
  expect(check.code, check.output).toBe(0);
  expect((await firstPageOf(saved, USER)).page.foreign.filter((a) => a.subtype === 'Stamp')).toHaveLength(1);

  const fresh = await reopenInNewTab(page, saved);
  // La firma reabierta es un sello de solo lectura: sin zona editable, pero en el panel de comentarios.
  // La etiqueta puede ser «Firma» o «Sello» según la lectura del nombre del sello (PDF-103/104).
  await expect(zoneOf(fresh, 1, 'Firma')).toHaveCount(0);
  await openCommentsPanel(fresh);
  await expect(commentRows(fresh).filter({ hasText: /Firma|Sello/ })).toHaveCount(1);
});

/** Sustituye `window.print` por una función que cuenta las llamadas y lee las hojas (imágenes) antes de liberarlas. */
async function probePrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printCount: number; __sheets: Promise<string[]> };
    w.__printCount = 0;
    window.print = (): void => {
      w.__printCount += 1;
      const sources = Array.from(document.querySelectorAll<HTMLImageElement>('#print-container img'), (img) => img.src);
      w.__sheets = Promise.all(
        sources.map(async (src) => {
          const blob = await (await fetch(src)).blob();
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => { resolve(String(reader.result)); };
            reader.readAsDataURL(blob);
          });
        }),
      );
    };
  });
}

/** Píxeles amarillos (resaltado) de las hojas impresas. */
async function yellowPixelsOf(page: Page): Promise<number> {
  const sheets = await page.evaluate(() => (window as unknown as { __sheets: Promise<string[]> }).__sheets);
  return page.evaluate(async (urls) => {
    let total = 0;
    for (const url of urls) {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('sin contexto 2D');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) > 180 && (data[i + 2] ?? 255) < 150) total += 1;
      }
    }
    return total;
  }, sheets);
}

test('imprimir la pagina 1 de encrypted-aes-256.pdf con una anotacion sin guardar: sale en la impresion y sin aviso', async ({ page }) => {
  await countPasswordPrompts(page.context());
  await probePrint(page);
  await openEncrypted(page, fixture('encrypted-aes-256.pdf'));
  await pickTool(page, 'Resaltar');
  await dragOverLine(page, 0);

  await page.keyboard.press('Control+P');
  const dialog = page.getByRole('dialog', { name: 'Imprimir', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Página actual (1)', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Imprimir comentarios' }).check();
  await dialog.getByRole('button', { name: 'Imprimir', exact: true }).click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __printCount: number }).__printCount)).toBe(1);
  await expect(page.getByText(printMsg.unsavedNotIncluded)).toHaveCount(0);
  expect(await yellowPixelsOf(page)).toBeGreaterThan(0);
  expect(await passwordPrompts(page)).toBe(1);
});
