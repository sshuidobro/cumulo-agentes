import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it, vi } from 'vitest';
import { loadPdf, type LoadedPdf } from '../../../src/engine';
import { readPageAnnotations, scanAnnotations } from '../../../src/engine/annotations-import';
import type { ImportedPage, SignatureAnnotation, SignatureArt } from '../../../src/core/annotations';
import { openForSave } from '../../../src/core/pdf/incremental';
import type { ObjectReader } from '../../../src/core/pdf/object-reader';
import { additionsDiff, saveAnnotations } from '../../support/save-annotations';
import { CORPUS_DIR, FIXTURES_DIR } from '../../fixtures/paths';
import { fixtureSource, nodeAssetBase } from '../../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;
const FALLBACK = '2026-10-17T12:00:00.000Z';

async function openFixture(name: string): Promise<LoadedPdf> {
  const result = await loadPdf(fixtureSource(name), { assetBaseUrl });
  if (!result.ok) throw new Error(`No se pudo abrir ${name}: ${result.error.code}`);
  return result.value;
}

async function openCorpus(relativePath: string): Promise<LoadedPdf> {
  const bytes = new Uint8Array(readFileSync(join(CORPUS_DIR, relativePath)));
  const result = await loadPdf(memorySource(bytes), { assetBaseUrl });
  if (!result.ok) throw new Error(`${relativePath}: ${result.error.code}`);
  return result.value;
}

describe('readPageAnnotations sobre annotated.pdf', () => {
  it('página 1: resaltado con comentario y autor, y subrayado azul; el popup no cuenta', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const page = await loaded.doc.getPage(1);
      const imported = await readPageAnnotations(page, FALLBACK);
      expect(imported.foreign).toEqual([]);
      expect(imported.supported).toHaveLength(2);
      const [highlight, underline] = imported.supported;
      expect(highlight).toMatchObject({
        type: 'highlight',
        pageIndex: 0,
        contents: 'Comentario previo',
        author: 'Otra persona',
        origin: { kind: 'file', ref: { gen: 0 } },
      });
      expect(highlight?.origin).toMatchObject({ kind: 'file', popupRef: expect.anything() });
      expect(underline).toMatchObject({ type: 'underline', color: [0, 0, 1] });
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('página 2: nota con icono Comment, texto libre de 12 pt y tinta con 2 trazos', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const page = await loaded.doc.getPage(2);
      const imported = await readPageAnnotations(page, FALLBACK);
      expect(imported.foreign).toEqual([]);
      expect(imported.supported.map((a) => a.type)).toEqual(['note', 'freetext', 'ink']);
      const [note, freeText, ink] = imported.supported;
      expect(note).toMatchObject({ type: 'note', icon: 'Comment', contents: 'Nota previa' });
      expect(freeText).toMatchObject({ type: 'freetext', fontSize: 12, contents: 'Texto libre previo' });
      expect(ink).toMatchObject({ type: 'ink', width: 2 });
      expect(ink).toMatchObject({ paths: [expect.any(Array), expect.any(Array)] });
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('página 3: el cuadrado es ajeno y el enlace no aparece en ninguna lista', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const page = await loaded.doc.getPage(3);
      const imported = await readPageAnnotations(page, FALLBACK);
      expect(imported.supported).toEqual([]);
      expect(imported.foreign).toHaveLength(1);
      expect(imported.foreign[0]).toMatchObject({ subtype: 'Square', pageIndex: 2, author: 'Otra persona' });
      expect(imported.foreign.some((f) => f.subtype === 'Link')).toBe(false);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('scanAnnotations', () => {
  it('recorre todas las páginas en lotes de 2 y entrega las importadas en orden', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const batches: ImportedPage[][] = [];
      const outcome = await scanAnnotations(loaded.doc, {
        batchSize: 2,
        fallbackDate: FALLBACK,
        onBatch: (pages) => { batches.push([...pages]); },
      });
      expect(outcome).toBe('done');
      expect(batches.map((b) => b.length)).toEqual([2, 1]);
      const all = batches.flat();
      expect(all.map((p) => p.supported.length)).toEqual([2, 3, 0]);
      expect(all.map((p) => p.foreign.length)).toEqual([0, 0, 1]);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('abortar tras el primer lote devuelve cancelled y no entrega más lotes', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const controller = new AbortController();
      let calls = 0;
      const outcome = await scanAnnotations(loaded.doc, {
        batchSize: 2,
        signal: controller.signal,
        fallbackDate: FALLBACK,
        onBatch: () => {
          calls += 1;
          controller.abort();
        },
      });
      expect(outcome).toBe('cancelled');
      expect(calls).toBe(1);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('con la señal ya abortada no entrega ningún lote', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const controller = new AbortController();
      controller.abort();
      let calls = 0;
      const outcome = await scanAnnotations(loaded.doc, {
        signal: controller.signal,
        fallbackDate: FALLBACK,
        onBatch: () => { calls += 1; },
      });
      expect(outcome).toBe('cancelled');
      expect(calls).toBe(0);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('corpus veraPDF · importación', () => {
  it('7.18.1-t02-pass-a.pdf importa exactamente un resaltado', async () => {
    const loaded = await openCorpus(join('verapdf', '7.18.1-t02-pass-a.pdf'));
    try {
      const batches: ImportedPage[][] = [];
      await scanAnnotations(loaded.doc, {
        fallbackDate: FALLBACK,
        onBatch: (pages) => { batches.push([...pages]); },
      });
      const supported = batches.flat().flatMap((p) => p.supported);
      expect(supported.map((a) => a.type)).toEqual(['highlight']);
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);
});

describe('readPageAnnotations con lector (nombre de los sellos ajenos)', () => {
  const INK: SignatureArt = { kind: 'ink', paths: [[0, 0, 25, 40, 50, 0]], width: 2, box: [100, 50] };
  const signature: SignatureAnnotation = {
    id: 'firma-1',
    type: 'signature',
    pageIndex: 0,
    rect: [100, 100, 300, 200],
    color: [0, 0, 0.6],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: FALLBACK,
    created: FALLBACK,
    origin: { kind: 'new' },
    art: INK,
  };

  async function signedDocument(): Promise<Uint8Array> {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data } = await saveAnnotations(original, additionsDiff([signature]));
    return data;
  }

  it('con lector, la firma de la suite es un ajeno con stampName «SuiteFirma»; sin lector, no lleva stampName', async () => {
    const data = await signedDocument();
    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    if (!loaded.ok) throw new Error(loaded.error.code);
    try {
      const page = await loaded.value.doc.getPage(1);
      const opened = await openForSave(memorySource(data));
      if (!opened.ok) throw new Error(opened.error.code);

      const withReader = await readPageAnnotations(page, FALLBACK, opened.value);
      expect(withReader.foreign).toHaveLength(1);
      expect(withReader.foreign[0]?.stampName).toBe('SuiteFirma');

      const withoutReader = await readPageAnnotations(page, FALLBACK);
      expect(withoutReader.foreign).toHaveLength(1);
      expect(withoutReader.foreign[0]?.stampName).toBeUndefined();
      expect(await readPageAnnotations(page, FALLBACK, null)).toEqual(withoutReader);
    } finally {
      await loaded.value.destroy();
    }
  }, OPEN_TIMEOUT);

  it('una página sin /Stamp ajeno no lee ningún diccionario', async () => {
    const loaded = await openFixture('annotated.pdf');
    try {
      const getDict = vi.fn(async () => null);
      const reader = { getDict } as unknown as ObjectReader;
      const imported = await readPageAnnotations(await loaded.doc.getPage(1), FALLBACK, reader);
      expect(imported.foreign.some((a) => a.subtype === 'Stamp')).toBe(false);
      expect(getDict).not.toHaveBeenCalled();
    } finally {
      await loaded.destroy();
    }
  }, OPEN_TIMEOUT);

  it('scanAnnotations pasa el lector a cada página', async () => {
    const data = await signedDocument();
    const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
    if (!loaded.ok) throw new Error(loaded.error.code);
    try {
      const opened = await openForSave(memorySource(data));
      if (!opened.ok) throw new Error(opened.error.code);
      const batches: ImportedPage[][] = [];
      const outcome = await scanAnnotations(loaded.value.doc, {
        fallbackDate: FALLBACK,
        reader: opened.value,
        onBatch: (pages) => { batches.push([...pages]); },
      });
      expect(outcome).toBe('done');
      expect(batches.flat()[0]?.foreign[0]?.stampName).toBe('SuiteFirma');
    } finally {
      await loaded.value.destroy();
    }
  }, OPEN_TIMEOUT);
});
