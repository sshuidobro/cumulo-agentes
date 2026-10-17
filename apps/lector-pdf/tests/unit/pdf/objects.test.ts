import { describe, expect, it } from 'vitest';
import {
  bytesString,
  dict,
  dictGet,
  name,
  ref,
  stream,
  withEntries,
  type PdfDict,
} from '../../../src/core/pdf/objects';
import { raw } from './helpers';

describe('constructores de objetos PDF', () => {
  it('name y ref construyen objetos con su tipo', () => {
    expect(name('Type')).toEqual({ kind: 'name', value: 'Type' });
    expect(ref(4)).toEqual({ kind: 'ref', num: 4, gen: 0 });
    expect(ref(4, 1)).toEqual({ kind: 'ref', num: 4, gen: 1 });
  });

  it('ref lanza RangeError con números no válidos', () => {
    expect(() => ref(-1)).toThrow(RangeError);
    expect(() => ref(1.5)).toThrow(RangeError);
    expect(() => ref(1, -1)).toThrow(RangeError);
  });

  it('dict acepta un registro o un mapa y conserva el orden', () => {
    const fromRecord = dict({ B: 1, A: 2 });
    expect([...fromRecord.entries.keys()]).toEqual(['B', 'A']);
    const fromMap = dict(new Map([['Z', true], ['Y', null]]));
    expect([...fromMap.entries]).toEqual([['Z', true], ['Y', null]]);
  });

  it('dict copia las entradas: cambiar el origen no cambia el objeto', () => {
    const source = new Map([['A', 1]]);
    const d = dict(source);
    source.set('B', 2);
    expect(d.entries.has('B')).toBe(false);
  });

  it('stream fija /Length al tamaño de los datos', () => {
    const s = stream({ Filter: name('X'), Length: 999 }, raw([1, 2, 3]));
    expect(dictGet(s.dict, 'Length')).toBe(3);
    expect(dictGet(s.dict, 'Filter')).toEqual(name('X'));
    expect(s.data).toEqual(raw([1, 2, 3]));
  });

  it('bytesString copia los bytes y marca si es hexadecimal', () => {
    const src = raw([1, 2]);
    const s = bytesString(src, true);
    src[0] = 9;
    expect(s).toEqual({ kind: 'string', bytes: raw([1, 2]), hex: true });
    expect(bytesString(raw([])).hex).toBe(false);
  });
});

describe('dictGet y withEntries', () => {
  const base: PdfDict = dict({ A: 1, B: 2, C: 3 });

  it('dictGet devuelve undefined si la clave no existe', () => {
    expect(dictGet(base, 'Nope')).toBeUndefined();
    expect(dictGet(base, 'B')).toBe(2);
  });

  it('withEntries sustituye sin mover la clave y añade las nuevas al final', () => {
    const d = withEntries(base, { B: 20, D: 4 });
    expect([...d.entries]).toEqual([['A', 1], ['B', 20], ['C', 3], ['D', 4]]);
  });

  it('withEntries con undefined borra la clave', () => {
    const d = withEntries(base, { A: undefined });
    expect([...d.entries.keys()]).toEqual(['B', 'C']);
  });

  it('withEntries no modifica el diccionario original', () => {
    withEntries(base, { A: undefined, Z: 1 });
    expect([...base.entries.keys()]).toEqual(['A', 'B', 'C']);
  });

  it('withEntries con undefined de una clave inexistente no hace nada', () => {
    expect([...withEntries(base, { Q: undefined }).entries.keys()]).toEqual(['A', 'B', 'C']);
  });
});
