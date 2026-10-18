/**
 * Simplificación de trazos a mano alzada (PDF-035): Ramer-Douglas-Peucker sobre `[x0, y0, x1, y1, ...]`.
 * Iterativo con pila explícita: un trazo de cientos de miles de puntos no desborda la pila de llamadas.
 */

/**
 * Devuelve un trazo con un subconjunto de sus puntos, de forma que ningún punto descartado quede a más de
 * `tolerance` del trazo simplificado. Conserva siempre el primero y el último. Entrada con 0 o 1 punto: se copia tal cual.
 */
export function simplifyPath(points: readonly number[], tolerance: number): number[] {
  const count = Math.floor(points.length / 2);
  if (count <= 2) return points.slice(0, count * 2);

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  // Pares [primero, último] de los tramos pendientes, en orden de pila.
  const stack: number[] = [0, count - 1];
  while (stack.length > 0) {
    const last = stack.pop() ?? 0;
    const first = stack.pop() ?? 0;
    const split = farthestIndex(points, first, last);
    if (split.index === -1 || split.distance <= tolerance) continue;
    keep[split.index] = 1;
    stack.push(first, split.index, split.index, last);
  }

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i] === 1) out.push(points[2 * i] ?? 0, points[2 * i + 1] ?? 0);
  }
  return out;
}

/** Punto interior de `(first, last)` más alejado del segmento `first`-`last`; `index` es -1 si no hay interiores. */
function farthestIndex(points: readonly number[], first: number, last: number): { index: number; distance: number } {
  const x1 = points[2 * first] ?? 0;
  const y1 = points[2 * first + 1] ?? 0;
  const x2 = points[2 * last] ?? 0;
  const y2 = points[2 * last + 1] ?? 0;
  let index = -1;
  let distance = -1;
  for (let i = first + 1; i < last; i++) {
    const d = distanceToSegment(points[2 * i] ?? 0, points[2 * i + 1] ?? 0, x1, y1, x2, y2);
    if (d > distance) {
      distance = d;
      index = i;
    }
  }
  return { index, distance };
}

/** Distancia de (px, py) al segmento (x1, y1)-(x2, y2). Si el segmento es un punto, la distancia a ese punto. */
function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
