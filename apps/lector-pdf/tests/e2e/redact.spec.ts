import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { editMsg } from '../../src/ui/messages-edit.ts';
import { redactMsg } from '../../src/ui/messages-redact.ts';
import { openWithDownloads, storeDownload } from './annotations-kit.ts';
import { fixture, waitPageRendered } from './helpers.ts';
import { qpdfCheck } from '../support/qpdf.ts';

/** Abre «Editar» y «Redactar» con el ratón. */
async function openRedact(page: Page): Promise<void> {
  await page.getByRole('button', { name: editMsg.editButton, exact: true }).click();
  await page.getByRole('button', { name: redactMsg.tool, exact: true }).click();
}

/** Ctrl+F y la consulta. */
async function search(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+f');
  const field = page.getByRole('searchbox', { name: 'Buscar en el documento' });
  await expect(field).toBeFocused();
  await field.fill(query);
}

/** Texto de todas las páginas, con `pdftotext` (sobre el fichero descargado). */
function pdfText(path: string): string {
  return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
}

function applyButton(page: Page, count: number): Locator {
  return page.getByRole('button', { name: redactMsg.apply(count), exact: true });
}

test.describe('redactar en basic-5.pdf', () => {
  test('criterio original: «Página 3» buscada, marcada y aplicada: el texto desaparece del PDF guardado', async ({
    page,
  }, testInfo) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await search(page, 'Página 3');
    await expect(page.getByText('1 de 1', { exact: true })).toBeVisible();
    await openRedact(page);

    await page.getByRole('button', { name: redactMsg.markSearch, exact: true }).click();
    await expect(page.getByText(redactMsg.marked(1), { exact: true })).toBeVisible();
    await applyButton(page, 1).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: redactMsg.confirmApply, exact: true }).click();
    const copy = await storeDownload(await downloaded, testInfo, 'redactado.pdf');

    const text = pdfText(copy);
    expect(text).not.toContain('Página 3');
    expect(text).toContain('Página 2');
    expect(text).toContain('Página 4');
    // Los bytes (sin comprimir) tampoco contienen el texto redactado.
    const qdf = execFileSync('qpdf', ['--qdf', '--object-streams=disable', copy, '-'], { maxBuffer: 64 * 1024 * 1024 });
    expect(qdf.includes(Buffer.from('Página 3', 'latin1'))).toBe(false);
    expect(qpdfCheck(copy).code).toBe(0);
  });

  test('zonas: arrastrar, Escape cancela, deshacer y rehacer; «Cancelar» no cambia nada', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await openRedact(page);
    // Accesibilidad: la barra «Redactar» sin violaciones de axe.
    const axe = await new AxeBuilder({ page }).include('[role="group"][aria-label="Redactar"]').analyze();
    expect(axe.violations).toEqual([]);
    const pageBox = await page.locator('[data-page-index="0"]').boundingBox();
    if (pageBox === null) throw new Error('la página 1 no tiene caja');
    const x = pageBox.x + 120;
    const y = pageBox.y + 160;

    // Escape cancela el arrastre y la herramienta sigue activa.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y + 60);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(applyButton(page, 0)).toBeDisabled();
    await expect(page.getByRole('button', { name: redactMsg.tool, exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Un arrastre crea una zona; Ctrl+Z la quita y Ctrl+Y la vuelve a poner.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y + 60, { steps: 4 });
    await page.mouse.up();
    await expect(applyButton(page, 1)).toBeEnabled();
    await page.keyboard.press('Control+z');
    await expect(applyButton(page, 0)).toBeDisabled();
    await page.keyboard.press('Control+y');
    await expect(applyButton(page, 1)).toBeEnabled();

    // Supr quita la marca enfocada.
    await page.getByRole('group', { name: redactMsg.mark(1), exact: true }).focus();
    await page.keyboard.press('Delete');
    await expect(applyButton(page, 0)).toBeDisabled();

    // «Cancelar» en la confirmación no cambia nada: no hay descarga y la marca sigue.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y + 60, { steps: 4 });
    await page.mouse.up();
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });
    await applyButton(page, 1).click();
    await page.getByRole('button', { name: redactMsg.cancel, exact: true }).click();
    await expect(applyButton(page, 1)).toBeEnabled();
    expect(downloads).toBe(0);
  });

  test('con marcas sin aplicar, cerrar su pestaña pregunta', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));
    await openRedact(page);
    const pageBox = await page.locator('[data-page-index="0"]').boundingBox();
    if (pageBox === null) throw new Error('la página 1 no tiene caja');
    await page.mouse.move(pageBox.x + 120, pageBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 300, pageBox.y + 220, { steps: 4 });
    await page.mouse.up();
    // Una segunda pestaña hace visible la barra de pestañas; la primera queda con cambios sin aplicar.
    await page.locator('[data-testid=open-input]').setInputFiles(fixture('scanned-es-3.pdf'));
    await waitPageRendered(page, 1);
    // El botón de cerrar la pestaña va fuera del árbol de accesibilidad: se localiza por su título.
    await page.locator('[title="Cerrar “basic-5.pdf”"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('redactar una imagen en scanned-es-3.pdf', () => {
  test('una zona sobre la imagen: la página sigue siendo una imagen con la zona en negro', async ({ page }, testInfo) => {
    await openWithDownloads(page, fixture('scanned-es-3.pdf'));
    await openRedact(page);
    const pageBox = await page.locator('[data-page-index="0"]').boundingBox();
    if (pageBox === null) throw new Error('la página 1 no tiene caja');
    const x0 = pageBox.x + pageBox.width * 0.1;
    const y0 = pageBox.y + pageBox.height * 0.1;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + pageBox.width * 0.4, y0 + pageBox.height * 0.2, { steps: 4 });
    await page.mouse.up();

    await applyButton(page, 1).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: redactMsg.confirmApply, exact: true }).click();
    const copy = await storeDownload(await downloaded, testInfo, 'escaneado-redactado.pdf');
    expect(qpdfCheck(copy).code).toBe(0);
    await expect(page.getByText(redactMsg.done(1), { exact: true })).toBeVisible();

    // Reabre la copia y comprueba que la zona se ve negra en el lienzo de la página 1.
    await openWithDownloads(page, copy);
    await waitPageRendered(page, 1);
    const blackPixels = await page.evaluate(
      ({ fx, fy }: { fx: number; fy: number }) => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-page-index="0"] canvas');
        if (canvas === null) throw new Error('la página 1 no tiene lienzo');
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('el lienzo no da contexto');
        const sx = Math.floor(canvas.width * fx);
        const sy = Math.floor(canvas.height * fy);
        const data = context.getImageData(sx, sy, Math.floor(canvas.width * 0.3), Math.floor(canvas.height * 0.1)).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i] ?? 255) < 16 && (data[i + 1] ?? 255) < 16 && (data[i + 2] ?? 255) < 16) dark += 1;
        }
        return dark / (data.length / 4);
      },
      { fx: 0.12, fy: 0.12 },
    );
    expect(blackPixels).toBeGreaterThan(0.5);
  });
});
