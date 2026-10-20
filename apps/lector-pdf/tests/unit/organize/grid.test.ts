import { describe, expect, it } from 'vitest';
import {
  fitBox,
  GRID_GAP,
  GRID_LABEL,
  GRID_MAX_MOUNTED_ROWS,
  gridMetrics,
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

  it('nunca monta más de 12 filas de celdas', () => {
    const tall = gridMetrics(100, 1000, 120); // 1 columna
    const range = visibleCells(tall, 0, 100_000, 2);
    expect(range.first).toBe(0);
    expect(range.last).toBe(GRID_MAX_MOUNTED_ROWS - 1);
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
