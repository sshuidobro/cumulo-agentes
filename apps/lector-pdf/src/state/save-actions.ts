import { create } from 'zustand';
import { createLogger, err, ok, type AppError, type Result } from '@suite/shared';
import type { OpenedFile } from '@suite/platform';
import { diffAnnotations, isEmptyDiff, type AnnotationDiff } from '../core/annotations/diff';
import { buildIncrementalUpdate, openForSave } from '../core/pdf';
import { msg } from '../ui/messages';
import { markAnnotationsSaved, nowIso } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { askChoice } from './choice';
import { openDocument, PDF_FILTERS } from './document-actions';
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
    const diff = currentDiff();
    if (isEmptyDiff(diff)) {
      markAnnotationsSaved();
      return 'nothing';
    }
    if (!file.canSaveInPlace) return writeCopy(file, diff);
    const built = await buildDelta(file, diff);
    if (!built.ok) return fail(built.error);
    const saved = await services().platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: file.size,
      delta: built.value,
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
    return writeCopy(file, currentDiff());
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

function currentDiff(): AnnotationDiff {
  const { baseline, edits } = useAnnotations.getState();
  return diffAnnotations(baseline, edits);
}

/** Construye el incremento. Los fallos (cifrado, estructura dañada) vuelven como `Result`, sin tocar la plataforma. */
async function buildDelta(file: OpenedFile, diff: AnnotationDiff): Promise<Result<Uint8Array, AppError>> {
  const reader = await openForSave(file.source);
  if (!reader.ok) return err(reader.error);
  const built = await buildIncrementalUpdate({ source: file.source, reader: reader.value, diff, now: nowIso() });
  if (!built.ok) return err(built.error);
  return ok(built.value.delta);
}

/** Guarda una copia con el incremento (la plataforma pide el nombre). */
async function writeCopy(file: OpenedFile, diff: AnnotationDiff): Promise<SaveResult> {
  const built = await buildDelta(file, diff);
  if (!built.ok) return fail(built.error);
  const outcome = await services().platform.saveAs(file.name, PDF_FILTERS, {
    kind: 'append',
    base: file,
    expectedSize: file.size,
    delta: built.value,
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
  if (choice === 'save-as') return writeCopy(file, currentDiff());
  return 'cancelled';
}
