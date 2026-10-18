import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { test as base } from '@playwright/test';
import { busyFraction, cpuSample, parseTopSnapshot, waitForCpuRest, type RestResult } from './cpu-usage.ts';
export { expect } from '@playwright/test';

interface LongTaskEntry {
  readonly start: number;
  readonly duration: number;
}

// Puerta de reposo de CPU (ADR-0016 «Revisión 2», PDF-078): antes de cada prueba @perf se espera a que la CPU esté en reposo.
const REST_MAX_BUSY = 0.15;
const REST_WINDOW_MS = 1000;
const REST_CONSECUTIVE = 3;
const REST_TIMEOUT_MS = 150_000;
const pct = (f: number): string => `${(f * 100).toFixed(0)} %`;

/** Procesos con más CPU ahora mismo (`top`, dos muestras; la segunda es la actual). Vacío en otros sistemas o si `top` falla. */
function topProcesses(): string[] {
  if (process.platform !== 'linux') return [];
  try {
    const out = execFileSync('top', ['-b', '-n', '2', '-d', '0.5', '-o', '%CPU', '-w', '200'], { encoding: 'utf8', timeout: 5000 });
    return parseTopSnapshot(out);
  } catch {
    return [];
  }
}

/**
 * `test` de las pruebas @perf (ADR-0016): igual que el de Playwright, más la puerta de reposo de CPU
 * (ADR-0016 «Revisión 2») que hace fallar la prueba si la máquina no se calma, y el diagnóstico automático.
 */
export const test = base.extend<{ perfDiagnostics: undefined }>({
  perfDiagnostics: [
    async ({ page }, use, testInfo) => {
      const perf = testInfo.tags.includes('@perf');
      let rest: RestResult | null = null;
      if (perf) {
        rest = await waitForCpuRest({ maxBusy: REST_MAX_BUSY, windowMs: REST_WINDOW_MS, consecutive: REST_CONSECUTIVE, timeoutMs: REST_TIMEOUT_MS });
        if (!rest.reached) {
          throw new Error(`La máquina no está en reposo: CPU ocupada ${pct(rest.lastBusy)} (máximo ${pct(REST_MAX_BUSY)}) tras ${String(Math.round(rest.waitedMs / 1000))} s. La medida de long tasks no sería válida (ADR-0016); repite cuando no haya otras baterías en marcha.`);
        }
      }
      const loadStart = loadavg()[0] ?? 0;
      await page.addInitScript(() => {
        const entries: { start: number; duration: number }[] = [];
        (window as Window & { __perfDiag?: typeof entries }).__perfDiag = entries;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) entries.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
        }).observe({ type: 'longtask', buffered: true });
      });
      const cpuStart = cpuSample();
      await use(undefined);
      if (!perf) return;
      // El diagnóstico nunca hace fallar la prueba: cualquier error del teardown se ignora.
      try {
        const cpuDuring = busyFraction(cpuStart, cpuSample());
        const entries: readonly LongTaskEntry[] = await page
          .evaluate((): LongTaskEntry[] => (window as Window & { __perfDiag?: LongTaskEntry[] }).__perfDiag ?? [])
          .catch(() => []);
        const loadEnd = loadavg()[0] ?? 0;
        const processes = topProcesses();
        const coreCount = cpus().length;
        testInfo.annotations.push({
          type: 'carga-cpu-1min',
          description: `${loadStart.toFixed(2)} → ${loadEnd.toFixed(2)} (${String(coreCount)} núcleos)`,
        });
        if (rest !== null) {
          testInfo.annotations.push({
            type: 'reposo-cpu',
            description: `${pct(rest.lastBusy)} tras ${String(Math.round(rest.waitedMs / 1000))} s de espera`,
          });
          testInfo.annotations.push({
            type: 'cpu-durante',
            description: `${pct(cpuDuring)} de ${String(coreCount)} núcleos`,
          });
        }
        testInfo.annotations.push({
          type: 'long-tasks',
          description: entries.length === 0 ? 'ninguna' : entries.map((e) => `${String(e.duration)} ms @ ${String(e.start)} ms`).join(', '),
        });
        await testInfo.attach('perf-diagnostico.json', {
          body: JSON.stringify(
            {
              entries,
              loadStart,
              loadEnd,
              cpus: coreCount,
              topProcesses: processes,
              restBusy: rest?.lastBusy ?? null,
              restWaitedMs: rest?.waitedMs ?? null,
              cpuDuring,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      } catch {
        // Diagnóstico opcional: se ignora.
      }
    },
    { auto: true, timeout: 200_000 },
  ],
});
