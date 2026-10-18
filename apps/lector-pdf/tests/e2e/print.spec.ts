import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test } from './perf-fixture.ts';
import { clearLongTasks, heapMB, installPerfProbes, longTasks, openFixture, waitPageRendered } from './helpers.ts';
import { dragOverLine, pickTool } from './annotations-kit.ts';

/** Lo que el diálogo de impresión deja en la página, copiado al llamar a `window.print` (antes de liberarlo). */
interface PrintSnapshot {
  readonly html: string;
  /** Data URL de cada `blob:` del contenedor, por la URL original. */
  readonly images: Readonly<Record<string, string>>;
}

/** Lo que añade `installPrintProbes` a la ventana. */
interface PrintProbeWindow {
  __printCount: number;
  __urlsCreated: number;
  __urlsRevoked: number;
  __printSnapshot?: Promise<PrintSnapshot>;
}

/**
 * Sustituye `window.print` por una función que cuenta la llamada y copia el contenedor de impresión. Lleva la cuenta
 * de las URL de blob creadas y revocadas. Las imágenes se leen como data URL porque la app las libera al terminar.
 */
async function installPrintProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as PrintProbeWindow;
    w.__printCount = 0;
    w.__urlsCreated = 0;
    w.__urlsRevoked = 0;
    const blobs = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = create(object);
      w.__urlsCreated += 1;
      if (object instanceof Blob) blobs.set(url, object);
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      w.__urlsRevoked += 1;
      revoke(url);
    };
    const toDataUrl = (blob: Blob): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { resolve(String(reader.result)); };
        reader.onerror = () => { reject(new Error('no se ha podido leer la hoja')); };
        reader.readAsDataURL(blob);
      });
    window.print = (): void => {
      w.__printCount += 1;
      const html = document.getElementById('print-container')?.innerHTML ?? '';
      const urls = Array.from(html.matchAll(/blob:[^"]+/g), (match) => match[0]);
      w.__printSnapshot = Promise.all(
        urls.map(async (url) => {
          const blob = blobs.get(url);
          return [url, blob === undefined ? '' : await toDataUrl(blob)] as const;
        }),
      ).then((pairs) => ({ html, images: Object.fromEntries(pairs) }));
    };
  });
}

/** Abre el diálogo con Ctrl+P y espera a que esté visible. */
async function openPrintDialog(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+P');
  const dialog = page.getByRole('dialog', { name: 'Imprimir', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Pulsa «Imprimir» dentro del diálogo indicado (el nombre accesible del botón de la barra es el mismo). */
async function pressPrint(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Imprimir', exact: true }).click();
}

async function printCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as PrintProbeWindow).__printCount);
}

async function urlBalance(page: Page): Promise<{ readonly created: number; readonly revoked: number }> {
  return page.evaluate(() => {
    const w = window as unknown as PrintProbeWindow;
    return { created: w.__urlsCreated, revoked: w.__urlsRevoked };
  });
}

/** Instantánea de la última impresión. Falla si no ha habido ninguna. */
async function lastSnapshot(page: Page): Promise<PrintSnapshot> {
  const snapshot = await page.evaluate(() => (window as unknown as PrintProbeWindow).__printSnapshot ?? null);
  if (snapshot === null) throw new Error('no hay ninguna impresión registrada');
  return snapshot;
}

/** Hojas del contenedor: tamaño y giro de cada una (lee el HTML copiado, sin tocar la página). */
async function sheetsOf(page: Page, html: string): Promise<readonly { readonly width: string; readonly height: string; readonly rotate: string | null; readonly transform: string }[]> {
  return page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    return Array.from(doc.querySelectorAll<HTMLElement>('.sheet'), (sheet) => {
      const img = sheet.querySelector<HTMLImageElement>('img');
      return {
        width: sheet.style.width,
        height: sheet.style.height,
        rotate: img?.dataset['rotate'] ?? null,
        transform: img?.style.transform ?? '',
      };
    });
  }, html);
}

/**
 * Reconstruye el documento de impresión con las hojas copiadas y lo convierte a PDF con `page.pdf()`
 * (medios de impresión y tamaño CSS de página). Así se comprueba el PDF que sale de la impresión.
 */
async function printedPdf(page: Page, snapshot: PrintSnapshot): Promise<Buffer> {
  await page.evaluate((copied) => {
    const container = document.getElementById('print-container');
    if (container === null) throw new Error('falta #print-container');
    let markup = copied.html;
    for (const [url, dataUrl] of Object.entries(copied.images)) markup = markup.split(url).join(dataUrl);
    container.innerHTML = markup;
  }, snapshot);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.evaluate(() => {
    const container = document.getElementById('print-container');
    if (container !== null) container.innerHTML = '';
  });
  return pdf;
}

async function pageCountOf(pdf: Buffer): Promise<number> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const count = doc.numPages;
  await task.destroy();
  return count;
}

/** Píxeles de color amarillo de resaltado (RGB ≈ 255, 235, 59) en una hoja. */
async function yellowPixels(page: Page, dataUrl: string): Promise<number> {
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
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) > 180 && (data[i + 2] ?? 0) < 160) count += 1;
    }
    return count;
  }, dataUrl);
}

/** Violaciones de axe de impacto grave o crítico (el informe de axe se adjunta en el fallo). */
async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help}`);
}

test.describe('imprimir', () => {
  test('el rango 2-4 de pages-5000 imprime una vez y el PDF tiene 3 páginas; todo queda liberado', async ({ page }) => {
    await installPrintProbes(page);
    await openFixture(page, 'pages-5000.pdf');

    const dialog = await openPrintDialog(page);
    await dialog.getByRole('radio', { name: 'Páginas', exact: true }).check();
    await dialog.getByRole('textbox', { name: 'Rango de páginas' }).fill('2-4');
    await pressPrint(dialog);

    await expect(dialog).toBeHidden();
    await expect.poll(() => printCount(page)).toBe(1);
    const snapshot = await lastSnapshot(page);
    expect(await sheetsOf(page, snapshot.html)).toHaveLength(3);

    await expect.poll(() => urlBalance(page)).toEqual({ created: 3, revoked: 3 });
    await expect(page.locator('#print-container')).toBeEmpty();

    const pdf = await printedPdf(page, snapshot);
    expect(await pageCountOf(pdf)).toBe(3);
  });

  test('sin comentarios no sale ningún resaltado; con comentarios sí (resaltado sin guardar en la página 1)', async ({ page }) => {
    await installPrintProbes(page);
    await openFixture(page, 'basic-5.pdf');
    await waitPageRendered(page, 1);
    await pickTool(page, 'Resaltar');
    await dragOverLine(page, 0);

    const dialog = await openPrintDialog(page);
    await dialog.getByRole('radio', { name: 'Página actual (1)', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Imprimir comentarios' }).check();
    await pressPrint(dialog);
    await expect.poll(() => printCount(page)).toBe(1);
    const withComments = await lastSnapshot(page);
    const withSheet = Object.values(withComments.images)[0] ?? '';
    expect(await yellowPixels(page, withSheet)).toBeGreaterThan(0);

    const again = await openPrintDialog(page);
    await again.getByRole('radio', { name: 'Página actual (1)', exact: true }).check();
    await again.getByRole('checkbox', { name: 'Imprimir comentarios' }).uncheck();
    await pressPrint(again);
    await expect.poll(() => printCount(page)).toBe(2);
    const withoutComments = await lastSnapshot(page);
    const withoutSheet = Object.values(withoutComments.images)[0] ?? '';
    expect(await yellowPixels(page, withoutSheet)).toBe(0);
  });

  test('sizes-mixed con orientación automática: 6 hojas del tamaño de la página 1 y la 2 (horizontal) girada', async ({ page }) => {
    await installPrintProbes(page);
    await openFixture(page, 'sizes-mixed.pdf');

    const dialog = await openPrintDialog(page);
    await dialog.getByRole('radio', { name: 'Todas', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Orientación automática' }).check();
    await pressPrint(dialog);
    await expect.poll(() => printCount(page)).toBe(1);

    const sheets = await sheetsOf(page, (await lastSnapshot(page)).html);
    expect(sheets).toHaveLength(6);
    for (const sheet of sheets) {
      expect(sheet.width).toBe('595pt');
      expect(sheet.height).toBe('842pt');
    }
    expect(sheets[1]?.rotate).toBe('90');
    expect(sheets[1]?.transform).toBe('translate(-50%, -50%) rotate(90deg)');
    expect(sheets[0]?.rotate).toBe('0');
  });

  test('el diálogo tiene foco en «Imprimir», valida el rango, se cierra con Esc y no tiene incidencias de accesibilidad graves', async ({ page }) => {
    await openFixture(page, 'basic-5.pdf');
    const dialog = await openPrintDialog(page);
    await expect(dialog.getByRole('button', { name: 'Imprimir', exact: true })).toBeFocused();
    expect(await seriousViolations(page)).toEqual([]);

    const range = dialog.getByRole('textbox', { name: 'Rango de páginas' });
    await range.fill('0');
    await expect(dialog.getByRole('alert')).toContainText('Escribe páginas entre 1 y 5, por ejemplo 1-3, 5');
    await expect(dialog.getByRole('button', { name: 'Imprimir', exact: true })).toBeDisabled();
    await range.fill('1-9999');
    await expect(dialog.getByRole('button', { name: 'Imprimir', exact: true })).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('@perf pages-5000: 20 páginas sin long tasks de más de 100 ms y heap < 400 MB; Cancelar a mitad libera en < 300 ms', { tag: '@perf' }, async ({ page }) => {
    await installPrintProbes(page);
    await installPerfProbes(page);
    await openFixture(page, 'pages-5000.pdf');
    await clearLongTasks(page);

    const dialog = await openPrintDialog(page);
    await dialog.getByRole('radio', { name: 'Páginas', exact: true }).check();
    await dialog.getByRole('textbox', { name: 'Rango de páginas' }).fill('1-20');
    await pressPrint(dialog);
    await expect.poll(() => printCount(page)).toBe(1);
    const slowest = Math.max(0, ...(await longTasks(page)));
    expect(slowest, 'ninguna long task > 100 ms durante la preparación').toBeLessThan(100);
    expect(await heapMB(page), 'heap tras imprimir').toBeLessThan(400);

    // Todas las páginas: pide confirmación; tras «Imprimir» se prepara y se cancela a mitad.
    const all = await openPrintDialog(page);
    await all.getByRole('radio', { name: 'Todas', exact: true }).check();
    await pressPrint(all);
    const confirm = page.getByRole('dialog', { name: 'Imprimir muchas páginas', exact: true });
    await confirm.getByRole('button', { name: 'Imprimir', exact: true }).click();
    const progress = page.getByRole('dialog', { name: 'Preparando la impresión', exact: true });
    await expect(progress).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await progress.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(progress).toBeHidden({ timeout: 300 });
    await expect.poll(() => printCount(page)).toBe(1);
  });
});
