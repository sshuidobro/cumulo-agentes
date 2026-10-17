import { describe, expect, it } from 'vitest';
import { blobSource, createStorageStore, memorySource, readAll } from '../src';

const isStr = (v: unknown): v is string => typeof v === 'string';

describe('QA casos límite', () => {
  it('prefs conserva Unicode (ñ, tildes, emoji, RTL) en claves y valores', () => {
    const store = createStorageStore(null, 'suite.');
    const text = 'Ñandú áéí 😀 مرحبا';
    store.set('clave ñ 😀', text);
    expect(store.get('clave ñ 😀', isStr)).toBe(text);
  });

  it('prefs: valor circular no lanza', () => {
    const store = createStorageStore(null, 'x.');
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => { store.set('c', a); }).not.toThrow();
    expect(store.get('c', isStr)).toBeNull();
  });

  it('fuente vacía y rangos NaN/Infinity rechazan o devuelven vacío', async () => {
    const empty = memorySource(new Uint8Array(0));
    expect((await empty.read(0, 0)).length).toBe(0);
    await expect(empty.read(Number.NaN, 0)).rejects.toMatchObject({ code: 'out-of-range' });
    await expect(blobSource(new Blob([])).read(0, Number.POSITIVE_INFINITY)).rejects.toMatchObject({ code: 'out-of-range' });
  });

  it('readAll de 10 MB con trozos por defecto es exacto', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 3).map((_, i) => i % 251);
    const out = await readAll(blobSource(new Blob([big])));
    expect(out.length).toBe(big.length);
    expect(out[big.length - 1]).toBe(big[big.length - 1]);
    expect(out[5_000_000]).toBe(big[5_000_000]);
  });
});
