import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import {
  checkZipBudget,
  extractFileName,
  splitByBookmarks,
  splitByPageCount,
  splitBySize,
  splitPartNames,
  splitZipName,
  SPLIT_SIZES_MB,
} from '../../../src/core/organize/split';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { readTopLevelOutline } from '../../../src/core/pdf/outline-copy';
import { FIXTURES_DIR } from '../../fixtures/paths';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

async function openFixture(name: string): Promise<ObjectReader> {
  return ObjectReader.open(memorySource(fixture(name)));
}

describe('splitByPageCount', () => {
  it('agrupa de 2 en 2 y el último grupo puede ser menor', () => {
    expect(splitByPageCount(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('un grupo por página cuando every = 1', () => {
    expect(splitByPageCount(3, 1)).toEqual([[0], [1], [2]]);
  });

  it('every mayor que el número de páginas: un solo grupo', () => {
    expect(splitByPageCount(3, 10)).toEqual([[0, 1, 2]]);
  });

  it('cero páginas: ningún grupo', () => {
    expect(splitByPageCount(0, 2)).toEqual([]);
  });

  it('every 0, negativo, decimal o no numérico lanza RangeError', () => {
    expect(() => splitByPageCount(5, 0)).toThrow(RangeError);
    expect(() => splitByPageCount(5, -1)).toThrow(RangeError);
    expect(() => splitByPageCount(5, 1.5)).toThrow(RangeError);
    expect(() => splitByPageCount(5, Number.NaN)).toThrow(RangeError);
  });
});

describe('splitByBookmarks', () => {
  it('corta en cada entrada de primer nivel', () => {
    const top = [
      { title: 'Cap. 1', pageIndex: 0 },
      { title: 'Cap. 2', pageIndex: 10 },
      { title: 'Cap. 3', pageIndex: 20 },
      { title: 'Anexo', pageIndex: 29 },
    ];
    expect(splitByBookmarks(top, 30)).toEqual([
      range(0, 10),
      range(10, 20),
      range(20, 29),
      [29],
    ]);
  });

  it('si la primera entrada no está en la página 0, el primer grupo empieza en 0', () => {
    const top = [{ title: 'Cap. 2', pageIndex: 3 }];
    expect(splitByBookmarks(top, 5)).toEqual([[0, 1, 2], [3, 4]]);
  });

  it('quita duplicados y ordena los cortes', () => {
    const top = [
      { title: 'b', pageIndex: 4 },
      { title: 'a', pageIndex: 2 },
      { title: 'c', pageIndex: 4 },
    ];
    expect(splitByBookmarks(top, 6)).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('ignora entradas sin página o fuera de rango', () => {
    const top = [
      { title: 'URI', pageIndex: null },
      { title: 'Fuera', pageIndex: 9 },
      { title: 'Cap. 2', pageIndex: 2 },
    ];
    expect(splitByBookmarks(top, 5)).toEqual([[0, 1], [2, 3, 4]]);
  });

  it('sin cortes: un único grupo con todas las páginas', () => {
    expect(splitByBookmarks([], 3)).toEqual([[0, 1, 2]]);
    expect(splitByBookmarks([{ title: 'URI', pageIndex: null }], 3)).toEqual([[0, 1, 2]]);
  });

  it('cero páginas: ningún grupo', () => {
    expect(splitByBookmarks([], 0)).toEqual([]);
  });
});

describe('splitBySize', () => {
  it('reparte las 5000 páginas sin páginas sueltas oversized (el tamaño real se mide en split-ops)', async () => {
    const reader = await openFixture('pages-5000.pdf');
    const maxBytes = 100_000;
    const result = await splitBySize(reader, maxBytes);
    const pages = result.groups.flat();
    expect(pages).toHaveLength(5000);
    expect(new Set(pages).size).toBe(5000);
    expect(result.groups.length).toBeGreaterThan(1);
    expect(result.oversized).toBe(0);
  });

  it('los grupos mantienen el orden de las páginas y no repiten ninguna', async () => {
    const reader = await openFixture('pages-5000.pdf');
    const result = await splitBySize(reader, 100_000);
    expect(result.groups.flat()).toEqual(range(0, 5000));
  });

  it('una página mayor que el máximo va sola en su parte y se cuenta en oversized', async () => {
    // images-200.pdf: cada página lleva una imagen de más de 100 000 bytes.
    const reader = await openFixture('images-200.pdf');
    const result = await splitBySize(reader, 100_000);
    expect(result.oversized).toBe(200);
    expect(result.groups).toHaveLength(200);
    for (const group of result.groups) expect(group).toHaveLength(1);
  }, 60_000);

  it('un máximo inferior a 100 000 bytes lanza RangeError', async () => {
    const reader = await openFixture('outline.pdf');
    await expect(splitBySize(reader, 99_999)).rejects.toThrow(RangeError);
    await expect(splitBySize(reader, Number.NaN)).rejects.toThrow(RangeError);
  });

  it('con la señal ya abortada devuelve ningún grupo', async () => {
    const reader = await openFixture('outline.pdf');
    const controller = new AbortController();
    controller.abort();
    const result = await splitBySize(reader, 100_000, controller.signal);
    expect(result).toEqual({ groups: [], oversized: 0 });
  });
});

describe('checkZipBudget', () => {
  it('false si la suma supera el límite', () => {
    expect(checkZipBudget([600, 500], 1000)).toBe(false);
  });

  it('true si la suma es igual o menor que el límite', () => {
    expect(checkZipBudget([500, 500], 1000)).toBe(true);
    expect(checkZipBudget([], 1000)).toBe(true);
  });
});

describe('nombres', () => {
  it('splitPartNames usa al menos dos cifras y las que necesite el recuento', () => {
    expect(splitPartNames('outline', 4)).toEqual([
      'outline-parte-01.pdf',
      'outline-parte-02.pdf',
      'outline-parte-03.pdf',
      'outline-parte-04.pdf',
    ]);
    const many = splitPartNames('x', 120);
    expect(many[0]).toBe('x-parte-001.pdf');
    expect(many[119]).toBe('x-parte-120.pdf');
  });

  it('extractFileName: rango consecutivo, página única o extracto', () => {
    expect(extractFileName('outline', [2, 3, 4, 5, 6])).toBe('outline-paginas-3-7.pdf');
    expect(extractFileName('outline', [4])).toBe('outline-paginas-5.pdf');
    expect(extractFileName('outline', [0, 2])).toBe('outline-extracto.pdf');
    expect(extractFileName('outline', [3, 2])).toBe('outline-extracto.pdf');
    expect(extractFileName('outline', [])).toBe('outline-extracto.pdf');
  });

  it('splitZipName', () => {
    expect(splitZipName('informe')).toBe('informe-partes.zip');
  });

  it('SPLIT_SIZES_MB ofrece los tamaños de la interfaz', () => {
    expect(SPLIT_SIZES_MB).toEqual([1, 2, 5, 10, 25, 50, 100]);
  });
});

describe('índice de primer nivel de outline.pdf', () => {
  it('readTopLevelOutline + splitByBookmarks dan 10, 10, 9 y 1 páginas', async () => {
    const reader = await openFixture('outline.pdf');
    const top = await readTopLevelOutline(reader);
    const groups = splitByBookmarks(top, await reader.pageCount());
    expect(groups.map((group) => group.length)).toEqual([10, 10, 9, 1]);
  });
});

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}
