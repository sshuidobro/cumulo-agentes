/**
 * Índice del cambio al que lleva un paso (`delta` = 1 siguiente, -1 anterior) desde `current`, limitado a la lista.
 * Sin selección, el primer paso hacia delante va al primero y hacia atrás al último. `null` si la lista está vacía.
 */
export function nextChangeIndex(current: number | null, count: number, delta: 1 | -1): number | null {
  if (count <= 0) return null;
  const base = current ?? (delta > 0 ? -1 : count);
  return Math.min(Math.max(base + delta, 0), count - 1);
}
