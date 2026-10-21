import { create } from 'zustand';
import type { UndoState } from '@suite/shared';
import { EMPTY_SELECTION, initialPlan, isUnchanged, type OrganizePlan, type PlanSelection } from '../core/organize/plan';
import type { PageRotation } from '../core/pdf/page-tree';
import type { PDFDocumentProxy } from '../engine';

/** PDF importado con «Insertar desde archivo» (PDF-128). `doc` da las miniaturas; `close` lo libera. */
export interface ImportedDoc {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Contraseña con la que se leyó (solo en memoria). `null` si no tiene. */
  readonly password: string | null;
  readonly doc: PDFDocumentProxy;
  readonly close: () => Promise<void>;
}

/** Estado de la vista «Organizar páginas» (PDF-124, ADR-0035). Las acciones están en `organize-actions.ts`. */
export interface OrganizeState {
  readonly open: boolean;
  readonly status: 'loading' | 'ready' | 'saving' | 'error';
  /** Giros iniciales del fichero. */
  readonly rotations: readonly PageRotation[];
  /** PDF importados: el hueco `imported` del plan usa su índice como `doc`. */
  readonly imported: readonly ImportedDoc[];
  readonly plan: OrganizePlan;
  readonly selection: PlanSelection;
  readonly undo: UndoState;
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly error: string | null;
}

const EMPTY_UNDO: UndoState = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  undoDepth: 0,
  redoDepth: 0,
  isDirty: false,
};

export const initialOrganizeState: OrganizeState = {
  open: false,
  status: 'ready',
  rotations: [],
  imported: [],
  plan: initialPlan([]),
  selection: EMPTY_SELECTION,
  undo: EMPTY_UNDO,
  progress: null,
  error: null,
};

export const useOrganize = create<OrganizeState>()(() => initialOrganizeState);

/** La vista está abierta y el plan ya no es el del fichero: hay cambios sin guardar. */
export function organizeDirty(): boolean {
  const { open, plan, rotations } = useOrganize.getState();
  return open && !isUnchanged(plan, rotations);
}
