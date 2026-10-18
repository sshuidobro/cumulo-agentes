import { describe, expect, it } from 'vitest';
import { createTauriPlatform } from '../../src/tauri/platform-tauri';
import type { TauriApi } from '../../src/tauri/tauri-api';

const dto = { token: 't ñ 😀', name: 'Ñandú 😀 مرحبا.pdf', path: '/mi carpeta/Ñandú 😀.pdf', size: 10, lastModified: null };

function api(over: Partial<TauriApi> = {}): TauriApi {
  return {
    invoke: () => Promise.resolve(dto as never),
    listen: () => Promise.resolve(() => undefined),
    setTitle: () => Promise.resolve(),
    onCloseRequested: () => Promise.resolve(() => undefined),
    destroyWindow: () => Promise.resolve(),
    openUrl: () => Promise.resolve(),
    setFullscreen: () => Promise.resolve(),
    isFullscreen: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => undefined),
    ...over,
  };
}

describe('QA tauri casos límite', () => {
  it('conserva Unicode, rutas con espacios y lastModified null', async () => {
    const p = createTauriPlatform({ prefsPrefix: 'x.' }, api());
    const r = await p.openFile([]);
    expect(r.ok && r.value?.name).toBe(dto.name);
    expect(r.ok && r.value?.path).toBe(dto.path);
    expect(r.ok && r.value?.lastModified).toBeNull();
  });

  it('read fuera de rango, negativo y no entero no invoca y da out-of-range', async () => {
    let calls = 0;
    const p = createTauriPlatform({ prefsPrefix: 'x.' }, api({ invoke: () => { calls++; return Promise.resolve(dto as never); } }));
    const r = await p.openFile([]);
    if (!r.ok || !r.value) throw new Error('no abierto');
    const calls0 = calls;
    for (const [b, e] of [[0, 11], [-1, 3], [5, 2], [0.5, 2]] as const) {
      await expect(r.value.source.read(b, e)).rejects.toMatchObject({ code: 'out-of-range' });
    }
    expect(calls).toBe(calls0);
  });

  it('error sin code, string o null en invoke -> io', async () => {
    for (const bad of ['boom', null, new Error('x'), { code: 5 }]) {
      const p = createTauriPlatform({ prefsPrefix: 'x.' }, api({ invoke: () => Promise.reject(bad) }));
      const r = await p.openFile([]);
      expect(!r.ok && r.error.code).toBe('io');
    }
  });

  it('onCloseRequested(() => true) no impide el cierre', async () => {
    const handlers: ((p: () => void) => void)[] = [];
    const p = createTauriPlatform({ prefsPrefix: 'x.' }, api({
      onCloseRequested: (h) => { handlers.push(h); return Promise.resolve(() => undefined); },
    }));
    p.onCloseRequested(() => true);
    await Promise.resolve();
    let prevented = false;
    expect(handlers).toHaveLength(1);
    handlers[0]?.(() => { prevented = true; });
    expect(prevented).toBe(false);
  });

  it('darse de baja antes de que listen resuelva llama a unlisten', async () => {
    let unlistened = 0;
    let resolve!: (f: () => void) => void;
    const p = createTauriPlatform({ prefsPrefix: 'x.' }, api({
      invoke: () => Promise.resolve([] as never),
      listen: () => new Promise((r) => { resolve = r; }),
    }));
    const stop = p.onFileOpenedFromOS(() => undefined);
    stop();
    stop();
    resolve(() => { unlistened++; });
    await new Promise((r) => setTimeout(r, 0));
    expect(unlistened).toBe(1);
  });

  it('openExternalUrl: mailto/https ok; file:, data:, vacío y relativa se rechazan', async () => {
    const opened: string[] = [];
    const p = createTauriPlatform({ prefsPrefix: 'x.' }, api({ openUrl: (u) => { opened.push(u); return Promise.resolve(); } }));
    expect((await p.openExternalUrl('mailto:a@b.es')).ok).toBe(true);
    expect((await p.openExternalUrl('https://ñandú.es/a b')).ok).toBe(true);
    for (const u of ['file:///etc/passwd', 'data:text/html,x', '', '/relativa', 'JAVASCRIPT:alert(1)']) {
      const r = await p.openExternalUrl(u);
      expect(!r.ok && r.error.code).toBe('unsupported');
    }
    expect(opened).toHaveLength(2);
  });

  it('setTitle con rechazo no lanza', async () => {
    const p = createTauriPlatform({ prefsPrefix: 'x.' }, api({ setTitle: () => Promise.reject(new Error('x')) }));
    expect(() => { p.setTitle('Título 😀'); }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
