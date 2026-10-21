// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import { fakeEnv, fakeHandle, namedError } from './fakes';

const FILTERS = [{ name: 'XFDF', extensions: ['xfdf'] }];

describe('importFiles (web)', () => {
  const a = new File([new Uint8Array([1, 2])], 'a.xfdf');
  const b = new File([new Uint8Array([3, 4, 5])], 'b.xfdf');

  it('con selector devuelve nombres y bytes exactos en orden y no toca recientes', async () => {
    const picker = vi.fn(async () => [fakeHandle(a), fakeHandle(b)]);
    const platform = createWebPlatform({ prefsPrefix: 'im.' }, fakeEnv({ showOpenFilePicker: picker }));
    const result = await platform.importFiles(FILTERS, 100, 5);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(result.ok && result.value?.map((f) => f.name)).toEqual(['a.xfdf', 'b.xfdf']);
    expect(result.ok && result.value?.map((f) => Array.from(f.bytes))).toEqual([[1, 2], [3, 4, 5]]);
    expect(await platform.recentFiles()).toEqual([]);
  });

  it('sin selector usa el input múltiple', async () => {
    const pickManyWithInput = vi.fn(async () => [a, b]);
    const platform = createWebPlatform({ prefsPrefix: 'im.' }, fakeEnv({ pickManyWithInput }));
    const result = await platform.importFiles(FILTERS, 100, 5);
    expect(pickManyWithInput).toHaveBeenCalledWith('.xfdf');
    expect(result.ok && result.value?.map((f) => f.name)).toEqual(['a.xfdf', 'b.xfdf']);
  });

  it('input múltiple: cancelar devuelve ok(null)', async () => {
    const platform = createWebPlatform({ prefsPrefix: 'im.' }, fakeEnv({ pickManyWithInput: async () => null }));
    expect(await platform.importFiles(FILTERS, 100, 5)).toEqual({ ok: true, value: null });
  });

  it('selector cancelado (AbortError) devuelve ok(null)', async () => {
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => { throw namedError('AbortError'); }) });
    expect(await createWebPlatform({ prefsPrefix: 'im.' }, env).importFiles(FILTERS, 100, 5))
      .toEqual({ ok: true, value: null });
  });

  it('más ficheros que maxCount: out-of-range sin leer ninguno', async () => {
    const files = [a, b, new File([new Uint8Array(1)], 'c.xfdf')];
    const spies = files.map((f) => vi.spyOn(f, 'arrayBuffer'));
    const handles = files.map((f) => fakeHandle(f));
    const platform = createWebPlatform({ prefsPrefix: 'im.' }, fakeEnv({ showOpenFilePicker: async () => handles }));
    const result = await platform.importFiles(FILTERS, 100, 2);
    expect(result.ok ? null : result.error.code).toBe('out-of-range');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('alguno mayor que maxBytesEach: out-of-range sin leer ninguno', async () => {
    const big = new File([new Uint8Array(10)], 'g.xfdf');
    const spyA = vi.spyOn(a, 'arrayBuffer');
    const spyBig = vi.spyOn(big, 'arrayBuffer');
    const platform = createWebPlatform({ prefsPrefix: 'im.' }, fakeEnv({ showOpenFilePicker: async () => [fakeHandle(a), fakeHandle(big)] }));
    const result = await platform.importFiles(FILTERS, 5, 5);
    expect(result.ok ? null : result.error.code).toBe('out-of-range');
    expect(spyA).not.toHaveBeenCalled();
    expect(spyBig).not.toHaveBeenCalled();
  });

  it('error de lectura de un fichero: err', async () => {
    const broken = new File([new Uint8Array(2)], 'roto.xfdf');
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('io'));
    const platform = createWebPlatform({ prefsPrefix: 'im.' }, fakeEnv({ showOpenFilePicker: async () => [fakeHandle(a), fakeHandle(broken)] }));
    const result = await platform.importFiles(FILTERS, 100, 5);
    expect(result.ok).toBe(false);
  });
});
