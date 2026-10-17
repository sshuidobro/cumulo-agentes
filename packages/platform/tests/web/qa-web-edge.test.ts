// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import { fakeEnv, fakeHandle, namedError } from './fakes';

const opts = { prefsPrefix: 'qa.' };

describe('QA web: casos límite', () => {
  it('fichero vacío y nombre con Unicode, espacios y RTL', async () => {
    const file = new File([], 'Informe ñandú 😀 مرحبا.pdf');
    const p = createWebPlatform(opts, fakeEnv({ showOpenFilePicker: async () => [fakeHandle(file)] }));
    const r = await p.openFile([{ name: 'PDF', extensions: ['pdf'] }]);
    expect(r.ok).toBe(true);
    if (!r.ok || r.value === null) throw new Error('esperaba fichero');
    expect(r.value.name).toBe('Informe ñandú 😀 مرحبا.pdf');
    expect(r.value.size).toBe(0);
    expect((await r.value.source.read(0, 0)).length).toBe(0);
  });

  it('picker sin handles devuelve ok(null)', async () => {
    const p = createWebPlatform(opts, fakeEnv({ showOpenFilePicker: async () => [] }));
    const r = await p.openFile([]);
    expect(r).toEqual({ ok: true, value: null });
  });

  it('getFile que falla (fichero borrado) da err io sin lanzar', async () => {
    const handle = { kind: 'file', name: 'x', getFile: async () => { throw namedError('NotFoundError'); } };
    const p = createWebPlatform(opts, fakeEnv({ showOpenFilePicker: async () => [handle as unknown as FileSystemFileHandle] }));
    const r = await p.openFile([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('io');
  });

  it('pickWithInput que lanza no rompe', async () => {
    const p = createWebPlatform(opts, fakeEnv({ pickWithInput: async () => { throw new TypeError('boom'); } }));
    const r = await p.openFile([]);
    expect(r.ok).toBe(false);
  });

  it('openDropped: getAsFileSystemHandle rechaza -> cae a files; carpeta -> cae a files', async () => {
    const file = new File(['abc'], 'a.txt');
    const p = createWebPlatform(opts, fakeEnv());
    const bad = { items: [{ getAsFileSystemHandle: async () => { throw namedError('NotAllowedError'); } }], files: [file] };
    const r1 = await p.openDropped(bad as unknown as DataTransfer);
    expect(r1.ok && r1.value?.canSaveInPlace).toBe(false);
    const dir = { items: [{ getAsFileSystemHandle: async () => ({ kind: 'directory' }) }], files: [file] };
    const r2 = await p.openDropped(dir as unknown as DataTransfer);
    expect(r2.ok && r2.value?.name).toBe('a.txt');
  });

  it('openExternalUrl: protocolos en mayúsculas, con espacios y vacíos', async () => {
    const open = vi.fn();
    const w = Object.create(window, { open: { value: open } }) as Window;
    const p = createWebPlatform(opts, fakeEnv({ window: w }));
    for (const u of ['JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'vbscript:x', 'blob:http://a/b', '', 'ftp://x']) {
      const r = await p.openExternalUrl(u);
      expect(r.ok, u).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
    expect((await p.openExternalUrl('MAILTO:a@b.es')).ok).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('onCloseRequested: dos listeners independientes y baja doble es inocua', () => {
    const p = createWebPlatform(opts, fakeEnv());
    const off1 = p.onCloseRequested(() => false);
    const off2 = p.onCloseRequested(() => true);
    off2(); off2();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    off1();
    const e2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });

  it('tokens únicos tras closeFile y save/saveAs son unsupported', async () => {
    const p = createWebPlatform(opts, fakeEnv());
    const a = p.openBrowserFile(new File(['1'], 'a'));
    const b = p.openBrowserFile(new File(['1'], 'a'));
    if (!a.ok || !b.ok) throw new Error('fallo');
    await p.closeFile(a.value);
    const c = p.openBrowserFile(new File(['1'], 'a'));
    if (!c.ok) throw new Error('fallo');
    expect(new Set([a.value.token, b.value.token, c.value.token]).size).toBe(3);
    const s = await p.save(b.value, { kind: 'bytes', bytes: new Uint8Array(1) });
    expect(s.ok).toBe(false);
  });
});
