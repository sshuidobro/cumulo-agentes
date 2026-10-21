import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { UndoState } from '@suite/shared';
import type { RectPt } from '../core/annotations/model';

/** Zona marcada para redactar (PDF-137). `rect` está en espacio de usuario de la página. */
export interface RedactMark {
  readonly id: string;
  readonly pageIndex: number;
  readonly rect: RectPt;
}

/** Estado de «Redactar» del documento abierto. Las acciones están en `redact-actions.ts`. */
export interface RedactState {
  readonly marks: readonly RedactMark[];
  readonly undo: UndoState;
}

export const initialRedactState: RedactState = {
  marks: [],
  undo: {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    undoDepth: 0,
    redoDepth: 0,
    isDirty: false,
  },
};

export const useRedact: UseBoundStore<StoreApi<RedactState>> = create<RedactState>()(() => initialRedactState);
