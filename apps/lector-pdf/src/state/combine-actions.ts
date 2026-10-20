import { create } from 'zustand';
import type { SourceInput } from '../core/doc-ops/client';
import { exportBaseName } from '../core/export/plan';
import { organizeMsg } from '../ui/messages-organize';
import { nowIso } from './annotation-actions';
import { runDocOp } from './doc-ops';
import { currentPassword, openRequested, PDF_FILTERS } from './document-actions';
import { beginJob, endJob, jobOptions, sourceWithChanges } from './extract-actions';
import { checkImport } from './import-pdf';
import { showNotice } from './notice';
import { MAX_IMPORT_BYTES } from './organize-actions';
import { services } from './services';
import { useViewer } from './viewer-store';

/** Número máximo de ficheros en «Combinar archivos» (incluido el documento abierto). */
export const MAX_COMBINE_FILES = 50;

/** Un elemento de la lista de «Combinar archivos» (PDF-128). `current` = el documento abierto, con sus cambios. */
export interface CombineItem {
  readonly id: string;
  readonly name: string;
  readonly pages: number;
  readonly source: 'current' | { readonly bytes: Uint8Array; readonly password: string | null };
}

/** Resultado de combinar. `failed` si no se pudo (ya avisado). */
export type CombineOutcome = 'saved' | 'downloaded' | 'cancelled' | 'failed';

interface CombineDialogState {
  readonly open: boolean;
  readonly items: readonly CombineItem[];
}

/** Diálogo «Combinar archivos» (lo pinta `ui/organize/CombineDialog`). */
export const useCombineDialog = create<CombineDialogState>()(() => ({ open: false, items: [] }));

const CURRENT_ID = 'current';
let itemCounter = 0;

function nextItemId(): string {
  itemCounter += 1;
  return `file-${String(itemCounter)}`;
}

/** Abre el diálogo. Si hay un documento abierto, lo añade primero (con sus cambios sin guardar). */
export function openCombineDialog(): void {
  const { file, status, pdf } = useViewer.getState();
  const items: CombineItem[] =
    status === 'ready' && file !== null && pdf !== null
      ? [{ id: CURRENT_ID, name: file.name, pages: pdf.numPages, source: 'current' }]
      : [];
  useCombineDialog.setState({ open: true, items });
}

export function closeCombineDialog(): void {
  useCombineDialog.setState({ open: false, items: [] });
}

/**
 * Elige uno o varios PDF y los añade al final de la lista. Más de `MAX_COMBINE_FILES` en total, o uno mayor que
 * `MAX_IMPORT_BYTES`, avisa y no añade nada. Los protegidos piden su contraseña; los que no se pueden leer se avisan
 * y se saltan.
 */
export async function addCombineFiles(): Promise<void> {
  const picked = await services().platform.importFiles(PDF_FILTERS, MAX_IMPORT_BYTES, MAX_COMBINE_FILES);
  if (!picked.ok) {
    showNotice(picked.error.code === 'out-of-range' ? organizeMsg.combineLimit : picked.error.message);
    return;
  }
  const files = picked.value;
  if (files === null) return;
  if (useCombineDialog.getState().items.length + files.length > MAX_COMBINE_FILES) {
    showNotice(organizeMsg.combineLimit);
    return;
  }
  const added: CombineItem[] = [];
  for (const file of files) {
    const check = await checkImport(file.name, file.bytes);
    if (check.kind !== 'ok') continue;
    added.push({
      id: nextItemId(),
      name: file.name,
      pages: check.rotations.length,
      source: { bytes: file.bytes, password: check.password },
    });
  }
  // Si el diálogo se cerró mientras se leían los ficheros, no se añade nada.
  if (added.length > 0 && useCombineDialog.getState().open) {
    useCombineDialog.setState((state) => ({ items: [...state.items, ...added] }));
  }
}

/** Sube (-1) o baja (+1) un elemento. En los extremos no hace nada. */
export function moveCombineItem(id: string, delta: -1 | 1): void {
  useCombineDialog.setState((state) => {
    const items = [...state.items];
    const from = items.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return state;
    const [moved] = items.splice(from, 1);
    if (moved === undefined) return state;
    items.splice(to, 0, moved);
    return { items };
  });
}

/** Quita un elemento de la lista (no toca el fichero). */
export function removeCombineItem(id: string): void {
  useCombineDialog.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
}

/**
 * Combina los elementos en el orden de la lista (al menos dos) en un PDF nuevo, con una rama del índice por fichero.
 * Lo guarda con el diálogo del sistema y lo abre. Nunca lanza.
 */
export async function combineFiles(): Promise<CombineOutcome> {
  const { items } = useCombineDialog.getState();
  const first = items[0];
  if (items.length < 2 || first === undefined) return 'failed';
  const controller = beginJob(organizeMsg.combineTitle);
  if (controller === null) return 'failed';
  try {
    const parts: { readonly password: string | null; readonly title: string }[] = [];
    const sources: SourceInput[] = [];
    let unsaved = false;
    for (const item of items) {
      const title = exportBaseName(item.name);
      if (item.source === 'current') {
        const current = useViewer.getState().file;
        if (current === null) return 'failed';
        const withChanges = await sourceWithChanges(current);
        unsaved = unsaved || withChanges.unsaved;
        sources.push(withChanges.source);
        parts.push({ password: currentPassword(), title });
      } else {
        sources.push(item.source.bytes);
        parts.push({ password: item.source.password, title });
      }
    }
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      'combine',
      { parts, now: nowIso() },
      sources,
      jobOptions(controller),
    );
    if (controller.signal.aborted) return 'cancelled';
    endJob(controller);
    if (!result.ok) {
      showNotice(result.error.message);
      return 'failed';
    }
    const outcome = await services().platform.saveAs(`${exportBaseName(first.name)}-combinado.pdf`, PDF_FILTERS, {
      kind: 'bytes',
      bytes: result.value.bytes,
    });
    if (!outcome.ok) {
      showNotice(outcome.error.message);
      return 'failed';
    }
    switch (outcome.value.kind) {
      case 'cancelled':
        return 'cancelled';
      case 'saved':
        closeCombineDialog();
        if (unsaved) showNotice(organizeMsg.unsavedNotIncluded);
        await openRequested(outcome.value.file);
        return 'saved';
      case 'downloaded': {
        closeCombineDialog();
        const text = organizeMsg.combined(outcome.value.name);
        showNotice(unsaved ? `${organizeMsg.unsavedNotIncluded} ${text}` : text);
        return 'downloaded';
      }
    }
  } finally {
    endJob(controller);
  }
}
