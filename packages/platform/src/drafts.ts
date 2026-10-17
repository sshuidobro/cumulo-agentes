import { PlatformIoError } from './errors';

/**
 * Borradores para recuperar trabajo tras un cierre inesperado. Guarda valores clonables
 * (estructura de `structuredClone`); las funciones y los objetos no clonables se rechazan.
 */
export interface DraftStore {
  put(key: string, value: unknown): Promise<void>;
  /** `undefined` si la clave no existe. */
  get(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
  /** Claves en orden de código UTF-16 (orden por defecto de `Array.prototype.sort`). */
  keys(): Promise<string[]>;
}

const VERSION = 1;
const STORE = 'drafts';

/**
 * Almacén de borradores. Con `factory` (por defecto, `indexedDB` del entorno) usa IndexedDB;
 * con `factory === null` guarda en memoria, sin persistencia.
 */
export function createIdbDraftStore(
  dbName: string,
  factory: IDBFactory | null = globalThis.indexedDB ?? null,
): DraftStore {
  return factory === null ? createMemoryDraftStore() : createIndexedDbDraftStore(dbName, factory);
}

function createMemoryDraftStore(): DraftStore {
  const drafts = new Map<string, unknown>();
  return {
    put: async (key, value) => {
      try {
        drafts.set(key, structuredClone(value));
      } catch (cause) {
        throw new PlatformIoError('io', { cause });
      }
    },
    get: async (key) => {
      const value = drafts.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    delete: async (key) => {
      drafts.delete(key);
    },
    keys: async () => [...drafts.keys()].sort(),
  };
}

function createIndexedDbDraftStore(dbName: string, factory: IDBFactory): DraftStore {
  let connection: Promise<IDBDatabase> | null = null;

  // Abre la conexión una sola vez. Si falla, se olvida para que la siguiente operación reintente.
  function open(): Promise<IDBDatabase> {
    if (connection === null) {
      const pending = new Promise<IDBDatabase>((resolve, reject) => {
        let blocked = false;
        let request: IDBOpenDBRequest;
        try {
          request = factory.open(dbName, VERSION);
        } catch (cause) {
          reject(new PlatformIoError('io', { cause }));
          return;
        }
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => {
          if (blocked) {
            // Ya se rechazó por bloqueo: no dejar una conexión abierta sin dueño.
            request.result.close();
            return;
          }
          const db = request.result;
          db.onversionchange = () => {
            // Otra pestaña necesita otra versión: cerramos para no bloquearla.
            db.close();
            if (connection === pending) connection = null;
          };
          resolve(db);
        };
        request.onerror = () => {
          reject(new PlatformIoError('io', { cause: request.error }));
        };
        request.onblocked = () => {
          // Sin `request.error`: la petición sigue pendiente y leerlo lanza InvalidStateError.
          blocked = true;
          reject(new PlatformIoError('io'));
        };
      });
      connection = pending;
      pending.catch(() => {
        if (connection === pending) connection = null;
      });
    }
    return connection;
  }

  /** Escritura: resuelve cuando la transacción se confirma (`complete`). */
  async function write(work: (store: IDBObjectStore) => void): Promise<void> {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction | null = null;
      try {
        tx = db.transaction(STORE, 'readwrite');
        work(tx.objectStore(STORE));
      } catch (cause) {
        abort(tx);
        reject(new PlatformIoError('io', { cause }));
        return;
      }
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(new PlatformIoError('io', { cause: tx?.error })); };
      tx.onabort = () => { reject(new PlatformIoError('io', { cause: tx?.error })); };
    });
  }

  /** Lectura: resuelve en `onsuccess` de la petición. */
  async function read<T>(work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction | null = null;
      try {
        tx = db.transaction(STORE, 'readonly');
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(new PlatformIoError('io', { cause: request.error })); };
      } catch (cause) {
        abort(tx);
        reject(new PlatformIoError('io', { cause }));
      }
    });
  }

  return {
    put: (key, value) => write((store) => { store.put(value, key); }),
    get: (key) => read((store) => store.get(key)),
    delete: (key) => write((store) => { store.delete(key); }),
    keys: async () => {
      const all = await read((store) => store.getAllKeys());
      return all.filter((key): key is string => typeof key === 'string').sort();
    },
  };
}

function abort(tx: IDBTransaction | null): void {
  if (tx === null) return;
  try {
    tx.abort();
  } catch {
    // La transacción ya terminó: nada que deshacer.
  }
}
