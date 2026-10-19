import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { flateEncode } from '../../../src/core/pdf/filters';
import { dictGet, PdfSyntaxError, type PdfRef } from '../../../src/core/pdf/objects';
import { readXref, type XrefEntry, type XrefInfo } from '../../../src/core/pdf/xref';
import { appendIncrementalUpdate } from '../../fixtures/pdf-builder';
import { FIXTURES_DIR, CORPUS_DIR } from '../../fixtures/paths';
import { countingSource } from '../../helpers/pdfjs-node';
import { bytes, latin1 } from './helpers';

/** Escritor de bytes con offsets conocidos, para construir PDFs mínimos a mano. */
class PdfWriter {
  private chunks: Uint8Array[] = [];
  private length_ = 0;
  readonly offsets = new Map<number, number>();

  constructor() {
    this.text('%PDF-1.7\n');
  }

  get length(): number {
    return this.length_;
  }

  raw(data: Uint8Array): void {
    this.chunks.push(data);
    this.length_ += data.length;
  }

  text(s: string): void {
    this.raw(bytes(s));
  }

  object(num: number, body: string): void {
    this.offsets.set(num, this.length_);
    this.text(`${num} 0 obj\n${body}\nendobj\n`);
  }

  /** Flujo con `/Length` directo. */
  stream(num: number, dict: string, data: Uint8Array): void {
    this.offsets.set(num, this.length_);
    this.text(`${num} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
    this.raw(data);
    this.text('\nendstream\nendobj\n');
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length_);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/** Entradas de un xref stream (`/W [1 4 2]`) en orden: tipo, campo 2 y campo 3. */
type Row = readonly [number, number, number];

function rowsData(rows: readonly Row[]): Uint8Array {
  const out = new Uint8Array(rows.length * 7);
  rows.forEach(([type, f2, f3], r) => {
    out[r * 7] = type;
    for (let k = 0; k < 4; k++) out[r * 7 + 1 + k] = Math.floor(f2 / 256 ** (3 - k)) & 0xff;
    out[r * 7 + 5] = (f3 >> 8) & 0xff;
    out[r * 7 + 6] = f3 & 0xff;
  });
  return out;
}

/** Codificación PNG con filtro Up (2) en cada fila de `rowLength` bytes. */
function encodePngUp(data: Uint8Array, rowLength: number): Uint8Array {
  const rows = data.length / rowLength;
  const out = new Uint8Array(rows * (rowLength + 1));
  for (let r = 0; r < rows; r++) {
    out[r * (rowLength + 1)] = 2;
    for (let x = 0; x < rowLength; x++) {
      const above = r > 0 ? (data[(r - 1) * rowLength + x] ?? 0) : 0;
      out[r * (rowLength + 1) + 1 + x] = ((data[r * rowLength + x] ?? 0) - above) & 0xff;
    }
  }
  return out;
}

/**
 * PDF mínimo con una sola sección xref stream (objeto 4) que describe los objetos 0-5.
 * `filter` y `predictor` controlan cómo se codifican sus datos.
 */
function xrefStreamPdf(options: { readonly predictor: boolean; readonly rows?: readonly Row[] }): Uint8Array {
  const w = new PdfWriter();
  w.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  w.object(2, '<< /Type /Pages /Kids [] /Count 0 >>');
  w.object(3, '<< /Title (Info) >>');
  const xrefAt = w.length;
  const rows: readonly Row[] = options.rows ?? [
    [0, 0, 65535],
    [1, w.offsets.get(1) ?? 0, 0],
    [1, w.offsets.get(2) ?? 0, 0],
    [1, w.offsets.get(3) ?? 0, 0],
    [1, xrefAt, 0],
    [2, 3, 0],
  ];
  const raw = rowsData(rows);
  const data = options.predictor ? encodePngUp(raw, 7) : raw;
  const parms = options.predictor ? ' /DecodeParms << /Predictor 12 /Columns 7 >>' : '';
  w.stream(4, `/Type /XRef /Size 6 /W [1 4 2] /Root 1 0 R /Filter /FlateDecode${parms}`, flateEncode(data));
  w.text(`startxref\n${xrefAt}\n%%EOF\n`);
  return w.bytes();
}

/** Línea de entrada de la tabla clásica con separador de fin de línea dado. */
function tableEntry(offset: number, gen: number, kind: 'n' | 'f', eol: string): string {
  return `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${kind}${eol}`;
}

/** PDF con una tabla clásica de 3 entradas (0 libre, 1 en offset 9, 2 'n' con offset 0). */
function tablePdf(eol1: string, eol2: string): Uint8Array {
  const w = new PdfWriter();
  w.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const xrefAt = w.length;
  w.text(
    `xref\n0 3\n${tableEntry(0, 65535, 'f', '\r\n')}${tableEntry(9, 0, 'n', eol1)}${tableEntry(0, 0, 'n', eol2)}`
    + `trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
  return w.bytes();
}

/** Valor del último `startxref` del fichero. */
function lastStartxref(data: Uint8Array): number {
  const match = /startxref\n(\d+)\n%%EOF\n$/.exec(latin1(data));
  if (match?.[1] === undefined) throw new Error('el fichero no termina en startxref');
  return Number(match[1]);
}

/** Cambia el `/Prev` de la última sección (el trailer más reciente) por `prev`. */
function withPrev(data: Uint8Array, prev: number): Uint8Array {
  const text = latin1(data);
  const at = text.lastIndexOf('/Prev ');
  if (at < 0) throw new Error('la última sección no tiene /Prev');
  // Latin-1 (1 byte por carácter): el PDF base tiene bytes binarios en la cabecera.
  return Uint8Array.from(text.slice(0, at) + text.slice(at).replace(/^\/Prev \d+/, `/Prev ${prev}`), (ch) => ch.charCodeAt(0));
}

function read(data: Uint8Array): Promise<XrefInfo> {
  return readXref(memorySource(data));
}

async function readError(data: Uint8Array): Promise<PdfSyntaxError> {
  try {
    await read(data);
  } catch (error) {
    if (error instanceof PdfSyntaxError) return error;
    throw error;
  }
  throw new Error('se esperaba un error de sintaxis');
}

function fixture(name_: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name_)));
}

function rootRef(info: XrefInfo): PdfRef {
  const root = dictGet(info.trailer, 'Root');
  if (typeof root !== 'object' || root === null || Array.isArray(root) || !('kind' in root) || root.kind !== 'ref') {
    throw new Error('el trailer no tiene /Root');
  }
  return root;
}

function entryOf(info: XrefInfo, num: number): XrefEntry {
  const entry = info.entries.get(num);
  if (entry === undefined) throw new Error(`falta la entrada ${num}`);
  return entry;
}

describe('readXref · tabla clásica', () => {
  it('basic-5.pdf: una sección en tabla, entradas = /Size y /Root apunta a un objeto', async () => {
    const data = fixture('basic-5.pdf');
    const info = await read(data);
    expect(info.lastKind).toBe('table');
    expect(info.sections).toBe(1);
    expect(info.entries.size).toBe(info.size);
    const root = rootRef(info);
    const entry = entryOf(info, root.num);
    expect(entry.type).toBe('offset');
    if (entry.type !== 'offset') throw new Error('tipo inesperado');
    expect(latin1(data.slice(entry.offset, entry.offset + 20))).toMatch(new RegExp(`^${root.num} ${root.gen} obj`));
  });

  it('acepta entradas de 19, 20 y 21 bytes (distintos fines de línea)', async () => {
    const info = await read(tablePdf('\n', '  \r\n'));
    expect(entryOf(info, 1)).toEqual({ type: 'offset', offset: 9, gen: 0 });
    expect(entryOf(info, 0)).toEqual({ type: 'free' });
  });

  it('trata una entrada en uso con offset 0 como libre', async () => {
    const info = await read(tablePdf('\r\n', '\r\n'));
    expect(entryOf(info, 2)).toEqual({ type: 'free' });
  });

  it('acepta una tabla con varias subsecciones', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    w.object(3, '<< /Title (x) >>');
    const xrefAt = w.length;
    w.text(
      `xref\n0 1\n0000000000 65535 f \n1 1\n${tableEntry(w.offsets.get(1) ?? 0, 0, 'n', '\n')}`
      + `3 1\n${tableEntry(w.offsets.get(3) ?? 0, 0, 'n', '\r\n')}`
      + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
    );
    const info = await read(w.bytes());
    expect(entryOf(info, 1)).toMatchObject({ type: 'offset', gen: 0 });
    expect(entryOf(info, 3)).toMatchObject({ type: 'offset', gen: 0 });
    expect(info.entries.has(2)).toBe(false);
  });
});

describe('readXref · xref stream', () => {
  it('compressed.pdf: lastKind stream y el objeto /Root está en un ObjStm', async () => {
    const info = await read(fixture('compressed.pdf'));
    expect(info.lastKind).toBe('stream');
    const root = rootRef(info);
    const entry = entryOf(info, root.num);
    expect(entry.type).toBe('compressed');
    if (entry.type !== 'compressed') throw new Error('tipo inesperado');
    const holder = entryOf(info, entry.objStm);
    expect(holder.type).toBe('offset');
  });

  it('lee las entradas con predictor PNG Up igual que sin predictor', async () => {
    const plain = await read(xrefStreamPdf({ predictor: false }));
    const predicted = await read(xrefStreamPdf({ predictor: true }));
    expect(predicted.entries).toEqual(plain.entries);
    expect(predicted.lastKind).toBe('stream');
    expect(entryOf(predicted, 5)).toEqual({ type: 'compressed', objStm: 3, index: 0 });
    expect(entryOf(predicted, 0)).toEqual({ type: 'free' });
    expect(entryOf(predicted, 4)).toMatchObject({ type: 'offset', gen: 0 });
  });

  it('respeta /Index y el valor por defecto de /W con tipo 1 cuando el primer campo es 0', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    const xrefAt = w.length;
    // /W [0 2 0]: sin campo de tipo, todas las filas son tipo 1 (offset). /Index [1 2].
    const rows = Uint8Array.from([0x00, 0x09, 0x00, 0x0a]);
    w.stream(2, '/Type /XRef /Size 3 /W [0 2 0] /Index [1 2] /Root 1 0 R', rows);
    w.text(`startxref\n${xrefAt}\n%%EOF\n`);
    const info = await read(w.bytes());
    expect(entryOf(info, 1)).toEqual({ type: 'offset', offset: 9, gen: 0 });
    expect(entryOf(info, 2)).toEqual({ type: 'offset', offset: 10, gen: 0 });
  });

  it('rechaza un /Filter no soportado con su nombre', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    const xrefAt = w.length;
    w.stream(2, '/Type /XRef /Size 2 /W [1 1 1] /Filter /LZWDecode /Root 1 0 R', Uint8Array.from([1, 9, 0]));
    w.text(`startxref\n${xrefAt}\n%%EOF\n`);
    await expect(read(w.bytes())).rejects.toThrow('Filtro no soportado: LZWDecode');
  });
});

describe('readXref · híbridos y cadena /Prev', () => {
  it('un /XRefStm híbrido aporta entradas que la tabla de la misma sección sobrescribe', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    w.object(2, '<< /Title (y) >>');
    const offset2 = w.offsets.get(2) ?? 0;
    const streamAt = w.length;
    // Stream: 0 libre, 1 en 9, 2 en el offset del objeto 2 y 3 en el offset del objeto 2 (solo aquí).
    w.stream(4, '/Type /XRef /Size 4 /W [1 4 2] /Root 1 0 R', rowsData([[0, 0, 0], [1, 9, 0], [1, offset2, 0], [1, offset2, 0]]));
    const xrefAt = w.length;
    // Tabla: el objeto 2 figura como libre y debe ganar a la entrada del stream.
    w.text(
      `xref\n0 3\n0000000000 65535 f \r\n0000000009 00000 n \r\n0000000000 00000 f \r\n`
      + `trailer\n<< /Size 4 /Root 1 0 R /XRefStm ${streamAt} >>\nstartxref\n${xrefAt}\n%%EOF\n`,
    );
    const info = await read(w.bytes());
    expect(info.lastKind).toBe('table');
    expect(entryOf(info, 1)).toEqual({ type: 'offset', offset: 9, gen: 0 });
    expect(entryOf(info, 2)).toEqual({ type: 'free' });
    expect(entryOf(info, 3)).toEqual({ type: 'offset', offset: offset2, gen: 0 });
  });

  it('sigue /Prev y da prioridad a la sección más nueva (incremental-updates.pdf)', async () => {
    const data = fixture('incremental-updates.pdf');
    const info = await read(data);
    expect(info.sections).toBe(3);
    const infoRef = dictGet(info.trailer, 'Info');
    if (typeof infoRef !== 'object' || infoRef === null || Array.isArray(infoRef) || !('kind' in infoRef) || infoRef.kind !== 'ref') {
      throw new Error('el trailer no tiene /Info');
    }
    const entry = entryOf(info, infoRef.num);
    if (entry.type !== 'offset') throw new Error('tipo inesperado');
    expect(latin1(data.slice(entry.offset, entry.offset + 300))).toContain('Actualizado dos veces');
  });

  it('un /Prev que apunta a su propia sección termina sin error', async () => {
    const updated = appendIncrementalUpdate(fixture('basic-5.pdf'), new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]));
    const selfOffset = lastStartxref(updated);
    const info = await read(withPrev(updated, selfOffset));
    expect(info.sections).toBe(1);
  });

  it('/Prev fuera del fichero → xref-unreadable', async () => {
    const updated = appendIncrementalUpdate(fixture('basic-5.pdf'), new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]));
    const error = await readError(withPrev(updated, 999999999));
    expect(error.message).toBe('xref-unreadable');
  });
});

describe('readXref · errores', () => {
  it('corrupt-bad-startxref.pdf → PdfSyntaxError xref-unreadable', async () => {
    const error = await readError(fixture('corrupt-bad-startxref.pdf'));
    expect(error).toBeInstanceOf(PdfSyntaxError);
    expect(error.message).toBe('xref-unreadable');
  });

  it('un fichero vacío o sin startxref → xref-unreadable', async () => {
    expect((await readError(new Uint8Array(0))).message).toBe('xref-unreadable');
    expect((await readError(fixture('corrupt-not-pdf.pdf'))).message).toBe('xref-unreadable');
  });

  it('un trailer con /Encrypt se lee como una referencia (lo abre ObjectReader)', async () => {
    const updated = appendIncrementalUpdate(fixture('basic-5.pdf'), new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]), '/Encrypt 9 0 R');
    const info = await readXref(memorySource(updated));
    expect(dictGet(info.trailer, 'Encrypt')).toEqual({ kind: 'ref', num: 9, gen: 0 });
  });

  it('una sección que no es xref ni /Type /XRef → xref-unreadable', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    const at = w.offsets.get(1) ?? 0;
    w.text(`startxref\n${at}\n%%EOF\n`);
    expect((await readError(w.bytes())).message).toBe('xref-unreadable');
  });

  it('una tabla con /Prev no válido (no entero) → xref-unreadable', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    const xrefAt = w.length;
    w.text(`xref\n0 1\n0000000000 65535 f \r\ntrailer\n<< /Size 2 /Root 1 0 R /Prev /x >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    expect((await readError(w.bytes())).message).toBe('xref-unreadable');
  });

  it('una cadena de más de 1 000 secciones → xref-unreadable', async () => {
    const w = new PdfWriter();
    w.object(1, '<< /Type /Catalog >>');
    const offsets: number[] = [];
    // Cada sección apunta a la anterior con /Prev, y todas son distintas (no hay bucle).
    let prev: number | null = null;
    for (let k = 0; k < 1001; k++) {
      const at = w.length;
      offsets.push(at);
      const prevText = prev === null ? '' : ` /Prev ${prev}`;
      w.text(`xref\n0 1\n0000000000 65535 f \r\ntrailer\n<< /Size 2 /Root 1 0 R${prevText} >>\n`);
      prev = at;
    }
    w.text(`startxref\n${prev ?? 0}\n%%EOF\n`);
    expect((await readError(w.bytes())).message).toBe('xref-unreadable');
  });
});

describe('readXref · por rangos y corpus', () => {
  it('pages-100000.pdf: lee la tabla completa y menos del 14 % del fichero', async () => {
    const data = fixture('pages-100000.pdf');
    const source = countingSource(memorySource(data));
    const info = await readXref(source);
    expect(info.entries.size).toBe(203232);
    expect(source.bytesRead / data.length).toBeLessThan(0.14);
  });

  it('corpus (7 veraPDF y 3 de LibreOffice): no lanza y size > 0; 7.10 tiene al menos 5 secciones', async () => {
    const files = [
      'verapdf/7.1-t01-pass-a.pdf',
      'verapdf/7.10-t01-pass-a.pdf',
      'verapdf/7.18.1-t02-pass-a.pdf',
      'verapdf/7.18.4-t01-pass-a.pdf',
      'verapdf/7.18.5-t01-pass-a.pdf',
      'verapdf/7.18.5-t02-pass-a.pdf',
      'verapdf/7.21.4.1-t01-pass-a.pdf',
      'libreoffice/informe.pdf',
      'libreoffice/multilingue.pdf',
      'libreoffice/largo.pdf',
    ];
    for (const file of files) {
      const info = await read(new Uint8Array(readFileSync(join(CORPUS_DIR, file))));
      expect(info.size, file).toBeGreaterThan(0);
      if (file.endsWith('7.10-t01-pass-a.pdf')) expect(info.sections).toBeGreaterThanOrEqual(5);
    }
  });
});
