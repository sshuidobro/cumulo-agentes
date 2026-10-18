import { create } from 'zustand';
import { createLogger, err, ok, type AppError, type Result } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import { diffAnnotations, isEmptyDiff, type AnnotationDiff } from '../core/annotations/diff';
import { diffFields, type FieldChange } from '../core/forms';
import { buildIncrementalUpdate, openForSave } from '../core/pdf';
import { msg } from '../ui/messages';
import { markAnnotationsSaved, nowIso } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { askChoice } from './choice';
import { openDocument, PDF_FILTERS } from './document-actions';
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

/** Ctrl+S: anexa las anotaciones al PDF abierto (o descarga una copia si no se puede escribir en sitio). */
export async function save(): Promise<SaveResult> {
  return runExclusive(async () => {
    const file = openedFile();
    if (file === null) return 'nothing';
    if (!hasChanges(currentDiff())) {
      markAnnotationsSaved();
      return 'nothing';
    }
    if (!file.canSaveInPlace) return writeCopy(file);
    const built = await buildCurrentDelta(file);
    if (!built.ok) return fail(built.error);
    const saved = await services().platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: file.size,
      delta: built.value ?? new Uint8Array(0),
    });
    if (!saved.ok) return reportWriteError(saved.error, file);
    return reopenSaved(saved.value);
  });
}

/** Ctrl+Mayús+S: guarda una copia con otro nombre (aunque no haya cambios, la copia es el PDF con anotaciones actuales). */
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

/** Cambios pendientes: anotaciones (frente a la línea base del fichero) y valores de formulario. */
interface PendingChanges {
  readonly diff: AnnotationDiff;
  readonly fields: readonly FieldChange[];
}

function currentDiff(): PendingChanges {
  const { baseline, edits } = useAnnotations.getState();
  return { diff: diffAnnotations(baseline, edits), fields: diffFields(useForms.getState().fields, edits) };
}

function hasChanges(changes: PendingChanges): boolean {
  return !isEmptyDiff(changes.diff) || changes.fields.length > 0;
}

/**
 * Incremento con las anotaciones y valores de formulario actuales sobre `file`. `null` = sin cambios.
 * Los fallos (cifrado, estructura dañada) vuelven como `Result`, sin tocar la plataforma.
 * Lo usan guardar, guardar como e imprimir (PDF-087).
 */
export async function buildCurrentDelta(file: OpenedFile): Promise<Result<Uint8Array | null, AppError>> {
  const changes = currentDiff();
  const reader = await openForSave(file.source);
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
  const outcome = await services().platform.saveAs(file.name, PDF_FILTERS, {
    kind: 'append',
    base: file,
    expectedSize: file.size,
    delta: built.value ?? new Uint8Array(0),
  });
  if (!outcome.ok) return reportWriteError(outcome.error, file);
  switch (outcome.value.kind) {
    case 'cancelled':
      return 'cancelled';
    case 'downloaded':
      markAnnotationsSaved();
      showNotice(msg.downloaded(outcome.value.name));
      return 'downloaded';
    case 'saved':
      return reopenSaved(outcome.value.file);
  }
}

/** Tras escribir en disco: reabre el fichero en la misma posición; las anotaciones pasan a ser la línea base. */
async function reopenSaved(file: OpenedFile): Promise<SaveResult> {
  const position = readCurrentPosition();
  await openDocument(file, position === null ? undefined : { restore: position });
  showNotice(msg.saved);
  return 'saved';
}

function fail(error: AppError): SaveResult {
  log.warn('save', error.code);
  showNotice(error.message);
  return 'failed';
}

/** Si el fichero cambió en disco, se ofrece guardar como otro fichero. Cualquier otro fallo es un aviso. */
async function reportWriteError(error: AppError, file: OpenedFile): Promise<SaveResult> {
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
  if (choice === 'save-as') return writeCopy(file);
  return 'cancelled';
}
