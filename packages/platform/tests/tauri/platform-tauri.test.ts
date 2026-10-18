import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureLogging, consoleSink, type AppError } from '@suite/shared';
import { PlatformIoError } from '../../src/errors';
import { createTauriPlatform } from '../../src/tauri/platform-tauri';
import type { InvokeOptions, TauriApi } from '../../src/tauri/tauri-api';
import type { OpenedFile, Platform, SaveData } from '../../src/types';

type Respond = (cmd: string, args: unknown, options: InvokeOptions | undefined) => unknown;

interface Call { readonly cmd: string; readonly args: unknown; readonly options: InvokeOptions | undefined }

interface FakeTauri {
  readonly api: TauriApi;
  readonly calls: Call[];
  readonly openedUrls: string[];
  readonly titles: string[];
  /** Dispara un evento registrado con `listen`. */
  emit(event: string): void;
  /** Dispara el manejador de cierre con una función `preventDefault` espía. */
  requestClose(): { readonly prevented: boolean };
  /** Número de suscriptores de `listen` activos. */
  readonly listeners: number;
  /** Número de llamadas a `destroyWindow`. */
  readonly destroys: number;
}

/** Doble falso de `TauriApi`: registra las llamadas y responde con `respond`. */
function fakeTauri(respond: Respond = () => undefined): FakeTauri {
  const calls: Call[] = [];
  const openedUrls: string[] = [];
  const titles: string[] = [];
  const handlers = new Map<string, Set<() => void>>();
  let destroyCount = 0;
  let closeHandler: ((preventDefault: () => void) => void) | null = null;

  const api: TauriApi = {
    invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: InvokeOptions): Promise<T> {
      calls.push({ cmd, args, options });
      return Promise.resolve().then(() => respond(cmd, args, options)) as Promise<T>;
    },
    listen(event: string, handler: () => void): Promise<() => void> {
      const set = handlers.get(event) ?? new Set<() => void>();
      set.add(handler);
      handlers.set(event, set);
      return Promise.resolve(() => { set.delete(handler); });
    },
    setTitle(title: string): Promise<void> {
      titles.push(title);
      return Promise.resolve();
    },
    onCloseRequested(handler: (preventDefault: () => void) => void): Promise<() => void> {
      closeHandler = handler;
      return Promise.resolve(() => { closeHandler = null; });
    },
    destroyWindow(): Promise<void> {
      destroyCount += 1;
      return Promise.resolve();
    },
    openUrl(url: string): Promise<void> {
      openedUrls.push(url);
      return Promise.resolve();
    },
    setFullscreen: () => Promise.resolve(),
    isFullscreen: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => undefined),
  };

  return {
    api,
    calls,
    openedUrls,
    titles,
    emit(event) {
      for (const handler of handlers.get(event) ?? []) handler();
    },
    requestClose() {
      const state = { prevented: false };
      closeHandler?.(() => { state.prevented = true; });
      return state;
    },
    get listeners() {
      let count = 0;
      for (const set of handlers.values()) count += set.size;
      return count;
    },
    get destroys() {
      return destroyCount;
    },
  };
}

const flush = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

function dto(token: string, name = 'a.pdf', size = 10): Record<string, unknown> {
  return { token, name, path: `/x/${name}`, size, lastModified: 5 };
}

async function openOne(platform: Platform): Promise<OpenedFile> {
  const result = await platform.openFile([{ name: 'PDF', extensions: ['pdf'] }]);
  if (!result.ok || result.value === null) throw new Error('el diálogo debería devolver un fichero');
  return result.value;
}

afterEach(() => {
  configureLogging({ sink: consoleSink, minLevel: 'warn' });
});

describe('createTauriPlatform · abrir', () => {
  it('openFile con DTO devuelve OpenedFile con esos datos y canSaveInPlace true', async () => {
    const fake = fakeTauri((cmd) => (cmd === 'suite_open_dialog'
      ? dto('t1', 'a.pdf', 10)
      : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const result = await platform.openFile([{ name: 'PDF', extensions: ['pdf'] }]);

    expect(result).toEqual({ ok: true, value: expect.objectContaining({
      token: 't1', name: 'a.pdf', path: '/x/a.pdf', size: 10, lastModified: 5, canSaveInPlace: true,
    }) });
    expect(fake.calls).toEqual([{ cmd: 'suite_open_dialog', args: { filters: [{ name: 'PDF', extensions: ['pdf'] }] }, options: undefined }]);
  });

  it('openFile con null (cancelado) devuelve ok(null)', async () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri(() => null).api);
    expect(await platform.openFile([])).toEqual({ ok: true, value: null });
  });

  it('openFile con rechazo permission-denied devuelve err con ese código', async () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri(() => Promise.reject({ code: 'permission-denied' })).api);
    const result = await platform.openFile([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  it('openFile con un código desconocido o sin code devuelve io', async () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri(() => Promise.reject({ code: 'bad-request' })).api);
    const result = await platform.openFile([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
  });

  it('openBrowserFile es unsupported y openDropped devuelve ok(null)', async () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri().api);
    const file = new File(['x'], 'a.pdf');
    expect(platform.openBrowserFile(file)).toEqual({ ok: false, error: expect.objectContaining({ code: 'unsupported' }) });
    expect(await platform.openDropped({} as DataTransfer)).toEqual({ ok: true, value: null });
  });
});

describe('createTauriPlatform · lectura por rangos', () => {
  it('source.read(2, 5) invoca suite_read_range con offset y length', async () => {
    const fake = fakeTauri((cmd) => {
      if (cmd === 'suite_open_dialog') return dto('t1', 'a.pdf', 10);
      if (cmd === 'suite_read_range') return new Uint8Array([7, 8, 9]).buffer;
      return undefined;
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const opened = await openOne(platform);

    const bytes = await opened.source.read(2, 5);

    expect(bytes).toEqual(new Uint8Array([7, 8, 9]));
    expect(fake.calls.at(-1)).toEqual({
      cmd: 'suite_read_range',
      args: { token: 't1', offset: 2, length: 3 },
      options: undefined,
    });
  });

  it('source.read(4, 4) devuelve vacío sin invocar nada', async () => {
    const fake = fakeTauri((cmd) => (cmd === 'suite_open_dialog' ? dto('t1') : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const opened = await openOne(platform);
    const before = fake.calls.length;

    expect(await opened.source.read(4, 4)).toEqual(new Uint8Array(0));
    expect(fake.calls.length).toBe(before);
  });

  it('un error unknown-token se convierte en PlatformIoError not-found', async () => {
    const fake = fakeTauri((cmd) => {
      if (cmd === 'suite_open_dialog') return dto('t1');
      return Promise.reject({ code: 'unknown-token', message: 'x' });
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const opened = await openOne(platform);

    const error: unknown = await opened.source.read(0, 1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlatformIoError);
    expect((error as PlatformIoError).code).toBe('not-found');
  });

  it('un rango fuera del fichero se rechaza con out-of-range sin invocar nada', async () => {
    const fake = fakeTauri((cmd) => (cmd === 'suite_open_dialog' ? dto('t1', 'a.pdf', 10) : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const opened = await openOne(platform);
    const before = fake.calls.length;

    const error: unknown = await opened.source.read(5, 11).catch((e: unknown) => e);

    expect((error as PlatformIoError).code).toBe('out-of-range');
    expect(fake.calls.length).toBe(before);
  });

  it('un error sin código ni objeto se convierte en io', async () => {
    const fake = fakeTauri((cmd) => {
      if (cmd === 'suite_open_dialog') return dto('t1');
      return Promise.reject(new Error('fallo'));
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const opened = await openOne(platform);

    const error: unknown = await opened.source.read(0, 1).catch((e: unknown) => e);

    expect((error as PlatformIoError).code).toBe('io');
  });
});

describe('createTauriPlatform · guardar', () => {
  const base = { token: 't1', name: 'a.pdf', path: '/x/a.pdf', size: 10, lastModified: 5 } as const;

  it('save en modo append envía el delta y las tres cabeceras exactas', async () => {
    const fake = fakeTauri((cmd) => (cmd === 'suite_append_atomic' ? dto('t1', 'a.pdf', 13) : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const target = { ...base, canSaveInPlace: true, source: { size: 10, read: () => Promise.resolve(new Uint8Array()) } } as OpenedFile;
    const delta = new Uint8Array([1, 2, 3]);
    const data: SaveData = { kind: 'append', base: target, expectedSize: 10, delta };

    const result = await platform.save(target, data);

    expect(result.ok).toBe(true);
    const call = fake.calls.at(-1);
    expect(call?.cmd).toBe('suite_append_atomic');
    expect(call?.args).toEqual(delta);
    expect(call?.options).toEqual({
      headers: { 'x-suite-token': 't1', 'x-suite-base-token': 't1', 'x-suite-expected-size': '10' },
    });
  });

  it('save en modo bytes envía el cuerpo y la cabecera x-suite-token', async () => {
    const fake = fakeTauri((cmd) => (cmd === 'suite_write_atomic' ? dto('t1', 'a.pdf', 3) : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const target = { ...base, canSaveInPlace: true, source: { size: 10, read: () => Promise.resolve(new Uint8Array()) } } as OpenedFile;
    const bytes = new Uint8Array([4, 5, 6]);

    const result = await platform.save(target, { kind: 'bytes', bytes });

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ token: 't1', size: 3 }) });
    const call = fake.calls.at(-1);
    expect(call?.cmd).toBe('suite_write_atomic');
    expect(call?.args).toEqual(bytes);
    expect(call?.options).toEqual({ headers: { 'x-suite-token': 't1' } });
  });

  it('un error de save devuelve err con el código mapeado', async () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri(() => Promise.reject({ code: 'changed-on-disk' })).api);
    const target = { ...base, canSaveInPlace: true, source: { size: 10, read: () => Promise.resolve(new Uint8Array()) } } as OpenedFile;

    const result = await platform.save(target, { kind: 'bytes', bytes: new Uint8Array() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('changed-on-disk');
  });

  it('saveAs cancelado devuelve { kind: cancelled }', async () => {
    const fake = fakeTauri((cmd) => (cmd === 'suite_save_dialog' ? null : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const result = await platform.saveAs('nuevo.pdf', [], { kind: 'bytes', bytes: new Uint8Array() });

    expect(result).toEqual({ ok: true, value: { kind: 'cancelled' } });
    expect(fake.calls.map((c) => c.cmd)).toEqual(['suite_save_dialog']);
    expect(fake.calls[0]?.args).toEqual({ suggestedName: 'nuevo.pdf', filters: [] });
  });

  it('saveAs aceptado guarda en el destino del diálogo y devuelve saved con su token', async () => {
    const fake = fakeTauri((cmd) => {
      if (cmd === 'suite_save_dialog') return dto('t9', 'nuevo.pdf', 0);
      if (cmd === 'suite_write_atomic') return dto('t9', 'nuevo.pdf', 3);
      return undefined;
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const result = await platform.saveAs('nuevo.pdf', [], { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'saved') throw new Error('debería estar guardado');
    expect(result.value.file.token).toBe('t9');
    expect(fake.calls.at(-1)?.options).toEqual({ headers: { 'x-suite-token': 't9' } });
  });

  it('saveAs con error del diálogo devuelve err', async () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri(() => Promise.reject({ code: 'permission-denied' })).api);

    const result = await platform.saveAs('x.pdf', [], { kind: 'bytes', bytes: new Uint8Array() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  it('closeFile invoca suite_close con el token', async () => {
    const fake = fakeTauri(() => true);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const target = { ...base, canSaveInPlace: true, source: { size: 10, read: () => Promise.resolve(new Uint8Array()) } } as OpenedFile;

    await platform.closeFile(target);

    expect(fake.calls).toEqual([{ cmd: 'suite_close', args: { token: 't1' }, options: undefined }]);
  });
});

describe('createTauriPlatform · ficheros abiertos desde el sistema', () => {
  it('con 2 pendientes al suscribirse llama a cb 2 veces; con 1 más al disparar el evento, 3; tras darse de baja, no', async () => {
    const pending: Record<string, unknown>[] = [dto('p1', 'uno.pdf'), dto('p2', 'dos.pdf')];
    const fake = fakeTauri((cmd) => {
      if (cmd === 'suite_take_pending_opens') return pending.splice(0);
      return undefined;
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const received: string[] = [];
    const unsubscribe = platform.onFileOpenedFromOS((file) => { received.push(file.token); });

    await flush();
    expect(received).toEqual(['p1', 'p2']);

    pending.push(dto('p3', 'tres.pdf'));
    fake.emit('suite://file-opened');
    await flush();
    expect(received).toEqual(['p1', 'p2', 'p3']);

    unsubscribe();
    pending.push(dto('p4', 'cuatro.pdf'));
    fake.emit('suite://file-opened');
    await flush();
    expect(received).toEqual(['p1', 'p2', 'p3']);
    expect(fake.listeners).toBe(0);
  });

  it('si se da de baja antes de que listen resuelva, el listener se quita al resolver', async () => {
    const fake = fakeTauri(() => []);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const unsubscribe = platform.onFileOpenedFromOS(() => undefined);

    unsubscribe();
    await flush();

    expect(fake.listeners).toBe(0);
  });

  it('un fallo al recoger pendientes se registra en el log y no lanza', async () => {
    const warn = vi.fn();
    configureLogging({ sink: (level, scope, message, data) => { if (level === 'warn') warn(scope, message, data); }, minLevel: 'warn' });
    const fake = fakeTauri((cmd) => (cmd === 'suite_take_pending_opens' ? Promise.reject(new Error('caído')) : undefined));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const unsubscribe = platform.onFileOpenedFromOS(() => undefined);
    await flush();
    unsubscribe();

    expect(warn).toHaveBeenCalledWith('platform', expect.stringContaining('ficheros abiertos'), expect.anything());
  });
});

describe('createTauriPlatform · enlaces, título, cierre y preferencias', () => {
  it('openExternalUrl acepta http(s) y mailto y llama a openUrl', async () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    expect(await platform.openExternalUrl('https://example.org')).toEqual({ ok: true, value: undefined });
    expect(await platform.openExternalUrl('mailto:a@example.org')).toEqual({ ok: true, value: undefined });
    expect(fake.openedUrls).toEqual(['https://example.org', 'mailto:a@example.org']);
  });

  it("openExternalUrl('javascript:x') devuelve unsupported sin llamar a openUrl", async () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const result = await platform.openExternalUrl('javascript:x');

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'unsupported' }) as AppError });
    expect(fake.openedUrls).toEqual([]);
  });

  it('openExternalUrl con URL inválida o file: devuelve unsupported', async () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    expect((await platform.openExternalUrl('no es url')).ok).toBe(false);
    expect((await platform.openExternalUrl('file:///etc/passwd')).ok).toBe(false);
    expect(fake.openedUrls).toEqual([]);
  });

  it('si openUrl rechaza, devuelve io', async () => {
    const fake = fakeTauri();
    fake.api.openUrl = () => Promise.reject(new Error('sin navegador'));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const result = await platform.openExternalUrl('https://example.org');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
  });

  it('setTitle llama a api.setTitle', () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    platform.setTitle('a.pdf — Lector PDF');

    expect(fake.titles).toEqual(['a.pdf — Lector PDF']);
  });

  it('si setTitle rechaza, se registra en el log sin lanzar', async () => {
    const warn = vi.fn();
    configureLogging({ sink: (level, scope, message) => { if (level === 'warn') warn(scope, message); }, minLevel: 'warn' });
    const fake = fakeTauri();
    fake.api.setTitle = () => Promise.reject(new Error('ventana cerrada'));
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    platform.setTitle('x');
    await flush();

    expect(warn).toHaveBeenCalledWith('platform', expect.stringContaining('título'));
  });

  it('onCloseRequested(() => false) llama a preventDefault; con true no', () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    const stop = platform.onCloseRequested(() => false);
    expect(fake.requestClose().prevented).toBe(true);
    stop();

    const stopAllow = platform.onCloseRequested(() => true);
    expect(fake.requestClose().prevented).toBe(false);
    stopAllow();
  });

  it('kind es tauri, isMac depende del user agent y prefs usa el prefijo', () => {
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fakeTauri().api);

    expect(platform.kind).toBe('tauri');
    expect(platform.isMac).toBe(navigator.userAgent.includes('Mac'));
    platform.prefs.set('zoom', 150);
    expect(platform.prefs.get('zoom', (v): v is number => typeof v === 'number')).toBe(150);
  });
});

describe('createTauriPlatform · cerrar ventana', () => {
  it('closeWindow llama a destroyWindow una vez', async () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);

    await platform.closeWindow();

    expect(fake.destroys).toBe(1);
  });

  it('si destroyWindow rechaza, closeWindow resuelve igualmente y registra el error', async () => {
    const error = vi.fn();
    configureLogging({ sink: (level, scope, message, data) => { if (level === 'error') error(scope, message, data); }, minLevel: 'error' });
    const fake = fakeTauri();
    const failing: TauriApi = { ...fake.api, destroyWindow: () => Promise.reject(new Error('caído')) };
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, failing);

    await expect(platform.closeWindow()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('platform', expect.stringContaining('cerrar la ventana'), expect.anything());
  });

  it('closeWindow no vuelve a llamar a onCloseRequested ni se cancela', async () => {
    const fake = fakeTauri();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, fake.api);
    const cb = vi.fn(() => false);
    platform.onCloseRequested(cb);

    await platform.closeWindow();

    expect(fake.destroys).toBe(1);
    expect(cb).not.toHaveBeenCalled();
  });
});
