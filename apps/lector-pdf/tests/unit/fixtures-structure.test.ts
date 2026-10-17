import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { appendIncrementalUpdate, PdfBuilder, readTrailer } from '../fixtures/pdf-builder.ts';

type OutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];

function loadBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function loadText(name: string): string {
  return Buffer.from(loadBytes(name)).toString('latin1');
}

/** Abre un fixture generado con pdf.js y lo cierra al terminar. */
async function withDocument<T>(name: string, callback: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const task = getDocument({ data: loadBytes(name), verbosity: 0 });
  try {
    return await callback(await task.promise);
  } finally {
    await task.destroy();
  }
}

async function textOfPage(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

/** Busca un elemento del índice por título; devuelve también su profundidad (1 = raíz). */
function findOutline(
  items: readonly OutlineItem[],
  title: string,
  depth = 1,
): { readonly item: OutlineItem; readonly depth: number } | undefined {
  for (const item of items) {
    if (item.title === title) {
      return { item, depth };
    }
    const nested = findOutline(item.items, title, depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

/** Texto del stream del objeto que empieza en `offset` (`N 0 obj << ... /Length L >> stream`). */
function streamAt(bytes: Uint8Array, text: string, offset: number): Buffer {
  const dataStart = text.indexOf('stream\n', offset) + 'stream\n'.length;
  const length = Number.parseInt(/\/Length (\d+)/.exec(text.slice(offset, dataStart))?.[1] ?? '', 10);
  return Buffer.from(bytes.subarray(dataStart, dataStart + length));
}

/**
 * Comprueba cada entrada de una xref en stream (/W [1 4 2]): las de tipo 1 apuntan a «N 0 obj» y
 * las de tipo 2 a un objeto dentro de su object stream. Devuelve cuántas entradas de tipo 2 hay.
 */
function verifyXrefStream(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  const startxref = Number.parseInt(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1] ?? '', 10);
  expect(/^\d+ 0 obj\n<< \/Type \/XRef/.test(text.slice(startxref))).toBe(true);
  const size = Number.parseInt(/\/Size (\d+)/.exec(text.slice(startxref))?.[1] ?? '', 10);
  const index = Buffer.from(streamAt(bytes, text, startxref));
  expect(index.byteLength).toBe(size * 7);

  const entry = (num: number): { readonly type: number; readonly field2: number; readonly field3: number } => ({
    type: index.readUInt8(num * 7),
    field2: index.readUInt32BE(num * 7 + 1),
    field3: index.readUInt16BE(num * 7 + 5),
  });

  let compressed = 0;
  for (let num = 1; num < size; num++) {
    const { type, field2, field3 } = entry(num);
    if (type === 1) {
      expect(text.startsWith(`${num} 0 obj`, field2)).toBe(true);
    } else if (type === 2) {
      compressed++;
      const stmOffset = entry(field2);
      expect(stmOffset.type).toBe(1);
      const stmText = text.slice(stmOffset.field2, text.indexOf('stream\n', stmOffset.field2));
      const first = Number.parseInt(/\/First (\d+)/.exec(stmText)?.[1] ?? '', 10);
      const data = inflateSync(streamAt(bytes, text, stmOffset.field2)).toString('latin1');
      const pairs = data.slice(0, first).trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
      expect(pairs[2 * field3]).toBe(num);
      const body = first + (pairs[2 * field3 + 1] ?? -1);
      expect(/^(<<|\[)/.test(data.slice(body, body + 2))).toBe(true);
    }
  }
  return compressed;
}

describe('outline.pdf', () => {
  it('índice: 5 raíces en orden, negrita, cursiva, profundidad 3, URL y destino nombrado', async () => {
    await withDocument('outline.pdf', async (doc) => {
      const outline = (await doc.getOutline()) ?? [];
      expect(outline.map((item) => item.title)).toEqual([
        'Capítulo 1',
        'Capítulo 2',
        'Capítulo 3',
        'Anexo',
        'Sitio web',
      ]);
      expect(findOutline(outline, 'Capítulo 1')?.item.bold).toBe(true);
      expect(findOutline(outline, 'Sección 2.1')?.item.italic).toBe(true);
      expect(findOutline(outline, 'Apartado 1.1.1')?.depth).toBe(3);
      expect(findOutline(outline, 'Sitio web')?.item.url).toBe('https://example.org/');

      const dest = await doc.getDestination('anexo');
      expect(dest).not.toBeNull();
      expect(await doc.getPageIndex(dest?.[0])).toBe(29);
    });
  });
});

describe('links.pdf', () => {
  it('página 1: 8 enlaces Link; los URI tienen url; (a) apunta a la página 3; (b) es el destino nombrado', async () => {
    await withDocument('links.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      expect(annotations.map((annotation) => annotation.subtype)).toEqual(Array.from({ length: 8 }, () => 'Link'));

      expect(await doc.getPageIndex(annotations[0]?.dest[0])).toBe(2);
      expect(annotations[1]?.dest).toBe('destino-final');
      expect(annotations[3]?.url).toBe('https://example.org/ruta?x=1');
      expect(annotations[4]?.url).toBe('mailto:alguien@example.org');
      // (h) javascript:alert(1): pdf.js no devuelve url para este esquema (ver Registro de PDF-003).
      expect(annotations[7]?.url).toBeUndefined();
    });
  });
});

describe('page-labels.pdf', () => {
  it('getPageLabels: i, ii, iii, iv, 1 … 7, A-1', async () => {
    await withDocument('page-labels.pdf', async (doc) => {
      expect(await doc.getPageLabels()).toEqual(['i', 'ii', 'iii', 'iv', '1', '2', '3', '4', '5', '6', '7', 'A-1']);
    });
  });
});

describe('compressed.pdf', () => {
  it('50 páginas; contiene /ObjStm y /XRef y ninguna tabla ni trailer; la página 50 tiene texto', async () => {
    const text = loadText('compressed.pdf');
    expect(text).toContain('/Type /ObjStm');
    expect(text).toContain('/Type /XRef');
    expect(text).not.toContain('trailer');

    await withDocument('compressed.pdf', async (doc) => {
      expect(doc.numPages).toBe(50);
      expect(await textOfPage(doc, 50)).toContain('Página 50 de 50');
    });
  });

  it('cada entrada de la xref en stream apunta al objeto correcto, también dentro de los object streams', () => {
    const compressed = verifyXrefStream(loadBytes('compressed.pdf'));
    expect(compressed).toBeGreaterThan(0);
  });
});

describe('incremental-updates.pdf', () => {
  it('tiene tres %%EOF, cada startxref apunta a una xref y la página 1 es la modificada', async () => {
    const text = loadText('incremental-updates.pdf');
    expect(text.match(/%%EOF/g)).toHaveLength(3);
    for (const match of text.matchAll(/startxref\n(\d+)\n%%EOF/g)) {
      expect(text.startsWith('xref\n', Number.parseInt(match[1] ?? '', 10))).toBe(true);
    }

    await withDocument('incremental-updates.pdf', async (doc) => {
      const first = await textOfPage(doc, 1);
      expect(first).toContain('Página 1 modificada');
      expect(first).not.toContain('Página 1 de 5');
      const metadata = await doc.getMetadata();
      expect(metadata.info).toMatchObject({ Title: 'Actualizado dos veces' });
    });
  });
});

describe('annotated.pdf', () => {
  it('subtipos por página: p1 Highlight, Popup, Underline; p2 Text, Popup, FreeText, Ink; p3 Square, Link', async () => {
    const expected: readonly (readonly string[])[] = [
      ['Highlight', 'Popup', 'Underline'],
      ['Text', 'Popup', 'FreeText', 'Ink'],
      ['Square', 'Link'],
    ];
    await withDocument('annotated.pdf', async (doc) => {
      for (const [index, subtypes] of expected.entries()) {
        const annotations = await (await doc.getPage(index + 1)).getAnnotations();
        expect(annotations.map((annotation) => annotation.subtype).sort()).toEqual([...subtypes].sort());
      }
    });
  });

  it('el resaltado tiene apariencia (/AP) y su comentario de otra persona', async () => {
    await withDocument('annotated.pdf', async (doc) => {
      const annotations = await (await doc.getPage(1)).getAnnotations();
      const highlight = annotations.find((annotation) => annotation.subtype === 'Highlight');
      expect(highlight?.hasAppearance).toBe(true);
      expect(highlight?.contentsObj?.str).toBe('Comentario previo');
    });
  });
});

describe('form.pdf', () => {
  it('getFieldObjects contiene los campos nombre y acepto', async () => {
    await withDocument('form.pdf', async (doc) => {
      // pdf.js devuelve un Map (aunque el tipo declare un Record): se comprueban sus claves.
      const fields: unknown = await doc.getFieldObjects();
      expect(fields).toBeInstanceOf(Map);
      expect([...(fields as Map<string, unknown>).keys()]).toEqual(expect.arrayContaining(['nombre', 'acepto']));
    });
  });
});

describe('PdfBuilder: /ID, object streams y actualizaciones', () => {
  function sampleBuilder(): PdfBuilder {
    const b = new PdfBuilder();
    const root = b.addObject('<< /Type /Catalog >>');
    b.setObject(root, '<< /Type /Catalog /Pages 2 0 R >>');
    b.addObject('<< /Type /Pages /Kids [] /Count 0 >>');
    return b;
  }

  it('xref clásica: el trailer lleva /ID con dos cadenas de 16 bytes y es determinista', () => {
    const first = sampleBuilder().build({ root: 1 });
    const text = Buffer.from(first).toString('latin1');
    expect(text).toMatch(/\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/);
    expect(Buffer.from(sampleBuilder().build({ root: 1 })).equals(Buffer.from(first))).toBe(true);
  });

  it('object streams exigen xref en stream', () => {
    expect(() => sampleBuilder().build({ root: 1, objectStreams: true })).toThrow();
  });

  it('más de 100 objetos se reparten en varios object streams', () => {
    const b = new PdfBuilder();
    const root = b.addObject('<< /Type /Catalog >>');
    for (let i = 0; i < 150; i++) {
      b.addObject(`<< /N ${i} >>`);
    }
    const text = Buffer.from(b.build({ root, xref: 'stream', objectStreams: true })).toString('latin1');
    expect(text.match(/\/Type \/ObjStm/g)).toHaveLength(2);
    expect(verifyXrefStream(b.build({ root, xref: 'stream', objectStreams: true }))).toBe(151);
  });

  it('la actualización lleva /Size igual al mayor número + 1 y /Prev con la xref anterior', () => {
    const base = sampleBuilder().build({ root: 1 });
    const baseText = Buffer.from(base).toString('latin1');
    const updated = appendIncrementalUpdate(base, new Map([[3, '<< /Count 1 >>']]));
    const text = Buffer.from(updated).toString('latin1');
    const trailer = readTrailer(text);
    expect(trailer.size).toBe(4);
    expect(text).toContain(`/Prev ${readTrailer(baseText).startxref}`);
    expect(text.startsWith('xref\n', trailer.startxref)).toBe(true);
  });

  it('una actualización sin startxref falla con un error claro', () => {
    expect(() => appendIncrementalUpdate(new Uint8Array(0), new Map([[1, '<< >>']]))).toThrow(/startxref/);
  });
});
