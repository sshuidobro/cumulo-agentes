/** Rotación de 90° en 90°, en grados. */
export type Rotation = 0 | 90 | 180 | 270;

/** Lanza `RangeError` si el valor no es una rotación válida (un bug del llamante). */
export function assertRotation(value: number): asserts value is Rotation {
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    throw new RangeError(`Rotación no válida: ${value}`);
  }
}

/** Múltiplo de 90 más cercano, módulo 360 (admite negativos: -90 → 270, 450 → 90). */
export function normalizeRotation(deg: number): Rotation {
  if (!Number.isFinite(deg)) throw new RangeError(`Rotación no válida: ${deg}`);
  const quarter = ((Math.round(deg / 90) % 4) + 4) % 4;
  switch (quarter) {
    case 1:
      return 90;
    case 2:
      return 180;
    case 3:
      return 270;
    default:
      return 0;
  }
}
