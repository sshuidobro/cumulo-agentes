import { IDBDatabase, IDBFactory, IDBVersionChangeEvent } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformIoError, createIdbDraftStore } from '../src/index';

const VERSION = 1;

function isBytes(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

// Cada caso se ejecuta contra IndexedDB falso (fábrica nueva por test, aislada) y contra memoria.
const backends: readonly [string, () => IDBFactory | null][] = [
  ['IndexedDB falso', () => new IDBFactory()],
  ['memoria', () => null],
];

describe.each(backends)('createIdbDraftStore (%s)', (_name, makeFactory) => {
  it('guarda y recupera un valor igual en profundidad, sin compartir objeto', async () => {
    const store = createIdbDraftStore('db', makeFactory());
    const value = { n: 1, list: [1, 2] };
    await store.put('a', value);

    const got = await store.get('a');
    expect(got).toEqual({ n: 1, list: [1, 2] });
    expect(got).not.toBe(value);

    // Mutar el original después de guardar no altera el borrador.
    value.list.push(3);
    expect(await store.get('a')).toEqual({ n: 1, list: [1, 2] });
    expect(await store.get('x')).toBeUndefined();
  });

  it('sobrescribe una clave, borra y lista las claves ordenadas', async () => {
    const store = createIdbDraftStore('db', makeFactory());
    await store.put('b', 'uno');
    await store.put('a', 'dos');
    await store.put('b', 'tres');
    expect(await store.get('b')).toBe('tres');

    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    await store.put('a', 'cuatro');
    expect(await store.keys()).toEqual(['a', 'b']);
  });

  it('borrar una clave inexistente no falla', async () => {
    const store = createIdbDraftStore('db', makeFactory());
    await expect(store.delete('nada')).resolves.toBeUndefined();
  });

  it('un valor no clonable (función) rechaza con PlatformIoError io', async () => {
    const store = createIdbDraftStore('db', makeFactory());
    const attempt = store.put('f', { fn: () => 1 });
    await expect(attempt).rejects.toBeInstanceOf(PlatformIoError);
    await expect(attempt).rejects.toMatchObject({ code: 'io' });
    expect(await store.keys()).toEqual([]);
  });

  it('guarda y recupera un Uint8Array de 1 MiB sin cambios', async () => {
    const store = createIdbDraftStore('db', makeFactory());
    const bytes = new Uint8Array(1024 * 1024).map((_, i) => (i * 31) % 256);
    await store.put('bin', bytes);

    const got = await store.get('bin');
    // Sin `instanceof`: el valor clonado puede venir de otro realm (structuredClone).
    expect(isBytes(got) && got.length === bytes.length && got.every((b, i) => b === bytes[i])).toBe(true);
  });

  it('guarda claves y textos con Unicode', async () => {
    const store = createIdbDraftStore('db', makeFactory());
    await store.put('ñandú 😀', 'áéí مرحبا');
    expect(await store.get('ñandú 😀')).toBe('áéí مرحبا');
    expect(await store.keys()).toEqual(['ñandú 😀']);
  });
});

describe('createIdbDraftStore con IndexedDB', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persiste: dos almacenes con la misma fábrica comparten datos', async () => {
    const factory = new IDBFactory();
    await createIdbDraftStore('db', factory).put('a', { n: 1 });
    expect(await createIdbDraftStore('db', factory).get('a')).toEqual({ n: 1 });
  });

  it('bases distintas no comparten datos', async () => {
    const factory = new IDBFactory();
    await createIdbDraftStore('uno', factory).put('a', 1);
    expect(await createIdbDraftStore('dos', factory).get('a')).toBeUndefined();
  });

  it('si abrir la base lanza, rechaza con io y la siguiente operación reintenta', async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      throw new DOMException('bloqueada por el sistema', 'UnknownError');
    });
    const store = createIdbDraftStore('db', factory);

    await expect(store.get('a')).rejects.toMatchObject({ code: 'io' });
    await store.put('a', 'ok');
    expect(await store.get('a')).toBe('ok');
  });

  it('si la apertura se bloquea, rechaza con io y la siguiente operación funciona', async () => {
    const factory = new IDBFactory();
    const realOpen = factory.open.bind(factory);
    vi.spyOn(factory, 'open').mockImplementationOnce((name, version) => {
      const request = realOpen(name, version);
      queueMicrotask(() => { request.dispatchEvent(new IDBVersionChangeEvent('blocked', { oldVersion: 0, newVersion: VERSION })); });
      return request;
    });
    const store = createIdbDraftStore('db', factory);

    await expect(store.keys()).rejects.toMatchObject({ code: 'io' });
    // Tras el bloqueo, la siguiente operación abre de nuevo y funciona.
    await store.put('a', 1);
    expect(await store.get('a')).toBe(1);
  });

  it('si abrir una transacción lanza de forma síncrona, lectura y escritura rechazan con io', async () => {
    const factory = new IDBFactory();
    const store = createIdbDraftStore('db', factory);
    await store.put('a', 1);
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('transacción no disponible', 'InvalidStateError');
    });

    await expect(store.get('a')).rejects.toMatchObject({ code: 'io' });
    await expect(store.put('b', 2)).rejects.toMatchObject({ code: 'io' });
  });

  it('si otra pestaña cambia la versión, la operación siguiente rechaza con io (no se queda colgada)', async () => {
    const factory = new IDBFactory();
    const store = createIdbDraftStore('db', factory);
    await store.put('a', 1);

    const upgrade = factory.open('db', 2);
    await new Promise<void>((resolve, reject) => {
      upgrade.onsuccess = () => {
        upgrade.result.close();
        resolve();
      };
      upgrade.onerror = () => { reject(upgrade.error); };
    });

    // La conexión se cerró al cambiar la versión; reabrir pide la versión 1 y falla con io.
    await expect(store.get('a')).rejects.toMatchObject({ code: 'io' });
  });
});
