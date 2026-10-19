import type { Page } from '@playwright/test';
import { expect, test } from './perf-fixture.ts';
import { clearLongTasks, fixture, installPerfProbes, longTasks, pageNow, recordMeasure, waitPageRendered } from './helpers.ts';
import { copyWithId, openMore } from './tabs-kit.ts';
import { expectViewerReady } from './viewer-ready.ts';

/**
 * Rendimiento del cambio de pestaña (PDF-095): tres documentos de 1 000 páginas. Cada cambio con Ctrl+Tab debe
 * dejar pintada la página visible en ≤ 500 ms (p95 de 20 cambios), el heap JS no debe crecer más de 50 MB tras los
 * cambios y ninguna long task debe superar 200 ms. Las mediciones son de reloj: solo corren en el proyecto `@perf`.
 */

const CHANGES = 20;
const P95_MAX_MS = 500;
const HEAP_GROWTH_MAX_MB = 50;
const LONG_TASK_MAX_MS = 200;
const NAMES = ['pages-1000.pdf', 'pages-1000-b.pdf', 'pages-1000-c.pdf'] as const;

/** Abre los tres documentos (el último queda activo) con el selector de la web. */
async function openThree(page: Page): Promise<void> {
  await installPerfProbes(page);
  await page.goto('/');
  await page.locator('[data-testid=open-input]').setInputFiles(fixture('pages-1000.pdf'));
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expectViewerReady(page);
  await waitPageRendered(page, 1);
  const source = fixture('pages-1000.pdf');
  await openMore(page, copyWithId(source, NAMES[1], 2), NAMES[1]);
  await openMore(page, copyWithId(source, NAMES[2], 3), NAMES[2]);
  await expect(page.getByRole('tab')).toHaveCount(3);
}

/** Pulsa Ctrl+Tab y devuelve el tiempo (ms) hasta que la página 1 del nuevo documento está pintada. */
async function switchAndMeasure(page: Page, next: string): Promise<number> {
  const started = await pageNow(page);
  await page.keyboard.press('Control+Tab');
  await expect(page.getByRole('tab', { name: next, selected: true })).toHaveCount(1);
  await page.waitForFunction(
    () => document.querySelector('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]') !== null,
    undefined,
    { polling: 'raf', timeout: 30_000 },
  );
  return (await pageNow(page)) - started;
}

/** Heap JS usado (MB) tras un recolector de basura forzado (CDP). */
async function usedHeapAfterGcMB(cdp: { send(method: string): Promise<unknown> }): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const result = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
  const used = result.metrics.find((m) => m.name === 'JSHeapUsedSize');
  if (used === undefined) throw new Error('Performance.getMetrics no devuelve JSHeapUsedSize');
  return used.value / (1024 * 1024);
}

test('Ctrl+Tab entre tres documentos de 1 000 páginas: p95 ≤ 500 ms, heap estable y sin long tasks > 200 ms', { tag: '@perf' }, async ({ page }, testInfo) => {
  await openThree(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  // Primera ronda (un ciclo completo por las tres pestañas) como referencia de memoria.
  let active = 2;
  for (let i = 0; i < NAMES.length; i++) {
    active = (active + 1) % NAMES.length;
    await switchAndMeasure(page, NAMES[active] ?? NAMES[0]);
  }
  const heapAfterFirstRound = await usedHeapAfterGcMB(cdp);

  await clearLongTasks(page);
  const samples: number[] = [];
  for (let i = 0; i < CHANGES; i++) {
    active = (active + 1) % NAMES.length;
    samples.push(await switchAndMeasure(page, NAMES[active] ?? NAMES[0]));
  }
  const heapAfter = await usedHeapAfterGcMB(cdp);
  const tasks = await longTasks(page);

  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(0.95 * CHANGES) - 1] ?? Number.POSITIVE_INFINITY;
  recordMeasure(
    testInfo,
    `cambio de pestaña: p95 ${p95.toFixed(0)} ms (máx. ${String(P95_MAX_MS)}); heap ${heapAfterFirstRound.toFixed(1)} → ${heapAfter.toFixed(1)} MB; long tasks: ${String(tasks.length)}`,
  );

  expect(p95, 'p95 del cambio de pestaña').toBeLessThanOrEqual(P95_MAX_MS);
  expect(heapAfter, 'heap JS tras 20 cambios').toBeLessThanOrEqual(heapAfterFirstRound + HEAP_GROWTH_MAX_MB);
  expect(tasks.filter((d) => d > LONG_TASK_MAX_MS), 'long tasks > 200 ms durante los cambios').toEqual([]);
});
