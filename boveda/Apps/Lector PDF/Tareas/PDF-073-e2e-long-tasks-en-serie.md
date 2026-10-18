---
tipo: tarea
id: PDF-073
titulo: Ejecutar las pruebas e2e de long tasks en un proyecto Playwright en serie
app: pdf
estado: hecha
depende_de: [PDF-075, PDF-076, PDF-077, PDF-078]
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, e2e, rendimiento]
---

# PDF-073 · Pruebas e2e de long tasks en serie

Plan: [[Apps/Lector PDF/Plan|Plan]] (secciones "Presupuestos" y "Comandos") · Decisiones: [[ADR-0016-e2e-long-tasks-en-serie]] (revisiones 1 y 2), [[PDF-078-reposo-cpu-antes-de-perf]], [[ADR-0012-suite-de-rendimiento]], [[ADR-0017-carga-diferida-de-pdfjs]], [[ADR-0018-vista-previa-del-trazo-en-canvas]] · Origen: [[PDF-039-e2e-anotaciones]] (ronda 2)

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
- [ ] ~~`pnpm --filter lector-pdf e2e` con código 0 tres veces seguidas, y `pnpm --filter lector-pdf e2e --repeat-each=3` con código 0.~~ Sustituido por los criterios de la sección «Replanificación (líder, 2026-10-18)».
- [ ] `git diff` no cambia ningún número de umbral, ni añade `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` con código 0.

## Fuera de alcance
- Optimizar la búsqueda o el scroll para ganar margen bajo los 100 ms (si una prueba falla también en serie, es una regresión real: anótala con su valor y devuelve la ficha al líder).
- Las pruebas de tiempo de reloj con margen amplio (no se etiquetan en esta ficha).
- `apps/lector-pdf/tests/perf/` (Vitest, ya en serie por [[ADR-0012-suite-de-rendimiento]]).

## Replanificación (líder, 2026-10-18)
Condición de medida (ADR-0016, revisión punto 2): antes de cada ejecución, `uptime` con carga de 1 min < 1,0 y `pgrep -fa "playwright|vitest|vite build"` vacío (salvo la propia ejecución). Pegar ambos en el Registro. Si la máquina está cargada, esperar a que baje; no ejecutar con carga y no repetir hasta que salga verde.

### Criterios de aceptación (sustituyen al 4.º de la lista original)
- [ ] `pnpm --filter lector-pdf e2e` con código 0 **tres veces seguidas**. En el Registro, por ejecución: totales y las anotaciones `carga-cpu-1min` y `long-tasks` de las 7 pruebas `@perf` (con `--reporter=list,json` o leyendo `test-results`), más «Tarea larga máxima» de `search` y `viewer` y `tarea-larga-maxima-ms` de `images-200`.
- [ ] Repetición ×3 de **toda** la batería, en dos órdenes (ninguna prueba se queda sin repetir):
  - `pnpm --filter lector-pdf e2e --project=chromium --repeat-each=3` → código 0 y total = 3 × (pruebas de `chromium`).
  - `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps --repeat-each=3` → código 0 y total = 21.
- [ ] Si alguna `@perf` falla: no repetir ni tocar nada; pegar su `perf-diagnostico.json` y la carga, y devolver la ficha al líder (`bloqueada`).
- [ ] Plan, línea «E2E» de «Comandos»: quitar «— vigente cuando PDF-073 esté hecha» (único cambio de la bóveda además de este Registro).
- [ ] El resto de criterios originales (listas, totales, `git diff`, lint/typecheck/test) se vuelven a comprobar con el estado final.

## Replanificación 2 (líder, 2026-10-18)
Tras la ronda 2 (`ink` 52 ms al soltar el ratón). Sustituye la «Condición de medida» y el 3.er criterio de la replanificación anterior; el resto sigue vigente.

**Condición de medida.** La garantiza la puerta de reposo de [[PDF-078-reposo-cpu-antes-de-perf]] antes de **cada** prueba `@perf` (ya no hace falta esperar a `uptime` < 1,0). Sí se mantiene: antes de cada ejecución, `pgrep -fa "playwright|vitest|vite build"` vacío (pegarlo), y no lanzar nada más en la máquina mientras dura la verificación.

**Criterios de aceptación (cambian estos dos; los demás de la sección anterior siguen)**
- [ ] Por ejecución, en el Registro, además de lo ya pedido (totales, `carga-cpu-1min`, `long-tasks`, máximos de `search`, `viewer`, `images-200`): las anotaciones `reposo-cpu` y `cpu-durante` de las 7 pruebas `@perf`.
- [ ] Si una `@perf` falla **por la puerta** («La máquina no está en reposo…»), no es una medida: anota el mensaje y las 5 filas de `top -b -n 1 -o %CPU | head -12`, espera a que termine el proceso ajeno y **empieza de cero** la serie de tres ejecuciones (eso no cuenta como repetir hasta que salga verde: no se midió nada).
- [ ] Si una `@perf` falla **por long tasks** (puerta pasada): no repetir ni tocar nada; pegar su `perf-diagnostico.json` completo (incluye `restBusy`, `cpuDuring`, `topProcesses`) y el `cpu-durante` de referencia de PDF-078, y devolver la ficha al líder (`bloqueada`).

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

### [lider] replanificación — 2026-10-18
Ronda 1 aceptada en lo hecho (configuración `chromium-perf` y 7 etiquetas `@perf`, commit `a54642d`): **no se repite**. La ficha vuelve a `pendiente`, `intentos: 0`, y queda solo la verificación, tras [[PDF-075-pdfjs-diferido]], [[PDF-076-vista-previa-trazo-canvas]] y [[PDF-077-diagnostico-long-tasks]]. Lo que se ha averiguado:
- **`images-200` (101 ms) es real y de la app.** Traza de Chromium, 4 ejecuciones aisladas: la única *long task* está a 70-100 ms de cargar la página, antes de abrir el PDF, y es `v8.evaluateModule` del chunk de entrada de 917 KB (67, 93, 96, 99 ms). El arranque congela la ventana casi 100 ms. Se arregla difiriendo pdf.js → [[ADR-0017-carga-diferida-de-pdfjs]], [[PDF-074-presupuesto-bundle-arranque]] (rojo previo) y [[PDF-075-pdfjs-diferido]]. Umbral sin cambios.
- **`ink` ([79, 145] ms) no se reproduce**: 6 ejecuciones aisladas, cero *long tasks* (el trazo de 2 000 pasos dura ~33 s porque cada paso espera un frame). Había otras baterías de agentes en la máquina (carga de 15 min > 2,5 en 4 núcleos). Pero el código tiene un coste O(n²) real por trazo y re-renderiza toda la capa en cada frame → [[ADR-0018-vista-previa-del-trazo-en-canvas]] y [[PDF-076-vista-previa-trazo-canvas]] (test rojo previo con `Profiler`). Umbral sin cambios.
- **`--repeat-each` no repite `chromium`**: es diseño de Playwright 1.56.1 (el `repeatEach` de la CLI solo se aplica a proyectos `top-level`; un proyecto que es dependencia de otro seleccionado siempre es `dependency`; ver `lib/runner/loadUtils.js` y `projectUtils.js`). Se cumple el criterio lanzando los dos proyectos por separado (abajo). Detalle en [[ADR-0016-e2e-long-tasks-en-serie]], «Revisión 2026-10-18».
- Para clasificar futuros rojos, cada prueba `@perf` adjuntará instante y duración de cada *long task* y la carga de CPU → [[PDF-077-diagnostico-long-tasks]].

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: esta ficha (`estado` y este Registro). Sin cambios de código ni de Plan: la configuración y las 7 etiquetas `@perf` ya están en `a54642d` y coinciden con la ficha; la línea «E2E» del Plan no se ha tocado porque el criterio de cierre no se cumple.
- Qué he hecho: he esperado a la condición de medida, he verificado listados y etiquetas, y he lanzado la batería completa (`pnpm --filter lector-pdf e2e`) con reporter JSON. La ejecución 1 pasa. La ejecución 2 falla una prueba `@perf` (`ink`). Según la ficha no repito, no toco nada y devuelvo la ficha al líder (`bloqueada`). No he lanzado la ejecución 3 ni las repeticiones ×3.
- Condición de medida (antes de cada ejecución), `uptime` y sin procesos de test:
  - Antes de la ejecución 1: `11:11:43 up 17 min, load average: 0.08, 1.42, 1.50`; `/proc/loadavg` 0,14; sin procesos `playwright|vitest|vite build`.
  - Antes de la ejecución 2: `11:20:46 up 26 min, load average: 0.12, 0.83, 1.33`; sin procesos de test.
- Comandos ejecutados y resultado:
  - `playwright test --list` (sin filtro): **160 tests en 41 ficheros** (antes de la ronda 1 eran 156). Son 153 de `chromium` + 7 de `chromium-perf`, así que ninguna se pierde ni se duplica. La diferencia de +4 respecto a 156 no la causa esta ficha (no lo he comprobado test a test; probablemente las pruebas añadidas por PDF-075 y PDF-076).
  - `--list --project=chromium-perf --no-deps`: **7 tests**, las de la tabla (`annotations-layer`, `annotations-performance`, `ink`, `performance`, `render`, `search`, `viewer`).
  - `--list --project=chromium`: 153 tests; `grep -c "@perf"` = **0**.
  - `pnpm --filter lector-pdf e2e`, **ejecución 1**: código 0, **160 pasan**, 0 fallos.
  - `pnpm --filter lector-pdf e2e`, **ejecución 2**: código 1, **159 pasan y 1 falla**: `ink.spec.ts` «dibujar un trazo de 2 000 eventos no produce long tasks» (`chromium-perf`). Esperaba `[]` y recibió **[52] ms**.
  - Anotaciones de las 7 pruebas `@perf` (carga inicial → final; long tasks):

    | Prueba | Ejec. 1 | Ejec. 2 |
    |---|---|---|
    | annotations-layer | 3,78 → 3,78; ninguna | 5,10 → 5,10; ninguna (máx. 0 ms) |
    | annotations-performance | 3,78 → 3,47; ninguna | 4,69 → 4,69; ninguna |
    | ink | 3,47 → 2,52; ninguna | **4,69 → 3,13; 51 ms @ 51 ms, 52 ms @ 33 957 ms (falla)** |
    | performance | 2,52 → 2,56; ninguna | 2,96 → 2,88; ninguna |
    | render (`images-200`) | 2,56 → 2,56; ninguna (máx. 0 ms) | 2,88 → 2,88; 54 ms @ 71 ms (máx. 54 ms) |
    | search | 2,56 → 2,67; ninguna (máx. 0 ms) | 2,88 → 2,88; ninguna (máx. 0 ms) |
    | viewer | 2,67 → 2,67; 56 ms @ 47 ms (máx. 56 ms) | 2,89 → 2,89; ninguna (máx. 0 ms) |

  - Ficha de la prueba fallida (`perf-diagnostico.json`, adjunto del reporte JSON): `entries` = `[{start: 51, duration: 51}, {start: 33957, duration: 52}]`, `loadStart` 4,69, `loadEnd` 3,13, 4 núcleos, procesos top: `headless_shell` 55,7 %, `headless_shell` 26,8 %, `node` 14,2 %, `headless_shell` 11,5 %, `node` 9,2 %.
  - `pnpm lint`: código 0. `pnpm typecheck`: código 0. `pnpm test`: código 0 (147 ficheros, 1724 tests).
  - Comprobaciones de la ficha que no dependen de la batería: `grep -ln "longTasks\|longtask"` da solo los 7 ficheros de la tabla. `git diff` de esta ronda no toca umbrales ni añade `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout`.
- Dudas o cosas que no he podido hacer:
  - **Bloqueada por fallo de un `@perf`** (criterio «si alguna @perf falla: no repetir ni tocar nada»). Pendiente del líder: decidir si `ink` debe optimizarse o si el presupuesto es intermitente (no está previsto en ADR-0016).
  - Observación para el líder, sin investigar a fondo: la carga de 1 min al empezar `ink` era **4,69**, aunque la comprobación previa daba 0,12. La carga la heredó del proyecto `chromium` (2 workers) que acababa de terminar, y el `webServer` hace `vite build` al arrancar. Así, la condición «carga < 1,0 antes de la ejecución» no garantiza un arranque tranquilo del proyecto `chromium-perf`. Esto puede explicar también el 101 ms de `images-200` de la ronda 1 (carga 3,13 aquí). Conviene decidirlo en ADR-0016.
  - La ejecución 3 y la repetición ×3 de `chromium` y de `chromium-perf` no se han hecho, por la condición de la ficha.

### [lider] replanificación 2 — 2026-10-18
Ronda 2 aceptada en lo verificado (listas 160 = 153 + 7, `@perf` solo en `chromium-perf`, lint/typecheck/test verdes). La ficha vuelve a `pendiente`, `intentos: 0`, tras [[PDF-078-reposo-cpu-antes-de-perf]]. Diagnóstico del rojo de `ink` (52 ms @ 33 957 ms, es decir, al soltar):
- **No es una regresión de la app.** Trazas de Chromium de la misma prueba con la máquina en reposo: sin limitar CPU, ninguna tarea del hilo principal pasa de 18,5 ms en los 35 s del trazo y el `pointerup` procesa en 9-11 ms (Event Timing). Con la CPU limitada ×2 sigue sin *long tasks* (tarea del `pointerup`: 22,6 ms). Solo con ×3 aparece una (197 ms, a mitad del trazo). El coste real está a más de ×2 del umbral de 50 ms de esta prueba: para llegar a 52 ms algo tuvo que quitarle CPU al navegador. No se crea ficha de optimización; los umbrales no cambian.
- **Por qué la condición de medida no lo evitó**: `loadavg` va con ~1 min de retraso (0,12 antes de lanzar, 4,69 al empezar `ink`, heredado del proyecto `chromium` y de las `@perf` anteriores) y no mide si la CPU está libre en ese instante; y `ps -o pcpu` de PDF-077 es la media de toda la vida de cada proceso, no su uso actual, así que el «top 5» de la ronda 2 no dice quién usaba la CPU. No sabemos si hubo intruso; sí sabemos que no lo podíamos saber.
- **Decisión** ([[ADR-0016-e2e-long-tasks-en-serie]], «Revisión 2»): puerta de reposo antes de cada prueba `@perf` midiendo la CPU real con `os.cpus()` (< 15 % en 3 ventanas seguidas de 1 s, máximo 150 s; si no, la prueba **falla** con mensaje claro, no se salta), y diagnóstico con `cpu-durante` y `top` actual → [[PDF-078-reposo-cpu-antes-de-perf]]. La verificación de esta ficha se repite entera tras PDF-078.

### [programador] ronda 3 — 2026-10-18
- Ficheros cambiados: esta ficha (`estado` y este Registro); `boveda/Apps/Lector PDF/Plan.md` (línea «E2E» de «Comandos»: quitado «— vigente cuando PDF-073 esté hecha», criterio de la replanificación). Sin cambios de código: configuración y etiquetas `@perf` ya están en `a54642d` y la puerta de reposo en `0524aac` (PDF-078).
- Qué he hecho: he esperado a que no hubiera otras baterías (otra sesión tenía dos `node` busy-loop de 200 s; terminaron solos antes de empezar). Comprobados listados, etiquetas, `grep longtask` y ausencia de umbrales/`retries`/`test.skip`/`.only`/`fixme` nuevos. Lanzadas tres ejecuciones seguidas de la batería, y las repeticiones ×3 por proyecto. Todo en verde; sin fallos de `@perf`, así que no hubo que devolver nada al líder.
- Condición de medida (antes de cada ejecución):
  - `uptime` antes de la ejecución 1: `12:00:07 up 1:06, load average: 0.29, 1.34, 1.55`. Antes de cada ejecución y de cada repetición: `ps` sin `playwright|vitest|vite build` (vacío).
  - La carga de 1 min sube a 4-6 durante el proyecto `chromium` (heredada, como se vio en la ronda 2); la puerta de reposo pasó en las 7 pruebas de cada ejecución (`reposo-cpu` 0-5 %).
- Comandos ejecutados y resultado:
  - `playwright test --list` (sin filtro): **160 tests en 41 ficheros** (igual que la ronda 2). `--list --project=chromium-perf --no-deps`: **7 tests** (las de la tabla). `--list --project=chromium`: **153 tests**; `grep -c "@perf"` = **0**.
  - `grep -ln "longTasks\|longtask" apps/lector-pdf/tests/e2e/*.spec.ts`: los 7 ficheros de la tabla.
  - `pnpm --filter lector-pdf e2e`, **ejecuciones 1, 2 y 3: código 0, 160 pasan, 0 fallos** (3,7 min cada una). Anotaciones de las 7 `@perf` (carga inicial → final; `reposo-cpu`; `cpu-durante`; long tasks):

    | Prueba | Ejec. 1 | Ejec. 2 | Ejec. 3 |
    |---|---|---|---|
    | annotations-layer | 5,86→5,86; 1 %; 43 %; ninguna | 5,06→4,82; 1 %; 44 %; ninguna | 5,72→5,72; 1 %; 43 %; ninguna |
    | annotations-performance | 5,39→5,11; 2 %; 36 %; 61 ms @ 59 ms | 4,43→4,08; 1 %; 43 %; ninguna | 5,26→5,00; 1 %; 42 %; ninguna |
    | ink | 4,70→2,94; 1 %; 26 %; 55 ms @ 51 ms | 4,08→2,72; 0 %; 29 %; ninguna | 4,60→3,10; 1 %; 29 %; ninguna |
    | performance | 2,94→2,79; 1 %; 40 %; 50 ms @ 44 ms | 2,51→2,71; 1 %; 46 %; ninguna | 2,85→2,71; 1 %; 48 %; ninguna |
    | render (`images-200`) | 2,56→2,84; 1 %; 41 %; ninguna | 2,49→2,49; 1 %; 40 %; 70 ms @ 48 ms | 2,49→2,49; 1 %; 44 %; 52 ms @ 51 ms |
    | search | 2,84→2,85; 1 %; 56 %; ninguna | 2,29→2,29; 1 %; 54 %; ninguna | 2,37→2,37; 1 %; 55 %; ninguna |
    | viewer | 2,85→2,62; 1 %; 36 %; ninguna | 2,11→2,10; 1 %; 39 %; 50 ms @ 48 ms | 2,58→2,45; 0 %; 40 %; ninguna |

    Tarea larga máxima de `search` / `viewer`: ejecución 1 ninguna / ninguna; ejecución 2 ninguna / 50 ms; ejecución 3 ninguna / ninguna. Tarea larga de `images-200` (`render`): 0 / 70 / 52 ms. Ninguna supera 100 ms.
  - Repetición ×3 de toda la batería, por proyectos: `e2e --project=chromium --repeat-each=3`: **código 0, 459 pasan** (= 3 × 153), 7,1 min. `e2e --project=chromium-perf --no-deps --repeat-each=3`: **código 0, 21 pasan** (= 3 × 7), 4,2 min. Long tasks de las repeticiones: `images-200`, `search`, `annotations-layer`, `annotations-performance`, `ink` sin long tasks en las tres; `pages-5000` 52 ms @ 58 ms en la repetición 3; `viewer` 53 ms @ 54 ms en la 2; ninguna supera 100 ms.
  - `pnpm lint`: código 0. `pnpm typecheck`: código 0. `pnpm test`: código 0 (148 ficheros, 1732 tests).
  - `git diff` de la batería (desde `385ad77^`): ningún umbral cambiado, ningún `retries`, `test.skip`, `.only`, `test.fixme` ni `waitForTimeout` añadido (los `waitForTimeout` de `search`, `save-qa`, `links-qa` y `recover-qa` son anteriores a esta ficha).
- Dudas o cosas que no he podido hacer:
  - La ficha pide «Tarea larga máxima» y `tarea-larga-maxima-ms` en el Registro; el fixture no crea esa anotación (solo `long-tasks`, con la duración y el instante de cada tarea). He puesto esos valores, sacados de `long-tasks`.
  - `cpu-durante` (26-56 %) es más alto que la referencia de PDF-078 (27 % en `ink` aislado) en pruebas que se ejecutan con otro proceso de Chromium en la misma máquina. Solo es un dato, la puerta pasó siempre.
  - Quedan a la espera del revisor. PDF-039 sigue esperando a esta ficha.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Sin relanzar la batería e2e (verificada 3 veces por el programador, 3 ejecuciones + ×3 por proyecto, todo en código 0).
1. Configuración: `apps/lector-pdf/playwright.config.ts` coincide con la ficha (proyectos `chromium` con `grepInvert` y `chromium-perf` en serie con `dependencies`); `workers: 2`, `retries: 0`, `timeout` y `webServer` intactos.
2. Listados reejecutados: total 160; `chromium-perf --no-deps` = 7 (las de la tabla); `chromium` con `@perf` = 0. `@perf` aparece 1 vez en cada uno de los 7 ficheros; `longtask` solo en esos 7.
3. Diff de las 7 specs desde `a54642d^`: solo la etiqueta `{ tag: '@perf' }` y el cambio de import al fixture `perf-fixture`; ningún umbral, `retries`, `skip`, `only`, `fixme` ni `waitForTimeout` nuevos. Umbrales de la puerta de reposo (15 %, 3 ventanas de 1 s, 150 s) conformes a ADR-0016 rev. 2 y fallan (no saltan).
4. Plan: línea «E2E» actualizada y coherente con ADR-0016. Lint/typecheck/test reportados en verde (1732 tests).
Sin problemas bloqueantes. (opcional) Las anotaciones `tarea-larga-maxima-ms` no existen; ya documentado por el programador.

### [tester] ronda 1 — 2026-10-18 — PASA
Una sola ejecución completa, sin otras baterías en paralelo (antes: `uptime` carga 1 min 1,23; `pgrep playwright|vitest|vite build` vacío).
| Criterio | Resultado | Evidencia |
|---|---|---|
| `chromium-perf --no-deps` lista 7 | OK | `Total: 7 tests in 7 files` |
| `chromium` sin `@perf` | OK | `grep -c "@perf"` = 0 |
| Total sin filtro | OK | 160 en 41 ficheros (153 + 7) |
| `e2e` código 0 | OK | `160 passed (3.7m)`, EXIT=0; las 7 `@perf` en verde (annotations-layer 2,4 s, annotations-performance 4,8 s, ink 34,4 s, performance 4,8 s, render 2,5 s, search 1,5 s, viewer 3,0 s); la puerta de reposo no saltó |
| Umbrales/retries/skip/only/fixme/waitForTimeout | OK | `git diff a54642d^` sin líneas añadidas con esos términos |
| lint / typecheck / test | OK | los tres con código 0 |
| `grep longtask` | OK | solo los 7 ficheros de la tabla |
Nota: no se repitieron las series ×3 (ya verificadas por el programador en la ronda 3 y aprobadas por el revisor); esta ronda fue una ejecución completa, como pidió la coordinación. Sin fallos `@perf`, no hizo falta repetir por reposo.
Tests añadidos: ninguno. Rendimiento: sin long tasks > 100 ms en las 7 pruebas.
