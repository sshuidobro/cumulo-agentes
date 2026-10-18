---
tipo: tarea
id: PDF-077
titulo: Adjuntar a cada prueba @perf el diagnóstico de long tasks y la carga de la máquina
app: pdf
estado: en-test
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/perf-fixture.ts` (nuevo); cambio de import de `test`/`expect` en `annotations-layer`, `annotations-performance`, `ink`, `performance`, `render`, `search`, `viewer` (`.spec.ts`, 1 línea cada una + import de tipos).
- Qué he hecho: fixture `perfDiagnostics` (auto) con observador de long tasks propio, que en teardown solo para pruebas `@perf` añade las anotaciones `carga-cpu-1min` y `long-tasks` y el adjunto `perf-diagnostico.json` (carga de CPU, núcleos y top 5 procesos con `ps` en Linux). Todo el teardown va en `try/catch`. Los observadores de cada prueba no se tocan.
- Desviación menor: el tipo de la fixture es `perfDiagnostics: undefined` y se llama `use(undefined)` en lugar de `void`, porque `@typescript-eslint/no-invalid-void-type` rechaza `void` ahí. Sin efecto funcional.
- Comandos ejecutados y resultado:
  - `playwright test --list`: antes 156 tests en 39 ficheros; después 156 tests en 39 ficheros (igual).
  - `playwright test --list --project=chromium-perf --no-deps`: 7 antes y 7 después.
  - `pnpm lint`: código 0. `pnpm typecheck`: código 0. `pnpm test`: 143 ficheros, 1709 tests, código 0.
  - `playwright test --project=chromium-perf --no-deps -g "trazo de 2 000|images-200" --reporter=json > /tmp/pdf077.json`: código 0, 2 passed. Ambos tienen adjunto `perf-diagnostico.json`. Anotaciones:
    - «dibujar un trazo de 2 000 eventos no produce long tasks»: `carga-cpu-1min` = `3.55 → 2.53 (4 núcleos)`; `long-tasks` = `70 ms @ 89 ms`.
    - «images-200: al recorrer las 20 primeras páginas…»: `carga-cpu-1min` = `2.53 → 2.53 (4 núcleos)`; `long-tasks` = `70 ms @ 89 ms`.
  - Prueba sin `@perf` «un zigzag de 5 segmentos…» (`--project=chromium -g "zigzag de 5"`): código 0, passed, sin anotaciones `carga-cpu-1min` ni `long-tasks` ni adjunto.
  - `grep -l "perf-fixture"`: exactamente los 7 ficheros. `grep "@perf"`: sin cambios. `git diff`: sin `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- Dudas o cosas que no he podido hacer: los observadores de long tasks de la fixture se instalan también en las pruebas sin `@perf` de esos 7 ficheros (así lo pide el paso 1 de la ficha); solo cuesta un observador por prueba. Si se quiere evitarlo, habría que condicionar el `addInitScript` a la etiqueta, y eso es decisión de diseño del líder.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Verificado: `--list` 156 tests/39 ficheros y `chromium-perf --no-deps` 7; lint y typecheck con código 0; diff de los 7 specs solo cambia imports; `perf-fixture` en exactamente los 7 ficheros; sin retries/skip/only/fixme/waitForTimeout; teardown en try/catch y solo con `@perf`. No he repetido la batería e2e ni `pnpm test` (indicación del coordinador; el programador reportó verde).
1. (opcional) `perf-fixture.ts` — el observador se instala también en pruebas sin `@perf`; coste mínimo, decisión del líder.
