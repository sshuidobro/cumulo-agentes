import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { OpenedFile } from '@suite/platform';
import { createLogger, type Result } from '@suite/shared';
import { CompareSession, type CompareProgress, type PageComparison } from '../core/compare/compare';
import { loadPdf, type LoadedPdf } from '../engine';
import { createPageTextSource } from '../engine/search-source';
import { PDF_FILTERS } from './document-actions';
import { askPassword, cancelPassword } from './password-prompt';
import { showNotice } from './notice';
import { services } from './services';
import { useViewer } from './viewer-store';

const log = createLogger('compare-actions');

/** Cada cuánto, como mucho, se añaden resultados al estado (un `setState` por lote). */
const RESULTS_BATCH_MS = 100;

export type CompareStatus = 'idle' | 'loading' | 'running' | 'done';

export interface CompareState {
  readonly status: CompareStatus;
  readonly otherName: string | null;
  /** Solo páginas que no son `same`, en orden. */
  readonly results: readonly PageComparison[];
  readonly progress: CompareProgress | null;
  /** Índice en `results`. */
  readonly selected: number | null;
  readonly cancelled: boolean;
}

/** Resultado de `startCompare`. */
export type CompareOutcome = 'started' | 'cancelled' | 'failed';

const IDLE: CompareState = { status: 'idle', otherName: null, results: [], progress: null, selected: null, cancelled: false };

/** Estado de la comparación. Lo leen la vista de comparación y el menú. */
export const useCompare: UseBoundStore<StoreApi<CompareState>> = create<CompareState>()(() => IDLE);

/** Comparación en curso (o cargando el segundo PDF). Solo puede haber una. */
interface Run {
  /** Aborta la carga del segundo PDF. */
  readonly controller: AbortController;
  /** Segundo PDF tal como lo entrega la plataforma; se cierra al liberar la comparación. */
  readonly file: OpenedFile;
  /** Segundo documento ya cargado (lo usa PDF-117). */
  pdf: LoadedPdf | null;
  session: CompareSession | null;
  pending: PageComparison[];
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

let run: Run | null = null;

function isCurrent(r: Run): boolean {
  return run === r && !r.closed;
}

/**
 * Elige el segundo PDF, lo abre (pide contraseña si hace falta) y lanza la comparación con el documento abierto.
 * Los errores al abrirlo se avisan; cancelar el selector o la contraseña no avisa.
 */
export async function startCompare(): Promise<CompareOutcome> {
  const viewer = useViewer.getState();
  const aPdf = viewer.pdf;
  if (run !== null || viewer.status !== 'ready' || aPdf === null) return 'failed';

  const picked = await services().platform.openFile(PDF_FILTERS);
  if (!picked.ok) {
    showNotice(picked.error.message);
    return 'failed';
  }
  const file = picked.value;
  if (file === null) return 'cancelled';
  if (run !== null) {
    await closeOpened(file);
    return 'failed';
  }

  const current: Run = { controller: new AbortController(), file, pdf: null, session: null, pending: [], timer: null, closed: false };
  run = current;
  useCompare.setState({ ...IDLE, status: 'loading', otherName: file.name });

  const loaded = await loadOther(current);
  if (!isCurrent(current)) return 'cancelled';
  if (loaded === 'cancelled') {
    await endRun(current);
    return 'cancelled';
  }
  if (!loaded.ok) {
    await endRun(current);
    showNotice(loaded.error.message);
    return 'failed';
  }
  // Si el documento abierto ha cambiado mientras se cargaba, esta comparación ya no vale.
  if (useViewer.getState().pdf !== aPdf) {
    await loaded.value.destroy();
    await endRun(current);
    return 'cancelled';
  }

  const other = loaded.value;
  current.pdf = other;
  const total = Math.max(aPdf.numPages, other.numPages);
  useCompare.setState({ status: 'running', progress: { pagesDone: 0, totalPages: total, changedPages: 0 } });
  current.session = new CompareSession(
    { numPages: aPdf.numPages, source: createPageTextSource(aPdf.doc) },
    { numPages: other.numPages, source: createPageTextSource(other.doc) },
    {
      onPage: (result) => { addResult(current, result); },
      onProgress: (progress) => {
        if (isCurrent(current)) useCompare.setState({ progress });
      },
      onDone: ({ cancelled, ...progress }) => { finishRun(current, progress, cancelled); },
    },
  );
  current.session.start();
  return 'started';
}

/**
 * Carga el segundo PDF. Pide la contraseña con `askPassword` si hace falta (nunca se guarda).
 * Devuelve `'cancelled'` si el usuario cancela la contraseña o la comparación se cierra mientras carga.
 */
async function loadOther(current: Run): Promise<Result<LoadedPdf> | 'cancelled'> {
  const { assetBaseUrl } = services();
  let password: string | undefined;
  for (;;) {
    const result = await loadPdf(current.file.source, {
      assetBaseUrl,
      signal: current.controller.signal,
      ...(password === undefined ? {} : { password }),
    });
    if (current.closed) {
      if (result.ok) await result.value.destroy();
      return 'cancelled';
    }
    if (result.ok) return result;
    if (result.error.code !== 'password-required' && result.error.code !== 'password-incorrect') return result;

    const entered = await askPassword(current.file.name, result.error.code === 'password-incorrect');
    if (current.closed || entered === null) return 'cancelled';
    password = entered;
  }
}

/** Cancela la comparación en curso. Los resultados parciales se conservan con `cancelled: true`. */
export function cancelCompare(): void {
  const r = run;
  if (r === null) return;
  // Mientras se carga el segundo PDF no hay comparación que parar: se cierra.
  if (useCompare.getState().status === 'loading') {
    void closeCompare();
    return;
  }
  r.session?.cancel();
}

/** Selecciona un cambio de la lista. Un índice fuera de `results` no hace nada. */
export function selectChange(index: number): void {
  const { results } = useCompare.getState();
  if (!Number.isInteger(index) || index < 0 || index >= results.length) return;
  useCompare.setState({ selected: index });
}

/** Cierra la comparación: cancela, destruye el segundo documento, cierra su fichero y vuelve a `idle`. */
export async function closeCompare(): Promise<void> {
  const r = run;
  if (useCompare.getState().status === 'loading') cancelPassword();
  if (r !== null) await endRun(r);
  useCompare.setState(IDLE);
}

/** Documento B cargado (lo usa PDF-117 para pintar sus páginas). `null` fuera de una comparación. */
export function comparedDocument(): LoadedPdf | null {
  return run?.pdf ?? null;
}

/** Quita la comparación del estado del módulo y libera sus recursos. */
async function endRun(r: Run): Promise<void> {
  if (run === r) run = null;
  await release(r);
  if (run === null) useCompare.setState(IDLE);
}

/** Libera una comparación una sola vez: detiene la sesión y la carga, destruye B y cierra su fichero. */
async function release(r: Run): Promise<void> {
  if (r.closed) return;
  r.closed = true;
  if (r.timer !== null) clearTimeout(r.timer);
  r.timer = null;
  r.pending.length = 0;
  r.controller.abort();
  r.session?.cancel();
  const pdf = r.pdf;
  r.pdf = null;
  if (pdf !== null) await pdf.destroy();
  await closeOpened(r.file);
}

async function closeOpened(file: OpenedFile): Promise<void> {
  try {
    await services().platform.closeFile(file);
  } catch (cause) {
    log.warn('closeFile', cause);
  }
}

/** Acumula un resultado; se publica como mucho cada `RESULTS_BATCH_MS`. */
function addResult(r: Run, result: PageComparison): void {
  if (!isCurrent(r)) return;
  r.pending.push(result);
  r.timer ??= setTimeout(() => { flush(r); }, RESULTS_BATCH_MS);
}

function flush(r: Run): void {
  if (r.timer !== null) clearTimeout(r.timer);
  r.timer = null;
  if (!isCurrent(r) || r.pending.length === 0) return;
  const batch = r.pending.splice(0);
  useCompare.setState((state) => ({ results: [...state.results, ...batch] }));
}

function finishRun(r: Run, progress: CompareProgress, cancelled: boolean): void {
  if (!isCurrent(r)) return;
  flush(r);
  useCompare.setState({ status: 'done', progress, cancelled });
}

/** Cambios que cuenta el resumen: cada cambio de una página; una página «muy distinta» o solo en un lado cuenta como uno. */
export function countChanges(results: readonly PageComparison[]): number {
  return results.reduce((n, r) => n + (r.kind === 'changed' ? r.changes.length : 1), 0);
}

/** Se cierra la comparación si cambia el documento abierto. */
useViewer.subscribe((state, previous) => {
  if (state.file === previous.file) return;
  if (useCompare.getState().status === 'idle') return;
  void closeCompare();
});
