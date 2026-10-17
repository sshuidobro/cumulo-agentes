import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { PlatformIoError, createIdbDraftStore } from '../src';

describe.each([
  ['IndexedDB', () => new IDBFactory()],
  ['memoria', () => null],
])('QA borradores (%s)', (_name, make) => {
  it('claves y valores Unicode (ñ, tildes, emoji, RTL, espacios, vacía)', async () => {
    const s = createIdbDraftStore('qa', make());
    const keys = ['Ñandú', 'ruta con espacios/a b.pdf', '😀', 'مرحبا', ''];
    for (const k of keys) await s.put(k, { t: `${k} ñ 😀 مرحبا` });
    for (const k of keys) expect(await s.get(k)).toEqual({ t: `${k} ñ 😀 مرحبا` });
    expect(await s.keys()).toEqual([...keys].sort());
  });

  it('valores falsy y tipos clonables (null, 0, "", Date, Map, Uint8Array)', async () => {
    const s = createIdbDraftStore('qa', make());
    await s.put('n', null);
    await s.put('z', 0);
    await s.put('e', '');
    await s.put('d', new Date(86400000));
    await s.put('m', new Map([[1, 'a']]));
    expect(await s.get('n')).toBeNull();
    expect(await s.get('z')).toBe(0);
    expect(await s.get('e')).toBe('');
    expect(await s.get('d')).toEqual(new Date(86400000));
    expect(await s.get('m')).toEqual(new Map([[1, 'a']]));
  });

  it('mutar el original tras put no altera lo guardado', async () => {
    const s = createIdbDraftStore('qa', make());
    const v = { list: [1] };
    await s.put('a', v);
    v.list.push(2);
    expect(await s.get('a')).toEqual({ list: [1] });
  });

  it('operaciones concurrentes: la última put gana y delete de inexistente no falla', async () => {
    const s = createIdbDraftStore('qa', make());
    await Promise.all([s.put('a', 1), s.put('a', 2), s.put('b', 3)]);
    expect(await s.get('a')).toBe(2);
    await expect(s.delete('nada')).resolves.toBeUndefined();
    expect(await s.keys()).toEqual(['a', 'b']);
  });

  it('un put fallido no deja rastro y el almacén sigue usable', async () => {
    const s = createIdbDraftStore('qa', make());
    await expect(s.put('f', () => 1)).rejects.toBeInstanceOf(PlatformIoError);
    expect(await s.get('f')).toBeUndefined();
    await s.put('ok', 1);
    expect(await s.keys()).toEqual(['ok']);
  });

  it('50 MiB se guardan y recuperan', async () => {
    const s = createIdbDraftStore('qa', make());
    const big = new Uint8Array(50 * 1024 * 1024).map((_, i) => i % 253);
    await s.put('big', big);
    const back = (await s.get('big')) as Uint8Array;
    expect(back.length).toBe(big.length);
    expect(back[49_999_999]).toBe(big[49_999_999]);
  });
});

it('bases con distinto nombre en la misma factory están aisladas', async () => {
  const f = new IDBFactory();
  await createIdbDraftStore('uno', f).put('a', 1);
  expect(await createIdbDraftStore('dos', f).get('a')).toBeUndefined();
});
