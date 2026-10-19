import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { DeltaWriter, finishDelta, reserveXref, startDelta } from '../../../src/core/pdf/delta-writer';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { bytesString, dict, dictGet, name, ref, type PdfDict, type PdfValue } from '../../../src/core/pdf/objects';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { bytes, latin1 } from './helpers';

const NOW = '2026-10-19T10:00:00.000Z';
const LF = 0x0a;
const CR = 0x0d;
const fixedRandom = (n: number): Uint8Array => new Uint8Array(n).fill(7);

function fixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

/** PDF mínimo con tabla o flujo de xref, `/Info` y sin `/ID`. */
function minimalPdf(xref: 'table' | 'stream'): { readonly bytes: Uint8Array; readonly root: number; readonly info: number } {
  const b = new PdfBuilder();
  const pages = b.addObject('<< /Type /Pages /Kids [] /Count 0 >>');
  const root = b.addObject(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  const info = b.addObject('<< /Title (Prueba) >>');
  return { bytes: b.build({ root, info, xref }), root, info };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Copia de `data` sin el `/ID` del trailer (el trailer va tras la xref, así que los offsets no cambian). */
function withoutTrailerId(data: Uint8Array): Uint8Array {
  const text = latin1(data).replace(/ \/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/, '');
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function openReader(data: Uint8Array, password?: string): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(data), password === undefined ? {} : { password });
}

function idOf(trailer: PdfDict): readonly PdfValue[] {
  const id = dictGet(trailer, 'ID');
  return Array.isArray(id) ? id : [];
}

describe('startDelta', () => {
  it('añade un LF inicial solo si el original no acaba en LF ni en CR', async () => {
    const base = minimalPdf('table').bytes;
    expect(base.at(-1)).toBe(LF);
    const reader = await openReader(base);

    const withoutLf = base.slice(0, base.length - 1);
    const needsLf = await startDelta(memorySource(withoutLf), reader, fixedRandom);
    expect(needsLf.toBytes()).toEqual(Uint8Array.of(LF));
    expect(needsLf.offset).toBe(withoutLf.length + 1);

    const endsCr = base.slice();
    endsCr[endsCr.length - 1] = CR;
    const withCr = await startDelta(memorySource(endsCr), reader, fixedRandom);
    expect(withCr.toBytes().length).toBe(0);
    expect(withCr.offset).toBe(endsCr.length);

    const withLf = await startDelta(memorySource(base), reader, fixedRandom);
    expect(withLf.toBytes().length).toBe(0);
    expect(withLf.offset).toBe(base.length);
  });
});

describe('DeltaWriter', () => {
  it('registra el offset absoluto de cada objeto y acumula las escrituras', () => {
    const writer = new DeltaWriter(100, null, fixedRandom);
    expect(writer.offset).toBe(100);

    writer.write(bytes('ab'));
    expect(writer.offset).toBe(102);

    writer.object(7, 2, 42);
    expect(writer.offsets.get(7)).toEqual({ offset: 102, gen: 2 });

    const out = writer.toBytes();
    expect(latin1(out.subarray(0, 2))).toBe('ab');
    expect(latin1(out)).toContain('7 2 obj');
    expect(writer.offset).toBe(100 + out.length);
  });
});

describe('reserveXref', () => {
  it('no reserva número si la última sección del original es una tabla', async () => {
    const reader = await openReader(minimalPdf('table').bytes);
    expect(reserveXref(reader, 9)).toEqual({ xrefNum: null, size: 9 });
  });

  it('reserva el número siguiente para la xref de flujo si el original la usa', async () => {
    const reader = await openReader(fixture('compressed.pdf'));
    expect(reader.xref.lastKind).toBe('stream');
    expect(reserveXref(reader, 120)).toEqual({ xrefNum: 120, size: 121 });
  });
});

describe('finishDelta con xref de tabla', () => {
  it('agrupa las subsecciones, usa filas de 20 bytes y conserva /Info, /Root, /Size y /Prev', async () => {
    const original = minimalPdf('table');
    const reader = await openReader(original.bytes);
    const n = reader.xref.size;
    const writer = await startDelta(memorySource(original.bytes), reader, fixedRandom);
    writer.object(n, 0, dict({ Uno: name('a') }));
    writer.object(n + 1, 0, dict({ Dos: name('b') }));
    writer.object(n + 3, 0, dict({ Tres: name('c') }));

    const delta = finishDelta(writer, {
      reader,
      root: ref(original.root),
      size: n + 4,
      xrefNum: null,
      now: NOW,
      sourceSize: original.bytes.length,
    });

    const text = latin1(delta);
    const header = `xref\n${n} 2\n`;
    expect(text).toContain(header);
    expect(text).toContain(`${n + 3} 1\n`);
    const rowsStart = text.indexOf(header) + header.length;
    expect(text.slice(rowsStart, rowsStart + 40)).toMatch(/^\d{10} 00000 n \n\d{10} 00000 n \n$/);

    const reopened = await openReader(concat(original.bytes, delta));
    expect(reopened.xref.lastKind).toBe('table');
    expect(reopened.xref.size).toBe(n + 4);
    expect(reopened.xref.entries.get(n)).toEqual({ type: 'offset', offset: writer.offsets.get(n)?.offset, gen: 0 });
    expect(reopened.xref.entries.get(n + 3)).toEqual({ type: 'offset', offset: writer.offsets.get(n + 3)?.offset, gen: 0 });

    const trailer = reopened.xref.trailer;
    expect(dictGet(trailer, 'Size')).toBe(n + 4);
    expect(dictGet(trailer, 'Root')).toEqual(ref(original.root));
    expect(dictGet(trailer, 'Info')).toEqual(ref(original.info));
    expect(dictGet(trailer, 'Prev')).toBe(reader.xref.lastXrefOffset);
  });
});

describe('finishDelta con xref de flujo', () => {
  it('escribe /W [1 4 2], /Index agrupado y /Prev, y reserva el número con reserveXref', async () => {
    const base = fixture('compressed.pdf');
    const reader = await openReader(base);
    const n = reader.xref.size;
    const writer = await startDelta(memorySource(base), reader, fixedRandom);
    writer.object(n, 0, dict({ Test: name('flujo') }));
    const { xrefNum, size } = reserveXref(reader, n + 1);
    expect(xrefNum).toBe(n + 1);
    expect(size).toBe(n + 2);

    const delta = finishDelta(writer, { reader, root: ref(1), size, xrefNum, now: NOW, sourceSize: base.length });

    const reopened = await openReader(concat(base, delta));
    expect(reopened.xref.lastKind).toBe('stream');
    expect(reopened.xref.size).toBe(n + 2);
    expect(reopened.xref.entries.get(n)).toEqual({ type: 'offset', offset: writer.offsets.get(n)?.offset, gen: 0 });
    expect(reopened.xref.entries.get(n + 1)).toMatchObject({ type: 'offset', gen: 0 });

    const streamDict = await reopened.getDict(ref(n + 1));
    expect(streamDict).not.toBeNull();
    const d = streamDict ?? dict({});
    expect(dictGet(d, 'Type')).toEqual(name('XRef'));
    expect(dictGet(d, 'W')).toEqual([1, 4, 2]);
    expect(dictGet(d, 'Index')).toEqual([n, 2]);
    expect(dictGet(d, 'Prev')).toBe(reader.xref.lastXrefOffset);
    expect(dictGet(d, 'Root')).toEqual(ref(1));
  });
});

describe('finishDelta /ID', () => {
  it('conserva /ID[0] del original y pone uno nuevo en /ID[1]', async () => {
    const base = fixture('basic-5.pdf');
    const reader = await openReader(base);
    const original = idOf(reader.xref.trailer);
    expect(original.length).toBe(2);

    const n = reader.xref.size;
    const writer = await startDelta(memorySource(base), reader, fixedRandom);
    writer.object(n, 0, dict({ Uno: name('a') }));
    const delta = finishDelta(writer, { reader, root: ref(1), size: n + 1, xrefNum: null, now: NOW, sourceSize: base.length });

    const reopened = await openReader(concat(base, delta));
    const [id0, id1] = idOf(reopened.xref.trailer);
    expect(id0).toEqual(original[0]);
    expect(id1).toMatchObject({ kind: 'string' });
    expect(id1).not.toEqual(original[0]);
  });

  it('sin /ID en el original, ambos identificadores son nuevos e iguales', async () => {
    // El generador de pruebas siempre escribe /ID; se quita del trailer (no mueve ningún offset de la xref).
    const base = withoutTrailerId(minimalPdf('table').bytes);
    const reader = await openReader(base);
    expect(idOf(reader.xref.trailer)).toEqual([]);
    const n = reader.xref.size;
    const writer = await startDelta(memorySource(base), reader, fixedRandom);
    writer.object(n, 0, dict({ Uno: name('a') }));
    const delta = finishDelta(writer, { reader, root: ref(1), size: n + 1, xrefNum: null, now: NOW, sourceSize: base.length });

    const reopened = await openReader(concat(base, delta));
    const [id0, id1] = idOf(reopened.xref.trailer);
    expect(id0).toMatchObject({ kind: 'string' });
    expect(id0).toEqual(id1);
  });
});

describe('finishDelta con cifrado', () => {
  it('cifra los objetos escritos, conserva /Encrypt y el lector los descifra', async () => {
    const base = fixture('encrypted-aes-128.pdf');
    const reader = await openReader(base, 'usuario');
    const n = reader.xref.size;
    const writer = await startDelta(memorySource(base), reader, fixedRandom);
    writer.object(n, 0, dict({ Note: bytesString(bytes('secreto'), false) }));
    const delta = finishDelta(writer, { reader, root: ref(1), size: n + 1, xrefNum: null, now: NOW, sourceSize: base.length });

    expect(latin1(delta)).not.toContain('secreto');

    const reopened = await openReader(concat(base, delta), 'usuario');
    expect(dictGet(reopened.xref.trailer, 'Encrypt')).toEqual(ref(15));
    const obj = await reopened.getDict(ref(n));
    expect(obj).not.toBeNull();
    expect(dictGet(obj ?? dict({}), 'Note')).toMatchObject({ kind: 'string', bytes: bytes('secreto') });
  });
});
