import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it, vi } from 'vitest';
import {
  SIGNATURE_STAMP_NAME,
  foreignTypeLabel,
  withStampNames,
  readStampNames,
  type ForeignAnnotation,
  type ImportedPage,
  type SignatureAnnotation,
  type SignatureArt,
} from '../../../src/core/annotations';
import type { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dict, name, ref, type PdfDict, type PdfValue } from '../../../src/core/pdf/objects';
import { openForSave } from '../../../src/core/pdf/incremental';
import { loadPdf, readPageAnnotations } from '../../../src/engine';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { additionsDiff, saveAnnotations } from '../../support/save-annotations';

const T0 = '2026-10-18T10:00:00.000Z';

const INK_ART: SignatureArt = {
  kind: 'ink',
  paths: [[0, 0, 25, 40, 50, 0]],
  width: 2,
  box: [100, 50],
};

function signature(id: string): SignatureAnnotation {
  return {
    id,
    type: 'signature',
    pageIndex: 0,
    rect: [100, 100, 300, 200],
    color: [0, 0, 0.6],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: T0,
    created: T0,
    origin: { kind: 'new' },
    art: INK_ART,
  };
}

function foreign(id: string, subtype: string, extra: Partial<ForeignAnnotation> = {}): ForeignAnnotation {
  return {
    id,
    pageIndex: 0,
    subtype,
    rect: [10, 20, 110, 40],
    contents: '',
    author: '',
    modified: null,
    ...extra,
  };
}

/** Lector falso: solo `getDict`, con objetos por número. Los ausentes dan `null`; `throws` lanza. */
function fakeReader(objects: Record<number, PdfDict | 'throws'>, getDict = vi.fn()): ObjectReader {
  getDict.mockImplementation(async (r: { num: number }) => {
    const o = objects[r.num];
    if (o === 'throws') throw new Error('objeto roto');
    return o ?? null;
  });
  return { getDict } as unknown as ObjectReader;
}

function stampDict(entries: Record<string, PdfValue>): PdfDict {
  return dict({ Type: name('Annot'), Subtype: name('Stamp'), ...entries });
}

function page(...items: readonly ForeignAnnotation[]): ImportedPage {
  return { supported: [], foreign: items, widgets: [] };
}

describe('readStampNames · ida y vuelta con firma de la suite', () => {
  it('una firma escrita con SuiteFirma se lee como /Name del /Stamp ajeno', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data } = await saveAnnotations(original, additionsDiff([signature('firma-1')]));

    const loaded = await loadPdf(memorySource(data), { assetBaseUrl: nodeAssetBase() });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const imported = await readPageAnnotations(await loaded.value.doc.getPage(1), T0);
      expect(imported.foreign).toHaveLength(1);
      const id = imported.foreign[0]?.id ?? '';
      expect(id).toMatch(/^ref:\d+R\d*$/);

      const opened = await openForSave(memorySource(data));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const names = await readStampNames(opened.value, imported.foreign);

      expect(names).toEqual(new Map([[id, 'SuiteFirma']]));
      expect(foreignTypeLabel('Stamp', names.get(id))).toBe('Firma');
    } finally {
      await loaded.value.destroy();
    }
  });
});

describe('readStampNames · nombres de sello', () => {
  it('un /Stamp /Name /Approved da «Approved»; uno sin /Name no aparece en el mapa', async () => {
    const reader = fakeReader({
      10: stampDict({ Name: name('Approved') }),
      11: stampDict({}),
    });
    const names = await readStampNames(reader, [foreign('ref:10R', 'Stamp'), foreign('ref:11R', 'Stamp')]);

    expect(names).toEqual(new Map([['ref:10R', 'Approved']]));
    expect(foreignTypeLabel('Stamp', names.get('ref:10R'))).toBe('Sello');
    expect(foreignTypeLabel('Stamp', names.get('ref:11R'))).toBe('Sello');
  });

  it('un /Name que no es nombre se omite', async () => {
    const reader = fakeReader({ 12: stampDict({ Name: 5 }) });
    expect((await readStampNames(reader, [foreign('ref:12R', 'Stamp')])).size).toBe(0);
  });

  it('un id con generación explícita usa esa referencia', async () => {
    const getDict = vi.fn();
    const reader = fakeReader({ 13: stampDict({ Name: name('Draft') }) }, getDict);
    const names = await readStampNames(reader, [foreign('ref:13R2', 'Stamp')]);

    expect(names).toEqual(new Map([['ref:13R2', 'Draft']]));
    expect(getDict).toHaveBeenCalledWith(ref(13, 2));
  });
});

describe('readStampNames · omisiones sin lanzar', () => {
  it('ids que no son referencia, subtipos distintos de Stamp y objetos inexistentes o rotos se omiten', async () => {
    const getDict = vi.fn();
    const reader = fakeReader({ 20: 'throws' }, getDict);
    const names = await readStampNames(reader, [
      foreign('ref:?0.1', 'Stamp'),
      foreign('ref:5R', 'Square'),
      foreign('ref:99R', 'Stamp'),
      foreign('ref:20R', 'Stamp'),
    ]);

    expect(names.size).toBe(0);
    expect(getDict.mock.calls.map((c) => (c[0] as { num: number }).num)).toEqual([99, 20]);
  });

  it('no consulta el objeto de anotaciones que no son sellos', async () => {
    const getDict = vi.fn();
    const reader = fakeReader({ 7: stampDict({ Name: name('Approved') }) }, getDict);
    await readStampNames(reader, [foreign('ref:7R', 'Square'), foreign('ref:8R', 'Text')]);

    expect(getDict).not.toHaveBeenCalled();
  });
});

describe('withStampNames', () => {
  it('con mapa vacío devuelve el mismo objeto', () => {
    const p = page(foreign('ref:1R', 'Stamp'));
    expect(withStampNames(p, new Map())).toBe(p);
  });

  it('sin coincidencias devuelve el mismo objeto', () => {
    const p = page(foreign('ref:1R', 'Stamp'));
    expect(withStampNames(p, new Map([['ref:2R', 'SuiteFirma']]))).toBe(p);
  });

  it('con coincidencia cambia solo esa anotación y no toca el original', () => {
    const a = foreign('ref:1R', 'Stamp');
    const b = foreign('ref:2R', 'Stamp');
    const p = page(a, b);
    const out = withStampNames(p, new Map([['ref:2R', SIGNATURE_STAMP_NAME]]));

    expect(out).not.toBe(p);
    expect(out.foreign[0]).toBe(a);
    expect(out.foreign[1]).toEqual({ ...b, stampName: SIGNATURE_STAMP_NAME });
    expect(p.foreign[1]).toBe(b);
    expect(out.supported).toBe(p.supported);
    expect(out.widgets).toBe(p.widgets);
  });
});
