import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { editMsg } from '../../src/ui/messages-edit.ts';
import { fixture, pageFrame, waitDraftSaved, waitPageRendered } from './helpers.ts';
import { commentRows, openInNewPage, openWithDownloads } from './annotations-kit.ts';

/** PNG de 1 × 1 píxel: la imagen de prueba de «Añadir imagen» (PDF-130). */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Carpeta temporal de la prueba, con ruta solo ASCII: Chromium no abre con `setInputFiles` los ficheros cuya ruta
 * lleva los caracteres «» del título de la prueba.
 */
function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'edit-content-'));
}

/** Ctrl+S, con la descarga guardada en `dir` (ruta ASCII). Devuelve la ruta del fichero. */
async function saveInto(page: Page, dir: string, name: string): Promise<string> {
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const path = join(dir, name);
  await (await download).saveAs(path);
  return path;
}

/** Barra «Editar» abierta (la abre con su botón de la barra principal si está cerrada). */
async function openEditBar(page: Page): Promise<Locator> {
  const bar = page.getByRole('toolbar', { name: editMsg.editButton });
  if ((await bar.count()) === 0) {
    await page.getByRole('button', { name: editMsg.editButton, exact: true }).click();
  }
  await expect(bar).toBeVisible();
  return bar;
}

/** Herramienta de la barra «Editar» activa (la pulsa si no lo está). */
async function pickEditTool(page: Page, name: string): Promise<void> {
  const bar = await openEditBar(page);
  const tool = bar.getByRole('button', { name, exact: true });
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
}

/** Campo del texto que se está escribiendo en el sitio. */
function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Texto del cuadro' });
}

/** Zonas de las anotaciones pendientes de la página 1 (lo añadido y aún sin guardar). */
function pendingZones(page: Page): Locator {
  return pageFrame(page, 1).locator('[data-annot-id]');
}

/** Dibujo de un texto del contenido de la página, tal como sale en el lienzo tras guardar y reabrir. */
function pageText(page: Page, text: string): Locator {
  return pageFrame(page, 1).locator('svg text', { hasText: text });
}

test('«Añadir texto» escribe en la página; tras guardar y reabrir, se busca y se copia, y no sale en comentarios', async ({
  page,
}) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await waitPageRendered(page, 1);
  await pickEditTool(page, editMsg.addText);

  await pageFrame(page, 1).click({ position: { x: 150, y: 150 } });
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Añadido por mí');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);

  const saved = await saveInto(page, scratchDir(), 'texto-anadido.pdf');
  const reopened = await openInNewPage(page, saved);
  await reopened.keyboard.press('Control+f');
  await reopened.getByRole('searchbox', { name: 'Buscar en el documento' }).fill('Añadido por mí');
  await expect(reopened.locator('.search-highlights .hit')).toHaveCount(1);
  await expect(pageFrame(reopened, 1).locator('.textLayer')).toContainText('Añadido por mí');

  // Panel de comentarios: el botón «Panel lateral» (si está cerrado) y su pestaña «Comentarios».
  const sidebar = reopened.getByRole('button', { name: 'Panel lateral', exact: true });
  if ((await sidebar.getAttribute('aria-pressed')) !== 'true') await sidebar.click();
  await reopened.getByRole('tab', { name: 'Comentarios' }).click();
  await expect(reopened.getByRole('listbox', { name: 'Comentarios del documento' })).toBeVisible();
  await expect(commentRows(reopened)).toHaveCount(0);
});

test('«Añadir imagen»: colocar, redimensionar, deshacer el tamaño, guardar; la imagen queda en la página, no como anotación', async ({
  page,
}) => {
  const dir = scratchDir();
  const png = join(dir, 'pixel.png');
  writeFileSync(png, PIXEL_PNG);
  // Sin el selector nativo: así el elegir imagen pasa por el `input` de fichero que Playwright atiende.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await waitPageRendered(page, 1);
  await openEditBar(page);

  const addImage = page.getByRole('button', { name: editMsg.addImage, exact: true });
  const chooser = page.waitForEvent('filechooser');
  await addImage.click();
  await (await chooser).setFiles(png);
  // La imagen se decodifica antes de quedar pendiente: la herramienta «Añadir imagen» se activa al terminar.
  await expect(addImage).toHaveAttribute('aria-pressed', 'true');

  await pageFrame(page, 1).click({ position: { x: 200, y: 200 } });
  await expect(pendingZones(page)).toHaveCount(1);
  await expect(pendingZones(page).locator('title')).toHaveText(editMsg.pendingContent);

  // Tras colocarla, el clic que la pone se considera de fondo y la deselecciona: se selecciona con un clic en ella.
  await pendingZones(page).click();
  const handle = pageFrame(page, 1).locator('[data-resize-id]');
  await expect(handle).toHaveCount(1);
  const outline = pendingZones(page).locator('rect').last();
  const before = await outline.getAttribute('width');
  const box = await handle.boundingBox();
  if (box === null) throw new Error('El tirador de tamaño no tiene caja');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect(outline).not.toHaveAttribute('width', before ?? '');

  await page.keyboard.press('Control+z');
  await expect(outline).toHaveAttribute('width', before ?? '');

  const saved = await saveInto(page, dir, 'imagen-anadida.pdf');
  const bytes = readFileSync(saved).toString('latin1');
  expect(bytes).toMatch(/\/Subtype\s*\/Image/);

  const reopened = await openInNewPage(page, saved);
  await expect(pendingZones(reopened)).toHaveCount(0);
});

test('con un texto añadido sin guardar, recargar ofrece «Recuperar» y lo restaura en la página', async ({ page }) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await waitPageRendered(page, 1);
  await pickEditTool(page, editMsg.addText);
  await pageFrame(page, 1).click({ position: { x: 150, y: 220 } });
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Texto sin guardar');
  await page.keyboard.press('Escape');
  await waitDraftSaved(page);

  await page.reload();
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('basic-5.pdf'));
  const dialog = page.getByRole('dialog', { name: /Hay cambios sin guardar de la última vez en «basic-5\.pdf»/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Recuperar' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(pendingZones(page)).toHaveCount(1);
  await expect(pageText(page, 'Texto sin guardar')).toHaveCount(1);
});

test('barra «Editar» abierta con «Añadir texto» activo: sin violaciones serious ni critical', async ({ page }, testInfo) => {
  await openWithDownloads(page, fixture('basic-5.pdf'));
  await pickEditTool(page, editMsg.addText);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  testInfo.annotations.push({ type: 'axe', description: `edit: ${String(results.violations.length)} violaciones en total` });
  expect(serious.map((v) => `${v.impact ?? '?'} ${v.id}: ${v.help}`)).toEqual([]);
});
