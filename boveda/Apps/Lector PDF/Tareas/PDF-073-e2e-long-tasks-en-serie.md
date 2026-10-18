---
tipo: tarea
id: PDF-073
titulo: Ejecutar las pruebas e2e de long tasks en un proyecto Playwright en serie
app: pdf
estado: en-curso
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
