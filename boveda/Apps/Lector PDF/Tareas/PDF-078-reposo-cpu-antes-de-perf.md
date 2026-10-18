---
tipo: tarea
id: PDF-078
titulo: Esperar a que la CPU esté en reposo antes de cada prueba @perf y medir la CPU real durante ella
app: pdf
estado: hecha
depende_de: []
intentos: 0
skills: [pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, e2e, rendimiento]
---

# PDF-078 · Puerta de reposo de CPU antes de cada prueba @perf

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] («Revisión 2») · Origen: [[PDF-073-e2e-long-tasks-en-serie]] (ronda 2, `ink` 52 ms) · Base: [[PDF-077-diagnostico-long-tasks]]

## Objetivo
Que ninguna prueba `@perf` empiece a medir con la CPU ocupada: antes de cada una se espera a que la CPU de la máquina esté en reposo (medida real, no `loadavg`), y si no se calma en 150 s la prueba **falla** con un mensaje claro. El diagnóstico informa de la CPU real durante la prueba y de los procesos que la usan **ahora** (`top`), no la media de toda su vida (`ps`). No cambia ningún umbral ni añade reintentos.

## Contexto
- Leer: `apps/lector-pdf/tests/e2e/perf-fixture.ts` (entero, ~70 líneas), [[ADR-0016-e2e-long-tasks-en-serie]] («Revisión 2»).
- Node: `os.cpus()` devuelve por núcleo `times: { user, nice, sys, idle, irq }` (ms acumulados); funciona en Linux, Windows y macOS.
- Playwright 1.56.1: una fixture de test admite `{ auto: true, timeout: N }`; ese `timeout` es propio de la fixture y no consume el de la prueba (60 s).
- Rutas relativas a `apps/lector-pdf/`. `tests/` ya está en el `tsconfig` (con `allowImportingTsExtensions`) y Vitest incluye `tests/unit/**/*.test.ts`.

## Qué hay que hacer
1. Nuevo `tests/e2e/cpu-usage.ts` (sin Playwright; solo `node:os`):
   ```ts
   import { cpus } from 'node:os';

   export interface CpuTimes { readonly user: number; readonly nice: number; readonly sys: number; readonly idle: number; readonly irq: number }
   /** Tiempos acumulados de todos los núcleos (ms). */
   export interface CpuSample { readonly idle: number; readonly total: number }

   /** Suma los tiempos de todos los núcleos. Por defecto, los de `os.cpus()`. */
   export function cpuSample(cores: readonly { readonly times: CpuTimes }[] = cpus()): CpuSample;
   /** Fracción ocupada (0-1) de toda la máquina entre dos muestras: 1 − Δidle/Δtotal, recortada a [0, 1]. Δtotal ≤ 0 → 0. */
   export function busyFraction(a: CpuSample, b: CpuSample): number;

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
   /** Espera a `consecutive` ventanas seguidas con CPU < `maxBusy`, o hasta `timeoutMs`. */
   export async function waitForCpuRest(opts: RestOptions): Promise<RestResult>;

   /** De la salida de `top -b -n 2 …`, las 5 primeras filas del **segundo** bloque como "<%CPU> <COMMAND>". [] si no se puede leer. */
   export function parseTopSnapshot(out: string): string[];
   ```
   - `cpuSample`: `idle` = suma de `idle`; `total` = suma de `user + nice + sys + idle + irq`.
   - `waitForCpuRest`, exactamente:
     ```ts
     const start = now(); let prev = sample(); let ok = 0; let last = 1;
     for (;;) {
       await sleep(windowMs);
       const cur = sample(); last = busyFraction(prev, cur); prev = cur;
       ok = last < maxBusy ? ok + 1 : 0;
       if (ok >= consecutive) return { reached: true, waitedMs: now() - start, lastBusy: last };
       if (now() - start >= timeoutMs) return { reached: false, waitedMs: now() - start, lastBusy: last };
     }
     ```
   - `parseTopSnapshot`: divide en líneas; toma las que siguen a la **segunda** línea que empieza por `top -`; en ellas busca la cabecera (contiene `PID` y `COMMAND`), saca los índices de `%CPU` y `COMMAND` de `cabecera.trim().split(/\s+/)`, y de las 5 líneas no vacías siguientes devuelve `` `${cols[iCpu]} ${cols.slice(iCmd).join(' ')}` ``. Si falta algo, `[]`.
2. `tests/e2e/perf-fixture.ts`:
   - Constantes arriba: `REST_MAX_BUSY = 0.15`, `REST_WINDOW_MS = 1000`, `REST_CONSECUTIVE = 3`, `REST_TIMEOUT_MS = 150_000`, y `const pct = (f: number): string => \`${(f * 100).toFixed(0)} %\``.
   - Al principio de la fixture: `const perf = testInfo.tags.includes('@perf');`. Si `perf`: `const rest = await waitForCpuRest({ maxBusy: REST_MAX_BUSY, windowMs: REST_WINDOW_MS, consecutive: REST_CONSECUTIVE, timeoutMs: REST_TIMEOUT_MS })`; si `!rest.reached`, `throw new Error(\`La máquina no está en reposo: CPU ocupada ${pct(rest.lastBusy)} (máximo ${pct(REST_MAX_BUSY)}) tras ${String(Math.round(rest.waitedMs / 1000))} s. La medida de long tasks no sería válida (ADR-0016); repite cuando no haya otras baterías en marcha.\`)`. (Esto hace **fallar** la prueba; no uses `test.skip`.)
   - Justo antes de `await use(undefined)`: `const cpuStart = cpuSample();`. El `if (!testInfo.tags.includes('@perf')) return;` del teardown pasa a `if (!perf) return;`.
   - En el teardown (dentro del `try` existente), además de lo que ya hay: `const cpuDuring = busyFraction(cpuStart, cpuSample());` y dos anotaciones nuevas, después de `carga-cpu-1min`:
     - `{ type: 'reposo-cpu', description: \`${pct(rest.lastBusy)} tras ${String(Math.round(rest.waitedMs / 1000))} s de espera\` }`
     - `{ type: 'cpu-durante', description: \`${pct(cpuDuring)} de ${String(coreCount)} núcleos\` }`
     (declara `rest` fuera del `if` como `let rest: RestResult | null = null` y usa estas anotaciones solo si `rest !== null`).
   - Añade al JSON del adjunto `perf-diagnostico.json` los campos `restBusy`, `restWaitedMs` y `cpuDuring`.
   - `topProcesses()`: sustituye `ps` por `execFileSync('top', ['-b', '-n', '2', '-d', '0.5', '-o', '%CPU', '-w', '200'], { encoding: 'utf8', timeout: 5000 })` y devuelve `parseTopSnapshot(out)`; sigue siendo solo Linux y `[]` si falla.
   - La opción de la fixture pasa de `{ auto: true }` a `{ auto: true, timeout: 200_000 }`.
   - Comentario JSDoc de la fixture: menciona la puerta de reposo y ADR-0016 «Revisión 2».
3. Nuevo `tests/unit/cpu-usage.test.ts` (importa de `../e2e/cpu-usage.ts`):
   - `cpuSample` con 2 núcleos `{user 10, nice 0, sys 5, idle 85, irq 0}` y `{user 30, nice 0, sys 10, idle 60, irq 0}` → `{ idle: 145, total: 200 }`.
   - `busyFraction({idle: 100, total: 200}, {idle: 150, total: 400})` → `0.75`; con Δtotal 0 → `0`; con Δidle > Δtotal (dato raro) → `0` (recortado).
   - `waitForCpuRest` con `sample` falso que produce las fracciones ocupadas `[0.5, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1]` (la 1.ª llamada devuelve `{ idle: 0, total: 0 }`; la llamada k + 1 suma `total += 1000` e `idle += 1000 × (1 − fracción k)` y devuelve el acumulado), `sleep` que avanza un reloj falso `windowMs` y no espera, `now` = ese reloj; `maxBusy 0.15`, `consecutive 3`, `windowMs 1000`, `timeoutMs 60_000` → `{ reached: true, waitedMs: 7000, lastBusy: 0.1 }` (con `toBeCloseTo` en `lastBusy`).
   - Siempre `0.5`, `timeoutMs 5000` → `reached: false`, `waitedMs 5000`, `lastBusy ≈ 0.5`.
   - `parseTopSnapshot` con un texto de dos bloques `top -` (cabecera `PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ COMMAND`): del primer bloque nada; del segundo, 5 entradas tipo `'55.7 headless_shell'`, incluido un `COMMAND` con espacio (`'12.0 node vite preview'`). Texto sin segundo bloque → `[]`.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf exec vitest run tests/unit/cpu-usage.test.ts` en verde (todos los casos del paso 3).
- [ ] Puerta en acción, con máquina en reposo: `pnpm --filter lector-pdf exec playwright test --project=chromium-perf --no-deps -g "trazo de 2 000" --reporter=list,json` (JSON a un fichero del scratchpad) → código 0; en el resultado están las anotaciones `reposo-cpu`, `cpu-durante`, `carga-cpu-1min` y `long-tasks`, y `topProcesses` tiene filas con `%CPU` actual. Pegar las cuatro anotaciones en el Registro: `cpu-durante` queda como **valor de referencia en reposo** para [[PDF-073-e2e-long-tasks-en-serie]].
- [ ] Puerta con carga: lanzar en paralelo `node -e "const e=Date.now()+200000;while(Date.now()<e){}" & node -e "const e=Date.now()+200000;while(Date.now()<e){}" &` (2 núcleos ocupados, 50 %) y la misma prueba → **falla** a los ~150 s con el mensaje «La máquina no está en reposo: CPU ocupada …» (pegar el mensaje). Matar después los dos `node` (`kill %1 %2`) y comprobar con `pgrep -fa "Date.now()+200000"` que no queda ninguno.
- [ ] Una prueba sin `@perf` (`--project=chromium -g "zigzag de 5"`) no espera (dura lo mismo que antes, ±2 s; anotar ambos tiempos) y no recibe anotaciones.
- [ ] `--list` da el mismo total que antes (anotar) y `--list --project=chromium-perf --no-deps` sigue dando 7.
- [ ] `git diff` no cambia ningún umbral de *long tasks* ni ninguna prueba `.spec.ts`, y no añade `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` con código 0.

## Fuera de alcance
- La batería completa ×3 (es la verificación de [[PDF-073-e2e-long-tasks-en-serie]]).
- Cambiar las pruebas `@perf`, sus observadores o sus umbrales.
- Detener o expulsar otros procesos de la máquina.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/cpu-usage.ts` (nuevo), `apps/lector-pdf/tests/unit/cpu-usage.test.ts` (nuevo, escrito antes que el módulo: rojo por import inexistente), `apps/lector-pdf/tests/e2e/perf-fixture.ts` (puerta de reposo, anotaciones `reposo-cpu` y `cpu-durante`, `top` en vez de `ps`, `timeout: 200_000`), esta ficha.
- Qué he hecho: implementado el módulo de CPU y la puerta de reposo según la ficha; los 8 tests unitarios pasan. Con la máquina en reposo la prueba `@perf` pasa; con dos bucles `node` ocupando 2 núcleos falla tras 150 s con el mensaje esperado. Única desviación textual: en `waitForCpuRest` he declarado `let last: number;` sin el `= 1` inicial, porque ESLint (`no-useless-assignment`) lo marcaba como asignación inútil; el valor inicial nunca se lee.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf exec vitest run tests/unit/cpu-usage.test.ts`: rojo antes (import inexistente), verde después: 8/8.
  - `pnpm lint`: 0 (tras corregir la asignación inútil). `pnpm typecheck`: 0.
  - `pnpm test` (suite completa, en serie): 0. 148 ficheros, 1732 tests.
  - `playwright test --project=chromium-perf --no-deps -g "trazo de 2 000" --reporter=list,json` con reposo: código 0. Anotaciones de referencia en reposo (valor de referencia para PDF-073): `carga-cpu-1min` 2.42 → 2.18 (4 núcleos); `reposo-cpu` 4 % tras 3 s de espera; `cpu-durante` 27 % de 4 núcleos; `long-tasks` 58 ms @ 63 ms. `topProcesses` (ahora): `2.0 claude`, `2.0 headless_shell.`, `0.0 process_api`, `0.0 kthreadd`, `0.0 pool_workqueue_release`. Los campos `restBusy`, `restWaitedMs` y `cpuDuring` están en el adjunto `perf-diagnostico.json`.
  - Puerta con carga (dos `node` busy-loop de 200 s en paralelo, 2 de 4 núcleos): código 1; mensaje: «La máquina no está en reposo: CPU ocupada 51 % (máximo 15 %) tras 150 s. La medida de long tasks no sería válida (ADR-0016); repite cuando no haya otras baterías en marcha.». Los dos `node` se han matado y `pgrep` no encuentra ninguno.
  - `--project=chromium -g "zigzag de 5"` (sin `@perf`): código 0 en ambas versiones. Duración de la prueba en el JSON: 1782 ms; tiempo de pared del comando 8,53 s sin el cambio de fixture y 8,56 s con él (incluye el build). 0 anotaciones y 0 adjuntos.
  - `--list`: 160 tests en 41 ficheros (sin cambios en ningún `.spec.ts`, así que el total no cambia). `--list --project=chromium-perf --no-deps`: 7.
  - Auditoría: `git diff` no toca umbrales de long tasks ni ningún `.spec.ts`; no hay `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout` en lo añadido.
- Dudas o cosas que no he podido hacer: (1) En el caso con carga, Playwright muestra «(170ms)» junto a la prueba fallida, mientras que el mensaje dice «tras 150 s» (calculado con `Date.now`). Parece que el reporte `list` no cuenta el tiempo de la fixture; no lo he investigado, el mensaje sí demuestra la espera de 150 s. (2) La batería ×3 no es de esta ficha (es la verificación de PDF-073).

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Comprobado: lint y typecheck en 0; 8/8 tests unitarios de `cpu-usage`; el código sigue la ficha (única desviación, `let last: number;` sin valor inicial, es correcta y justificada). Sin umbrales, `.spec.ts`, `retries`, `skip`, `only`, `fixme` ni `waitForTimeout` añadidos.
Duda del programador (170 ms con carga): **no es un problema real**. Repetí la prueba con dos bucles `node` ocupando 2 núcleos y el tiempo de pared fue de 158 s (cronometrado con `date`), con fallo y sin dejar procesos. El reporte `list` solo cuenta la duración del cuerpo de la prueba, no la preparación de la fixture automática, que es donde falla y espera.
1. (opcional) `perf-fixture.ts` — el aviso de duración engañosa podría anotarse en ADR-0016 para quien lea el reporte; no bloquea.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Unitarios cpu-usage | PASA | `vitest run tests/unit/cpu-usage.test.ts`: 8/8 |
| Puerta en reposo | PASA | código 0; anotaciones: `carga-cpu-1min` 1.87 → 1.44 (4 núcleos); `reposo-cpu` 2 % tras 3 s de espera; `cpu-durante` 27 % de 4 núcleos (referencia en reposo para [[PDF-073-e2e-long-tasks-en-serie]]); `long-tasks` ninguna. `topProcesses` con %CPU actual (`2.0 claude`, `2.0 headless_shell.`, `2.0 top`...); `restBusy`, `restWaitedMs`, `cpuDuring` en `perf-diagnostico.json` |
| Puerta con carga | PASA | código 1, pared 157 s: «La máquina no está en reposo: CPU ocupada 51 % (máximo 15 %) tras 150 s. La medida de long tasks no sería válida (ADR-0016); repite cuando no haya otras baterías en marcha.»; `pgrep` sin restos |
| Sin `@perf` no espera | PASA | `zigzag de 5`: 1,6 s la prueba, 7,96 s de pared (programador: 8,5 s antes/después); sin anotaciones |
| `--list` | PASA | 160 tests en 41 ficheros; `chromium-perf --no-deps`: 7 |
| Sin umbrales/spec/prohibidos | PASA | diff 385ad77..HEAD: ningún `.spec.ts`; sin retries/skip/only/fixme/waitForTimeout |
| lint, typecheck, test | PASA | código 0; 148 ficheros, 1732 tests |

Al empezar había dos bucles `node` huérfanos de otra sesión; esperé a que terminaran y repetí en reposo (la parte de lint/test no se vio afectada). Tests añadidos: ninguno (los 8 de la ficha cubren el módulo). Rendimiento: n/a.
