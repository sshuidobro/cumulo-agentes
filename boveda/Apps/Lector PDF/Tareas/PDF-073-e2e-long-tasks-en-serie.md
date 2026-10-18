---
tipo: tarea
id: PDF-073
titulo: Ejecutar las pruebas e2e de long tasks en un proyecto Playwright en serie
app: pdf
estado: bloqueada
depende_de: []
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, e2e, rendimiento]
---

# PDF-073 · Pruebas e2e de long tasks en serie

Plan: [[Apps/Lector PDF/Plan|Plan]] (secciones "Presupuestos" y "Comandos") · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]], [[ADR-0012-suite-de-rendimiento]] · Origen: [[PDF-039-e2e-anotaciones]] (ronda 2)

## Objetivo
Que `pnpm --filter lector-pdf e2e` mida las *long tasks* sin otra ventana de Chromium compitiendo por la CPU, sin cambiar ningún umbral, y termine con código 0 de forma estable.

## Contexto
- Leer: `apps/lector-pdf/playwright.config.ts`, [[ADR-0016-e2e-long-tasks-en-serie]], y las 7 pruebas de la tabla del paso 2.
- Playwright 1.56.1: `TestProject` admite `workers`, `fullyParallel`, `grep`, `grepInvert` y `dependencies` (ver `node_modules/.pnpm/playwright@1.56.1/node_modules/playwright/types/test.d.ts`). Etiquetas: `test(title, { tag: '@perf' }, fn)`.
- Síntoma de partida: con la batería completa (`workers: 2`), `search.spec.ts` «durante la búsqueda…» dio 101/117 ms y `viewer.spec.ts` «durante un scroll continuo…» 102 ms; aisladas pasan.

## Qué hay que hacer
1. `apps/lector-pdf/playwright.config.ts`: sustituir `projects` por exactamente:
   ```ts
   projects: [
     { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@perf/ },
     // Pruebas de long tasks (ADR-0016): solas, en serie y después del resto, sin carga concurrente.
     {
       name: 'chromium-perf',
       use: { ...devices['Desktop Chrome'] },
       grep: /@perf/,
       workers: 1,
       fullyParallel: false,
       dependencies: ['chromium'],
     },
   ],
   ```
   No tocar `workers: 2` global, `retries: 0`, `timeout` ni `webServer`.
2. Añadir `{ tag: '@perf' }` como segundo argumento (entre el título y la función) a estas 7 pruebas, y a ninguna otra. No cambiar nada más de ellas:

   | Fichero (`apps/lector-pdf/tests/e2e/`) | Prueba |
   |---|---|
   | `search.spec.ts` | «durante la búsqueda el visor y el campo de página siguen respondiendo» |
   | `viewer.spec.ts` | «durante un scroll continuo no hay tareas largas de más de 100 ms» |
   | `render.spec.ts` | «images-200: al recorrer las 20 primeras páginas, las visibles se dibujan sin tareas largas» |
   | `ink.spec.ts` | «dibujar un trazo de 2 000 eventos no produce long tasks» |
   | `annotations-layer.spec.ts` | «una página con 500 anotaciones se desplaza sin tareas largas de más de 100 ms» |
   | `performance.spec.ts` | «pages-5000: ninguna long task supera 100 ms durante scroll, zoom y búsqueda» |
   | `annotations-performance.spec.ts` | «pages-5000.pdf: escaneo de anotaciones < 10 s sin long tasks > 100 ms; …» |

3. Comprobar que no queda ninguna prueba que lea `longtask` sin etiqueta: `grep -ln "longTasks\|longtask" apps/lector-pdf/tests/e2e/*.spec.ts` debe dar solo los 7 ficheros de la tabla, y en cada uno solo la prueba listada mide long tasks. Si aparece otra, para y anótalo en el Registro (no la etiquetes por tu cuenta).
4. El Plan ya documenta el proyecto `chromium-perf` en la línea de «E2E» (lo hizo el líder): no hay que tocarlo.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf exec playwright test --list --project=chromium-perf --no-deps` lista exactamente 7 pruebas (las de la tabla). Salida en el Registro.
- [ ] `pnpm --filter lector-pdf exec playwright test --list --project=chromium | grep -c "@perf"` da `0`.
- [ ] El total de `--list` sin filtro es el mismo que antes del cambio (anotar ambos números): ninguna prueba se pierde ni se duplica.
- [ ] `pnpm --filter lector-pdf e2e` con código 0 tres veces seguidas, y `pnpm --filter lector-pdf e2e --repeat-each=3` con código 0. En el Registro: totales y el valor `long-task-max-ms`/«Tarea larga máxima» de `search.spec.ts` y `viewer.spec.ts` en cada ejecución.
- [ ] `git diff` no cambia ningún número de umbral, ni añade `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` con código 0.

## Fuera de alcance
- Optimizar la búsqueda o el scroll para ganar margen bajo los 100 ms (si una prueba falla también en serie, es una regresión real: anótala con su valor y devuelve la ficha al líder).
- Las pruebas de tiempo de reloj con margen amplio (no se etiquetan en esta ficha).
- `apps/lector-pdf/tests/perf/` (Vitest, ya en serie por [[ADR-0012-suite-de-rendimiento]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/playwright.config.ts` (proyecto `chromium` con `grepInvert: /@perf/` y proyecto `chromium-perf` tal como indica la ficha); `apps/lector-pdf/tests/e2e/{search,viewer,render,ink,annotations-layer,performance,annotations-performance}.spec.ts` (solo `{ tag: '@perf' }` en la prueba listada de cada uno); esta ficha.
- Qué he hecho: he comprobado con `grep -ln "longTasks\|longtask"` que solo esos 7 ficheros miden long tasks y que en cada uno solo la prueba de la tabla lo hace (las demás de esos ficheros no leen `longtask`). He configurado el proyecto `chromium-perf` y etiquetado las 7 pruebas. `git diff` no toca umbrales ni añade `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- Comandos ejecutados y resultado:
  - `playwright test --list` (sin filtro): 156 tests en 39 ficheros, igual que antes del cambio (línea base: 156).
  - `--list --project=chromium-perf --no-deps`: **7 tests** (las de la tabla, todas en `chromium-perf`).
  - `--list --project=chromium`: 149 tests (149 + 7 = 156). Sin `@perf` en esa lista (`grep -c` = 0).
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`: código 0 (143 ficheros, 1709 tests).
  - `pnpm --filter lector-pdf e2e`, 4 ejecuciones (código 0 en 1, 2 y 4; **código 1 en la 3**). Tarea larga máxima (`search` / `viewer`): ejecución 1 → 69,0 ms / 69 ms; ejecución 4 → 67,0 ms / 74 ms. Las ejecuciones 2 y 3 no guardaron anotaciones (reporter `list`). En la 3: **156 → 155 pasan, 1 falla**: `render.spec.ts` «images-200…» (`chromium-perf`) midió **101 ms** frente a un presupuesto de 100 ms.
  - `pnpm --filter lector-pdf e2e --repeat-each=3`: **código 1**. 169 pasan y 1 falla: `ink.spec.ts` «dibujar un trazo de 2 000 eventos no produce long tasks» (`chromium-perf`, repetición 2), que esperaba `[]` y recibió **[79, 145] ms**. Valores de la misma ejecución: `search` 69,0 / 75,0 / 70,0 ms; `viewer` 74 / 74 / 71 ms; `images-200` 77 / 69 / 96 ms (pasa). Observación: el resultado fue 170 pruebas, es decir 149 de `chromium` una vez y 21 de `chromium-perf` (7 × 3); `--repeat-each` no repitió las de `chromium`. No lo he investigado.
- Dudas o cosas que no he podido hacer:
  - **Criterio no cumplido: tres ejecuciones seguidas en verde.** Según la ficha («si una prueba falla también en serie, es una regresión real»), no lo arreglo yo: anoto los valores y la ficha queda **bloqueada** para el líder. Esto va contra la indicación de pasarla a `en-revision`; prefiero no mandar al revisor una ficha con un rojo de regresión real.
  - Regresión 1: `images-200` 101 ms (1 ms sobre el presupuesto), una vez de 4 ejecuciones completas y una de 3 repeticiones (77, 69, 96 ms).
  - Regresión 2: `ink` «dibujar un trazo de 2 000 eventos…» con dos long tasks (79 y 145 ms) en serie. Con `workers: 2` estos valores no se medían, así que no sé si la regresión es nueva o de siempre. Hay que analizarlo; no se toca el umbral.
  - Pendiente del líder: decidir si estas dos pruebas deben optimizarse o si el presupuesto se vuelve intermitente (ADR-0016 no lo prevé).
