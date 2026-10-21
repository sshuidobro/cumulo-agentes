import { createLogger, UndoStack, type Command } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import type { EditTextProbe } from '../core/doc-ops/ops/edit-text';
import type { RectPt } from '../core/annotations/model';
import { concatSource } from '../core/pdf/concat-source';
import { firstUnmappable } from '../core/annotations/winansi';
import type { SignatureStatus } from '../core/signature/digital';
import { lineHintAt, type TextItemLike } from '../engine/line-hint';
import type { TextContent } from '../engine/pdfjs';
import { getPageTextContent } from '../engine/text';
import { editTextMsg } from '../ui/messages-edit-text';
import { nowIso } from './annotation-actions';
import { askChoice } from './choice';
import { currentPassword } from './document-actions';
import { runDocOp } from './doc-ops';
import { beginJob, endJob, jobOptions } from './extract-actions';
import { initialEditTextState, useEditText, type LineEditDraft } from './edit-text-store';
import { showNotice } from './notice';
import { isSwitchingTab, registerTabParticipant, type TabParticipant } from './tabs';
import {
  buildCurrentDelta,
  pendingChanges,
  registerPendingChanges,
  writeDocument,
  type PendingChanges,
  type SaveResult,
} from './save-actions';
import { useViewer } from './viewer-store';

const log = createLogger('edit-text-actions');

/** Profundidad del historial de ediciones de línea (PDF-146). */
export const EDIT_TEXT_UNDO_DEPTH = 100;

type Edits = readonly LineEditDraft[];

/** Historial de las ediciones del documento abierto. Cada apertura empieza uno nuevo. */
let stack = newStack();
/** Se incrementa al limpiar o suspender: invalida las consultas y guardados en curso. */
let generation = 0;
/** Guardado en curso (lo aborta `clearView`). */
let activeSave: AbortController | null = null;

function newStack(): UndoStack<Edits> {
  return new UndoStack<Edits>([], { maxDepth: EDIT_TEXT_UNDO_DEPTH });
}

/** Comando que sustituye todas las ediciones por `next`. Deshacerlo restaura las anteriores. */
function replaceEdits(next: Edits, label: string): Command<Edits> {
  return {
    label,
    apply: () => next,
    invert: (before) => replaceEdits(before, label),
  };
}

/** Cambios pendientes de este módulo: solo mientras haya alguna edición. */
const pendingHandle: PendingChanges = {
  isDirty: () => useEditText.getState().edits.length > 0,
  save: saveTextEdits,
  discard: clearView,
};

/** Registra o quita los cambios pendientes según haya ediciones. Nunca quita los de otra herramienta. */
function syncPending(): void {
  if (useEditText.getState().edits.length > 0) registerPendingChanges(pendingHandle);
  else if (pendingChanges() === pendingHandle) registerPendingChanges(null);
}

/** Publica las ediciones del historial en el store y actualiza los cambios pendientes. */
function publish(edits: Edits): void {
  useEditText.setState({ edits });
  syncPending();
}

/** Las ediciones no cambian mientras se guarda. */
function mutable(): boolean {
  return useEditText.getState().status !== 'saving';
}

/** Aplica un cambio al historial y lo publica. El cuadro abierto lo cierra quien llama, si hace falta. */
function apply(next: Edits, label: string): void {
  publish(stack.execute(replaceEdits(next, label)));
}

/** Vacía todo (herramienta, cuadro, ediciones y guardado) sin preguntar. Invalida lo que estuviera en curso. */
function clearView(): void {
  generation++;
  activeSave?.abort();
  activeSave = null;
  stack = newStack();
  useEditText.setState(initialEditTextState);
  syncPending();
}

function contains(rect: RectPt, point: readonly [number, number]): boolean {
  const [x0, y0, x1, y1] = rect;
  const [x, y] = point;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** Ítems de texto (con `str`) de una página de pdf.js, en la forma que necesita `lineHintAt`. */
function textItems(items: TextContent['items']): TextItemLike[] {
  const out: TextItemLike[] = [];
  for (const item of items) {
    if ('str' in item) out.push({ str: item.str, transform: item.transform, width: item.width, height: item.height });
  }
  return out;
}

/** Activa o desactiva la herramienta. Al desactivar con el cuadro abierto, confirma el texto `currentText` (si lo hay). */
export function setEditTextTool(active: boolean, currentText?: string): void {
  const { editing } = useEditText.getState();
  if (!active && editing !== null && currentText !== undefined) {
    // Con un texto no válido el cuadro sigue abierto para que el usuario lo corrija.
    if (validateLineText(currentText) !== null) return;
    commitLineEdit(currentText);
  }
  useEditText.setState({ active, editing: active ? useEditText.getState().editing : null });
}

/**
 * Abre el cuadro de edición de la línea bajo `point` de la página `pageIndex`: primero busca una edición existente
 * con ese punto; si no, localiza la línea con pdf.js y pregunta al Worker si es editable.
 */
export async function beginLineEdit(pageIndex: number, point: readonly [number, number]): Promise<void> {
  if (!mutable()) return;
  const own = useEditText.getState().edits.find((edit) => edit.pageIndex === pageIndex && contains(edit.line.bounds, point));
  if (own !== undefined) {
    useEditText.setState({
      editing: { pageIndex, hint: own.hint, line: own.line, original: own.original, editId: own.id },
    });
    return;
  }
  const pending = pendingChanges();
  if (pending !== null && pending !== pendingHandle) {
    showNotice(editTextMsg.otherPending);
    return;
  }
  const { file, pdf } = useViewer.getState();
  if (file === null || pdf === null) return;

  const gen = generation;
  useEditText.setState({ status: 'probing' });
  try {
    const page = await pdf.doc.getPage(pageIndex + 1);
    const content = await getPageTextContent(page);
    if (gen !== generation) return;
    const located = lineHintAt(textItems(content.items), point);
    if (located === null) {
      showNotice(editTextMsg.noText);
      return;
    }
    const probed = await runDocOp<EditTextProbe>('edit-text-probe', {
      password: currentPassword(),
      pageIndex,
      hint: located.hint,
    }, [file.source]);
    if (gen !== generation) return;
    if (!probed.ok) {
      showNotice(probed.error.message);
      return;
    }
    const probe = probed.value;
    if ('issue' in probe) {
      showNotice(editTextMsg.issue[probe.issue]);
      return;
    }
    useEditText.setState({
      editing: { pageIndex, hint: located.hint, line: probe.line, original: located.text, editId: null },
    });
  } finally {
    if (gen === generation) useEditText.setState({ status: 'idle' });
  }
}

/** `null` si el texto es válido; si no, el mensaje de error para el cuadro (carácter no admitido o salto de línea). */
export function validateLineText(text: string): string | null {
  const bad = firstUnmappable(text);
  if (bad === null) return null;
  if (bad === '\n' || bad === '\r' || bad === '\t') return editTextMsg.noLineBreaks;
  return editTextMsg.unsupportedChar(bad);
}

/**
 * Confirma el cuadro abierto con `text`. Un texto no válido no hace nada. Una línea nueva con el texto original
 * no crea edición; una edición que vuelve al original se quita. Cada cambio es un paso deshacible.
 */
export function commitLineEdit(text: string): void {
  const { editing, edits } = useEditText.getState();
  if (editing === null || !mutable() || validateLineText(text) !== null) return;
  const close = (): void => {
    useEditText.setState({ editing: null });
  };

  if (editing.editId === null) {
    if (text !== editing.original) {
      const draft: LineEditDraft = {
        id: crypto.randomUUID(),
        pageIndex: editing.pageIndex,
        hint: editing.hint,
        line: editing.line,
        original: editing.original,
        text,
      };
      apply([...edits, draft], editTextMsg.undoEdit);
    }
    close();
    return;
  }

  const current = edits.find((edit) => edit.id === editing.editId);
  if (current === undefined || current.text === text) {
    close();
    return;
  }
  const next =
    text === current.original
      ? edits.filter((edit) => edit.id !== current.id)
      : edits.map((edit) => (edit.id === current.id ? { ...edit, text } : edit));
  apply(next, text === current.original ? editTextMsg.undoRestore : editTextMsg.undoEdit);
  close();
}

/** Cierra el cuadro sin cambiar nada. */
export function cancelLineEdit(): void {
  useEditText.setState({ editing: null });
}

/** Quita la edición `id` y restaura la línea original (deshacible). */
export function removeLineEdit(id: string): void {
  const { edits } = useEditText.getState();
  if (!mutable() || !edits.some((edit) => edit.id === id)) return;
  apply(
    edits.filter((edit) => edit.id !== id),
    editTextMsg.undoRestore,
  );
}

export function editTextUndo(): void {
  if (!mutable() || !stack.undo()) return;
  publish(stack.doc);
}

export function editTextRedo(): void {
  if (!mutable() || !stack.redo()) return;
  publish(stack.doc);
}

function confirmMessage(count: number, signed: boolean): string {
  return [editTextMsg.confirmBody(count), signed ? editTextMsg.signaturesWarning : null]
    .filter((part): part is string => part !== null)
    .join(' ');
}

/**
 * Pide confirmación (con aviso si hay firmas), reescribe las líneas editadas con la operación `edit-text` y guarda el
 * fichero completo. «Cancelar» no cambia nada; un error deja las ediciones intactas.
 */
export async function saveTextEdits(): Promise<SaveResult> {
  const { edits, status } = useEditText.getState();
  if (edits.length === 0) return 'nothing';
  if (status === 'saving') return 'cancelled';
  const file = useViewer.getState().file;
  if (file === null) return 'nothing';

  const gen = generation;
  useEditText.setState({ status: 'saving' });
  try {
    const signed = await runDocOp<readonly SignatureStatus[]>('verify-signatures', { password: currentPassword() }, [file.source]);
    if (gen !== generation) return 'cancelled';
    if (!signed.ok) return failSave(signed.error.message);
    const choice = await askChoice({
      title: editTextMsg.confirmTitle,
      message: confirmMessage(edits.length, signed.value.length > 0),
      options: [
        { label: editTextMsg.save, value: 'save' },
        { label: editTextMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (choice === 'cancel' || gen !== generation) return 'cancelled';
    return await writeEdits(file, edits, gen);
  } finally {
    if (gen === generation && useEditText.getState().status === 'saving') useEditText.setState({ status: 'idle' });
  }
}

/** Construye el fichero con las líneas editadas y lo escribe. Con la operación en curso, cancelar no escribe nada. */
async function writeEdits(file: OpenedFile, edits: Edits, gen: number): Promise<SaveResult> {
  const controller = beginJob(editTextMsg.confirmTitle, editTextMsg.progress);
  if (controller === null) return 'cancelled';
  activeSave = controller;
  try {
    const built = await buildCurrentDelta(file);
    if (!built.ok) return failSave(built.error.message);
    const prefix = built.value ?? new Uint8Array(0);
    if (controller.signal.aborted || gen !== generation) return 'cancelled';
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      'edit-text',
      {
        password: currentPassword(),
        edits: edits.map((edit) => ({ pageIndex: edit.pageIndex, hint: edit.hint, text: edit.text })),
        now: nowIso(),
      },
      [concatSource(file.source, prefix)],
      jobOptions(controller),
    );
    if (controller.signal.aborted || gen !== generation) return 'cancelled';
    if (!result.ok) return failSave(result.error.message);

    // Antes de abrir el guardado, la operación deja de estar «en curso».
    endJob(controller);
    const saved = await writeDocument({ kind: 'replace', bytes: result.value.bytes, password: currentPassword() });
    if (saved === 'saved' || saved === 'downloaded') {
      clearView();
      showNotice(editTextMsg.done(edits.length));
    }
    return saved;
  } finally {
    endJob(controller);
    if (activeSave === controller) activeSave = null;
  }
}

function failSave(message: string): SaveResult {
  log.warn('save', message);
  showNotice(message);
  return 'failed';
}

/** Con el documento cambiado (abrir otro o reabrir tras guardar) se vacía sin preguntar, salvo al cambiar de pestaña. */
useViewer.subscribe((next, prev) => {
  if (next.file !== prev.file && !isSwitchingTab()) clearView();
});

/** Estado que se guarda al suspender la pestaña: el historial va con él. */
interface EditTextSnapshot {
  readonly active: boolean;
  readonly edits: Edits;
  readonly stack: UndoStack<Edits>;
}

const editTextParticipant: TabParticipant<EditTextSnapshot> = {
  id: 'edit-text',
  order: 42,
  suspend(): EditTextSnapshot {
    const { active, edits } = useEditText.getState();
    const snapshot: EditTextSnapshot = { active, edits, stack };
    clearView();
    return snapshot;
  },
  resume(snapshot: EditTextSnapshot): void {
    stack = snapshot.stack;
    useEditText.setState({ active: snapshot.active, edits: snapshot.edits, editing: null, status: 'idle' });
    syncPending();
  },
  dispose: () => Promise.resolve(),
};

/** Da de alta las ediciones de texto en el registro de pestañas. Llamar una vez al arrancar. */
export function registerEditTextParticipant(): void {
  registerTabParticipant(editTextParticipant);
}
