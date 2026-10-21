import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { RectPt } from '../core/annotations/model';
import type { EditableLine } from '../core/edit-text';

/** Línea editada pendiente de guardar (PDF-146). `text` es el texto nuevo; `original`, el de pdf.js. */
export interface LineEditDraft {
  readonly id: string;
  readonly pageIndex: number;
  readonly hint: RectPt;
  readonly line: EditableLine;
  readonly original: string;
  readonly text: string;
}

/** Cuadro de edición abierto. `editId` es `null` si la línea aún no tiene edición. */
export interface ActiveLineEdit {
  readonly pageIndex: number;
  readonly hint: RectPt;
  readonly line: EditableLine;
  readonly original: string;
  readonly editId: string | null;
}

export interface EditTextState {
  /** Herramienta activa. */
  readonly active: boolean;
  readonly edits: readonly LineEditDraft[];
  /** Cuadro abierto, o `null`. */
  readonly editing: ActiveLineEdit | null;
  readonly status: 'idle' | 'probing' | 'saving';
}

export const initialEditTextState: EditTextState = { active: false, edits: [], editing: null, status: 'idle' };

export const useEditText: UseBoundStore<StoreApi<EditTextState>> = create<EditTextState>()(() => initialEditTextState);
