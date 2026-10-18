import { cpus } from 'node:os';

export interface CpuTimes { readonly user: number; readonly nice: number; readonly sys: number; readonly idle: number; readonly irq: number }
/** Tiempos acumulados de todos los núcleos (ms). */
export interface CpuSample { readonly idle: number; readonly total: number }

/** Suma los tiempos de todos los núcleos. Por defecto, los de `os.cpus()`. */
export function cpuSample(cores: readonly { readonly times: CpuTimes }[] = cpus()): CpuSample {
  let idle = 0;
  let total = 0;
  for (const { times } of cores) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** Fracción ocupada (0-1) de toda la máquina entre dos muestras: 1 − Δidle/Δtotal, recortada a [0, 1]. Δtotal ≤ 0 → 0. */
export function busyFraction(a: CpuSample, b: CpuSample): number {
  const dTotal = b.total - a.total;
  if (dTotal <= 0) return 0;
  const busy = 1 - (b.idle - a.idle) / dTotal;
  return Math.min(1, Math.max(0, busy));
}

export interface RestOptions {
  readonly maxBusy: number;      // p. ej. 0.15
  readonly windowMs: number;     // p. ej. 1000
  readonly consecutive: number;  // p. ej. 3
  readonly timeoutMs: number;    // p. ej. 150_000
  readonly sample?: () => CpuSample;               // por defecto cpuSample()
  readonly sleep?: (ms: number) => Promise<void>;  // por defecto setTimeout
  readonly now?: () => number;                     // por defecto Date.now
}
export interface RestResult { readonly reached: boolean; readonly waitedMs: number; readonly lastBusy: number }

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a `consecutive` ventanas seguidas con CPU < `maxBusy`, o hasta `timeoutMs`. */
export async function waitForCpuRest(opts: RestOptions): Promise<RestResult> {
  const { maxBusy, windowMs, consecutive, timeoutMs } = opts;
  const sample = opts.sample ?? (() => cpuSample());
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());

  const start = now(); let prev = sample(); let ok = 0; let last: number;
  for (;;) {
    await sleep(windowMs);
    const cur = sample(); last = busyFraction(prev, cur); prev = cur;
    ok = last < maxBusy ? ok + 1 : 0;
    if (ok >= consecutive) return { reached: true, waitedMs: now() - start, lastBusy: last };
    if (now() - start >= timeoutMs) return { reached: false, waitedMs: now() - start, lastBusy: last };
  }
}

/** De la salida de `top -b -n 2 …`, las 5 primeras filas del **segundo** bloque como "<%CPU> <COMMAND>". [] si no se puede leer. */
export function parseTopSnapshot(out: string): string[] {
  const lines = out.split('\n');
  const starts = lines.flatMap((line, i) => (line.startsWith('top -') ? [i] : []));
  const second = starts[1];
  if (second === undefined) return [];
  const block = lines.slice(second + 1);
  const headerIndex = block.findIndex((line) => line.includes('PID') && line.includes('COMMAND'));
  if (headerIndex === -1) return [];
  const cols = block[headerIndex]?.trim().split(/\s+/) ?? [];
  const iCpu = cols.indexOf('%CPU');
  const iCmd = cols.indexOf('COMMAND');
  if (iCpu === -1 || iCmd === -1) return [];
  return block
    .slice(headerIndex + 1)
    .filter((line) => line.trim() !== '')
    .slice(0, 5)
    .map((line) => {
      const c = line.trim().split(/\s+/);
      return `${c[iCpu] ?? ''} ${c.slice(iCmd).join(' ')}`;
    });
}
