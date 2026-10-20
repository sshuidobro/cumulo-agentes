/**
 * Geometría y navegación de la cuadrícula de «Organizar páginas» (PDF-125). Funciones puras: sin DOM ni React.
 * Las celdas van en filas de `columns` huecos; cada fila mide `rowHeight` px CSS (caja de la miniatura + etiqueta + hueco).
 */

/** Hueco entre celdas, en px CSS (horizontal y vertical). */
export const GRID_GAP = 16;
/** Altura reservada para la etiqueta bajo la miniatura, en px CSS. */
export const GRID_LABEL = 24;
/** Altura máxima de la caja de una miniatura, como múltiplo de su ancho (cubre páginas en vertical). */
export const GRID_MAX_ASPECT = 1.5;
/** Máximo de filas de celdas montadas a la vez (las visibles más el margen). */
export const GRID_MAX_MOUNTED_ROWS = 12;

/** Anchos de miniatura que ofrece la barra, en px CSS. */
export const ORGANIZE_CELL_SIZES = [120, 180, 240] as const;

export interface GridMetrics {
  readonly columns: number;
  readonly cell: number;
  readonly gap: number;
  readonly rowHeight: number;
  readonly rows: number;
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

/**
 * Columnas, filas y alturas para `count` huecos de `cell` px de ancho en un viewport de `viewportWidth` px.
 * Siempre hay al menos una columna.
 */
export function gridMetrics(viewportWidth: number, count: number, cell: number): GridMetrics {
  if (!Number.isFinite(cell) || cell <= 0) throw new RangeError(`Ancho de celda no válido: ${String(cell)}`);
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const columns = Math.max(1, Math.floor((width + GRID_GAP) / (cell + GRID_GAP)));
  const rows = count > 0 ? Math.ceil(count / columns) : 0;
  const rowHeight = Math.round(cell * GRID_MAX_ASPECT) + GRID_LABEL + GRID_GAP;
  return { columns, cell, gap: GRID_GAP, rowHeight, rows };
}

/**
 * Índices (inclusive) de las celdas que deben estar montadas: las filas que tocan la franja visible del scroll,
 * más `overscanRows` filas a cada lado y como mucho `GRID_MAX_MOUNTED_ROWS` filas.
 * `last` puede pasar del último hueco en la última fila incompleta: el llamador lo recorta a `count - 1`.
 * Sin filas devuelve `{ first: 0, last: -1 }`.
 */
export function visibleCells(
  m: GridMetrics,
  scrollTop: number,
  viewportHeight: number,
  overscanRows: number,
): { readonly first: number; readonly last: number } {
  if (m.rows === 0) return { first: 0, last: -1 };
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const height = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const overscan = Math.max(0, Math.floor(overscanRows));
  const bottom = top + height;
  const firstVisibleRow = Math.floor(top / m.rowHeight);
  const lastVisibleRow = Math.floor(Math.max(bottom - 1, top) / m.rowHeight);
  const firstRow = Math.min(Math.max(firstVisibleRow - overscan, 0), m.rows - 1);
  const lastRow = Math.min(
    Math.min(lastVisibleRow + overscan, m.rows - 1),
    firstRow + GRID_MAX_MOUNTED_ROWS - 1,
  );
  return { first: firstRow * m.columns, last: (lastRow + 1) * m.columns - 1 };
}

/**
 * Índice del hueco que recibe el foco tras pulsar `key` desde `index`, con `count` huecos.
 * Flechas: sin pasar de los bordes; Arriba/Abajo mantienen la columna (Abajo, si la fila siguiente no tiene
 * esa columna, va al último hueco). Inicio/Fin: primero/último. RePág/AvPág: `pageRows` filas.
 */
export function neighbour(m: GridMetrics, count: number, index: number, key: GridKey, pageRows: number): number {
  if (count <= 0) return 0;
  const last = count - 1;
  const current = Math.min(Math.max(Math.floor(index), 0), last);
  const cols = Math.max(1, m.columns);
  const rowsPerPage = Math.max(1, Math.floor(pageRows));
  switch (key) {
    case 'ArrowLeft':
      return Math.max(current - 1, 0);
    case 'ArrowRight':
      return Math.min(current + 1, last);
    case 'ArrowUp':
      return current - cols >= 0 ? current - cols : current;
    case 'ArrowDown': {
      const below = current + cols;
      if (below <= last) return below;
      return Math.floor(current / cols) < Math.floor(last / cols) ? last : current;
    }
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'PageUp':
      return Math.max(current - rowsPerPage * cols, 0);
    case 'PageDown':
      return Math.min(current + rowsPerPage * cols, last);
  }
}

/**
 * Caja de una miniatura de `width`×`height` puntos ajustada dentro de `cell` × `cell × GRID_MAX_ASPECT` px,
 * con su proporción. Las medidas no válidas dan una caja vacía.
 */
export function fitBox(cell: number, width: number, height: number): { readonly width: number; readonly height: number } {
  if (!(width > 0) || !(height > 0) || !(cell > 0)) return { width: 0, height: 0 };
  const scale = Math.min(cell / width, (cell * GRID_MAX_ASPECT) / height);
  return { width: width * scale, height: height * scale };
}
