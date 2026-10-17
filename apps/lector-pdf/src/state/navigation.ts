import { useViewer } from './viewer-store';

let lastSeq = 0;

/**
 * Pide al visor ir a una página (se acota a [0, último]) con una posición opcional dentro de ella.
 * Sin documento con dimensiones no hace nada.
 */
export function goToPage(page: number, opts?: { readonly yFraction?: number; readonly xFraction?: number }): void {
  const dims = useViewer.getState().dims;
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
  });
}

/** Página actual del visor. Solo escribe si cambia, para no re-renderizar en cada scroll. */
export function setCurrentPage(page: number): void {
  if (useViewer.getState().currentPage !== page) useViewer.setState({ currentPage: page });
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
