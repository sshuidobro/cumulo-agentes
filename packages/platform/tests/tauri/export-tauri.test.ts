import { describe, expect, it } from 'vitest';
import { createTauriPlatform } from '../../src/tauri/platform-tauri';
import type { InvokeOptions, TauriApi } from '../../src/tauri/tauri-api';

interface Call { readonly cmd: string; readonly args: unknown; readonly options: InvokeOptions | undefined }

function fake(respond: (cmd: string) => unknown) {
  const calls: Call[] = [];
  const api = {
    invoke(cmd: string, args?: unknown, options?: InvokeOptions) {
      calls.push({ cmd, args, options });
      return Promise.resolve().then(() => respond(cmd));
    },
    listen: () => Promise.resolve(() => undefined),
    onResized: () => Promise.resolve(() => undefined),
  } as unknown as TauriApi;
  return { api, calls };
}

const dto = (size: number) => ({ token: 't1', name: 'f.xfdf', path: '/x/f.xfdf', size, lastModified: 1 });
const FILTERS = [{ name: 'X', extensions: ['xfdf'] }];

describe('exportFile (tauri)', () => {
  it('guarda sin recordar y cierra el token', async () => {
    const f = fake((cmd) => (cmd === 'suite_save_dialog' ? dto(0) : dto(2)));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).exportFile('f.xfdf', FILTERS, new Uint8Array([1, 2]));
    expect(result).toEqual({ ok: true, value: 'saved' });
    expect(f.calls.map((c) => c.cmd)).toEqual(['suite_save_dialog', 'suite_write_atomic', 'suite_close']);
    expect(f.calls[0]?.args).toEqual({ suggestedName: 'f.xfdf', filters: FILTERS, remember: false });
  });

  it('cancelar devuelve cancelled', async () => {
    const f = fake(() => null);
    expect(await createTauriPlatform({ prefsPrefix: 't:' }, f.api).exportFile('f', [], new Uint8Array()))
      .toEqual({ ok: true, value: 'cancelled' });
    expect(f.calls).toHaveLength(1);
  });

  it('error de E/S: err mapeado y token cerrado', async () => {
    const f = fake((cmd) => {
      if (cmd === 'suite_save_dialog') return dto(0);
      if (cmd === 'suite_write_atomic') return Promise.reject({ code: 'permission-denied' });
      return true;
    });
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).exportFile('f', [], new Uint8Array());
    expect(result.ok ? null : result.error.code).toBe('permission-denied');
    expect(f.calls.at(-1)?.cmd).toBe('suite_close');
  });
});

describe('importFile (tauri)', () => {
  it('lee los bytes, no recuerda y cierra el token', async () => {
    const f = fake((cmd) => (cmd === 'suite_open_dialog' ? dto(3) : cmd === 'suite_read_range' ? new Uint8Array([7, 8, 9]).buffer : true));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFile(FILTERS, 10);
    expect(result.ok && result.value?.name).toBe('f.xfdf');
    expect(result.ok && Array.from(result.value?.bytes ?? [])).toEqual([7, 8, 9]);
    expect(f.calls[0]?.args).toEqual({ filters: FILTERS, remember: false });
    expect(f.calls.at(-1)?.cmd).toBe('suite_close');
  });

  it('demasiado grande: out-of-range, sin leer y con cierre', async () => {
    const f = fake((cmd) => (cmd === 'suite_open_dialog' ? dto(50) : true));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFile(FILTERS, 10);
    expect(result.ok ? null : result.error.code).toBe('out-of-range');
    expect(f.calls.map((c) => c.cmd)).toEqual(['suite_open_dialog', 'suite_close']);
  });

  it('cancelar devuelve ok(null)', async () => {
    expect(await createTauriPlatform({ prefsPrefix: 't:' }, fake(() => null).api).importFile(FILTERS, 10))
      .toEqual({ ok: true, value: null });
  });

  it('fallo de lectura: err y token cerrado', async () => {
    const f = fake((cmd) => (cmd === 'suite_open_dialog' ? dto(3) : cmd === 'suite_read_range' ? Promise.reject({ code: 'io' }) : true));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFile(FILTERS, 10);
    expect(result.ok ? null : result.error.code).toBe('io');
    expect(f.calls.at(-1)?.cmd).toBe('suite_close');
  });
});
