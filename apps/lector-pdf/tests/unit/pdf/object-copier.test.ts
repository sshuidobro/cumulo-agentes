/**
 * Copia de páginas y de sus objetos a números nuevos (PDF-120, ADR-0028). Los fixtures son los de
 * `tests/fixtures/catalog.ts`; los casos degenerados se construyen con `PdfBuilder`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it, vi } from 'vitest';
import { ObjectCopier } from '../../../src/core/pdf/object-copier';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, PdfSyntaxError, ref, type PdfDict, type PdfRef, type PdfStream, type PdfValue } from '../../../src/core/pdf/objects';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder } from '../../fixtures/pdf-builder';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function openBytes(data: Uint8Array, password?: string): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(data), password === undefined ? {} : { password });
}

function openFixture(name: string, password?: string): Promise<ObjectReader> {
  return openBytes(fixture(name), password);
}

/** Números nuevos desde 1. */
function counter(): () => PdfRef {
  let next = 1;
  return () => ref(next++);
}

async function reserve(reader: ObjectReader, indices: readonly number[]): Promise<{
  readonly copier: ObjectCopier;
  readonly reserved: ReadonlyMap<number, PdfRef>;
}> {
  const copier = new ObjectCopier({ from: reader, alloc: counter() });
  const reserved = await copier.reservePages(indices);
  return { copier, reserved };
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

function isStreamValue(v: PdfValue | undefined): v is PdfStream {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'stream';
}

function isRefValue(v: PdfValue | undefined): v is PdfRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'ref';
}

function dictOf(v: PdfValue | undefined): PdfDict {
  if (!isDictValue(v)) throw new Error('se esperaba un diccionario');
  return v;
}

/** `/Type` de un diccionario o de un flujo. */
function typeOf(v: PdfValue | undefined): string | undefined {
  const d = isDictValue(v) ? v : isStreamValue(v) ? v.dict : undefined;
  const t = d === undefined ? undefined : dictGet(d, 'Type');
  return typeof t === 'object' && t !== null && !Array.isArray(t) && 'kind' in t && t.kind === 'name' ? t.value : undefined;
}

/** Objetos copiados indexados por número nuevo. */
function byNum(copied: readonly (readonly [PdfRef, PdfValue])[]): Map<number, PdfValue> {
  return new Map(copied.map(([r, v]) => [r.num, v]));
}

/** Arrays cuyo primer elemento es una referencia o `null` y el segundo un nombre: destinos explícitos. */
function destinationsIn(value: PdfValue, out: PdfValue[][] = []): PdfValue[][] {
  if (Array.isArray(value)) {
    const list = value as readonly PdfValue[];
    const second = list[1];
    if (list.length >= 2 && (list[0] === null || isRefValue(list[0])) && typeof second === 'object' && second !== null && 'kind' in second && second.kind === 'name') {
      out.push([...list]);
    }
    for (const item of list) destinationsIn(item, out);
  } else if (isDictValue(value)) {
    for (const item of value.entries.values()) destinationsIn(item, out);
  } else if (isStreamValue(value)) {
    destinationsIn(value.dict, out);
  }
  return out;
}

/** Documento de una página cuyo diccionario recibe las entradas que devuelve `entries`. */
function singlePagePdf(entries: (b: PdfBuilder, pages: number) => string): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const extra = entries(b, pages);
  b.setObject(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 100 100] ${extra} >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
  return b.build({ root: catalog });
}

describe('ObjectCopier: copia de páginas (PDF-120)', () => {
  it('basic-5.pdf: copiar la página 3 no trae otras páginas ni nodos /Pages y tiene /MediaBox y /Resources propios', async () => {
    const reader = await openFixture('basic-5.pdf');
    const { copier } = await reserve(reader, [2]);
    const page = await copier.copyPage(2);
    const copied = copier.drain();

    for (const [, value] of copied) {
      expect(['Page', 'Pages']).not.toContain(typeOf(value));
    }
    expect(dictGet(page.dict, 'Parent')).toBeUndefined();
    expect(dictGet(page.dict, 'MediaBox')).toBeDefined();
    expect(dictGet(page.dict, 'Resources')).toBeDefined();
  });

  it('links.pdf: el destino a la página copiada apunta a su ref nueva y el de la no copiada queda en null', async () => {
    const reader = await openFixture('links.pdf');
    const { copier, reserved } = await reserve(reader, [0, 2]);
    await copier.copyPage(0);
    await copier.copyPage(2);
    const copied = copier.drain();

    const targets = copied.flatMap(([, value]) => destinationsIn(value)).map((list) => list[0]);
    const page3 = reserved.get(2);
    const newRefs = new Set([reserved.get(0)?.num, reserved.get(2)?.num]);
    expect(page3).toBeDefined();
    expect(targets.some((t) => isRefValue(t) && t.num === page3?.num)).toBe(true);
    expect(targets.some((t) => t === null)).toBe(true);
    for (const t of targets) {
      if (isRefValue(t)) expect(newRefs.has(t.num)).toBe(true);
    }
  });

  it('annotated.pdf: las anotaciones conservan subtipo y contenido, /Popup remapeado y /P apunta a la página nueva', async () => {
    const reader = await openFixture('annotated.pdf');
    const { copier, reserved } = await reserve(reader, [0]);
    const page = await copier.copyPage(0);
    const objects = byNum(copier.drain());

    const sourcePage = dictOf(await reader.get(await reader.pageRef(0)));
    const sourceAnnots = await reader.resolve(dictGet(sourcePage, 'Annots'));
    expect(Array.isArray(sourceAnnots)).toBe(true);
    const annotsCopied = dictGet(page.dict, 'Annots');
    expect(Array.isArray(annotsCopied)).toBe(true);
    const copiedList = annotsCopied as readonly PdfValue[];
    const sourceList = sourceAnnots as readonly PdfValue[];
    expect(copiedList.length).toBe(sourceList.length);

    let popupsChecked = 0;
    for (let i = 0; i < sourceList.length; i++) {
      const src = dictOf(await reader.resolve(sourceList[i]));
      const copiedRef = copiedList[i];
      expect(isRefValue(copiedRef)).toBe(true);
      if (!isRefValue(copiedRef)) continue;
      const dst = dictOf(objects.get(copiedRef.num));
      expect(dictGet(dst, 'Subtype')).toEqual(dictGet(src, 'Subtype'));
      expect(dictGet(dst, 'Contents')).toEqual(dictGet(src, 'Contents'));

      const srcPopup = dictGet(src, 'Popup');
      if (isRefValue(srcPopup)) {
        const dstPopup = dictGet(dst, 'Popup');
        expect(isRefValue(dstPopup)).toBe(true);
        if (!isRefValue(dstPopup)) continue;
        const popup = dictOf(objects.get(dstPopup.num));
        expect(dictGet(popup, 'Subtype')).toEqual(dictGet(dictOf(await reader.get(srcPopup)), 'Subtype'));
        // Ciclo /Popup ↔ /Parent: el padre de la popup es la anotación copiada.
        const parent = dictGet(popup, 'Parent');
        expect(isRefValue(parent) && parent.num === copiedRef.num).toBe(true);
        popupsChecked++;
      }
      if (dictGet(src, 'P') !== undefined) {
        expect(dictGet(dst, 'P')).toEqual(reserved.get(0));
      }
    }
    expect(popupsChecked).toBeGreaterThan(0);
  });

  it('compressed.pdf: el flujo copiado es el del original (sin decodificar, con /Length directo)', async () => {
    const reader = await openFixture('compressed.pdf');
    await expectContentsCopiedAsOriginal(reader);
  });

  it('encrypted-aes-256.pdf (usuario): los flujos copiados son los del original descifrados', async () => {
    const reader = await openFixture('encrypted-aes-256.pdf', 'usuario');
    await expectContentsCopiedAsOriginal(reader);
  });

  it('ciclos /Popup ↔ /Parent: termina y cada objeto aparece una sola vez', async () => {
    const reader = await openFixture('annotated.pdf');
    const copier = new ObjectCopier({ from: reader, alloc: counter() });
    await copier.reservePages([0, 1, 2]);
    for (const index of [0, 1, 2]) await copier.copyPage(index);
    const nums = copier.drain().map(([r]) => r.num);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('pages-5000.pdf: copiar la página 2 500 no arrastra el documento', async () => {
    const reader = await openFixture('pages-5000.pdf');
    const sourceRef = await reader.pageRef(2499);
    const { copier } = await reserve(reader, [2499]);
    const spy = vi.spyOn(reader, 'get');
    await copier.copyPage(2499);
    const requested = spy.mock.calls.map(([r]) => r);
    spy.mockRestore();

    const copied = copier.drain();
    expect(copied.length).toBeLessThanOrEqual(20);
    for (const r of requested) {
      if (r.num === sourceRef.num) continue;
      const value = await reader.get(r);
      expect(typeOf(value)).not.toBe('Page');
    }
  });

  it('referencias a páginas no copiadas y a objetos inexistentes quedan en null', async () => {
    const reader = await openBytes(
      singlePagePdf((b, pages) => `/Back ${pages} 0 R /Ghost 77 0 R /Dest [${pages} 0 R /Fit]`),
    );
    const { copier } = await reserve(reader, [0]);
    const page = await copier.copyPage(0);
    expect(page.dict.entries.get('Back')).toBeNull();
    expect(page.dict.entries.get('Ghost')).toBeNull();
    expect(page.dict.entries.get('Dest')).toEqual([null, expect.objectContaining({ kind: 'name' })]);
  });

  it('la página copiada no conserva /Parent, /B ni /StructParents', async () => {
    const reader = await openBytes(singlePagePdf(() => '/B [1 0 R] /StructParents 0 /Rotate 90'));
    const { copier } = await reserve(reader, [0]);
    const page = await copier.copyPage(0);
    expect(dictGet(page.dict, 'Parent')).toBeUndefined();
    expect(dictGet(page.dict, 'B')).toBeUndefined();
    expect(dictGet(page.dict, 'StructParents')).toBeUndefined();
    expect(dictGet(page.dict, 'Rotate')).toBe(90);
  });

  it('hereda MediaBox, Rotate y Resources del antecesor (resueltos y copiados)', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const page = b.alloc();
    const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const resources = b.addObject(`<< /Font << /F1 ${font} 0 R >> >>`);
    b.setObject(page, `<< /Type /Page /Parent ${pages} 0 R >>`);
    b.setObject(
      pages,
      `<< /Type /Pages /Kids [${page} 0 R] /Count 1 /MediaBox [0 0 300 400] /Rotate 90 /Resources ${resources} 0 R >>`,
    );
    b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
    const reader = await openBytes(b.build({ root: catalog }));

    const copier = new ObjectCopier({ from: reader, alloc: counter() });
    await copier.reservePages([0]);
    const copied = await copier.copyPage(0);
    expect(dictGet(copied.dict, 'MediaBox')).toEqual([0, 0, 300, 400]);
    expect(dictGet(copied.dict, 'Rotate')).toBe(90);
    expect(dictGet(copied.dict, 'CropBox')).toBeUndefined();
    const resDict = dictOf(dictGet(copied.dict, 'Resources'));
    const f1 = dictGet(resDict, 'Font');
    expect(isDictValue(f1)).toBe(true);
    expect(isRefValue(dictOf(f1).entries.get('F1'))).toBe(true);
    expect(copier.mapped(font)).toBeDefined();
  });

  it('/Annots indirecto: la lista se resuelve y cada anotación se copia', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const page = b.alloc();
    const annot = b.addObject('<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] /Contents (Hola) /P ' + page + ' 0 R /StructParent 3 >>');
    const annots = b.addObject(`[${annot} 0 R]`);
    b.setObject(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 100 100] /Annots ${annots} 0 R >>`);
    b.setObject(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
    b.setObject(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
    const reader = await openBytes(b.build({ root: catalog }));

    const { copier, reserved } = await reserve(reader, [0]);
    const copied = await copier.copyPage(0);
    const objects = byNum(copier.drain());
    const list = dictGet(copied.dict, 'Annots');
    expect(Array.isArray(list)).toBe(true);
    const first = (list as readonly PdfValue[])[0];
    expect(isRefValue(first)).toBe(true);
    if (!isRefValue(first)) return;
    const dst = dictOf(objects.get(first.num));
    expect(dictGet(dst, 'Contents')).toEqual(expect.objectContaining({ kind: 'string' }));
    expect(dictGet(dst, 'StructParent')).toBeUndefined();
    expect(dictGet(dst, 'P')).toEqual(reserved.get(0));
  });

  it('copyPage exige reservar la página antes y devuelve lo mismo si se pide dos veces', async () => {
    const reader = await openFixture('basic-5.pdf');
    const copier = new ObjectCopier({ from: reader, alloc: counter() });
    await expect(copier.copyPage(0)).rejects.toThrow('no está reservada');

    const reserved = await copier.reservePages([0, 0]);
    expect(reserved.get(0)).toBeDefined();
    const first = await copier.copyPage(0);
    const second = await copier.copyPage(0);
    expect(second).toBe(first);
  });

  it('un valor directo más anidado que el límite es un error de sintaxis, no un desbordamiento', async () => {
    // El analizador ya rechaza más de 100 niveles al leer la página; el error llega como PdfSyntaxError.
    const deep = (levels: number): string => '['.repeat(levels) + ']'.repeat(levels);
    const reader = await openBytes(singlePagePdf(() => `/Deep ${deep(102)}`));
    await expect(
      reserve(reader, [0]).then(({ copier }) => copier.copyPage(0)),
    ).rejects.toBeInstanceOf(PdfSyntaxError);
  });

  it('un nivel de anidamiento dentro del límite se copia', async () => {
    const deep = (levels: number): string => '['.repeat(levels) + ']'.repeat(levels);
    const reader = await openBytes(singlePagePdf(() => `/Deep ${deep(40)}`));
    const { copier } = await reserve(reader, [0]);
    const page = await copier.copyPage(0);
    expect(dictGet(page.dict, 'Deep')).toBeDefined();
  });
});

/** Compara el flujo de /Contents copiado con el del origen (`reader.get`, descifrado y sin decodificar). */
async function expectContentsCopiedAsOriginal(reader: ObjectReader): Promise<void> {
  const { copier, reserved } = await reserve(reader, [0]);
  const copied = await copier.copyPage(0);
  const objects = byNum(copier.drain());

  const sourcePage = dictOf(await reader.get(await reader.pageRef(0)));
  const contentsSource = dictGet(sourcePage, 'Contents');
  expect(isRefValue(contentsSource)).toBe(true);
  if (!isRefValue(contentsSource)) return;

  const original = await reader.get(contentsSource);
  expect(isStreamValue(original)).toBe(true);
  if (!isStreamValue(original)) return;

  const newRef = copier.mapped(contentsSource.num);
  expect(newRef).toBeDefined();
  expect(dictGet(copied.dict, 'Contents')).toEqual(newRef);
  const copiedStream = objects.get(newRef?.num ?? -1);
  expect(isStreamValue(copiedStream)).toBe(true);
  if (!isStreamValue(copiedStream)) return;

  expect(Array.from(copiedStream.data)).toEqual(Array.from(original.data));
  expect(dictGet(copiedStream.dict, 'Length')).toBe(original.data.length);
  expect(reserved.size).toBe(1);
}
