import { createLogger } from '@suite/shared';
import type { KeyValueStore } from './types';

const log = createLogger('platform');

/** Almacén de preferencias sobre `Storage` (localStorage). Sin `storage` usa memoria. */
export function createStorageStore(storage: Storage | null, prefix: string): KeyValueStore {
  const memory = new Map<string, string>();
  const backend: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = storage ?? {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: (key) => { memory.delete(key); },
  };
  const fullKey = (key: string): string => `${prefix}${key}`;

  return {
    get<T>(key: string, guard: (v: unknown) => v is T): T | null {
      let raw: string | null;
      try {
        raw = backend.getItem(fullKey(key));
      } catch (cause) {
        // P. ej. SecurityError con cookies bloqueadas: la preferencia no está disponible.
        log.warn(`No se ha podido leer la preferencia «${key}».`, cause);
        return null;
      }
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        backend.removeItem(fullKey(key));
        return null;
      }
      if (!guard(parsed)) {
        backend.removeItem(fullKey(key));
        return null;
      }
      return parsed;
    },
    set(key: string, value: unknown): void {
      try {
        backend.setItem(fullKey(key), JSON.stringify(value));
      } catch (cause) {
        log.warn(`No se ha podido guardar la preferencia «${key}».`, cause);
      }
    },
    remove(key: string): void {
      backend.removeItem(fullKey(key));
    },
  };
}
