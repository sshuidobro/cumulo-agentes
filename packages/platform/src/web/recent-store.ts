import { PlatformIoError } from '../errors';
import type { PermissionHandle } from './fs-access';

/** Máximo de entradas; al superarlo sale la más antigua. */
export const MAX_RECENTS = 20;

const VERSION = 1;
const STORE = 'recent';

/**
 * Entrada guardada. Solo metadatos y el handle del fichero: nunca el contenido.
 * Es lo que se persiste en IndexedDB (5 claves exactas).
 */
export interface RecentRecord {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly openedAt: number;
  readonly handle: PermissionHandle;
}

export interface RecentStore {
  /** Todas las entradas, más reciente primero. */
  list(): Promise<RecentRecord[]>;
  get(id: string): Promise<RecentRecord | undefined>;
  put(record: RecentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Comprueba la forma de un registro leído de IndexedDB (no es de confianza). */
function isRecentRecord(value: unknown): value is RecentRecord {
  if (typeof value !== 'object' || value === null) return false;
  return 'id' in value && typeof value.id === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'size' in value && typeof value.size === 'number'
    && 'openedAt' in value && typeof value.openedAt === 'number'
    && 'handle' in value && typeof value.handle === 'object' && value.handle !== null;
}

function newestFirst(records: readonly RecentRecord[]): RecentRecord[] {
  return [...records].sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * Almacén de recientes. Con `factory` usa IndexedDB `suite-recent-<appId>`; con `factory === null`, memoria.
 * Los handles se guardan tal cual en memoria (no se clonan).
 */
export function createRecentStore(appId: string, factory: IDBFactory | null): RecentStore {
  return factory === null ? createMemoryRecentStore() : createIndexedDbRecentStore(`suite-recent-${appId}`, factory);
}

function createMemoryRecentStore(): RecentStore {
  const records = new Map<string, RecentRecord>();
  return {
    list: async () => newestFirst([...records.values()]),
    get: async (id) => records.get(id),
    put: async (record) => { records.set(record.id, record); },
    delete: async (id) => { records.delete(id); },
    clear: async () => { records.clear(); },
  };
}

function openDatabase(factory: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = factory.open(dbName, VERSION);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
      request.onsuccess = () => { resolve(request.result); };
      request.onerror = () => { reject(new PlatformIoError('io', { cause: request.error })); };
    } catch (cause) {
      reject(new PlatformIoError('io', { cause }));
    }
  });
}

/** Una transacción por operación; la conexión se cierra al terminar. Resuelve con el resultado de `work` al confirmarse. */
async function transact<T>(
  factory: IDBFactory,
  dbName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase(factory, dbName);
  try {
    return await new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => { resolve(request.result); };
        tx.onerror = () => { reject(new PlatformIoError('io', { cause: tx.error })); };
        tx.onabort = () => { reject(new PlatformIoError('io', { cause: tx.error })); };
      } catch (cause) {
        reject(new PlatformIoError('io', { cause }));
      }
    });
  } finally {
    db.close();
  }
}

function createIndexedDbRecentStore(dbName: string, factory: IDBFactory): RecentStore {
  const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    transact(factory, dbName, mode, work);
  return {
    list: async () => {
      const values = await run('readonly', (store) => store.getAll());
      return newestFirst(values.filter(isRecentRecord));
    },
    get: async (id) => {
      const value: unknown = await run('readonly', (store) => store.get(id));
      return isRecentRecord(value) ? value : undefined;
    },
    put: async (record) => {
      await run('readwrite', (store) => store.put(record, record.id));
    },
    delete: async (id) => {
      await run('readwrite', (store) => store.delete(id));
    },
    clear: async () => {
      await run('readwrite', (store) => store.clear());
    },
  };
}

async function sameEntry(stored: PermissionHandle, handle: PermissionHandle): Promise<boolean> {
  try {
    return await stored.isSameEntry(handle);
  } catch {
    // Un handle que no se puede comparar cuenta como otro fichero: como mucho se duplica una entrada.
    return false;
  }
}

/**
 * Añade el fichero al principio de los recientes. Si ya hay una entrada del mismo fichero
 * (`isSameEntry`), solo actualiza su fecha y nombre. Recorta a `MAX_RECENTS` quitando las más antiguas.
 */
export async function rememberEntry(
  store: RecentStore,
  handle: PermissionHandle,
  file: { readonly name: string; readonly size: number },
  openedAt: number,
): Promise<void> {
  const records = await store.list();
  let id: string | undefined;
  for (const record of records) {
    if (await sameEntry(record.handle, handle)) {
      id = record.id;
      break;
    }
  }
  await store.put({ id: id ?? crypto.randomUUID(), name: file.name, size: file.size, openedAt, handle });
  const all = await store.list();
  for (const old of all.slice(MAX_RECENTS)) await store.delete(old.id);
}
