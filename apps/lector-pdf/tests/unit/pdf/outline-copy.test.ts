/**
 * Índice de las fuentes (PDF-122): entradas de primer nivel con su página y copia de la rama de un índice.
 * `outline.pdf` es el fixture de `tests/fixtures/structure.ts` (30 páginas, tres niveles, «Anexo» con destino
 * nombrado y «Sitio web» con URI). El resto de documentos se construyen con `PdfBuilder`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { ObjectCopier } from '../../../src/core/pdf/object-copier';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { copyOutlineBranch, readTopLevelOutline, type OutlineBranch } from '../../../src/core/pdf/outline-copy';
import { dictGet, name, ref, type PdfDict, type PdfRef, type PdfValue } from '../../../src/core/pdf/objects';
import { decodeTextString } from '../../../src/core/pdf/text-string';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder } from '../../fixtures/pdf-builder';

function fixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

async function openBytes(bytes: Uint8Array): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(bytes));
}

function counter(): () => PdfRef {
  let next = 1;
  return () => ref(next++);
}

function asDict(v: PdfValue | undefined): PdfDict {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || !('kind' in v) || v.kind !== 'dict') {
    throw new Error('se esperaba un diccionario');
  }
  return v;
}

/** Entrada de la rama por título (los títulos de estos fixtures son únicos). */
function entryTitled(branch: OutlineBranch, title: string): PdfDict {
  for (const [, value] of branch.objects) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !('kind' in value) || value.kind !== 'dict') continue;
    const t = dictGet(value, 'Title');
    if (typeof t === 'object' && t !== null && !Array.isArray(t) && 'kind' in t && t.kind === 'string' && decodeTextString(t) === title) {
      return value;
    }
  }
  throw new Error(`no hay entrada «${title}»`);
}

/** Índice con los elementos dados (`body` es el diccionario de cada uno, sin `/Next`); el catálogo es el 1. */
function outlineFile(items: readonly string[], links: 'chain' | 'cycle' = 'chain'): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const outlines = b.alloc();
  const nums = items.map(() => b.alloc());
  items.forEach((body, i) => {
    const next = links === 'cycle' ? nums[(i + 1) % nums.length] : nums[i + 1];
    const nextEntry = next === undefined ? '' : ` /Next ${next} 0 R`;
    b.setObject(nums[i] ?? outlines, `<< ${body} /Parent ${outlines} 0 R${nextEntry} >>`);
  });
  const first = nums[0] ?? outlines;
  b.setObject(outlines, `<< /Type /Outlines /First ${first} 0 R /Count ${items.length} >>`);
  b.setObject(catalog, `<< /Type /Catalog /Outlines ${outlines} 0 R >>`);
  return b.build({ root: catalog });
}

describe('readTopLevelOutline', () => {
  it('outline.pdf → Capítulo 1→0, Capítulo 2→10, Capítulo 3→20, Anexo→29, Sitio web→null', async () => {
    const reader = await openBytes(fixture('outline.pdf'));
    const top = await readTopLevelOutline(reader);
    expect(top).toEqual([
      { title: 'Capítulo 1', pageIndex: 0 },
      { title: 'Capítulo 2', pageIndex: 10 },
      { title: 'Capítulo 3', pageIndex: 20 },
      { title: 'Anexo', pageIndex: 29 },
      { title: 'Sitio web', pageIndex: null },
    ]);
  });

  it('un documento sin índice devuelve []', async () => {
    const reader = await openBytes(fixture('basic-5.pdf'));
    expect(await readTopLevelOutline(reader)).toEqual([]);
  });

  it('un ciclo en /Next termina y cada entrada aparece una vez', async () => {
    const reader = await openBytes(outlineFile(['/Title (Uno)', '/Title (Dos)'], 'cycle'));
    expect(await readTopLevelOutline(reader)).toEqual([
      { title: 'Uno', pageIndex: null },
      { title: 'Dos', pageIndex: null },
    ]);
  });

  it('páginas de las entradas: GoTo con nombre, /Dest explícito y GoTo con array', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const p1 = b.alloc();
    const p2 = b.alloc();
    const outlines = b.alloc();
    const first = b.alloc();
    const second = b.alloc();
    const third = b.alloc();
    b.setObject(p1, `<< /Type /Page /Parent ${pages} 0 R >>`);
    b.setObject(p2, `<< /Type /Page /Parent ${pages} 0 R >>`);
    b.setObject(pages, `<< /Type /Pages /Kids [${p1} 0 R ${p2} 0 R] /Count 2 >>`);
    b.setObject(first, `<< /Title (Nombrado) /Parent ${outlines} 0 R /Next ${second} 0 R /A << /S /GoTo /D (destino) >> >>`);
    b.setObject(second, `<< /Title (Explícito) /Parent ${outlines} 0 R /Next ${third} 0 R /Dest [${p2} 0 R /Fit] >>`);
    b.setObject(third, `<< /Title (Primera) /Parent ${outlines} 0 R /A << /S /GoTo /D [${p1} 0 R /Fit] >> >>`);
    b.setObject(outlines, `<< /Type /Outlines /First ${first} 0 R /Count 3 >>`);
    b.setObject(
      catalog,
      `<< /Type /Catalog /Pages ${pages} 0 R /Outlines ${outlines} 0 R /Names << /Dests << /Names [(destino) [${p2} 0 R /Fit]] >> >> >>`,
    );
    const reader = await openBytes(b.build({ root: catalog }));
    expect(await readTopLevelOutline(reader)).toEqual([
      { title: 'Nombrado', pageIndex: 1 },
      { title: 'Explícito', pageIndex: 1 },
      { title: 'Primera', pageIndex: 0 },
    ]);
  });
});

describe('copyOutlineBranch', () => {
  it('outline.pdf con todas sus páginas copiadas: destinos remapeados, estructura y /Count de la rama', async () => {
    const reader = await openBytes(fixture('outline.pdf'));
    const copier = new ObjectCopier({ from: reader, alloc: counter(), resolveNames: true });
    const reserved = await copier.reservePages(Array.from({ length: 30 }, (_, i) => i));
    const first = reserved.get(0);
    if (first === undefined) throw new Error('página 0 sin reservar');

    const branch = await copyOutlineBranch(reader, copier, 'outline', first);
    // Raíz + 11 entradas (3 niveles, Capítulo 3 cerrado incluido).
    expect(branch.objects).toHaveLength(12);
    expect(branch.objects.find(([r]) => r.num === branch.ref.num)?.[1]).toBeDefined();
    // Visibles: Capítulo 1 con 3 debajo (4), Capítulo 2 con 1 (2), Capítulo 3 cerrado (1), Anexo (1), Sitio web (1).
    expect(branch.visibleCount).toBe(9);

    const root = asDict(branch.objects.find(([r]) => r.num === branch.ref.num)?.[1]);
    expect(dictGet(root, 'Count')).toBe(9);
    expect(dictGet(root, 'Dest')).toEqual([first, name('Fit')]);

    const chapter2 = entryTitled(branch, 'Capítulo 2');
    expect(dictGet(chapter2, 'Dest')).toEqual([reserved.get(10), name('FitH'), 792]);
    expect(dictGet(chapter2, 'Parent')).toEqual(branch.ref);
    expect(dictGet(chapter2, 'Prev')).toBeDefined();
    expect(dictGet(chapter2, 'Next')).toBeDefined();
    expect(dictGet(chapter2, 'Count')).toBe(1);

    const chapter3 = entryTitled(branch, 'Capítulo 3');
    expect(dictGet(chapter3, 'Count')).toBe(-2);

    const anexo = entryTitled(branch, 'Anexo');
    expect(dictGet(anexo, 'Dest')).toEqual([reserved.get(29), name('Fit')]);

    const web = entryTitled(branch, 'Sitio web');
    const action = asDict(dictGet(web, 'A'));
    expect(dictGet(action, 'S')).toEqual(name('URI'));
    expect(dictGet(action, 'URI')).toBeDefined();
  });

  it('entradas cuya página no se copió se conservan sin /Dest; la URI se mantiene', async () => {
    const reader = await openBytes(fixture('outline.pdf'));
    const copier = new ObjectCopier({ from: reader, alloc: counter(), resolveNames: true });
    await copier.reservePages([0, 1, 2, 3, 4]);
    const first = (await copier.reservePages([0])).get(0);
    if (first === undefined) throw new Error('página 0 sin reservar');

    const branch = await copyOutlineBranch(reader, copier, 'parcial', first);
    expect(dictGet(entryTitled(branch, 'Capítulo 1'), 'Dest')).toBeDefined();
    expect(dictGet(entryTitled(branch, 'Capítulo 2'), 'Dest')).toBeUndefined();
    expect(dictGet(entryTitled(branch, 'Capítulo 2'), 'Title')).toBeDefined();
    expect(dictGet(entryTitled(branch, 'Anexo'), 'Dest')).toBeUndefined();
    expect(dictGet(entryTitled(branch, 'Sitio web'), 'A')).toBeDefined();
  });

  it('un ciclo en /Next copia cada entrada una vez', async () => {
    const reader = await openBytes(outlineFile(['/Title (Uno)', '/Title (Dos)'], 'cycle'));
    const copier = new ObjectCopier({ from: reader, alloc: counter(), resolveNames: true });
    const branch = await copyOutlineBranch(reader, copier, 'ciclo', ref(1));
    // Raíz + 2 entradas.
    expect(branch.objects).toHaveLength(3);
    expect(branch.visibleCount).toBe(2);
    expect(entryTitled(branch, 'Uno')).toBeDefined();
    expect(entryTitled(branch, 'Dos')).toBeDefined();
  });

  it('GoToR, Launch y JavaScript se quitan; GoTo con destino inexistente también', async () => {
    const reader = await openBytes(
      outlineFile([
        '/Title (Remoto) /A << /S /GoToR /F (otro.pdf) /D [0 /Fit] >>',
        '/Title (Lanzar) /A << /S /Launch /F (calc.exe) >>',
        '/Title (Script) /A << /S /JavaScript /JS (app.alert\\(1\\)) >>',
        '/Title (Sin destino) /A << /S /GoTo /D (no-existe) >>',
        '/Title (Web) /A << /S /URI /URI (https://example.org/) >>',
      ]),
    );
    const copier = new ObjectCopier({ from: reader, alloc: counter(), resolveNames: true });
    const branch = await copyOutlineBranch(reader, copier, 'acciones', ref(1));
    for (const title of ['Remoto', 'Lanzar', 'Script', 'Sin destino']) {
      expect(dictGet(entryTitled(branch, title), 'A')).toBeUndefined();
    }
    expect(dictGet(entryTitled(branch, 'Web'), 'A')).toBeDefined();
    expect(branch.visibleCount).toBe(5);
  });

  it('un índice vacío da una rama sin hijos', async () => {
    const b = new PdfBuilder();
    const catalog = b.addObject('<< /Type /Catalog >>');
    const reader = await openBytes(b.build({ root: catalog }));
    const copier = new ObjectCopier({ from: reader, alloc: counter(), resolveNames: true });
    const branch = await copyOutlineBranch(reader, copier, 'vacío', ref(1));
    expect(branch.objects).toHaveLength(1);
    expect(branch.visibleCount).toBe(0);
    expect(dictGet(asDict(branch.objects[0]?.[1]), 'First')).toBeUndefined();
  });
});
