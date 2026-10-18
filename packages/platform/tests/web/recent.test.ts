import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import type { WebEnv } from '../../src/web/web-env';
import type { Platform, RecentFile } from '../../src/types';
import { fakeEnv, fakeHandle, namedError } from './fakes';
import type { FakeHandleOptions } from './fakes';

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];
const T0 = 1_700_000_000_000;
const STEP_MS = 1_000;

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });
}

function names(files: readonly RecentFile[]): string[] {
  return files.map((file) => file.name);
}

/**
 * Plataforma web con selector controlado: `open(handle)` abre ese handle con `openFile`
 * y avanza el reloj de forma determinista para que cada apertura tenga su propia fecha.
 */
function setup(overrides: Partial<WebEnv> = {}): { readonly platform: Platform; readonly open: (handle: FileSystemFileHandle) => ReturnType<Platform['openFile']> } {
  let next: FileSystemFileHandle | null = null;
  const platform = createWebPlatform({ prefsPrefix: 'test.' }, fakeEnv({
    showOpenFilePicker: async () => {
      if (next === null) throw namedError('AbortError');
      return [next];
    },
    ...overrides,
  }));
  const open = async (handle: FileSystemFileHandle) => {
    next = handle;
    vi.setSystemTime(Date.now() + STEP_MS);
    return platform.openFile(PDF_FILTERS);
  };
  return { platform, open };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recientes en web (memoria)', () => {
  it('guarda los abiertos con el último primero y reabrir el primero no duplica', async () => {
    const a = makeFile('a.pdf');
    const b = makeFile('b.pdf');
    const c = makeFile('c.pdf');
    const { platform, open } = setup();
    await open(fakeHandle(a));
    await open(fakeHandle(b));
    await open(fakeHandle(c));
    expect(names(await platform.recentFiles())).toEqual(['c.pdf', 'b.pdf', 'a.pdf']);

    // Otro handle del mismo fichero: `isSameEntry` lo reconoce como la misma entrada.
    await open(fakeHandle(a));
    const recents = await platform.recentFiles();
    expect(names(recents)).toEqual(['a.pdf', 'c.pdf', 'b.pdf']);
    expect(recents[0]?.openedAt).toBe(T0 + 4 * STEP_MS);
    expect(recents[0]?.path).toBeNull();
    expect(recents[0]?.available).toBe(true);
  });

  it('con 21 aperturas distintas quedan 20 y sale la más antigua', async () => {
    const { platform, open } = setup();
    for (let i = 0; i <= 20; i += 1) {
      await open(fakeHandle(makeFile(`f${i}.pdf`)));
    }
    const recents = await platform.recentFiles();
    expect(recents).toHaveLength(20);
    expect(recents[0]?.name).toBe('f20.pdf');
    expect(recents[19]?.name).toBe('f1.pdf');
    expect(names(recents)).not.toContain('f0.pdf');
  });

  it('openRecent con permiso de escritura devuelve el fichero editable en sitio', async () => {
    const { platform, open } = setup();
    await open(fakeHandle(makeFile('a.pdf')));
    const [recent] = await platform.recentFiles();
    if (recent === undefined) throw new Error('se esperaba un reciente');

    const result = await platform.openRecent(recent.id);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.name).toBe('a.pdf');
    expect(result.value.canSaveInPlace).toBe(true);
  });

  it('openRecent con solo lectura devuelve el fichero sin poder guardar en sitio', async () => {
    const options: FakeHandleOptions = { readwrite: 'denied', read: 'granted' };
    const { platform, open } = setup();
    await open(fakeHandle(makeFile('a.pdf'), options));
    const [recent] = await platform.recentFiles();
    if (recent === undefined) throw new Error('se esperaba un reciente');

    const result = await platform.openRecent(recent.id);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.canSaveInPlace).toBe(false);
    expect(Array.from(await result.value.source.read(0, 3))).toEqual([1, 2, 3]);
  });

  it('openRecent con el permiso denegado devuelve ok(null)', async () => {
    const options: FakeHandleOptions = { readwrite: 'denied', read: 'denied' };
    const { platform, open } = setup();
    await open(fakeHandle(makeFile('a.pdf'), options));
    const [recent] = await platform.recentFiles();
    if (recent === undefined) throw new Error('se esperaba un reciente');

    expect(await platform.openRecent(recent.id)).toEqual({ ok: true, value: null });
  });

  it('fichero borrado: err not-found y la entrada queda no disponible hasta que vuelva a abrirse', async () => {
    const options: FakeHandleOptions = {};
    const { platform, open } = setup();
    await open(fakeHandle(makeFile('a.pdf'), options));
    const [recent] = await platform.recentFiles();
    if (recent === undefined) throw new Error('se esperaba un reciente');

    options.missing = true;
    const failed = await platform.openRecent(recent.id);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('debería fallar');
    expect(failed.error.code).toBe('not-found');
    expect((await platform.recentFiles())[0]?.available).toBe(false);

    options.missing = false;
    expect((await platform.openRecent(recent.id)).ok).toBe(true);
    expect((await platform.recentFiles())[0]?.available).toBe(true);
  });

  it('openRecent de un id desconocido devuelve not-found', async () => {
    const { platform } = setup();
    const result = await platform.openRecent('no-existe');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('debería fallar');
    expect(result.error.code).toBe('not-found');
  });

  it('openBrowserFile no añade recientes', async () => {
    const { platform } = setup();
    expect(platform.openBrowserFile(makeFile('a.pdf')).ok).toBe(true);
    expect(await platform.recentFiles()).toEqual([]);
  });

  it('openDropped con handle añade el fichero a recientes', async () => {
    const file = makeFile('soltado.pdf');
    const handle = fakeHandle(file);
    const { platform } = setup();
    const dt = {
      items: [{ getAsFileSystemHandle: () => Promise.resolve(handle) }],
      files: [file],
    } as unknown as DataTransfer;

    expect((await platform.openDropped(dt)).ok).toBe(true);
    expect(names(await platform.recentFiles())).toEqual(['soltado.pdf']);
  });

  it('guardar como con selector añade el fichero a recientes', async () => {
    const file = makeFile('nuevo.pdf');
    const handle = fakeHandle(file);
    const writable = {
      write: async () => undefined,
      close: async () => undefined,
      abort: async () => undefined,
    } as unknown as FileSystemWritableFileStream;
    const target = { ...handle, createWritable: async () => writable } as unknown as FileSystemFileHandle;
    const { platform } = setup({ showSaveFilePicker: async () => target });

    const saved = await platform.saveAs('nuevo.pdf', PDF_FILTERS, { kind: 'bytes', bytes: new Uint8Array([1]) });
    expect(saved.ok && saved.value.kind).toBe('saved');
    expect(names(await platform.recentFiles())).toEqual(['nuevo.pdf']);
  });

  it('removeRecent quita una entrada y clearRecents vacía la lista', async () => {
    const { platform, open } = setup();
    await open(fakeHandle(makeFile('a.pdf')));
    await open(fakeHandle(makeFile('b.pdf')));
    await open(fakeHandle(makeFile('c.pdf')));
    const recents = await platform.recentFiles();
    const middle = recents[1];
    if (middle === undefined) throw new Error('se esperaba un reciente');

    await platform.removeRecent(middle.id);
    expect(names(await platform.recentFiles())).toEqual(['c.pdf', 'a.pdf']);

    await platform.clearRecents();
    expect(await platform.recentFiles()).toEqual([]);
  });
});

/** Handle que se puede clonar en IndexedDB (sin funciones propias; los métodos viven en el prototipo). */
class DiskHandle {
  readonly kind = 'file';
  readonly name: string;
  readonly #file: File;

  constructor(file: File) {
    this.name = file.name;
    this.#file = file;
  }

  getFile(): Promise<File> {
    return Promise.resolve(this.#file);
  }
}

/** Lee las entradas tal cual quedan en IndexedDB, sin pasar por la plataforma. */
function readRawRecords(factory: IDBFactory, dbName: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const open = factory.open(dbName, 1);
    open.onerror = () => { reject(open.error); };
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('recent', 'readonly').objectStore('recent').getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        db.close();
        resolve(request.result as Record<string, unknown>[]);
      };
    };
  });
}

describe('recientes en web (IndexedDB)', () => {
  it('persisten entre instancias de la plataforma y solo guardan 5 claves, sin contenido', async () => {
    const factory = new IDBFactory();
    const file = makeFile('persistido.pdf');
    const picker = async (): Promise<FileSystemFileHandle[]> => [new DiskHandle(file) as unknown as FileSystemFileHandle];
    const first = createWebPlatform({ prefsPrefix: 'test.' }, fakeEnv({ indexedDB: factory, showOpenFilePicker: picker }));
    expect((await first.openFile(PDF_FILTERS)).ok).toBe(true);

    const second = createWebPlatform({ prefsPrefix: 'test.' }, fakeEnv({ indexedDB: factory }));
    expect(names(await second.recentFiles())).toEqual(['persistido.pdf']);

    const raw = await readRawRecords(factory, 'suite-recent-test.');
    expect(raw).toHaveLength(1);
    expect(Object.keys(raw[0] ?? {}).sort()).toEqual(['handle', 'id', 'name', 'openedAt', 'size']);
  });
});
