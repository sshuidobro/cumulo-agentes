import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { type PdfDict } from '../../../src/core/pdf/objects';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder } from '../../fixtures/pdf-builder';

const TEXT_ENCODER = new TextEncoder();

export function bytes(text: string): Uint8Array {
  return TEXT_ENCODER.encode(text);
}

/** Bytes de un fixture generado (tests/fixtures/ensure.ts). */
export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/**
 * PDF de una sola página (MediaBox 612×792) con `content` como contenido. `makeResources` puede añadir objetos al
 * constructor y devuelve el diccionario `/Resources` como texto.
 */
export function onePagePdf(
  content: string | Uint8Array,
  makeResources: (b: PdfBuilder) => string = () => '<< >>',
): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const resources = makeResources(b);
  const contents = b.addStream('<< >>', content);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
  b.setObject(
    page,
    `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${String(contents)} 0 R >>`,
  );
  return b.build({ root: catalog });
}

/** Fuente Helvetica estándar (sin /Widths) como recurso /F1. */
export function helveticaResources(b: PdfBuilder): string {
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  return `<< /Font << /F1 ${String(font)} 0 R >> >>`;
}

/** Lector abierto sobre `data` y diccionario de la página `index`. */
export async function openPage(data: Uint8Array, index = 0): Promise<{ readonly reader: ObjectReader; readonly page: PdfDict }> {
  const reader = await ObjectReader.open(memorySource(data));
  const ref = await reader.pageRef(index);
  const page = await reader.getDict(ref);
  if (page === null) throw new Error('página sin diccionario');
  return { reader, page };
}
