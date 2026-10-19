// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import { fakeEnv, fakeHandle, namedError } from './fakes';

const FILTERS = [{ name: 'XFDF', extensions: ['xfdf'] }];

function saveHandle() {
  const written: Uint8Array[] = [];
  const handle = {
    kind: 'file',
    name: 'x.xfdf',
    getFile: async () => new File([written[0] ?? new Uint8Array()], 'x.xfdf'),
    createWritable: async () => ({
      write: async (part: Uint8Array) => { written.push(part); },
      close: async () => undefined,
      abort: async () => undefined,
    }),
  };
  return { handle: handle as unknown as FileSystemFileHandle, written };
}

describe('exportFile (web)', () => {
  it('con selector escribe los bytes exactos y no toca recientes', async () => {
    const { handle, written } = saveHandle();
    const platform = createWebPlatform({ prefsPrefix: 'e.' }, fakeEnv({ showSaveFilePicker: async () => handle }));
    const result = await platform.exportFile('x.xfdf', FILTERS, new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ ok: true, value: 'saved' });
    expect(Array.from(written[0] ?? [])).toEqual([1, 2, 3]);
    expect(await platform.recentFiles()).toEqual([]);
  });

  it('sin selector descarga con el nombre sugerido', async () => {
    const env = fakeEnv();
    const platform = createWebPlatform({ prefsPrefix: 'e.' }, env);
    const result = await platform.exportFile('a.png', [], new Uint8Array([7]));
    expect(result).toEqual({ ok: true, value: 'downloaded' });
    expect(env.download).toHaveBeenCalledWith(expect.any(Blob), 'a.png');
  });

  it('cancelar devuelve cancelled', async () => {
    const env = fakeEnv({ showSaveFilePicker: vi.fn(async () => { throw namedError('AbortError'); }) });
    const platform = createWebPlatform({ prefsPrefix: 'e.' }, env);
    expect(await platform.exportFile('a.png', [], new Uint8Array())).toEqual({ ok: true, value: 'cancelled' });
  });
});

describe('importFile (web)', () => {
  const file = new File([new Uint8Array([4, 5, 6])], 'n.xfdf');

  it('con selector devuelve nombre y bytes exactos sin tocar recientes', async () => {
    const platform = createWebPlatform({ prefsPrefix: 'i.' }, fakeEnv({ showOpenFilePicker: async () => [fakeHandle(file)] }));
    const result = await platform.importFile(FILTERS, 100);
    expect(result.ok && result.value?.name).toBe('n.xfdf');
    expect(result.ok && Array.from(result.value?.bytes ?? [])).toEqual([4, 5, 6]);
    expect(await platform.recentFiles()).toEqual([]);
  });

  it('sin selector usa el input', async () => {
    const platform = createWebPlatform({ prefsPrefix: 'i.' }, fakeEnv({ pickWithInput: async () => file }));
    const result = await platform.importFile(FILTERS, 100);
    expect(result.ok && result.value?.name).toBe('n.xfdf');
  });

  it('más grande que maxBytes: out-of-range sin leer', async () => {
    const big = new File([new Uint8Array(10)], 'g.xfdf');
    const spy = vi.spyOn(big, 'arrayBuffer');
    const platform = createWebPlatform({ prefsPrefix: 'i.' }, fakeEnv({ showOpenFilePicker: async () => [fakeHandle(big)] }));
    const result = await platform.importFile(FILTERS, 5);
    expect(result.ok ? null : result.error.code).toBe('out-of-range');
    expect(spy).not.toHaveBeenCalled();
  });

  it('cancelar devuelve ok(null)', async () => {
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => { throw namedError('AbortError'); }) });
    const platform = createWebPlatform({ prefsPrefix: 'i.' }, env);
    expect(await platform.importFile(FILTERS, 5)).toEqual({ ok: true, value: null });
  });
});
