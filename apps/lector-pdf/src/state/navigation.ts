import { rowFirstPage, stepRow } from '../core/view-mode';
import { useViewer } from './viewer-store';

let lastSeq = 0;

/**
 * Pide al visor ir a una página (se acota a [0, último]) con una posición opcional dentro de ella.
 * Sin documento con dimensiones no hace nada.
 */
export function goToPage(page: number, opts?: { readonly yFraction?: number; readonly xFraction?: number }): void {
  const { dims, viewMode } = useViewer.getState();
  if (dims === null || dims.count === 0) return;
  if (!Number.isFinite(page)) throw new RangeError(`Página no válida: ${page}`);
  const target = Math.min(Math.max(Math.trunc(page), 0), dims.count - 1);
  lastSeq += 1;
  useViewer.setState({
    navRequest: {
      seq: lastSeq,
      page: target,
      yFraction: clamp01(opts?.yFraction ?? 0),
      xFraction: opts?.xFraction === undefined ? null : clamp01(opts.xFraction),
    },
    // En modo por páginas la fila de la página pedida pasa a ser la mostrada en el mismo cambio de estado.
    ...(viewMode.scroll === 'paged' ? { currentPage: rowFirstPage(target, viewMode.spread) } : {}),
  });
}

/** Página actual del visor. Solo escribe si cambia, para no re-renderizar en cada scroll. */
export function setCurrentPage(page: number): void {
  if (useViewer.getState().currentPage !== page) useViewer.setState({ currentPage: page });
}

/** Posición vertical dentro de la página actual. Solo escribe si cambia más de 0,01, para no re-renderizar en cada scroll. */
export function setCurrentYFraction(yFraction: number): void {
  const current = useViewer.getState().currentYFraction;
  if (Math.abs(current - yFraction) > 0.01) useViewer.setState({ currentYFraction: yFraction });
}

/** Va a la primera página de la fila siguiente (según el modo de vista). En la última no hace nada. */
export function nextPage(): void {
  const { currentPage, dims, viewMode } = useViewer.getState();
  if (dims === null) return;
  const target = stepRow(currentPage, 1, viewMode.spread, dims.count);
  if (target !== null) goToPage(target);
}

/** Va a la primera página de la fila anterior (según el modo de vista). En la primera no hace nada. */
export function prevPage(): void {
  const { currentPage, dims, viewMode } = useViewer.getState();
  if (dims === null) return;
  const target = stepRow(currentPage, -1, viewMode.spread, dims.count);
  if (target !== null) goToPage(target);
}

/** Va a la primera página. */
export function firstPage(): void {
  goToPage(0);
}

/** Va a la primera página de la última fila. */
export function lastPage(): void {
  const dims = useViewer.getState().dims;
  if (dims === null || dims.count === 0) return;
  goToPage(rowFirstPage(dims.count - 1, useViewer.getState().viewMode.spread));
}

/** Actualiza si el contenido es más ancho que el visor. Solo escribe si cambia. */
export function setHorizontalOverflow(overflow: boolean): void {
  if (useViewer.getState().hasHorizontalOverflow !== overflow) useViewer.setState({ hasHorizontalOverflow: overflow });
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
