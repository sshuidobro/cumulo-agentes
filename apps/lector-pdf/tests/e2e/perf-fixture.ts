import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';

interface LongTaskEntry {
  readonly start: number;
  readonly duration: number;
}

/** Procesos con más CPU (líneas 2-6 de `ps`, Linux). Vacío en otros sistemas o si `ps` falla. */
function topProcesses(): string[] {
  if (process.platform !== 'linux') return [];
  try {
    const out = execFileSync('ps', ['-eo', 'pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' });
    return out
      .split('\n')
      .slice(1, 6)
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** `test` de las pruebas @perf (ADR-0016): igual que el de Playwright, más el diagnóstico automático. */
export const test = base.extend<{ perfDiagnostics: undefined }>({
  perfDiagnostics: [
    async ({ page }, use, testInfo) => {
      const loadStart = loadavg()[0] ?? 0;
      await page.addInitScript(() => {
        const entries: { start: number; duration: number }[] = [];
        (window as Window & { __perfDiag?: typeof entries }).__perfDiag = entries;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) entries.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
        }).observe({ type: 'longtask', buffered: true });
      });
      await use(undefined);
      if (!testInfo.tags.includes('@perf')) return;
      // El diagnóstico nunca hace fallar la prueba: cualquier error del teardown se ignora.
      try {
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
        testInfo.annotations.push({
          type: 'long-tasks',
          description: entries.length === 0 ? 'ninguna' : entries.map((e) => `${String(e.duration)} ms @ ${String(e.start)} ms`).join(', '),
        });
        await testInfo.attach('perf-diagnostico.json', {
          body: JSON.stringify({ entries, loadStart, loadEnd, cpus: coreCount, topProcesses: processes }, null, 2),
          contentType: 'application/json',
        });
      } catch {
        // Diagnóstico opcional: se ignora.
      }
    },
    { auto: true },
  ],
});
