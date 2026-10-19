import { zipSync } from 'fflate';
import { buildPageText, type TextItemLike } from '../search/page-text';
import { printScale } from '../print/plan';

export type ExportFormat = 'png' | 'jpeg' | 'txt';

export const EXPORT_DPIS = [72, 150, 300, 600] as const;
export const DEFAULT_EXPORT_DPI = 150;
/** Tope estimado del ZIP de imágenes (páginas × ancho × alto × 4 / 3). Por encima se pide reducir el rango o la resolución. */
export const MAX_ZIP_BYTES = 1_000_000_000;

/** Caracteres que Windows no admite en nombres de fichero. Los de control (U+0000 a U+001F) también se sustituyen. */
const INVALID_FILE_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
/** Espacios y puntos al final del nombre (Windows no los admite). */
const TRAILING_DOTS_AND_SPACES = /[. ]+$/u;
const EXTENSION = /\.[^.]*$/u;
const FALLBACK_BASE_NAME = 'documento';

/** «Informe final.PDF» → «Informe final»; caracteres no válidos en Windows (<>:"/\|?* y controles) → «_»; sin puntos ni espacios al final; vacío → «documento». */
export function exportBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(EXTENSION, '');
  let replaced = '';
  for (const ch of withoutExtension) {
    replaced += INVALID_FILE_CHARS.has(ch) || ch.charCodeAt(0) < 0x20 ? '_' : ch;
  }
  const sanitized = replaced.replace(TRAILING_DOTS_AND_SPACES, '');
  return sanitized === '' ? FALLBACK_BASE_NAME : sanitized;
}

/** `ext`: `png` o `jpg`. Una página: «<base>-p<N>.<ext>». En ZIP: número con ceros a max(4, cifras de total): «<base>-p0007.png». */
export function imageFileName(base: string, pageNumber: number, total: number, format: 'png' | 'jpeg', inZip: boolean): string {
  const ext = format === 'png' ? 'png' : 'jpg';
  const number = inZip ? String(pageNumber).padStart(Math.max(4, String(total).length), '0') : String(pageNumber);
  return `${base}-p${number}.${ext}`;
}

export function zipFileName(base: string): string {
  return `${base}-imagenes.zip`;
}

export function txtFileName(base: string): string {
  return `${base}.txt`;
}

/** Píxeles de la página a `dpi` con el mismo tope que imprimir: { width, height, reduced } (reduced = printScale recortó). */
export function imagePixelSize(
  widthPt: number,
  heightPt: number,
  dpi: number,
): { readonly width: number; readonly height: number; readonly reduced: boolean } {
  const scale = printScale(widthPt, heightPt, dpi);
  return {
    width: Math.max(1, Math.floor(widthPt * scale)),
    height: Math.max(1, Math.floor(heightPt * scale)),
    reduced: scale < dpi / 72,
  };
}

/** Estimación del tamaño de las imágenes: Σ (ancho × alto × 4 / 3) bytes, redondeado hacia arriba. */
export function estimateImagesBytes(sizes: readonly { readonly widthPt: number; readonly heightPt: number }[], dpi: number): number {
  let bytes = 0;
  for (const size of sizes) {
    const { width, height } = imagePixelSize(size.widthPt, size.heightPt, dpi);
    bytes += (width * height * 4) / 3;
  }
  return Math.ceil(bytes);
}

/** Texto de una página para TXT: `buildPageText(items).raw` con espacios finales de cada línea quitados. */
export function pageTextForExport(items: readonly TextItemLike[]): string {
  return buildPageText(items).raw.replace(/[^\S\n]+$/gmu, '');
}

const UTF8_BOM = '﻿';
const PAGE_BREAK = '\r\n\f\r\n';

/** UTF-8 con BOM; saltos `\r\n`; páginas unidas con `\r\n\f\r\n`; termina en `\r\n`. */
export function buildTxt(pages: readonly string[]): Uint8Array {
  const body = pages.map((page) => page.replace(/\r\n|\r|\n/gu, '\r\n')).join(PAGE_BREAK);
  return new TextEncoder().encode(`${UTF8_BOM}${body}\r\n`);
}

/** ZIP sin recomprimir (`level: 0`), entradas en el orden dado. */
export function buildZip(entries: readonly { readonly name: string; readonly bytes: Uint8Array }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    if (Object.hasOwn(files, entry.name)) throw new RangeError(`nombre de entrada repetido: ${entry.name}`);
    files[entry.name] = entry.bytes;
  }
  return zipSync(files, { level: 0 });
}
