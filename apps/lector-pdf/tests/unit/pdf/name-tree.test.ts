/**
 * Árboles de nombres y destinos con nombre (PDF-122, ISO 32000-1 §7.9.6 y §12.3.2.3). Los documentos de prueba
 * se construyen con `PdfBuilder`; el de `outline.pdf` es el fixture de `tests/fixtures/catalog.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { lookupNameTree, resolveNamedDest } from '../../../src/core/pdf/name-tree';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { name, ref, type PdfString } from '../../../src/core/pdf/objects';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { PdfBuilder } from '../../fixtures/pdf-builder';

function fixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

function bytesKey(text: string): PdfString {
  return { kind: 'string', bytes: new TextEncoder().encode(text), hex: false };
}

/**
 * Documento mínimo: el catálogo es el objeto 1 y `setup` escribe sus entradas (con `b`, reservando números).
 * Devuelve los bytes del fichero.
 */
function catalogFile(setup: (b: PdfBuilder, catalog: number) => string): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const entries = setup(b, catalog);
  b.setObject(catalog, `<< /Type /Catalog ${entries} >>`);
  return b.build({ root: catalog });
}

async function openBytes(bytes: Uint8Array): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(bytes));
}

/** Árbol con dos hojas bajo una raíz `/Kids` con `/Limits`. Las claves de la hoja B van de «m» a «q». */
function twoLeafTree(): Uint8Array {
  return catalogFile((b) => {
    const leafA = b.alloc();
    const leafB = b.alloc();
    const root = b.alloc();
    b.setObject(leafA, '<< /Limits [(a) (c)] /Names [(a) [1 0 R /Fit] (b) [2 0 R /Fit] (c) [3 0 R /XYZ 0 0 0]] >>');
    b.setObject(
      leafB,
      '<< /Limits [(m) (q)] /Names [(m) [4 0 R /Fit] (p) [5 0 R /Fit] (q) << /D [6 0 R /XYZ 0 700 0] >>] >>',
    );
    b.setObject(root, `<< /Limits [(a) (q)] /Kids [${leafA} 0 R ${leafB} 0 R] >>`);
    return `/Names << /Dests ${root} 0 R >>`;
  });
}

describe('lookupNameTree', () => {
  it('encuentra claves en hojas distintas de un árbol con /Kids y /Limits', async () => {
    const reader = await openBytes(twoLeafTree());
    const root = await reader.getDict(ref(4));
    if (root === null) throw new Error('la raíz del árbol no es un diccionario');

    expect(await lookupNameTree(reader, root, new TextEncoder().encode('b'))).toEqual([ref(2), name('Fit')]);
    expect(await lookupNameTree(reader, root, new TextEncoder().encode('p'))).toEqual([ref(5), name('Fit')]);
    // El valor `<< /D [...] >>` se devuelve tal cual: lookupNameTree no interpreta destinos.
    const q = await lookupNameTree(reader, root, new TextEncoder().encode('q'));
    expect(q).toMatchObject({ kind: 'dict' });
  });

  it('devuelve undefined si la clave no existe, dentro o fuera de los límites', async () => {
    const reader = await openBytes(twoLeafTree());
    const root = await reader.getDict(ref(4));
    if (root === null) throw new Error('la raíz del árbol no es un diccionario');
    expect(await lookupNameTree(reader, root, new TextEncoder().encode('z'))).toBeUndefined();
    expect(await lookupNameTree(reader, root, new TextEncoder().encode('d'))).toBeUndefined();
    expect(await lookupNameTree(reader, root, new TextEncoder().encode('0'))).toBeUndefined();
  });

  it('un nodo que se contiene a sí mismo no hace que la búsqueda cuelgue', async () => {
    const reader = await openBytes(
      catalogFile((b) => {
        const root = b.alloc();
        b.setObject(root, `<< /Kids [${root} 0 R] >>`);
        return `/Names << /Dests ${root} 0 R >>`;
      }),
    );
    expect(await resolveNamedDest(reader, bytesKey('x'))).toBeNull();
  });

  it('ignora los nodos a partir del nivel 32 y encuentra la hoja del nivel 32', async () => {
    const chain = (depth: number): Promise<ObjectReader> =>
      openBytes(
        catalogFile((b) => {
          const nums = Array.from({ length: depth }, () => b.alloc());
          nums.forEach((num, i) => {
            const next = nums[i + 1];
            b.setObject(
              num,
              next === undefined ? '<< /Names [(k) [1 0 R /Fit]] >>' : `<< /Kids [${next} 0 R] >>`,
            );
          });
          return `/Names << /Dests ${nums[0] ?? 0} 0 R >>`;
        }),
      );
    const reachable = await chain(32);
    expect(await resolveNamedDest(reachable, bytesKey('k'))).toEqual([ref(1), name('Fit')]);
    const unreachable = await chain(33);
    expect(await resolveNamedDest(unreachable, bytesKey('k'))).toBeNull();
  });
});

describe('resolveNamedDest', () => {
  it('outline.pdf: «anexo» → array cuya primera posición es la página 30 (índice 29)', async () => {
    const reader = await openBytes(fixture('outline.pdf'));
    const dest = await resolveNamedDest(reader, bytesKey('anexo'));
    const pages = await reader.pageRefs();
    expect(dest?.[0]).toEqual(pages[29]);
    expect(dest?.[1]).toEqual(name('Fit'));
  });

  it('acepta un nombre PDF como clave', async () => {
    const reader = await openBytes(fixture('outline.pdf'));
    const pages = await reader.pageRefs();
    expect((await resolveNamedDest(reader, name('anexo')))?.[0]).toEqual(pages[29]);
  });

  it('un nombre inexistente devuelve null', async () => {
    const reader = await openBytes(fixture('outline.pdf'));
    expect(await resolveNamedDest(reader, bytesKey('no-existe'))).toBeNull();
  });

  it('links.pdf: «destino-final» → página 5 (índice 4)', async () => {
    const reader = await openBytes(fixture('links.pdf'));
    const dest = await resolveNamedDest(reader, bytesKey('destino-final'));
    expect(dest?.[0]).toEqual((await reader.pageRefs())[4]);
  });

  it('una entrada `<< /D [...] >>` devuelve su /D', async () => {
    const reader = await openBytes(
      catalogFile(() => '/Names << /Dests << /Names [(d) << /D [9 0 R /XYZ 0 700 0] >>] >> >>'),
    );
    expect(await resolveNamedDest(reader, bytesKey('d'))).toEqual([ref(9), name('XYZ'), 0, 700, 0]);
  });

  it('una entrada que no es array ni diccionario con /D devuelve null', async () => {
    const reader = await openBytes(
      catalogFile(() => '/Names << /Dests << /Names [(n) 42 (sin-d) << /X 1 >>] >> >>'),
    );
    expect(await resolveNamedDest(reader, bytesKey('n'))).toBeNull();
    expect(await resolveNamedDest(reader, bytesKey('sin-d'))).toBeNull();
  });

  it('busca en el antiguo /Dests del catálogo si el árbol no tiene el nombre', async () => {
    const reader = await openBytes(catalogFile(() => '/Dests << /legado [7 0 R /Fit] >>'));
    expect(await resolveNamedDest(reader, name('legado'))).toEqual([ref(7), name('Fit')]);
    expect(await resolveNamedDest(reader, bytesKey('otro'))).toBeNull();
  });

  it('prefiere /Names /Dests al antiguo /Dests cuando los dos tienen el nombre', async () => {
    const reader = await openBytes(
      catalogFile(() => '/Names << /Dests << /Names [(doble) [8 0 R /Fit]] >> >> /Dests << /doble [9 0 R /Fit] >>'),
    );
    expect(await resolveNamedDest(reader, bytesKey('doble'))).toEqual([ref(8), name('Fit')]);
  });

  it('sin catálogo utilizable devuelve null', async () => {
    const b = new PdfBuilder();
    const catalog = b.addObject('<< /Type /Other >>');
    const reader = await openBytes(b.build({ root: catalog }));
    expect(await resolveNamedDest(reader, bytesKey('x'))).toBeNull();
  });
});
