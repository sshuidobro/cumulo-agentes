import { create } from 'zustand';
import { createLogger } from '@suite/shared';
import type { KeyValueStore } from '@suite/platform';
import type { SignatureArt } from '../core/annotations/model';
import {
  addStored,
  isStoredSignatures,
  removeStored,
  type StoredSignature,
} from '../core/signature/stored';
import { signatureMsg } from '../ui/messages-signature';
import { showNotice } from './notice';
import { services } from './services';

const log = createLogger('signature-actions');

/** Clave de la preferencia (el almacén ya antepone el prefijo de la app). */
const PREF_SIGNATURES = 'signatures';

export interface SignatureState {
  readonly list: readonly StoredSignature[];
}

/** Firmas guardadas. Lo escriben solo las acciones de este fichero. */
export const useSignatures = create<SignatureState>(() => ({ list: [] }));

/** Almacén del que se leyó la lista; si cambia (otros servicios), se vuelve a leer. */
let loadedFrom: KeyValueStore | null = null;

/** Lee la preferencia `signatures` la primera vez (y tras cambiar de almacén). Antes de usar la lista. */
export function ensureSignaturesLoaded(): void {
  const store = services().platform.prefs;
  if (store === loadedFrom) return;
  loadedFrom = store;
  useSignatures.setState({ list: store.get(PREF_SIGNATURES, isStoredSignatures) ?? [] });
}

/**
 * Guarda `art` como firma reutilizable (la más reciente, al principio). Si el almacén no la conserva (cuota
 * llena, p. ej.), avisa y la firma vale igual para esta sesión. Devuelve la firma guardada en memoria.
 */
export function saveSignature(art: SignatureArt): StoredSignature {
  ensureSignaturesLoaded();
  const stored: StoredSignature = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    art,
  };
  const next = addStored(useSignatures.getState().list, stored);
  useSignatures.setState({ list: next });
  persist(next);
  return stored;
}

/** Quita una firma guardada de la lista y de la preferencia. */
export function deleteSignature(id: string): void {
  ensureSignaturesLoaded();
  const next = removeStored(useSignatures.getState().list, id);
  useSignatures.setState({ list: next });
  persist(next);
}

/**
 * Escribe la lista y comprueba que se ha guardado de verdad: el almacén de preferencias traga los errores de
 * escritura, así que la lectura de vuelta es la única señal de que no cabe.
 */
function persist(list: readonly StoredSignature[]): void {
  const store = services().platform.prefs;
  store.set(PREF_SIGNATURES, list);
  const readBack = store.get(PREF_SIGNATURES, isStoredSignatures);
  if (list.length > 0 && readBack === null) {
    log.warn('La lista de firmas no se ha podido guardar en las preferencias.');
    showNotice(signatureMsg.storeFailed);
  }
}
