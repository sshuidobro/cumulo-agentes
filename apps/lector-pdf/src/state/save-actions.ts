import { create } from 'zustand';
import { createLogger, err, ok, type AppError, type Result } from '@suite/shared';
import type { OpenedFile, SaveData } from '@suite/platform';
import { diffAnnotations, isEmptyDiff, type AnnotationDiff } from '../core/annotations/diff';
import { diffFields, type FieldChange } from '../core/forms';
import { buildIncrementalUpdate, openForSave } from '../core/pdf';
import { msg } from '../ui/messages';
import { markAnnotationsSaved, nowIso } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { askChoice } from './choice';
import { currentPassword, openDocument, PDF_FILTERS } from './document-actions';
import { useForms } from './form-store';
import { readCurrentPosition } from './position-sync';
import { showNotice } from './notice';
import { services } from './services';
import { useViewer } from './viewer-store';

const log = createLogger('save-actions');

/**
 * Resultado de guardar. `downloaded`: copia descargada (web); el documento abierto sigue siendo el original.
 * `nothing`: sin cambios. `failed`: se ha mostrado el motivo en un aviso.
 */
export type SaveResult = 'saved' | 'downloaded' | 'cancelled' | 'nothing' | 'failed';

/** Guardado en curso. Lo lee la barra para deshabilitar los botones de guardar. */
export const useSaving = create<{ readonly saving: boolean }>()(() => ({ saving: false }));

export function isSaving(): boolean {
  return useSaving.getState().saving;
}

/**
 * Escritura sobre el fichero abierto: `append` anexa un incremento ya construido; `replace` sustituye el fichero
 * completo por `bytes` (y reabre con `password`, si el PDF la tiene).
 */
export type DocumentWrite =
  | { readonly kind: 'append'; readonly delta: Uint8Array }
  | { readonly kind: 'replace'; readonly bytes: Uint8Array; readonly password: string | null };

/**
 * Cambios pendientes que no viven en el historial de anotaciones (organizar, redactar…). Solo uno a la vez.
 * `save` debe guardarlos y devolver el resultado; `discard` los descarta sin preguntar.
 */
export interface PendingChanges {
  isDirty(): boolean;
  save(): Promise<SaveResult>;
  discard(): void;
}

let pending: PendingChanges | null = null;

/** Registra (o quita, con `null`) los cambios pendientes. Registrar otros mientras hay uno es un bug de la app. */
export function registerPendingChanges(changes: PendingChanges | null): void {
  if (changes !== null && pending !== null && pending !== changes) {
    throw new Error('save-actions: ya hay cambios pendientes registrados');
  }
  pending = changes;
}

export function pendingChanges(): PendingChanges | null {
  return pending;
}

/**
 * Ctrl+S: si hay cambios pendientes sucios, los guarda con su propio `save`; si no, anexa las anotaciones
 * al PDF abierto (o descarga una copia si no se puede escribir en sitio).
 */
export async function save(): Promise<SaveResult> {
  const changes = pending;
  if (changes !== null && changes.isDirty()) return changes.save();
  return runExclusive(async () => {
    const file = openedFile();
    if (file === null) return 'nothing';
    if (!hasChanges(currentChanges())) {
      markAnnotationsSaved();
      return 'nothing';
    }
    if (!file.canSaveInPlace) return writeCopy(file);
    const built = await buildCurrentDelta(file);
    if (!built.ok) return fail(built.error);
    return writeInPlace(file, appendData(file, built.value ?? new Uint8Array(0)), () => writeCopy(file));
  });
}

/**
 * Escribe en el fichero abierto con el flujo de Ctrl+S: exclusivo, en sitio o copia si no se puede, «cambió en disco»
 * → Guardar como, y reabre en la misma posición (con `password` si es `replace`).
 */
export function writeDocument(w: DocumentWrite): Promise<SaveResult> {
  return runExclusive(async () => {
    const file = openedFile();
    if (file === null) return 'nothing';
    const data: SaveData = w.kind === 'append' ? appendData(file, w.delta) : { kind: 'bytes', bytes: w.bytes };
    const password = w.kind === 'replace' ? w.password : undefined;
    const copy = (): Promise<SaveResult> => saveCopy(file, data, password);
    if (!file.canSaveInPlace) return copy();
    return writeInPlace(file, data, copy, password);
  });
}

/** Guardar como: aunque no haya cambios, la copia es el PDF con anotaciones actuales. */
export async function saveAs(): Promise<SaveResult> {
  return runExclusive(async () => {
    const file = openedFile();
    if (file === null) return 'nothing';
    return writeCopy(file);
  });
}

/** Ejecuta un guardado; si ya hay uno en curso, la llamada no hace nada. */
async function runExclusive(job: () => Promise<SaveResult>): Promise<SaveResult> {
  if (isSaving()) return 'cancelled';
  useSaving.setState({ saving: true });
  try {
    return await job();
  } finally {
    useSaving.setState({ saving: false });
  }
}

function openedFile(): OpenedFile | null {
  const { status, file } = useViewer.getState();
  return status === 'ready' ? file : null;
}

function appendData(file: OpenedFile, delta: Uint8Array): SaveData {
  return { kind: 'append', base: file, expectedSize: file.size, delta };
}

/** Cambios de anotaciones (frente a la línea base del fichero) y valores de formulario. */
interface CurrentChanges {
  readonly diff: AnnotationDiff;
  readonly fields: readonly FieldChange[];
}

function currentChanges(): CurrentChanges {
  const { baseline, edits } = useAnnotations.getState();
  return { diff: diffAnnotations(baseline, edits), fields: diffFields(useForms.getState().fields, edits) };
}

function hasChanges(changes: CurrentChanges): boolean {
  return !isEmptyDiff(changes.diff) || changes.fields.length > 0;
}

/**
 * Incremento con las anotaciones y valores de formulario actuales sobre `file`. `null` = sin cambios.
 * Los fallos (cifrado, estructura dañada) vuelven como `Result`, sin tocar la plataforma.
 * Lo usan guardar, guardar como, imprimir (PDF-087) y organizar (PDF-124).
 */
export async function buildCurrentDelta(file: OpenedFile): Promise<Result<Uint8Array | null, AppError>> {
  const changes = currentChanges();
  // La contraseña con la que se abrió el documento (PDF-046) evita volver a pedirla al guardar (PDF-047).
  const reader = await openForSave(file.source, currentPassword() ?? undefined);
  if (!reader.ok) return err(reader.error);
  const built = await buildIncrementalUpdate({
    source: file.source,
    reader: reader.value,
    diff: changes.diff,
    fields: changes.fields,
    now: nowIso(),
  });
  if (!built.ok) return err(built.error);
  return ok(hasChanges(changes) ? built.value.delta : null);
}

/** Guarda una copia con el incremento (la plataforma pide el nombre). */
async function writeCopy(file: OpenedFile): Promise<SaveResult> {
  const built = await buildCurrentDelta(file);
  if (!built.ok) return fail(built.error);
  return saveCopy(file, appendData(file, built.value ?? new Uint8Array(0)));
}

/** Guarda `data` en una copia nueva (diálogo de guardar). */
async function saveCopy(file: OpenedFile, data: SaveData, password?: string | null): Promise<SaveResult> {
  const outcome = await services().platform.saveAs(file.name, PDF_FILTERS, data);
  if (!outcome.ok) return reportWriteError(outcome.error, () => saveCopy(file, data, password));
  switch (outcome.value.kind) {
    case 'cancelled':
      return 'cancelled';
    case 'downloaded':
      markAnnotationsSaved();
      showNotice(msg.downloaded(outcome.value.name));
      return 'downloaded';
    case 'saved':
      return reopenSaved(outcome.value.file, password);
  }
}

/** Guarda `data` encima del fichero abierto y reabre el resultado. */
async function writeInPlace(
  file: OpenedFile,
  data: SaveData,
  saveAsCopy: () => Promise<SaveResult>,
  password?: string | null,
): Promise<SaveResult> {
  const saved = await services().platform.save(file, data);
  if (!saved.ok) return reportWriteError(saved.error, saveAsCopy);
  return reopenSaved(saved.value, password);
}

/**
 * Tras escribir en disco: reabre el fichero en la misma posición; las anotaciones pasan a ser la línea base.
 * `password` por defecto es la contraseña con la que se abrió el documento (PDF-046).
 */
async function reopenSaved(file: OpenedFile, password: string | null = currentPassword()): Promise<SaveResult> {
  const position = readCurrentPosition();
  await openDocument(file, {
    ...(position === null ? {} : { restore: position }),
    ...(password === null ? {} : { password }),
  });
  showNotice(msg.saved);
  return 'saved';
}

function fail(error: AppError): SaveResult {
  log.warn('save', error.code);
  showNotice(error.message);
  return 'failed';
}

/** Si el fichero cambió en disco, se ofrece guardar como otro fichero (`saveAsCopy`). Cualquier otro fallo es un aviso. */
async function reportWriteError(error: AppError, saveAsCopy: () => Promise<SaveResult>): Promise<SaveResult> {
  if (error.code !== 'changed-on-disk') return fail(error);
  const choice = await askChoice({
    title: msg.changedOnDiskTitle,
    message: error.message,
    options: [
      { label: msg.saveAs, value: 'save-as' },
      { label: msg.cancel, value: 'cancel' },
    ],
    cancel: 'cancel',
  });
  if (choice === 'save-as') return saveAsCopy();
  return 'cancelled';
}
