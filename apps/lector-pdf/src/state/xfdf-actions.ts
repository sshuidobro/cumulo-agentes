import type { FileFilter } from '@suite/platform';
import { createLogger } from '@suite/shared';
import { isFlattened, type Annotation } from '../core/annotations/model';
import { exportBaseName } from '../core/export/plan';
import { exportXfdf, importXfdf } from '../core/xfdf/xfdf';
import { commentsMsg } from '../ui/messages-comments';
import { addAnnotations, getEffective, newAnnotationId, nowIso } from './annotation-actions';
import { useAnnotations } from './annotation-store';
import { showNotice } from './notice';
import { services } from './services';
import { showSidebarTab } from './sidebar-actions';
import { useViewer } from './viewer-store';

const log = createLogger('xfdf');

export const XFDF_FILTERS: readonly FileFilter[] = [{ name: 'Comentarios XFDF', extensions: ['xfdf', 'xml'] }];
export const MAX_XFDF_BYTES = 20_000_000;

/** Nombre del fichero si el documento no tiene nombre utilizable. */
const FALLBACK_NAME = 'documento';

/** Una anotación se puede exportar si no es una firma ni un texto libre o forma ya aplanado (igual que `exportXfdf`). */
export function hasExportableComments(list: Iterable<Annotation>): boolean {
  for (const a of list) {
    if (a.type !== 'signature' && !isFlattened(a)) return true;
  }
  return false;
}

/** Exporta las anotaciones editables efectivas (con cambios sin guardar). Nombre sugerido: «<nombre sin .pdf>.xfdf». */
export async function exportComments(): Promise<'saved' | 'downloaded' | 'cancelled' | 'nothing' | 'failed'> {
  const { pdf, file } = useViewer.getState();
  const all = getEffective();
  if (pdf === null || !hasExportableComments(all.values())) return 'nothing';

  const fp = pdf.doc.fingerprints;
  const ids = typeof fp[0] === 'string' && typeof fp[1] === 'string' ? ([fp[0], fp[1]] as const) : null;
  const base = exportBaseName(file?.name ?? FALLBACK_NAME);
  const xml = exportXfdf(all, { fileName: file?.name ?? `${FALLBACK_NAME}.pdf`, ids });
  const bytes = new TextEncoder().encode(xml);

  const saved = await services().platform.exportFile(`${base}.xfdf`, XFDF_FILTERS, bytes);
  if (!saved.ok) {
    log.warn('exportFile', saved.error.code);
    showNotice(saved.error.message);
    return 'failed';
  }
  if (saved.value === 'saved') showNotice(commentsMsg.exported);
  return saved.value;
}

/** Elige un XFDF, lo importa con addAnnotations('importar comentarios', …) y avisa del resultado. */
export async function importComments(): Promise<'imported' | 'cancelled' | 'failed'> {
  const { pdf } = useViewer.getState();
  if (pdf === null) return 'failed';

  const picked = await services().platform.importFile(XFDF_FILTERS, MAX_XFDF_BYTES);
  if (!picked.ok) {
    log.warn('importFile', picked.error.code);
    showNotice(picked.error.code === 'out-of-range' ? commentsMsg.tooLarge : picked.error.message);
    return 'failed';
  }
  if (picked.value === null) return 'cancelled';

  const text = new TextDecoder('utf-8').decode(picked.value.bytes);
  const state = useAnnotations.getState();
  const existingIds = new Set<string>([...state.baseline.keys(), ...state.edits.upserts.keys(), ...state.edits.removed]);
  const result = importXfdf(text, {
    existingIds,
    pageCount: pdf.numPages,
    newId: newAnnotationId,
    now: nowIso(),
    author: state.author,
  });
  if (!result.ok) {
    showNotice(result.error.message);
    return 'failed';
  }

  addAnnotations('importar comentarios', result.value.annotations);
  showNotice(commentsMsg.imported(result.value.annotations.length, result.value.skipped, result.value.duplicates));
  showSidebarTab('comments');
  return 'imported';
}
