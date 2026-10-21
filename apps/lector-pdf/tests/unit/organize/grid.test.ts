import { describe, expect, it } from 'vitest';
import {
  fitBox,
  GRID_GAP,
  GRID_LABEL,
  GRID_MAX_MOUNTED_ROWS,
  gridMetrics,
  insertionIndex,
  neighbour,
  ORGANIZE_CELL_SIZES,
  visibleCells,
  type GridKey,
} from '../../../src/core/organize/grid';

describe('gridMetrics', () => {
  it('reparte las columnas según el ancho del viewport (hueco 16 px) y calcula filas y alturas', () => {
    // (600 + 16) / (120 + 16) = 4,5 → 4 columnas; 5 huecos → 2 filas.
    const m = gridMetrics(600, 5, 120);
    expect(m).toEqual({ columns: 4, cell: 120, gap: GRID_GAP, rowHeight: 180 + GRID_LABEL + GRID_GAP, rows: 2 });
  });

  it('siempre tiene al menos una columna, aunque el viewport sea estrecho o no tenga ancho', () => {
    expect(gridMetrics(0, 3, 180).columns).toBe(1);
    expect(gridMetrics(Number.NaN, 3, 180).columns).toBe(1);
    expect(gridMetrics(100, 3, 180).columns).toBe(1);
  });

  it('cuenta una columna más exactamente cuando cabe el hueco entre celdas', () => {
    // Dos columnas de 180 px con hueco de 16 px ocupan 376 px.
    expect(gridMetrics(2 * 180 + GRID_GAP, 10, 180).columns).toBe(2);
    expect(gridMetrics(2 * 180 + GRID_GAP - 1, 10, 180).columns).toBe(1);
  });

  it('sin páginas no hay filas, y la última fila incompleta cuenta como fila', () => {
    expect(gridMetrics(600, 0, 120).rows).toBe(0);
    expect(gridMetrics(600, 4, 120).rows).toBe(1);
    expect(gridMetrics(600, 5, 120).rows).toBe(2);
  });

  it('con 100 000 huecos calcula las filas sin recorrerlos', () => {
    const m = gridMetrics(1000, 100_000, 240);
    expect(m.columns).toBe(3);
    expect(m.rows).toBe(33_334);
  });

  it('rechaza un ancho de celda no válido', () => {
    expect(() => gridMetrics(600, 5, 0)).toThrow(RangeError);
    expect(() => gridMetrics(600, 5, Number.NaN)).toThrow(RangeError);
  });

  it('los tamaños que ofrece la barra son 120, 180 y 240 px', () => {
    expect([...ORGANIZE_CELL_SIZES]).toEqual([120, 180, 240]);
  });
});

describe('visibleCells', () => {
  // 4 columnas, 2 filas de 220 px.
  const m = gridMetrics(600, 5, 120);

  it('en la primera vista monta la primera fila, y con margen de 0 filas solo esa', () => {
    expect(visibleCells(m, 0, 200, 0)).toEqual({ first: 0, last: 3 });
  });

  it('con margen de 2 filas monta las filas vecinas (la última fila puede pasar del último hueco)', () => {
    expect(visibleCells(m, 0, 200, 2)).toEqual({ first: 0, last: 7 });
  });

  it('desde la segunda fila visible empieza en el primer hueco de esa fila', () => {
    expect(visibleCells(m, 220, 200, 0)).toEqual({ first: 4, last: 7 });
  });

  it('una franja que cruza dos filas las monta a las dos', () => {
    expect(visibleCells(m, 200, 100, 0)).toEqual({ first: 0, last: 7 });
  });

  it('con un viewport de ~4 filas y margen grande, no monta más de 12 filas de celdas', () => {
    const tall = gridMetrics(100, 1000, 120); // 1 columna, filas de 220 px
    const range = visibleCells(tall, 0, 1000, 20); // visibles 0..4; margen de 20 recortado
    expect(range.first).toBe(0);
    expect(range.last).toBe(GRID_MAX_MOUNTED_ROWS - 1);
  });

  it('el tope recorta el margen y nunca una fila visible (ventana de ~10 filas, margen 4)', () => {
    // 1 columna, filas de 220 px; ventana de 2000 px en scroll 0 → filas 0..9 visibles (la 9 ocupa 1980-2200).
    const oneColumn = gridMetrics(100, 1000, 120);
    const range = visibleCells(oneColumn, 0, 2000, 4);
    // Visibles 0..9 (10 filas) + margen por abajo recortado a 2 filas → 0..11.
    expect(range).toEqual({ first: 0, last: 11 });
  });

  it('monta todas las filas visibles aunque el viewport muestre más filas que el tope', () => {
    const oneColumn = gridMetrics(100, 1000, 120);
    // 20 filas visibles (0..19): no se puede bajar del viewport, así que se montan todas.
    const range = visibleCells(oneColumn, 0, 20 * oneColumn.rowHeight, 2);
    expect(range).toEqual({ first: 0, last: 19 });
  });

  it('con el scroll al final el tope recorta el margen de arriba y deja visibles las últimas filas', () => {
    const oneColumn = gridMetrics(100, 30, 120); // 30 filas
    const top = 25 * oneColumn.rowHeight; // fila 25 es la primera visible
    const range = visibleCells(oneColumn, top, oneColumn.rowHeight * 2, 4); // visibles 25..26
    // Margen: 21..29 (9 filas) ≤ 12, sin recortar.
    expect(range).toEqual({ first: 21, last: 29 });
    const longer = visibleCells(oneColumn, 10 * oneColumn.rowHeight, oneColumn.rowHeight * 3, 10);
    // Visibles 10..12; margen 0..22 (23 filas) se recorta a 12: 10 filas de margen arriba, 1 abajo → 10..21.
    expect(longer).toEqual({ first: 10, last: 21 });
  });

  it('sin filas no devuelve celdas', () => {
    expect(visibleCells(gridMetrics(600, 0, 120), 0, 600, 2)).toEqual({ first: 0, last: -1 });
  });

  it('un scroll negativo o no finito se trata como el principio', () => {
    expect(visibleCells(m, -50, 200, 0)).toEqual({ first: 0, last: 3 });
    expect(visibleCells(m, Number.NaN, 200, 0)).toEqual({ first: 0, last: 3 });
  });
});

describe('neighbour', () => {
  // 4 columnas, 5 huecos: fila 0 = 0..3, fila 1 = 4 (incompleta).
  const m = gridMetrics(600, 5, 120);
  const at = (index: number, key: GridKey, pageRows = 1): number => neighbour(m, 5, index, key, pageRows);

  it('las flechas laterales no pasan de los bordes', () => {
    expect(at(0, 'ArrowLeft')).toBe(0);
    expect(at(2, 'ArrowLeft')).toBe(1);
    expect(at(3, 'ArrowRight')).toBe(4);
    expect(at(4, 'ArrowRight')).toBe(4);
  });

  it('Arriba y Abajo mantienen la columna', () => {
    expect(at(4, 'ArrowUp')).toBe(0);
    expect(at(1, 'ArrowUp')).toBe(1);
    expect(at(0, 'ArrowDown')).toBe(4);
  });

  it('Abajo desde una columna que la última fila incompleta no tiene va al último hueco', () => {
    expect(at(2, 'ArrowDown')).toBe(4);
    // Ya en la última fila no hay nada debajo: se queda donde está.
    expect(at(4, 'ArrowDown')).toBe(4);
    expect(at(3, 'ArrowDown')).toBe(4);
  });

  it('Inicio y Fin van al primero y al último', () => {
    expect(at(3, 'Home')).toBe(0);
    expect(at(0, 'End')).toBe(4);
  });

  it('RePág y AvPág avanzan el número de filas de la página', () => {
    expect(neighbour(m, 5, 0, 'PageDown', 1)).toBe(4);
    expect(neighbour(m, 5, 4, 'PageUp', 1)).toBe(0);
    expect(neighbour(gridMetrics(100, 10, 60), 10, 0, 'PageDown', 3)).toBe(3);
    expect(neighbour(gridMetrics(100, 10, 60), 10, 9, 'PageUp', 3)).toBe(6);
    expect(neighbour(gridMetrics(100, 10, 60), 10, 2, 'PageUp', 5)).toBe(0);
  });

  it('con una sola columna, Arriba y Abajo son de un hueco en un hueco', () => {
    const one = gridMetrics(100, 3, 180);
    expect(neighbour(one, 3, 0, 'ArrowDown', 1)).toBe(1);
    expect(neighbour(one, 3, 1, 'ArrowUp', 1)).toBe(0);
    expect(neighbour(one, 3, 0, 'ArrowUp', 1)).toBe(0);
    expect(neighbour(one, 3, 2, 'ArrowDown', 1)).toBe(2);
  });

  it('sin huecos devuelve 0 y acota un índice fuera de rango', () => {
    expect(neighbour(gridMetrics(600, 0, 120), 0, 0, 'End', 1)).toBe(0);
    expect(neighbour(m, 5, 99, 'ArrowLeft', 1)).toBe(3);
  });
});

describe('fitBox', () => {
  it('ajusta una página horizontal al ancho de la celda', () => {
    // 200×100 pt en una celda de 100 px: escala 0,5.
    expect(fitBox(100, 200, 100)).toEqual({ width: 100, height: 50 });
  });

  it('ajusta una página vertical a la altura máxima (1,5 veces el ancho de la celda)', () => {
    const box = fitBox(100, 100, 400);
    expect(box.height).toBeCloseTo(150, 6);
    expect(box.width).toBeCloseTo(37.5, 6);
  });

  it('una medida no válida da una caja vacía', () => {
    expect(fitBox(100, 0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitBox(100, Number.NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('insertionIndex', () => {
  // 3 columnas de 180 px con hueco de 16 px (paso 196); filas de 310 px. 7 huecos: filas de 3, 3 y 1.
  const m = gridMetrics(3 * 180 + 2 * GRID_GAP, 7, 180);
  const ROW = 310;
  const PITCH = 196;

  it('calcula las columnas y filas de la cuadrícula de prueba', () => {
    expect(m.columns).toBe(3);
    expect(m.rowHeight).toBe(ROW);
  });

  it('mitad izquierda de una celda inserta antes; mitad derecha, después', () => {
    expect(insertionIndex(m, 7, 10, 10)).toBe(0);
    expect(insertionIndex(m, 7, 89, 10)).toBe(0);
    expect(insertionIndex(m, 7, 91, 10)).toBe(1);
    expect(insertionIndex(m, 7, 170, 10)).toBe(1);
    expect(insertionIndex(m, 7, PITCH + 10, 10)).toBe(1);
    expect(insertionIndex(m, 7, 2 * PITCH + 170, 10)).toBe(3);
  });

  it('en la siguiente fila cuenta desde su primera celda', () => {
    expect(insertionIndex(m, 7, 10, ROW + 10)).toBe(3);
    expect(insertionIndex(m, 7, PITCH + 170, ROW + 10)).toBe(5);
  });

  it('antes de la primera columna o en el hueco entre celdas se trata como borde', () => {
    expect(insertionIndex(m, 7, -50, 10)).toBe(0);
    expect(insertionIndex(m, 7, 180, 10)).toBe(1);
  });

  it('por debajo de la última fila devuelve count', () => {
    expect(insertionIndex(m, 7, 10, 3 * ROW)).toBe(7);
    expect(insertionIndex(m, 7, 10, 10_000)).toBe(7);
  });

  it('en una fila incompleta, el hueco vacío y el lado derecho de la última celda dan count', () => {
    expect(insertionIndex(m, 7, 10, 2 * ROW + 10)).toBe(6);
    expect(insertionIndex(m, 7, 170, 2 * ROW + 10)).toBe(7);
    expect(insertionIndex(m, 7, PITCH + 10, 2 * ROW + 10)).toBe(7);
    expect(insertionIndex(m, 7, 2 * PITCH + 10, 2 * ROW + 10)).toBe(7);
  });

  it('sin huecos o con coordenadas no finitas devuelve count o 0', () => {
    expect(insertionIndex(m, 0, 10, 10)).toBe(0);
    expect(insertionIndex(m, 7, Number.NaN, 10)).toBe(7);
    expect(insertionIndex(m, 7, 10, Number.POSITIVE_INFINITY)).toBe(7);
  });
});
