import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFormFields } from '../support/form-fields.ts';
import { qpdfCheck } from '../support/qpdf.ts';
import { liveAnnotations } from './annotations-live.ts';
import {
  AUTHOR,
  commentRows,
  openCommentsPanel,
  openFixtureWithDownloads,
  openInNewPage,
  optionName,
  saveWithCtrlS,
  zoneOf,
} from './annotations-kit.ts';
import { pageFrame } from './helpers.ts';

/**
 * Flujo completo de la iteración 3 (ADR-0019, ADR-0020, ADR-0021) sobre `form-full.pdf`: rellenar el formulario,
 * colocar una firma dibujada, resaltar texto, imprimir la p1, guardar con Ctrl+S y reabrir lo descargado.
 */

const FORM = 'form-full.pdf';
/** Punto de colocación de la firma en la página 1 (px a escala 1), por debajo de los campos. */
const SIGNATURE_AT = { x: 150, y: 600 };
/** Tipo de anotación de la firma en el panel y en la zona activa («Firma de…»). */
const SIGNATURE_KIND = 'Firma';

/** Lo que el diálogo de impresión deja en la página, copiado al llamar a `window.print` (antes de liberarlo). */
interface PrintSnapshot {
  readonly html: string;
  readonly images: Readonly<Record<string, string>>;
}

/** Lo que añade `installPrintProbes` a la ventana. */
interface PrintProbeWindow {
  __printCount: number;
  __printSnapshot?: Promise<PrintSnapshot>;
}

/** Sustituye `window.print` por una función que cuenta la llamada y copia el contenedor de impresión. */
async function installPrintProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as PrintProbeWindow;
    w.__printCount = 0;
    const blobs = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = create(object);
      if (object instanceof Blob) blobs.set(url, object);
      return url;
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

/** Selecciona en la capa de texto de la página `n` (1-based) la primera aparición de `word`; falla si no está. */
async function selectTextInPage(page: Page, n: number, word: string): Promise<void> {
  const found = await page.evaluate(
    ({ index, text }) => {
      const layer = document.querySelector(`[data-testid=viewer] [data-page-index="${String(index)}"] .textLayer`);
      if (layer === null) return false;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = (node.textContent ?? '').indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
      }
      return false;
    },
    { index: n - 1, text: word },
  );
  if (!found) throw new Error(`no encuentro «${word}» en la página ${String(n)}`);
}

/** Pulsa «Firmar», «Crear firma…», dibuja en el lienzo y acepta. */
async function createDrawnSignature(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Crear firma…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear firma' });
  await expect(dialog).toBeVisible();
  const box = await dialog.getByLabel('Área para dibujar la firma').boundingBox();
  if (box === null) throw new Error('el lienzo de la firma no tiene caja');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (const [dx, dy] of [[60, -20], [100, 20], [140, -20], [180, 20]] as const) {
    await page.mouse.move(box.x + 40 + dx, y + dy, { steps: 6 });
  }
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Imprime solo la página 1 con el diálogo (Ctrl+P) y devuelve el PDF que produce `page.pdf()` a partir de la copia. */
async function printFirstPage(page: Page): Promise<Buffer> {
  await page.keyboard.press('Control+P');
  const dialog = page.getByRole('dialog', { name: 'Imprimir', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Páginas', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Rango de páginas' }).fill('1');
  await dialog.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as PrintProbeWindow).__printCount)).toBe(1);
  // El `Promise` de la copia se resuelve al devolverlo desde `evaluate`.
  const snapshot = await page.evaluate(() => (window as unknown as PrintProbeWindow).__printSnapshot ?? null);
  if (snapshot === null) throw new Error('no hay ninguna impresión registrada');
  await page.evaluate((copy) => {
    const container = document.getElementById('print-container');
    if (container === null) throw new Error('falta #print-container');
    let markup = copy.html;
    for (const [url, dataUrl] of Object.entries(copy.images)) markup = markup.split(url).join(dataUrl);
    container.innerHTML = markup;
  }, snapshot);
  const out = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.evaluate(() => {
    const container = document.getElementById('print-container');
    if (container !== null) container.innerHTML = '';
  });
  return out;
}

/** Número de imágenes pintadas por cada página de un PDF (0 si una página sale vacía). */
async function imagesPerPage(pdf: Buffer): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const counts: number[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const ops = await page.getOperatorList();
    counts.push(ops.fnArray.filter((fn) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject).length);
    page.cleanup();
  }
  await task.destroy();
  return counts;
}

test('form-full.pdf: rellenar, firmar, resaltar, imprimir la p1, guardar y reabrir con todo', async ({ page }, testInfo: TestInfo) => {
  await installPrintProbes(page);
  await openFixtureWithDownloads(page, FORM);
  const p1 = pageFrame(page, 1);

  // Resaltado de la palabra «Formulario» del título de la p1 (doble clic y «Resaltar» de la barra de selección).
  // Va antes de tocar el formulario: el visor sigue en la parte alta de la página.
  // El título queda bajo el campo «comentarios» (un widget tapa el texto), así que la selección se hace en la capa
  // de texto con el DOM, no con el ratón: la barra de acciones reacciona al cambio de selección como con el ratón.
  await selectTextInPage(page, 1, 'Formulario');
  const bar = page.getByRole('toolbar', { name: 'Acciones de la selección' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Resaltar' }).click();
  await expect(zoneOf(page, 1, 'Resaltado de')).toHaveCount(1);

  // Formulario: texto, casilla, botón de opción y combo.
  await p1.getByRole('textbox', { name: 'nombre', exact: true }).fill('María José');
  await p1.getByRole('checkbox', { name: 'acepto' }).check();
  await p1.getByRole('radio', { name: 'color: Azul' }).check();
  const country = p1.getByRole('combobox', { name: 'pais' });
  await country.focus();
  await page.keyboard.press('p');
  await expect(country).toHaveValue('pt');

  // Firma dibujada, colocada con un clic en la p1.
  await createDrawnSignature(page);
  const frame = await pageFrame(page, 1).boundingBox();
  if (frame === null) throw new Error('la página 1 no tiene caja');
  await page.mouse.click(frame.x + SIGNATURE_AT.x, frame.y + SIGNATURE_AT.y);
  await expect(zoneOf(page, 1, SIGNATURE_KIND)).toHaveCount(1);

  // Impresión de la p1: el PDF impreso tiene una página, con imagen, y es válido para qpdf.
  const printed = await printFirstPage(page);
  const printedPath = testInfo.outputPath('impresion-pagina-1.pdf');
  writeFileSync(printedPath, printed);
  const printedCheck = qpdfCheck(printedPath);
  expect(printedCheck.code, printedCheck.output).toBe(0);
  expect(await imagesPerPage(printed), 'la página impresa no sale en blanco').toEqual([1]);

  // Ctrl+S: el fichero descargado es válido y lleva los valores, la firma (Stamp) y el resaltado.
  const saved = await saveWithCtrlS(page, testInfo, 'form-full-iteracion-3.pdf');
  const check = qpdfCheck(saved);
  expect(check.code, check.output).toBe(0);
  const fields = await readFormFields(new Uint8Array(readFileSync(saved)));
  expect(fields.get('nombre')?.initial).toEqual({ kind: 'text', text: 'María José' });
  expect(fields.get('acepto')?.initial).toEqual({ kind: 'checkbox', checked: true });
  expect(fields.get('color')?.initial).toEqual({ kind: 'radio', selected: 'Azul' });
  expect(fields.get('pais')?.initial).toEqual({ kind: 'choice', selected: ['pt'] });
  const subtypes = liveAnnotations(saved).map((a) => a.subtype);
  expect(subtypes.filter((s) => s === 'Stamp')).toHaveLength(1);
  expect(subtypes.filter((s) => s === 'Highlight')).toHaveLength(1);

  // Reabrir lo descargado: valores, firma y resaltado se ven en la app.
  const reopened = await openInNewPage(page, saved);
  await expect(reopened.getByRole('textbox', { name: 'nombre', exact: true }).first()).toHaveValue('María José');
  await expect(pageFrame(reopened, 1).getByRole('checkbox', { name: 'acepto' })).toBeChecked();
  await expect(pageFrame(reopened, 1).getByRole('radio', { name: 'color: Azul' })).toBeChecked();
  // La firma guardada es un sello (sin zona editable al reabrir, como en PDF-043): se comprueba en el panel y en el lienzo.
  await openCommentsPanel(reopened);
  await expect(commentRows(reopened).filter({ hasText: SIGNATURE_KIND })).toHaveCount(1);
  await expect(reopened.getByRole('option', { name: optionName(`Resaltado de ${AUTHOR}, página 1`) })).toHaveCount(1);
});

