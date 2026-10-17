import { assertRotation, type Rotation } from './rotation';

/**
 * Tabla de dimensiones de página en puntos PDF (sin rotar, ya multiplicadas por UserUnit).
 * Guarda todo en arrays tipados: un millón de páginas ocupa unos 13 MB.
 * Las páginas nacen "no conocidas" salvo que la tabla se cree con `uniform`.
 */
export class PageDimsTable {
  readonly count: number;
  private readonly widths: Float32Array;
  private readonly heights: Float32Array;
  private readonly rotations: Uint16Array;
  private readonly known: Uint8Array;
  private ver = 0;

  /** Tabla de `count` páginas sin conocer (tamaño 0 hasta que se llame a `set`). */
  constructor(count: number) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`Número de páginas no válido: ${count}`);
    }
    this.count = count;
    this.widths = new Float32Array(count);
    this.heights = new Float32Array(count);
    this.rotations = new Uint16Array(count);
    this.known = new Uint8Array(count);
  }

  /** Tabla con todas las páginas del mismo tamaño, marcadas como conocidas. */
  static uniform(count: number, width: number, height: number, rotation: Rotation): PageDimsTable {
    assertSize(width);
    assertSize(height);
    assertRotation(rotation);
    const table = new PageDimsTable(count);
    table.widths.fill(Math.fround(width));
    table.heights.fill(Math.fround(height));
    table.rotations.fill(rotation);
    table.known.fill(1);
    return table;
  }

  /** Se incrementa en cada `set` que cambia algo. */
  get version(): number {
    return this.ver;
  }

  width(i: number): number {
    return slot(this.widths, i);
  }

  height(i: number): number {
    return slot(this.heights, i);
  }

  rotation(i: number): Rotation {
    const value = slot(this.rotations, i);
    assertRotation(value);
    return value;
  }

  isKnown(i: number): boolean {
    return slot(this.known, i) === 1;
  }

  /** Guarda las dimensiones de la página `i` y la marca como conocida. Devuelve `true` si cambió algo. */
  set(i: number, width: number, height: number, rotation: Rotation): boolean {
    assertSize(width);
    assertSize(height);
    assertRotation(rotation);
    // Se compara con la precisión de almacenamiento (float32) para que un valor repetido no cuente como cambio.
    const w = Math.fround(width);
    const h = Math.fround(height);
    const changed =
      slot(this.known, i) !== 1 ||
      slot(this.widths, i) !== w ||
      slot(this.heights, i) !== h ||
      slot(this.rotations, i) !== rotation;
    if (!changed) return false;
    this.widths[i] = w;
    this.heights[i] = h;
    this.rotations[i] = rotation;
    this.known[i] = 1;
    this.ver += 1;
    return true;
  }
}

function assertSize(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Tamaño de página no válido: ${value}`);
}

/** Lee una posición de un array tipado; un índice fuera de rango es un bug del llamante. */
function slot(arr: ArrayLike<number>, i: number): number {
  const value = arr[i];
  if (value === undefined) throw new RangeError(`Página fuera de rango: ${i}`);
  return value;
}
