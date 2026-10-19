/**
 * `ObjectCopier` con `resolveNames` (PDF-122): los destinos con nombre de las anotaciones (`/Dest`) y de las acciones
 * `GoTo` (`/A`) pasan a destinos explícitos; un nombre inexistente quita el destino o la acción. Sin la opción, los
 * valores se copian tal cual (comportamiento de PDF-120).
 */
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { ObjectCopier } from '../../../src/core/pdf/object-copier';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, name, ref, type PdfDict, type PdfRef, type PdfValue } from '../../../src/core/pdf/objects';
import { PdfBuilder } from '../../fixtures/pdf-builder';

/**
 * Una página con cuatro enlaces: `/Dest (destino)`, `/Dest (no-existe)`, `/A << /S /GoTo /D (destino) >>` y
 * `/A << /S /GoTo /D (no-existe) >>`. El nombre «destino» apunta a la página.
 */
async function linksDocument(): Promise<ObjectReader> {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const annots = [b.alloc(), b.alloc(), b.alloc(), b.alloc()];
  const rect = '/Type /Annot /Subtype /Link /Rect [0 0 10 10]';
  b.setObject(annots[0] ?? 0, `<< ${rect} /Dest (destino) >>`);
  b.setObject(annots[1] ?? 0, `<< ${rect} /Dest (no-existe) >>`);
  b.setObject(annots[2] ?? 0, `<< ${rect} /A << /S /GoTo /D (destino) >> >>`);
  b.setObject(annots[3] ?? 0, `<< ${rect} /A << /S /GoTo /D (no-existe) >> >>`);
  const annotList = annots.map((num) => `${num} 0 R`).join(' ');
  b.setObject(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Annots [${annotList}] >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  b.setObject(
    catalog,
    `<< /Type /Catalog /Pages ${pages} 0 R /Names << /Dests << /Names [(destino) [${page} 0 R /Fit]] >> >> >>`,
  );
  return ObjectReader.open(memorySource(b.build({ root: catalog })));
}

/** Copia la página 0 y devuelve su diccionario y los diccionarios de sus anotaciones, en orden. */
async function copyPageWithAnnots(resolveNames: boolean): Promise<{ readonly page: PdfDict; readonly annots: PdfDict[]; readonly pageRef: PdfRef }> {
  const reader = await linksDocument();
  let next = 1;
  const copier = new ObjectCopier({ from: reader, alloc: () => ref(next++), resolveNames });
  await copier.reservePages([0]);
  const copied = await copier.copyPage(0);
  const objects = new Map<number, PdfValue>(copier.drain().map(([r, v]) => [r.num, v]));
  const list = dictGet(copied.dict, 'Annots');
  if (!Array.isArray(list)) throw new Error('la página copiada no tiene /Annots');
  const annots = list.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || !('kind' in item) || item.kind !== 'ref') {
      throw new Error('anotación no referenciada');
    }
    const value = objects.get(item.num);
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !('kind' in value) || value.kind !== 'dict') {
      throw new Error(`anotación ${item.num} no es un diccionario`);
    }
    return value;
  });
  return { page: copied.dict, annots, pageRef: copied.ref };
}

describe('ObjectCopier con resolveNames', () => {
  it('/Dest con nombre → destino explícito a la página copiada; nombre inexistente → se quita /Dest', async () => {
    const { annots, pageRef } = await copyPageWithAnnots(true);
    expect(dictGet(annots[0] ?? fail(), 'Dest')).toEqual([pageRef, name('Fit')]);
    expect(dictGet(annots[1] ?? fail(), 'Dest')).toBeUndefined();
  });

  it('/A con GoTo a nombre → GoTo con destino explícito; nombre inexistente → se quita /A', async () => {
    const { annots, pageRef } = await copyPageWithAnnots(true);
    const action = dictGet(annots[2] ?? fail(), 'A');
    expect(action).toMatchObject({ kind: 'dict' });
    if (typeof action !== 'object' || action === null || Array.isArray(action) || !('kind' in action) || action.kind !== 'dict') return;
    expect(dictGet(action, 'S')).toEqual(name('GoTo'));
    expect(dictGet(action, 'D')).toEqual([pageRef, name('Fit')]);
    expect(dictGet(annots[3] ?? fail(), 'A')).toBeUndefined();
  });

  it('sin resolveNames (por defecto) los nombres se copian tal cual', async () => {
    const { annots } = await copyPageWithAnnots(false);
    expect(dictGet(annots[0] ?? fail(), 'Dest')).toMatchObject({ kind: 'string' });
    expect(dictGet(annots[1] ?? fail(), 'Dest')).toMatchObject({ kind: 'string' });
    expect(dictGet(annots[3] ?? fail(), 'A')).toMatchObject({ kind: 'dict' });
  });
});

function fail(): never {
  throw new Error('falta la anotación esperada');
}
