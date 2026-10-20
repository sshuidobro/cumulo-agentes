import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { ocrMsg } from '../../src/ui/messages-ocr.ts';
import { printMsg } from '../../src/ui/messages-print.ts';
import { openWithDownloads } from './annotations-kit.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks } from './helpers.ts';

/** El OCR de tres páginas en el WASM de tesseract tarda; el tiempo de cada prueba lo refleja. */
const OCR_TIMEOUT = 300_000;

function searchField(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Buscar en el documento' });
}

/** Ctrl+F y la consulta. La búsqueda empieza tras el *debounce*. */
async function search(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+f');
  await expect(searchField(page)).toBeFocused();
  await searchField(page).fill(query);
}

/** «Más acciones» → «Reconocer texto (OCR)…» con el ratón. Devuelve el diálogo. */
async function openOcr(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Más acciones', exact: true }).click();
  await page.getByRole('menuitem', { name: ocrMsg.menuItem, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: ocrMsg.title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Violaciones de axe dentro del diálogo. */
async function dialogViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  return results.violations;
}

test.describe('reconocer texto (OCR) en scanned-es-3.pdf', () => {
  test.setTimeout(OCR_TIMEOUT);
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('tras reconocer, «Panadería», «arrendatario» y «eléctrica» se buscan y el importe se copia; sin red', async ({
    page,
  }) => {
    await openWithDownloads(page, fixture('scanned-es-3.pdf'));
    const appOrigin = new URL(page.url()).origin;
    const requests: string[] = [];
    page.on('request', (request) => {
      requests.push(request.url());
    });

    await search(page, 'Panadería');
    await expect(page.locator('.search-highlights .hit')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // En la web, «Guardar» descarga una copia y el documento abierto sigue siendo el original:
    // para comprobar el resultado se reabre la copia descargada.
    const dialog = await openOcr(page);
    const downloaded = page.waitForEvent('download', { timeout: OCR_TIMEOUT });
    await dialog.getByRole('button', { name: ocrMsg.run, exact: true }).click();
    const copy = await downloaded;
    await expect(page.getByText(ocrMsg.done(3), { exact: true })).toBeVisible();

    await openWithDownloads(page, await copy.path());
    await search(page, 'Panadería');
    await expect(page.getByText('1 de 1', { exact: true })).toBeVisible();
    await expect(page.locator('[data-page-index="0"]')).toBeInViewport({ ratio: 0.2 });

    await search(page, 'arrendatario');
    await expect(page.getByText('1 de 1', { exact: true })).toBeVisible();
    await expect(page.locator('[data-page-index="1"]')).toBeInViewport({ ratio: 0.2 });

    await search(page, 'eléctrica');
    await expect(page.getByText('1 de 1', { exact: true })).toBeVisible();
    await expect(page.locator('[data-page-index="2"]')).toBeInViewport({ ratio: 0.2 });

    // Seleccionar la línea del importe (desde «Importe» hasta «1.234,56») y copiarla.
    await page.evaluate(() => {
      const layer = document.querySelector('[data-page-index="0"] .textLayer');
      if (layer === null) throw new Error('la página 1 no tiene capa de texto');
      const spans = Array.from(layer.querySelectorAll('span'));
      const first = spans.find((span) => /Importe/.test(span.textContent ?? ''));
      const last = spans.find((span) => /1\.234,56/.test(span.textContent ?? ''));
      if (first === undefined || last === undefined) throw new Error('no está el importe en la capa de texto');
      const range = document.createRange();
      range.setStartBefore(first);
      range.setEndAfter(last);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await page.keyboard.press('Control+c');
    await expect(async () => {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1.234,56');
    }).toPass();

    // Sin red: ninguna petición fuera del origen de la app (ni blob/data, que son locales).
    const external = requests.filter(
      (url) => !url.startsWith(appOrigin) && !url.startsWith('blob:') && !url.startsWith('data:'),
    );
    expect(external).toEqual([]);
  });

  test('«Cancelar» a mitad no descarga nada y no avisa de terminado', async ({ page }) => {
    await openWithDownloads(page, fixture('scanned-es-3.pdf'));

    let downloaded = false;
    page.once('download', () => {
      downloaded = true;
    });
    const dialog = await openOcr(page);
    await dialog.getByRole('button', { name: ocrMsg.run, exact: true }).click();
    const progress = page.getByRole('dialog', { name: ocrMsg.title, exact: true });
    await expect(progress).toBeVisible();
    await progress.getByRole('button', { name: ocrMsg.cancel, exact: true }).click();
    await expect(progress).toBeHidden();

    await expect(page.getByText(ocrMsg.done(3), { exact: true })).toHaveCount(0);
    expect(downloaded).toBe(false);
  });

  test('el diálogo es operable con teclado y no tiene violaciones de axe', async ({ page }) => {
    await openWithDownloads(page, fixture('scanned-es-3.pdf'));

    const dialog = await openOcr(page);
    await expect(dialog.getByRole('combobox', { name: ocrMsg.language, exact: true })).toBeFocused();
    expect(await dialogViolations(page)).toEqual([]);

    await dialog.getByRole('radio', { name: printMsg.rangePages, exact: true }).check();
    await dialog.getByRole('textbox', { name: printMsg.rangeField }).fill('9');
    await expect(dialog.getByRole('button', { name: ocrMsg.run, exact: true })).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('reconocer texto (OCR) en basic-5.pdf', () => {
  test('con «Omitir páginas que ya tienen texto», basic-5.pdf avisa de que todas tienen texto', async ({ page }) => {
    await openWithDownloads(page, fixture('basic-5.pdf'));

    const dialog = await openOcr(page);
    await dialog.getByRole('checkbox', { name: ocrMsg.skipText, exact: true }).check();
    await dialog.getByRole('button', { name: ocrMsg.run, exact: true }).click();

    await expect(page.getByText(ocrMsg.allHaveText, { exact: true })).toBeVisible();
  });
});

test.describe('reconocer texto (OCR) · long tasks (@perf)', () => {
  test.setTimeout(OCR_TIMEOUT);

  test('@perf durante el OCR no hay long tasks de más de 100 ms', { tag: '@perf' }, async ({ page }) => {
    await installPerfProbes(page);
    await openWithDownloads(page, fixture('scanned-es-3.pdf'));
    await clearLongTasks(page);

    const dialog = await openOcr(page);
    const downloaded = page.waitForEvent('download', { timeout: OCR_TIMEOUT });
    await dialog.getByRole('button', { name: ocrMsg.run, exact: true }).click();
    await downloaded;

    const slowest = Math.max(0, ...(await longTasks(page)));
    expect(slowest).toBeLessThanOrEqual(100);
  });
});
