---
tipo: tarea
id: PDF-077
titulo: Adjuntar a cada prueba @perf el diagnóstico de long tasks y la carga de la máquina
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, e2e, rendimiento]
---

# PDF-077 · Diagnóstico de long tasks en las pruebas @perf

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] (revisión 2026-10-18, punto 2 y 3) · Origen: [[PDF-073-e2e-long-tasks-en-serie]] (ronda 1)

## Objetivo
Que cada prueba `@perf` deje en su informe **cuándo** ocurrió cada *long task* (instante y duración), la carga de CPU de la máquina al empezar y al terminar, y los procesos que más CPU usan. Así un rojo en `chromium-perf` se puede clasificar (app o máquina cargada) sin repetirlo a ciegas. No cambia ningún criterio de aprobado.

## Contexto
- Leer: `apps/lector-pdf/tests/e2e/helpers.ts` (`installPerfProbes`, `longTasks`) y las 7 pruebas `@perf`: `search`, `viewer`, `render`, `ink`, `annotations-layer`, `performance`, `annotations-performance` (`.spec.ts`). Cada una mide con su propio observador; **no se tocan** esos observadores.
- Playwright 1.56.1: fixtures automáticas con `test.extend({ name: [async ({ page }, use, testInfo) => { … }, { auto: true }] })`; `testInfo.attach(name, { body, contentType })`; `testInfo.annotations.push({ type, description })`; `testInfo.tags`.
- Rutas relativas a `apps/lector-pdf/`.

## Qué hay que hacer
1. Nuevo `tests/e2e/perf-fixture.ts`:
   ```ts
   import { execFileSync } from 'node:child_process';
   import { cpus, loadavg } from 'node:os';
   import { test as base } from '@playwright/test';
   export { expect } from '@playwright/test';

   interface LongTaskEntry { readonly start: number; readonly duration: number }

   /** `test` de las pruebas @perf (ADR-0016): igual que el de Playwright, más el diagnóstico automático. */
   export const test = base.extend<{ perfDiagnostics: void }>({
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
         await use();
         if (!testInfo.tags.includes('@perf')) return;
         const entries: readonly LongTaskEntry[] = await page
           .evaluate(() => (window as Window & { __perfDiag?: LongTaskEntryLike[] }).__perfDiag ?? [])
           .catch(() => []);
         … (paso 2)
       },
       { auto: true },
     ],
   });
   ```
   (`LongTaskEntryLike` = mismo tipo que `LongTaskEntry` declarado dentro del `evaluate`; ajusta los tipos para que `typecheck` pase sin `any`.)
2. En el teardown (tras `use()`), solo si la prueba tiene `@perf`:
   - `loadEnd = loadavg()[0] ?? 0`.
   - `topProcesses`: en Linux (`process.platform === 'linux'`), `execFileSync('ps', ['-eo', 'pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' })`, líneas 2-6 recortadas; en otro sistema o si falla, `[]` (envuelto en `try/catch`).
   - `testInfo.annotations.push({ type: 'carga-cpu-1min', description: \`${loadStart.toFixed(2)} → ${loadEnd.toFixed(2)} (${cpus().length} núcleos)\` })`.
   - `testInfo.annotations.push({ type: 'long-tasks', description: entries.length === 0 ? 'ninguna' : entries.map((e) => \`${e.duration} ms @ ${e.start} ms\`).join(', ') })`.
   - `await testInfo.attach('perf-diagnostico.json', { body: JSON.stringify({ entries, loadStart, loadEnd, cpus: cpus().length, topProcesses }, null, 2), contentType: 'application/json' })`.
   - Nada de esto puede hacer fallar la prueba: cualquier error del teardown se captura y se ignora.
3. En las 7 pruebas `@perf`: cambia solo la línea de import para que `test` y `expect` vengan de `./perf-fixture.ts`; los tipos (`Page`, `Locator`, `TestInfo`) siguen viniendo de `@playwright/test`. Ejemplo: `import { type Page } from '@playwright/test';` + `import { expect, test } from './perf-fixture.ts';`. No cambies nada más de esos ficheros.
4. Comprueba que ninguna otra prueba usa ya `perf-fixture.ts` y que las 7 sí: `grep -l "perf-fixture" tests/e2e/*.spec.ts` = los 7 ficheros.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf exec playwright test --list` da el mismo total que antes del cambio (anotar ambos) y `--list --project=chromium-perf --no-deps` sigue dando 7.
- [ ] `pnpm --filter lector-pdf exec playwright test --project=chromium-perf --no-deps -g "trazo de 2 000|images-200" --reporter=json > /tmp/pdf077.json` → código 0 y, en el JSON, cada uno de los 2 resultados tiene el adjunto `perf-diagnostico.json` y las anotaciones `carga-cpu-1min` y `long-tasks`. Pegar en el Registro esas anotaciones (sale, por ejemplo, la tarea de arranque de `images-200`).
- [ ] Una prueba sin `@perf` de esos ficheros (p. ej. `ink.spec.ts` «un zigzag de 5 segmentos…») no recibe esas anotaciones.
- [ ] `grep -n "@perf" tests/e2e/*.spec.ts` y los umbrales no cambian; `git diff` no añade `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` con código 0.

## Fuera de alcance
- Unificar los observadores de *long tasks* de cada prueba.
- Fallar o saltar pruebas según la carga de la máquina (solo se informa).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
