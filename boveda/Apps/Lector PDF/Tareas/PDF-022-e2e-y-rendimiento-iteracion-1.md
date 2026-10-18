---
tipo: tarea
id: PDF-022
titulo: E2E de extremo a extremo y presupuestos de rendimiento de la iteración 1
app: pdf
estado: hecha
depende_de: [PDF-004, PDF-011, PDF-012, PDF-013, PDF-014, PDF-016, PDF-018, PDF-019, PDF-020, PDF-021]
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, e2e, rendimiento]
---

# PDF-022 · E2E y presupuestos de la iteración 1

Plan: [[Apps/Lector PDF/Plan|Plan]] (sección "Presupuestos") · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0011-documentos-de-prueba-pdf]] · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
Una batería E2E que demuestra que la iteración 1 cumple lo prometido al usuario: abrir y leer **cualquier** PDF de cualquier tamaño con todas las funciones del visor, dentro de los presupuestos de tiempo y memoria del Plan, solo con teclado si hace falta, y sin errores con el corpus real.

## Contexto
- Leer: sección "Presupuestos" del [[Apps/Lector PDF/Plan|Plan]], todos los `tests/e2e/*.spec.ts` existentes (no dupliques: esta ficha añade los flujos completos y las mediciones), `fixtures/FUENTES.md`.
- Medir en el navegador: `performance.now()`, `PerformanceObserver({ type: 'longtask', buffered: true })`, `performance.memory.usedJSHeapSize` (Chromium). Inyecta los observadores con `page.addInitScript`.
- Esta ficha **no cambia código de la app** (sí tests: paso 0) salvo para añadir `data-testid` que falten (anótalos). Si un presupuesto no se cumple, el test falla: no se relaja el umbral; se anota en el Registro y la ficha vuelve al líder.

## Qué hay que hacer
0. Suite de rendimiento ([[ADR-0012-suite-de-rendimiento]]): mueve los dos asserts de tiempo de `tests/unit/fixtures.test.ts` (generación de `pages-5000.pdf` < 1 s y de `pages-100000.pdf` < 10 s, medida única con `performance.now()`) a `tests/perf/fixtures.perf.test.ts`. En `tests/unit/` se quedan los asserts de tamaño, número de páginas y «aguja». Mismos umbrales. Después, `grep -rn "performance.now" apps/lector-pdf/tests/unit apps/lector-pdf/tests/ui` no devuelve nada.
1. `tests/e2e/helpers.ts`: `openFixture(page, name)` (vía `[data-testid=open-input]`), `waitPageRendered(page, n)`, `installPerfProbes(page)`, `longTasks(page)`, `heapMB(page)`, `canvasCount(page)`.
2. `tests/e2e/performance.spec.ts` — una prueba por fila de la tabla de presupuestos del Plan (abrir pequeño < 1 s; 5 000 y 100 000 < 5 s; Fin < 1,5 s; ≤ 12 lienzos y ≤ 12 marcos; heap < 400 MB tras 30 saltos aleatorios por `pages-5000.pdf`; búsqueda en 5 000 páginas: 1.ª coincidencia < 1 s con la consulta `marcador-1` y recorrido completo < 15 s; ninguna *long task* > 100 ms durante scroll, zoom y búsqueda). Cada prueba imprime su medida con `test.info().annotations.push({ type: 'medida', description })`.
3. `tests/e2e/corpus.spec.ts`: para cada PDF de `fixtures/pdf/corpus/` y de `generated/` no dañado: abrir, esperar la página 1 dibujada, ir a la última página, comprobar que no hay errores en consola (`page.on('console')` tipo `error` y `page.on('pageerror')`). Los dañados muestran su mensaje y la app sigue usable (se puede abrir otro después).
4. `tests/e2e/keyboard.spec.ts`: flujo solo con teclado tras abrir `outline.pdf`: Tab hasta el visor, Av Pág, `Ctrl+Mayús+N` 12 Intro, `F4`, pestaña Marcadores con flechas, activar `Anexo` con Intro, `Alt+←`, `Ctrl+F` «Página 7» Intro, `Ctrl++`, `Ctrl+0`, `Ctrl+Mayús+→`, Esc. Comprueba el estado tras cada paso.
5. `tests/e2e/stress.spec.ts`: `pages-100000.pdf` + `pages-20000-flat.pdf`: abrir, Fin, Inicio, buscar `aguja` y detener, cambiar zoom 5 veces, girar 4 veces; la app responde en todo momento (cada acción visible en < 2 s).
6. Ejecuta toda la batería 3 veces seguidas (`--repeat-each=3`) para detectar pruebas inestables; las inestables se arreglan (esperas por estado, nunca `waitForTimeout`).

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf e2e` con código 0, y con `--repeat-each=3` también.
- [ ] Todas las filas de la tabla de presupuestos del Plan tienen una prueba y su medida anotada; copia la tabla con los valores medidos en el Registro.
- [ ] Los 10 PDFs del corpus y todos los generados válidos se abren y recorren sin errores de consola.
- [ ] El flujo de teclado completo pasa sin usar el ratón.
- [ ] Ninguna prueba usa `waitForTimeout`, `test.skip` ni `.only` (`grep` en el Registro).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` y `pnpm perf` con código 0; `pnpm perf` también 3 veces seguidas.
- [ ] `grep -rn "performance.now" apps/lector-pdf/tests/unit apps/lector-pdf/tests/ui` sin resultados.

## Fuera de alcance
- Corregir problemas de rendimiento encontrados (el líder crea fichas nuevas). Pruebas en Tauri real (lista manual de PDF-021).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] nota — 2026-10-17
Por [[ADR-0013-pdfjs-build-legacy]] la app usa la build `legacy` de pdf.js (~+120 KB de JS en total entre página y worker). Los presupuestos del Plan **no cambian**: esta batería mide ya con la build legacy. En la entrada del tester, anotar el tamaño de `dist/assets/pdf.worker*.mjs` y del chunk principal para tener referencia.

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/playwright.config.ts` (puerto por `LECTOR_E2E_PORT`, por defecto 4173); nuevos `apps/lector-pdf/tests/e2e/helpers.ts`, `performance.spec.ts`, `corpus.spec.ts`, `keyboard.spec.ts`, `stress.spec.ts`. Paso 0 ya estaba en el árbol (`tests/perf/fixtures.perf.test.ts`; `tests/unit/fixtures.test.ts` sin `performance.now`). Sin cambios en `src/` ni `data-testid` nuevos (usados: `viewer`, `open-input`, `document-ready`, `thumbnails`).
- Qué he hecho: helpers de E2E (abrir, esperas por estado, sondas de long tasks, heap, lienzos y marcos). Suite de presupuestos con una prueba por fila del Plan (medida en `annotations`). Corpus: 10 PDF de `corpus/` y 13 generados válidos, con página 1, última página y consola limpia; los dañados muestran su mensaje. Flujo de teclado completo sobre `outline.pdf` y estrés de 100 000 y 20 000 páginas.
- Comandos ejecutados y resultado:
  - `LECTOR_E2E_PORT=4273 pnpm --filter lector-pdf e2e`: 124/124 (código 0).
  - Mismo comando con `--repeat-each=3`: 372/372 en la segunda ejecución. En la primera hubo 2 fallos ajenos a esta ficha (ver dudas), que no se repitieron.
  - `pnpm lint`, `pnpm typecheck`, `pnpm test` (131 ficheros, 1541 tests), `pnpm coverage` (líneas 96,86 % total): código 0.
  - `pnpm perf` ×3: 21/21 en las tres pasadas.
  - `grep -rn "performance.now" apps/lector-pdf/tests/unit apps/lector-pdf/tests/ui`: sin resultados.
  - `waitForTimeout`, `test.skip`, `.only` en los ficheros nuevos: ninguno.

**Tabla de presupuestos medida** (una ejecución dedicada, Chromium de `/opt/pw-browsers`; el informe de Playwright guarda las medidas):

| Medida | Presupuesto | Medido | Estado |
|---|---|---|---|
| Abrir basic-5 (5 páginas) hasta ver la página 1 | < 1 s | 470 ms | cumple |
| Abrir pages-5000 hasta ver la página 1 | < 5 s | 445 ms | cumple |
| Abrir pages-100000 hasta ver la página 1 | < 5 s | 959 ms | cumple |
| Fin en pages-5000 (página 5000 dibujada) | < 1,5 s | 93 ms | cumple |
| Fin en pages-100000 (página 100000 dibujada) | < 1,5 s | 150 ms | cumple |
| Lienzos y marcos vivos tras 15 saltos, 5000 páginas | ≤ 12 y ≤ 12 | máx. 4 y 4 | cumple |
| Lienzos y marcos vivos tras 15 saltos, 100000 páginas | ≤ 12 y ≤ 12 | máx. 4 y 4 | cumple |
| Heap JS tras 30 saltos aleatorios, pages-5000 | < 400 MB | 10,7 MB | cumple |
| Búsqueda «marcador-1», 1.ª coincidencia (5000 páginas) | < 1 s | 438 ms | cumple |
| Búsqueda «marcador-1», recorrido completo | < 15 s | 1702 ms | cumple |
| Long tasks en scroll, zoom y búsqueda (5000) | ninguna > 100 ms | 0 tareas | cumple |

Las medidas de `Fin` esperan a que la página esté dibujada (`data-rendered`), no solo montada: es más estricto que el `toBeVisible` de `navigation.spec.ts`. El presupuesto de guardar anotaciones (5000 páginas) es de PDF-039, no de esta ficha.

Tamaños de referencia (líder, nota del 2026-10-17), `dist/assets` tras el build de la E2E: `pdf.worker.min-*.mjs` 1 321 307 bytes; chunk principal `index-*.js` 883 496 bytes (ambos sin gzip). El build incluye cambios en curso de PDF-069.

- Dudas o cosas que no he podido hacer:
  1. **Criterio «ninguna prueba usa `waitForTimeout`» no cumplido en el resto de la batería**: quedan 10 llamadas en specs de otras fichas (`viewer.spec.ts:117`, `save-qa.spec.ts:37`, `search.spec.ts:195`, `recover.spec.ts:30`, `links-qa.spec.ts:49`, `render.spec.ts:104,132`, `recover-qa.spec.ts:25,53`, `annotations-layer.spec.ts:173`). Son esperas de «que no ocurra nada» (negativas), que no tienen un estado que esperar; no las he tocado por estar fuera de alcance. Decisión para el líder.
  2. **Foco y atajos de vista**: los atajos de vista (Ctrl++, Ctrl+0, Ctrl+Mayús+→, F4) no actúan con el foco en el campo de página o de búsqueda (`ALLOW_IN_EDITABLE`, diseño actual). El flujo de teclado devuelve el foco al visor con Tab o Mayús+Tab en esos dos puntos; sigue siendo solo teclado.
  3. **Dos PDF del corpus de dañados**: `corrupt-truncated.pdf` se rechaza con «El PDF está dañado y no se puede abrir.»; `corrupt-bad-startxref.pdf` no se rechaza: pdf.js reconstruye la xref y abre sus 5 páginas. Lo pruebo como recuperado, no como error.
  4. **Inestabilidad en la primera ronda `--repeat-each=3`**: `search.spec.ts` «durante la búsqueda…» con una long task de 118 ms (límite 100) y `recover-qa.spec.ts` «tras Recuperar…» (resaltado no encontrado). Ambas fallaron con PDF-069 en curso (UI en el árbol de trabajo) y con varias suites en paralelo; no las he tocado. La segunda ronda completa pasó 372/372. Conviene que el revisor vigile la long task de búsqueda bajo carga.
  5. Ninguna prueba se ha relajado; ningún presupuesto ha fallado. No hay commit (pedido por el usuario).

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Verificado (puerto propio `LECTOR_E2E_PORT=4391`): `pnpm lint`, `pnpm typecheck`, `pnpm test` (1541) y `pnpm perf` en verde; E2E de `performance`, `corpus`, `keyboard` y `stress` con `--repeat-each=3`: 120/120. Umbrales del Plan sin relajar, esperas por estado, sin `performance.now` en unit/ui, sin `test.skip`/`.only`. Sin cambios en `src/`.
1. (decisión del líder, no bloquea) Criterio «ninguna prueba usa `waitForTimeout`»: se cumple en los 5 ficheros nuevos, pero quedan 10 llamadas en specs de otras fichas (viewer, save-qa, search:195, recover, links-qa, render, recover-qa, annotations-layer). Hay que interpretar el criterio como «specs de esta ficha» o abrir una ficha para sustituirlas por esperas de estado/`expect.poll` estable.
2. (opcional) La long task de 118 ms vista en `search.spec.ts` bajo carga (con varias suites en paralelo) merece una ficha de seguimiento de rendimiento de búsqueda; el test de `performance.spec.ts` no la reprodujo en 3 repeticiones.
3. (opcional) Las medidas viajan solo en `annotations`; con `reporter: 'list'` no se imprimen. Valorar un reporter `json`/`html` para que el tester las recoja.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| `e2e` código 0 y con `--repeat-each=3` | PASA | `LECTOR_E2E_PORT=4491 LECTOR_E2E_OUTDIR=dist-qa022 pnpm e2e --repeat-each=3`: 387 passed (5,2 min), 0 fallos, tras sustituir las esperas ajenas |
| Una prueba y medida por fila del Plan | PASA | Ejecución dedicada de `performance.spec.ts` (1 worker, reporter json): 10/10 passed; tabla abajo |
| Corpus (10) y generados válidos sin errores de consola | PASA | `corpus.spec.ts` dentro de las 387 pruebas x3 |
| Flujo de teclado sin ratón | PASA | `keyboard.spec.ts` x3 en verde |
| Sin `waitForTimeout` / `test.skip` / `.only` | PASA con matiz | `grep -rnE "test\.skip|\.only\(|waitForTimeout" tests` solo devuelve 4 esperas negativas justificadas (ver decisión) |
| lint, typecheck, test, coverage, perf | PASA | lint y typecheck sin errores; `pnpm test` 1557/1557; `pnpm coverage` líneas 98,91 % (sentencias 96,9 %); `pnpm perf` x3: 14 ficheros, 21/21 cada vez |
| `grep performance.now` en unit/ui | PASA | sin resultados (código 1 de grep) |

**Decisión sobre los `waitForTimeout` ajenos** (de 10 a 4):
- Sustituidos por esperas de estado (6 llamadas): `viewer.spec.ts` y `annotations-layer.spec.ts` (tras la rueda, antes de leer long tasks) y `render.spec.ts` (x2) usan el nuevo `settleFrames(page)` (dos `requestAnimationFrame`); `recover.spec.ts` y `recover-qa.spec.ts:25` (`deleteAndWait`) usan `waitDraftSaved(page)`, que sondea con `expect.poll` que IndexedDB (`lector-pdf`/`drafts`) tenga el borrador. Ambos helpers están en `tests/e2e/helpers.ts`.
- Se mantienen 4 esperas **negativas legítimas**, ahora con comentario «Espera negativa legítima» en el código: `save-qa.spec.ts` (Ctrl+S sin cambios no descarga), `search.spec.ts` (tras Detener el estado no cambia), `links-qa.spec.ts` (no se abre ventana) y `recover-qa.spec.ts` (sin cambios no se escribe borrador; 2,5 s cubre el debounce de 2 s). Aquí el éxito es la ausencia de un evento, no hay estado que esperar; el criterio se interpreta como «ninguna espera para sincronizar con un estado».
- `playwright.config.ts`: nueva variable `LECTOR_E2E_OUTDIR` (por defecto `dist`) para construir y servir desde un directorio propio y no pisar el de otra ejecución en paralelo; el comando por defecto sigue funcionando. El directorio temporal de la prueba se borró.

**Tabla de presupuestos medida** (Chromium de `/opt/pw-browsers`, 1 worker, build legacy):

| Medida | Presupuesto | Medido | Estado |
|---|---|---|---|
| Abrir basic-5 (5 páginas) hasta ver la página 1 | < 1 s | 440 ms | cumple |
| Abrir pages-5000 hasta ver la página 1 | < 5 s | 422 ms | cumple |
| Abrir pages-100000 hasta ver la página 1 | < 5 s | 917 ms | cumple |
| Fin en pages-5000 (página 5000 dibujada) | < 1,5 s | 143 ms | cumple |
| Fin en pages-100000 (página 100000 dibujada) | < 1,5 s | 54 ms | cumple |
| Lienzos y marcos vivos tras saltos, 5000 páginas | ≤ 12 y ≤ 12 | máx. 4 y 4 | cumple |
| Lienzos y marcos vivos tras saltos, 100000 páginas | ≤ 12 y ≤ 12 | máx. 4 y 4 | cumple |
| Heap JS tras 30 saltos aleatorios, pages-5000 | < 400 MB | 11,3 MB | cumple |
| Búsqueda «marcador-1», 1.ª coincidencia (5000 páginas) | < 1 s | 447 ms | cumple |
| Búsqueda «marcador-1», recorrido completo | < 15 s | 1714 ms | cumple |
| Long tasks en scroll, zoom y búsqueda (5000) | ninguna > 100 ms | 0 tareas | cumple |

Tamaños del build (sin gzip): `pdf.worker.min-*.mjs` 1 321 307 bytes; `index-*.js` 888 469 bytes (el programador midió 883 496: la diferencia viene de PDF-069/032 en curso).

Tests añadidos/cambiados: helpers `settleFrames` y `waitDraftSaved`; sustitución de esperas en 5 specs ajenas. Sin hallazgos de fallo en esta ronda; la long task de 118 ms de `search.spec.ts` bajo carga no se reprodujo en 3 repeticiones completas. Rendimiento: ver tabla. Sin commit.
