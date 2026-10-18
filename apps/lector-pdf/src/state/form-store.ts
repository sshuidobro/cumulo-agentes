import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { FormField } from '../core/forms';

/** Campos del documento abierto (ADR-0019). Lo escriben solo las acciones de `form-actions.ts`. */
export interface FormState {
  readonly fields: ReadonlyMap<string, FormField>;
  /** Nombres de campo con algún widget en cada página (0-based), en orden de aparición. */
  readonly byPage: ReadonlyMap<number, readonly string[]>;
  /** Resaltar campos (preferencia `formHighlight`, por defecto true). */
  readonly highlight: boolean;
}

/** Estado sin documento. `highlight` se conserva entre documentos: es una preferencia. */
export function initialFormState(highlight = true): FormState {
  return { fields: new Map(), byPage: new Map(), highlight };
}

export const useForms: UseBoundStore<StoreApi<FormState>> = create<FormState>()(() => initialFormState());
