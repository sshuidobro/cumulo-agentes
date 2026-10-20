/**
 * PDF desde imágenes (PDF-056, ADR-0035): una imagen por página. Los JPEG se incrustan con sus bytes originales
 * (`/DCTDecode`, sin recomprimir) y la orientación EXIF se aplica con la matriz de la página; los PNG llegan ya
 * decodificados como RGBA (la decodificación está en la interfaz). Función pura: devuelve los bytes del PDF.
 */
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import { isJpegBytes, jpegExifOrientation } from '../signature/image-art';
import { writeCompleteFile } from './file-writer';
import { jpegImageObject, readJpegInfo, rgbaImageObjects, type RgbaImage } from './image';
import { dict, name, ref, stream, type PdfStream, type PdfValue } from './objects';
import { planPageTree, type TreeNode } from './page-tree-layout';
import { encodeTextString, pdfDate } from './text-string';

export type ImageInput =
  | { readonly kind: 'jpeg'; readonly name: string; readonly bytes: Uint8Array }
  | { readonly kind: 'rgba'; readonly name: string; readonly image: RgbaImage };

export type PageSizeMode = 'fit' | 'a4' | 'letter';

export interface ImagesToPdfInput {
  readonly images: readonly ImageInput[];
  readonly pageSize: PageSizeMode;
  /** pt, 0..72; solo se aplica a A4 y Carta. */
  readonly margin: number;
  /** ISO 8601: fechas de `/Info`. */
  readonly now: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ImagesToPdfOutput {
  readonly bytes: Uint8Array;
  readonly pages: number;
}

export const A4_PT = [595.28, 841.89] as const;
export const LETTER_PT = [612, 792] as const;
export const FIT_DPI = 150;

const MAX_IMAGES = 500;
const MAX_MARGIN = 72;
const PAGE_SIZE_MODES: readonly string[] = ['fit', 'a4', 'letter'];
const PT_PER_INCH = 72;
const CM_PER_INCH = 2.54;
const JFIF_MIN_DPI = 72;
const JFIF_MAX_DPI = 1200;
const APP0 = 0xe0;
const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00];
const RESOURCE_NAME = 'Im0';
const PRODUCER = 'Cúmulo Lector PDF';
/** Números fijos: catálogo, raíz `/Pages` e `/Info`. Los demás objetos empiezan en `FIRST_FREE_NUM`. */
const CATALOG_NUM = 1;
const PAGES_NUM = 2;
const INFO_NUM = 3;
const FIRST_FREE_NUM = 4;

/** Imagen ya lista para una página. `width`/`height` son los píxeles tal como se ven (con EXIF aplicada). */
interface Prepared {
  readonly image: PdfStream;
  /** Máscara de alfa (solo RGBA con transparencia). */
  readonly smask: PdfStream | null;
  readonly width: number;
  readonly height: number;
  readonly exif: number;
  /** Puntos por pulgada de la imagen para el modo `fit`. */
  readonly dpi: number;
}

interface PageSpec {
  readonly num: number;
  readonly imageNum: number;
  readonly contentNum: number;
  readonly pageW: number;
  readonly pageH: number;
}

interface TreeEntry {
  readonly node: TreeNode;
  readonly num: number;
  readonly parent: number | null;
  readonly kids: PdfValue[];
}

/**
 * Crea un PDF con una página por imagen. Devuelve `invalid-image` si un JPEG no es válido o un RGBA no cuadra con sus
 * dimensiones, `organize-invalid` si hay 0 o más de 500 imágenes y `cancelled` si se aborta. Lanza `RangeError` si
 * `pageSize` o `margin` no son válidos (es un bug del llamante).
 */
export async function buildPdfFromImages(input: ImagesToPdfInput): Promise<Result<ImagesToPdfOutput>> {
  const { images, pageSize, margin, now, signal, onProgress } = input;
  if (!PAGE_SIZE_MODES.includes(pageSize)) throw new RangeError(`tamaño de página no válido: ${pageSize}`);
  if (!Number.isFinite(margin) || margin < 0 || margin > MAX_MARGIN) throw new RangeError(`margen no válido: ${margin}`);
  if (images.length < 1 || images.length > MAX_IMAGES) return err(pdfError('organize-invalid'));

  const objects = new Map<number, PdfValue>();
  const pages: PageSpec[] = [];
  let next = FIRST_FREE_NUM;
  for (const [index, source] of images.entries()) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const imageNum = next++;
    const prepared = prepareImage(source, next);
    if (!prepared.ok) return err(prepared.error);
    objects.set(imageNum, prepared.value.image);
    if (prepared.value.smask !== null) objects.set(next++, prepared.value.smask);

    const layout = pageLayout(prepared.value, pageSize, margin);
    const matrix = orientationMatrix(prepared.value.exif, layout);
    const pageNum = next++;
    const contentNum = next++;
    objects.set(contentNum, stream({}, encodeText(contentStream(matrix))));
    pages.push({ num: pageNum, imageNum, contentNum, pageW: layout.pageW, pageH: layout.pageH });
    onProgress?.(index + 1, images.length);
  }

  const count = pages.length;
  const pageParent: number[] = [];
  const nodes: TreeEntry[] = [{ node: planPageTree(count), num: PAGES_NUM, parent: null, kids: [] }];
  // Recorrido de arriba abajo: los nodos intermedios toman números después de los de las páginas.
  for (const entry of nodes) {
    for (const kid of entry.node.kids) {
      if ('slot' in kid) {
        pageParent[kid.slot] = entry.num;
        entry.kids.push(ref(at(pages, kid.slot).num));
      } else {
        const num = next++;
        entry.kids.push(ref(num));
        nodes.push({ node: kid.node, num, parent: entry.num, kids: [] });
      }
    }
  }
  for (const entry of nodes) {
    const d: Record<string, PdfValue> = { Type: name('Pages'), Kids: entry.kids, Count: entry.node.count };
    if (entry.parent !== null) d.Parent = ref(entry.parent);
    objects.set(entry.num, dict(d));
  }
  for (const [i, page] of pages.entries()) {
    objects.set(page.num, dict({
      Type: name('Page'),
      Parent: ref(at(pageParent, i)),
      MediaBox: [0, 0, page.pageW, page.pageH],
      Resources: dict({ XObject: dict({ [RESOURCE_NAME]: ref(page.imageNum) }) }),
      Contents: ref(page.contentNum),
    }));
  }

  objects.set(CATALOG_NUM, dict({ Type: name('Catalog'), Pages: ref(PAGES_NUM) }));
  const info: Record<string, PdfValue> = {
    Producer: encodeTextString(PRODUCER),
    CreationDate: pdfDate(now),
    ModDate: pdfDate(now),
    Title: encodeTextString(withoutExtension(at(images, 0).name)),
  };
  objects.set(INFO_NUM, dict(info));

  const list: (readonly [number, PdfValue])[] = [];
  for (let num = CATALOG_NUM; num < next; num++) {
    const value = objects.get(num);
    if (value === undefined) throw new RangeError(`objeto ${num} sin contenido (bug)`);
    list.push([num, value]);
  }
  const bytes = writeCompleteFile({
    objects: list,
    root: ref(CATALOG_NUM),
    info: ref(INFO_NUM),
    seed: `${now}|${count}`,
  });
  return ok({ bytes, pages: count });
}

/**
 * Densidad JFIF (APP0) en ppp si existe y está en [72, 1200]; si no, null. Con unidades en pulgadas se usa la
 * densidad horizontal; con unidades en centímetros, se convierte a pulgadas.
 */
export function jpegDensity(bytes: Uint8Array): number | null {
  if (!isJpegBytes(bytes)) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2) return null;
    if (marker === APP0 && length >= 16 && isJfifHeader(bytes, at + 4)) return jfifDpi(bytes, at + 4);
    at += 2 + length;
  }
  return null;
}

function isJfifHeader(bytes: Uint8Array, at: number): boolean {
  return JFIF_ID.every((byte, i) => bytes[at + i] === byte);
}

/** `p` es el inicio de la carga del APP0: `JFIF\0`, versión (2), unidades (1), densidad X (2), densidad Y (2). */
function jfifDpi(bytes: Uint8Array, p: number): number | null {
  const units = bytes[p + 7];
  const xDensity = ((bytes[p + 8] ?? 0) << 8) | (bytes[p + 9] ?? 0);
  let dpi: number;
  if (units === 1) dpi = xDensity;
  else if (units === 2) dpi = xDensity * CM_PER_INCH;
  else return null;
  return dpi >= JFIF_MIN_DPI && dpi <= JFIF_MAX_DPI ? dpi : null;
}

/** Imagen lista para una página. `smaskNum` es el número que tomará la máscara si la hay. */
function prepareImage(source: ImageInput, smaskNum: number): Result<Prepared> {
  if (source.kind === 'jpeg') {
    const info = readJpegInfo(source.bytes);
    if (info === null) return err(pdfError('invalid-image'));
    const object = jpegImageObject(source.bytes);
    if (!object.ok) return err(object.error);
    const exif = jpegExifOrientation(source.bytes);
    const swapped = exif >= 5;
    return ok({
      image: object.value,
      smask: null,
      width: swapped ? info.height : info.width,
      height: swapped ? info.width : info.height,
      exif,
      dpi: jpegDensity(source.bytes) ?? FIT_DPI,
    });
  }
  const { width, height, rgba } = source.image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    return err(pdfError('invalid-image'));
  }
  const { image, smask } = rgbaImageObjects(source.image, ref(smaskNum));
  return ok({ image, smask, width, height, exif: 1, dpi: FIT_DPI });
}

interface Layout {
  readonly pageW: number;
  readonly pageH: number;
  /** Caja de la imagen mostrada, en puntos, con origen abajo a la izquierda. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * `fit`: la página es el tamaño de la imagen a su ppp. A4 y Carta: orientación según la imagen mostrada, imagen
 * escalada para caber en la página menos el margen, sin ampliar por encima de `FIT_DPI`, y centrada.
 */
function pageLayout(img: Prepared, pageSize: PageSizeMode, margin: number): Layout {
  if (pageSize === 'fit') {
    const pageW = round4((img.width * PT_PER_INCH) / img.dpi);
    const pageH = round4((img.height * PT_PER_INCH) / img.dpi);
    return { pageW, pageH, x: 0, y: 0, w: pageW, h: pageH };
  }
  const [portraitW, portraitH] = pageSize === 'a4' ? A4_PT : LETTER_PT;
  const landscape = img.width > img.height;
  const pageW = landscape ? portraitH : portraitW;
  const pageH = landscape ? portraitW : portraitH;
  const scale = Math.min(
    (pageW - 2 * margin) / img.width,
    (pageH - 2 * margin) / img.height,
    PT_PER_INCH / FIT_DPI,
  );
  const w = round4(img.width * scale);
  const h = round4(img.height * scale);
  return { pageW, pageH, x: round4((pageW - w) / 2), y: round4((pageH - h) / 2), w, h };
}

/** Matriz `cm` según la orientación EXIF (1..8) para la caja `(x, y)` de tamaño `W × H`. */
function orientationMatrix(exif: number, { x, y, w: W, h: H }: Layout): readonly number[] {
  switch (exif) {
    case 2: return [-W, 0, 0, H, x + W, y];
    case 3: return [-W, 0, 0, -H, x + W, y + H];
    case 4: return [W, 0, 0, -H, x, y + H];
    case 5: return [0, -H, -W, 0, x + W, y + H];
    case 6: return [0, -H, W, 0, x, y + H];
    case 7: return [0, H, W, 0, x, y];
    case 8: return [0, H, -W, 0, x + W, y];
    default: return [W, 0, 0, H, x, y];
  }
}

function contentStream(matrix: readonly number[]): string {
  return `q ${matrix.map(formatPoint).join(' ')} cm /${RESOURCE_NAME} Do Q\n`;
}

/** Como mucho 4 decimales, sin ceros finales ni exponente. */
function formatPoint(value: number): string {
  const rounded = round4(value);
  return rounded === 0 ? '0' : String(rounded);
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function withoutExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]*$/, '');
}

/** Elemento de `items` que existe: lanza si el índice está fuera de rango (bug de quien llama). */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`índice ${index} fuera de rango`);
  return item;
}
