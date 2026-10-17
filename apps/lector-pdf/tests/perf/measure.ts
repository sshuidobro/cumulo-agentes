export interface Measurement<T> {
  readonly value: T;
  readonly ms: number;
}

export interface MeasureOptions {
  readonly warmup?: number;
  readonly runs?: number;
}

function timed<T>(fn: () => T): Measurement<T> {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

/**
 * Ejecuta `fn` `warmup` veces sin medir (por defecto 1) y luego `runs` veces (por defecto 5).
 * Devuelve el valor de la última pasada y el tiempo mínimo de las pasadas medidas.
 * El calentamiento descarta el coste de JIT y el mínimo descarta el ruido del sistema:
 * el presupuesto no cambia, solo se mide en condiciones limpias (ADR-0012).
 */
export function measureBest<T>(fn: () => T, opts: MeasureOptions = {}): Measurement<T> {
  const warmup = opts.warmup ?? 1;
  const runs = opts.runs ?? 5;
  if (!(runs >= 1) || !(warmup >= 0)) {
    throw new RangeError(`measureBest: se requiere runs >= 1 y warmup >= 0 (runs=${runs}, warmup=${warmup})`);
  }
  for (let w = 0; w < warmup; w++) fn();
  let last = timed(fn);
  let best = last.ms;
  for (let r = 1; r < runs; r++) {
    last = timed(fn);
    if (last.ms < best) best = last.ms;
  }
  return { value: last.value, ms: best };
}
