import { createLogger, UndoStack, type Command } from '@suite/shared';
import { concatSource } from '../core/pdf/concat-source';
import type { PageRotation } from '../core/pdf/page-tree';
import {
  canDelete,
  deleteCommand,
  indexOfKey,
  initialPlan,
  insertBlankCommand,
  moveCommand,
  ORGANIZE_UNDO_DEPTH,
  pruneSelection,
  rotateCommand,
  toSaveSlots,
  type OrganizePlan,
  type PlanSelection,
  type PlanSlot,
} from '../core/organize/plan';
import { windowTitle } from '../core/title';
import { organizeMsg } from '../ui/messages-organize';
import { askChoice } from './choice';
import { runDocOp } from './doc-ops';
import { currentPassword } from './document-actions';
import { initialOrganizeState, organizeDirty, useOrganize, type OrganizeState } from './organize-store';
import { nowIso } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { showNotice } from './notice';
import { refreshActiveTab, registerTabParticipant, type TabParticipant } from './tabs';
import {
  buildCurrentDelta,
  registerPendingChanges,
  writeDocument,
  type PendingChanges,
  type SaveResult,
} from './save-actions';
import { services } from './services';
import { useViewer } from './viewer-store';

const log = createLogger('organize-actions');

/** Historial del plan de la vista abierta. Cada apertura empieza uno nuevo. */
let stack = newStack(initialPlan([]));
/** Se incrementa al cerrar, suspender o cambiar de documento: invalida las cargas y guardados en curso. */
let generation = 0;
/** Guardado en curso (lo aborta `cancelOrganizeSave`). */
let activeSave: AbortController | null = null;
/** Documento para el que ya se avisó de que no permite organizar (una vez por documento). */
let assembleNoticeFor: string | null = null;

function newStack(plan: OrganizePlan): UndoStack<OrganizePlan> {
  return new UndoStack<OrganizePlan>(plan, { maxDepth: ORGANIZE_UNDO_DEPTH });
}

/** La vista está abierta y lista para editar. */
function ready(): boolean {
  const { open, status } = useOrganize.getState();
  return open && status === 'ready';
}

/** Título de la ventana con la marca de sin guardar de anotaciones y de la vista. */
function refreshTitle(): void {
  const file = useViewer.getState().file;
  if (file === null) return;
  services().platform.setTitle(windowTitle(file.name, useAnnotations.getState().undo.isDirty || organizeDirty()));
  refreshActiveTab();
}

/** Publica un plan nuevo: poda la selección, actualiza el historial y el título. */
function publish(plan: OrganizePlan): void {
  const { selection } = useOrganize.getState();
  useOrganize.setState({ plan, selection: pruneSelection(plan, selection), undo: stack.getState() });
  refreshTitle();
}

/** Aplica un comando al plan (solo con la vista lista). */
function run(command: Command<OrganizePlan>): void {
  if (!ready()) return;
  stack.execute(command);
  publish(stack.doc);
}

/** Cierra la vista y descarta el plan. Invalida lo que estuviera en curso. */
function closeNow(): void {
  generation++;
  activeSave?.abort();
  activeSave = null;
  stack = newStack(initialPlan([]));
  registerPendingChanges(null);
  useOrganize.setState(initialOrganizeState);
  refreshTitle();
}

const pendingHandle: PendingChanges = {
  isDirty: organizeDirty,
  save: saveOrganize,
  discard: closeNow,
};

/** Abre la vista: lee los giros de las páginas en el Worker y arranca el plan inicial. */
export async function openOrganize(): Promise<void> {
  const { file, status, permissions, pdf } = useViewer.getState();
  if (file === null || status !== 'ready' || useOrganize.getState().open) return;
  const key = pdf?.fingerprint ?? file.token;
  if (!permissions.assemble && assembleNoticeFor !== key) {
    assembleNoticeFor = key;
    showNotice(organizeMsg.assembleAnyway);
  }
  const gen = ++generation;
  stack = newStack(initialPlan([]));
  useOrganize.setState({ ...initialOrganizeState, open: true, status: 'loading' });
  registerPendingChanges(pendingHandle);
  const result = await runDocOp<readonly PageRotation[]>('page-rotations', { password: currentPassword() }, [file.source]);
  if (gen !== generation) return;
  if (!result.ok) {
    useOrganize.setState({ status: 'error', error: result.error.message });
    return;
  }
  const plan = initialPlan(result.value);
  stack = newStack(plan);
  useOrganize.setState({ status: 'ready', rotations: result.value, plan, undo: stack.getState(), error: null });
  refreshTitle();
}

/**
 * Cierra la vista. Con cambios pregunta: «Guardar» guarda y cierra si se ha guardado (o descargado);
 * «No guardar» descarta; «Cancelar» (o un fallo) la deja abierta.
 */
export async function closeOrganize(): Promise<'closed' | 'cancelled'> {
  const { open, status } = useOrganize.getState();
  if (!open) return 'closed';
  if (status === 'saving') return 'cancelled';
  if (organizeDirty()) {
    const choice = await askChoice({
      title: organizeMsg.saveQuestion(useViewer.getState().file?.name ?? ''),
      options: [
        { label: organizeMsg.save, value: 'save' },
        { label: organizeMsg.discard, value: 'discard' },
        { label: organizeMsg.cancel, value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (choice === 'cancel') return 'cancelled';
    if (choice === 'save') {
      const result = await saveOrganize();
      return result === 'saved' || result === 'downloaded' || result === 'nothing' ? 'closed' : 'cancelled';
    }
  }
  closeNow();
  return 'closed';
}

export function organizeUndo(): void {
  if (!ready() || !stack.undo()) return;
  publish(stack.doc);
}

export function organizeRedo(): void {
  if (!ready() || !stack.redo()) return;
  publish(stack.doc);
}

/** Gira ±90 las páginas seleccionadas. */
export function rotateSelected(delta: 90 | -90): void {
  const { keys } = useOrganize.getState().selection;
  if (keys.size === 0) return;
  run(rotateCommand(keys, delta));
}

/** Quita las páginas seleccionadas. Si quitaría todas, avisa y no hace nada. */
export function deleteSelected(): void {
  const { plan, selection } = useOrganize.getState();
  const { keys } = selection;
  if (keys.size === 0) return;
  if (!canDelete(plan, keys)) {
    showNotice(organizeMsg.cannotDeleteAll);
    return;
  }
  run(deleteCommand(keys));
}

/** Mueve las páginas seleccionadas delante del hueco `toIndex` (`slots.length` = al final). */
export function moveSelected(toIndex: number): void {
  const { keys } = useOrganize.getState().selection;
  if (keys.size === 0) return;
  run(moveCommand(keys, toIndex));
}

/**
 * Inserta una página en blanco junto al hueco con foco (antes o después); sin foco, al final.
 * Su tamaño es el del hueco de referencia (el foco, o el último si no hay): una página en blanco tiene el suyo;
 * una original, las dimensiones de la página en el visor, intercambiadas si el hueco está girado 90 o 270.
 */
export function insertBlank(where: 'before' | 'after'): void {
  if (!ready()) return;
  const { plan, selection } = useOrganize.getState();
  const focusIndex = selection.focus === null ? -1 : indexOfKey(plan, selection.focus);
  const reference = plan.slots[focusIndex >= 0 ? focusIndex : plan.slots.length - 1];
  if (reference === undefined) return;
  const size = blankSizeFor(reference);
  if (size === null) {
    log.warn('insert-blank', 'sin medidas de la página de referencia');
    return;
  }
  const at = focusIndex < 0 ? plan.slots.length : where === 'before' ? focusIndex : focusIndex + 1;
  run(insertBlankCommand(at, size.width, size.height));
}

function blankSizeFor(slot: PlanSlot): { readonly width: number; readonly height: number } | null {
  if (slot.kind === 'blank') return { width: slot.width, height: slot.height };
  // Las páginas importadas (PDF-128) no tienen dimensiones en el visor de este documento.
  if (slot.kind === 'imported') return null;
  const dims = useViewer.getState().dims;
  if (dims === null || !dims.isKnown(slot.source)) return null;
  const width = dims.width(slot.source);
  const height = dims.height(slot.source);
  return slot.rotate === 90 || slot.rotate === 270 ? { width: height, height: width } : { width, height };
}

export function setSelection(sel: PlanSelection): void {
  useOrganize.setState({ selection: pruneSelection(useOrganize.getState().plan, sel) });
}

/** Escribe el plan: anotaciones sin guardar + plan, en un único incremento. Cierra la vista si se guarda. */
export async function saveOrganize(): Promise<SaveResult> {
  const { open, status } = useOrganize.getState();
  if (!open) return 'nothing';
  if (status === 'saving') return 'cancelled';
  if (status !== 'ready') return 'nothing';
  const file = useViewer.getState().file;
  if (file === null) return 'nothing';
  if (!organizeDirty()) {
    closeNow();
    return 'nothing';
  }

  const gen = generation;
  const controller = new AbortController();
  activeSave = controller;
  useOrganize.setState({ status: 'saving', progress: null, error: null });
  try {
    // Las anotaciones y formularios sin guardar van primero, en el mismo incremento que el plan.
    const built = await buildCurrentDelta(file);
    if (!built.ok) return failSave(built.error.message);
    const prefix = built.value ?? new Uint8Array(0);
    if (controller.signal.aborted || gen !== generation) return 'cancelled';
    const { plan } = useOrganize.getState();
    const result = await runDocOp<{ readonly delta: Uint8Array }>(
      'organize',
      { password: currentPassword(), slots: toSaveSlots(plan), now: nowIso() },
      [concatSource(file.source, prefix)],
      {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (gen === generation) useOrganize.setState({ progress: { done, total } });
        },
      },
    );
    // Cancelado o cerrado/suspendido mientras tanto: no se escribe nada.
    if (controller.signal.aborted || gen !== generation) return 'cancelled';
    if (!result.ok) return failSave(result.error.message);
    const saved = await writeDocument({ kind: 'append', delta: concatBytes(prefix, result.value.delta) });
    if (saved === 'saved' || saved === 'downloaded') closeNow();
    return saved;
  } finally {
    if (activeSave === controller) activeSave = null;
    if (gen === generation && useOrganize.getState().status === 'saving') {
      useOrganize.setState({ status: 'ready', progress: null });
    }
  }
}

/** Cancela el guardado en curso: nada se escribe y la vista sigue con el plan. */
export function cancelOrganizeSave(): void {
  activeSave?.abort();
}

function failSave(message: string): SaveResult {
  log.warn('save', message);
  showNotice(message);
  return 'failed';
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Con el documento cambiado (abrir otro o reabrir tras guardar) la vista se cierra sin preguntar. */
useViewer.subscribe((next, prev) => {
  if (next.file !== prev.file && useOrganize.getState().open) closeNow();
});

/** Estado que se guarda al suspender la pestaña: el historial va con él. */
interface OrganizeSnapshot {
  readonly state: OrganizeState;
  readonly stack: UndoStack<OrganizePlan>;
}

const organizeParticipant: TabParticipant<OrganizeSnapshot> = {
  id: 'organize',
  order: 40,
  suspend(): OrganizeSnapshot {
    const { status, ...rest } = useOrganize.getState();
    // Un guardado en curso se cancela al suspender: la pestaña vuelve con el plan sin guardar, no a medio escribir.
    const snapshot: OrganizeSnapshot = { state: { ...rest, status: status === 'saving' ? 'ready' : status, progress: null }, stack };
    closeNow();
    return snapshot;
  },
  resume(snapshot: OrganizeSnapshot): void {
    stack = snapshot.stack;
    useOrganize.setState(snapshot.state);
    if (snapshot.state.open) registerPendingChanges(pendingHandle);
    refreshTitle();
  },
  dispose: () => Promise.resolve(),
};

/** Da de alta el participante de la vista en el registro de pestañas. Llamar una vez al arrancar. */
export function registerOrganizeParticipant(): void {
  registerTabParticipant(organizeParticipant);
}
