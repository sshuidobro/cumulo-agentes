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

const dto = (token: string, name: string, size: number) => ({ token, name, path: `/x/${name}`, size, lastModified: 1 });
const FILTERS = [{ name: 'X', extensions: ['xfdf'] }];

describe('importFiles (tauri)', () => {
  it('lee los bytes en orden, no recuerda y cierra todos los tokens', async () => {
    const f = fake((cmd) => {
      if (cmd === 'suite_open_dialog_multiple') return [dto('t1', 'a.xfdf', 2), dto('t2', 'b.xfdf', 1)];
      if (cmd === 'suite_read_range') return new Uint8Array([7, 8]).buffer;
      return true;
    });
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFiles(FILTERS, 10, 5);
    expect(f.calls[0]).toMatchObject({ cmd: 'suite_open_dialog_multiple', args: { filters: FILTERS, remember: false } });
    expect(result.ok && result.value?.map((x) => x.name)).toEqual(['a.xfdf', 'b.xfdf']);
    expect(f.calls.filter((c) => c.cmd === 'suite_close').map((c) => c.args)).toEqual([{ token: 't1' }, { token: 't2' }]);
  });

  it('cancelar devuelve ok(null)', async () => {
    const f = fake(() => null);
    expect(await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFiles(FILTERS, 10, 5)).toEqual({ ok: true, value: null });
    expect(f.calls).toHaveLength(1);
  });

  it('más ficheros que maxCount: out-of-range, sin leer y cerrando todos', async () => {
    const f = fake((cmd) => (cmd === 'suite_open_dialog_multiple' ? [dto('t1', 'a', 1), dto('t2', 'b', 1), dto('t3', 'c', 1)] : true));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFiles(FILTERS, 10, 2);
    expect(result.ok ? null : result.error.code).toBe('out-of-range');
    expect(f.calls.map((c) => c.cmd)).not.toContain('suite_read_range');
    expect(f.calls.filter((c) => c.cmd === 'suite_close')).toHaveLength(3);
  });

  it('alguno mayor que maxBytesEach: out-of-range, sin leer y cerrando todos', async () => {
    const f = fake((cmd) => (cmd === 'suite_open_dialog_multiple' ? [dto('t1', 'a', 1), dto('t2', 'b', 50)] : true));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFiles(FILTERS, 10, 5);
    expect(result.ok ? null : result.error.code).toBe('out-of-range');
    expect(f.calls.map((c) => c.cmd)).not.toContain('suite_read_range');
    expect(f.calls.filter((c) => c.cmd === 'suite_close')).toHaveLength(2);
  });

  it('error de E/S en una lectura: err mapeado y todos los tokens cerrados', async () => {
    let reads = 0;
    const f = fake((cmd) => {
      if (cmd === 'suite_open_dialog_multiple') return [dto('t1', 'a', 1), dto('t2', 'b', 1)];
      if (cmd === 'suite_read_range') {
        reads += 1;
        return reads === 1 ? new Uint8Array([1]).buffer : Promise.reject({ code: 'io' });
      }
      return true;
    });
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFiles(FILTERS, 10, 5);
    expect(result.ok ? null : result.error.code).toBe('io');
    expect(f.calls.filter((c) => c.cmd === 'suite_close')).toHaveLength(2);
  });

  it('error al invocar el diálogo: err mapeado', async () => {
    const f = fake(() => Promise.reject({ code: 'permission-denied' }));
    const result = await createTauriPlatform({ prefsPrefix: 't:' }, f.api).importFiles(FILTERS, 10, 5);
    expect(result.ok ? null : result.error.code).toBe('permission-denied');
  });
});
