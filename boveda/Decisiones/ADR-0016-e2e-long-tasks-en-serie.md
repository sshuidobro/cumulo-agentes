---
tipo: decision
id: ADR-0016
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-19
tags: [decision, pdf, e2e, rendimiento]
---

# ADR-0016 · Las pruebas e2e de *long tasks* se ejecutan en serie, sin carga concurrente

## Contexto
El presupuesto «nada bloquea el hilo principal más de 100 ms» (Plan, sección "Presupuestos"; skill `calidad-profesional`) se mide en Playwright con `PerformanceObserver({ type: 'longtask' })`. La batería e2e corre con `workers: 2`. En [[PDF-039-e2e-anotaciones]] (ronda 2), dos pruebas ya existentes fallaron por 1-17 ms solo con la batería completa en paralelo (`search.spec.ts` 101 y 117 ms; `viewer.spec.ts` 102 ms) y pasan aisladas: la otra ventana de Chromium compite por la CPU y alarga las tareas medidas. La medida es de la app, no de la máquina cargada. Relacionado: [[ADR-0012-suite-de-rendimiento]] (los asserts de reloj de Vitest ya van en serie).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Subir el umbral (p. ej. 150 ms) | Trivial | Relaja el presupuesto: prohibido | — |
| `retries` para esas pruebas | Trivial | Oculta regresiones reales; un rojo intermitente pasa por verde | — |
| `workers: 1` para toda la batería | Sencillo | La batería tarda el doble | — |
| Proyecto Playwright `chromium-perf` con `workers: 1`, que arranca cuando termina el proyecto paralelo (`dependencies`), y pruebas etiquetadas `@perf` | Mide sin carga concurrente; el resto sigue en paralelo; un solo `webServer` | Hay que etiquetar cada prueba nueva de *long tasks*; si falla el proyecto paralelo, el de rendimiento no se ejecuta | Apache-2.0 (Playwright, ya en uso) |

## Decisión
Proyecto `chromium-perf` en `apps/lector-pdf/playwright.config.ts`: `grep: /@perf/`, `workers: 1`, `fullyParallel: false`, `dependencies: ['chromium']`. El proyecto `chromium` lleva `grepInvert: /@perf/`. Toda prueba e2e que mida *long tasks* lleva `{ tag: '@perf' }`. Los umbrales no cambian y no hay reintentos.

## Consecuencias
- Las medidas de *long tasks* son estables y comparables entre ejecuciones; un rojo en `chromium-perf` es una regresión real.
- Si una prueba del proyecto `chromium` falla, Playwright no ejecuta `chromium-perf` (las cuenta como no ejecutadas, y el código de salida ya es distinto de 0).
- Regla para fichas futuras: una prueba nueva que lea `longtask` sin `@perf` es motivo de rechazo del revisor.
- Las pruebas de tiempo de reloj con margen amplio (apertura < 1 s, guardar < 1 s…) siguen en el proyecto paralelo; si alguna se vuelve intermitente por carga, se etiqueta `@perf` con el mismo criterio.

## Revisión 2026-10-18 (tras [[PDF-073-e2e-long-tasks-en-serie]], ronda 1)
Se mantiene la decisión. Tres precisiones:
1. **`--repeat-each` no repite proyectos de dependencia.** Es diseño de Playwright 1.56.1, no un fallo: en `lib/runner/loadUtils.js` el `repeatEach` de la línea de comandos solo se aplica a los proyectos `top-level`, y `buildProjectsClosure` (`lib/runner/projectUtils.js`) marca `chromium` como `dependency` en cuanto `chromium-perf` está seleccionado (la dependencia gana aunque también se pida con `--project`). Por eso la ronda 1 dio 170 = 149 + 7 × 3. Para repetir toda la batería sin tocar la configuración se lanzan los dos proyectos por separado: `e2e --project=chromium --repeat-each=3` (149 × 3) y `e2e --project=chromium-perf --no-deps --repeat-each=3` (7 × 3). No se añade `repeatEach` a la configuración.
2. **Las medidas no solo compiten con Playwright, también con otros procesos de la máquina** (4 núcleos; otras fichas lanzan Vitest o builds en paralelo). La verificación de `chromium-perf` se hace con la máquina en reposo (sin otros `playwright`/`vitest`/`vite build` en marcha y carga de 1 min < 1,0) y cada prueba `@perf` anota la carga de CPU ([[PDF-077-diagnostico-long-tasks]]). Esto no cambia ningún umbral: documenta las condiciones de medida.
3. **Un rojo en `chromium-perf` se diagnostica antes de clasificarlo.** De los dos rojos de la ronda 1, uno era real y de la app (arranque de ~100 ms, [[ADR-0017-carga-diferida-de-pdfjs]]) y el otro no se reprodujo en 6 repeticiones, pero señaló un coste O(n²) real ([[ADR-0018-vista-previa-del-trazo-en-canvas]]). Regla adicional: las pruebas `@perf` importan `test`/`expect` de `tests/e2e/perf-fixture.ts`, que adjunta las *long tasks* con su instante y la carga de la máquina.

## Revisión 2 · 2026-10-18 (tras [[PDF-073-e2e-long-tasks-en-serie]], ronda 2)
**Síntoma.** Batería completa, ejecución 2: `ink` «trazo de 2 000 eventos» dio una *long task* de 52 ms justo al soltar el ratón (instante 33 957 ms), con carga de 1 min 4,69 al empezar la prueba aunque antes de lanzar la batería era 0,12.

**Diagnóstico del líder (trazas de Chromium, máquina en reposo).**
- La prueba aislada, sin limitar CPU: ninguna tarea del hilo principal pasa de 18,5 ms en todo el trazo; el `pointerup` procesa en 9-11 ms.
- Con la CPU limitada ×2 (`Emulation.setCPUThrottlingRate`): ninguna *long task*; la tarea del `pointerup` dura 22,6 ms. Con ×3 aparece una de 197 ms a mitad del trazo.
- Conclusión: no es una regresión de la app (el coste real al soltar es ~10-20 ms, a más de ×2 del umbral de 50 ms de esta prueba). Hace falta que algo quite CPU al navegador para llegar a 52 ms.
- **Las dos métricas de reposo que usábamos engañan**: `loadavg` es una media exponencial de ~1 min (tras el proyecto `chromium` con 2 workers sigue alta un par de minutos, aunque la CPU ya esté libre, y no detecta un pico corto), y `ps -o pcpu` es la media de **toda la vida** del proceso, no su uso actual. Con ellas no se puede saber si la CPU estaba libre cuando empezó la prueba ni si alguien la usó durante ella.

**Opciones.**
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| Subir el umbral o reintentar `ink` | Trivial | Prohibido (relaja el presupuesto / oculta regresiones) |
| Comprobar `loadavg` < 1,0 antes de la batería (lo vigente) | Ya escrito | No cubre el arranque de `chromium-perf` ni cada prueba; `loadavg` va con retraso |
| Espera fija (p. ej. 60 s) antes de `chromium-perf` | Sencilla | No garantiza nada si hay otra carga; alarga siempre |
| **Puerta de reposo por prueba `@perf` midiendo la CPU real** (`os.cpus()`, diferencias de tiempos entre muestras de 1 s) y diagnóstico con la CPU real durante la prueba | Garantiza la condición de medida justo antes de cada medida; multiplataforma; si la máquina no se calma, la prueba **falla** con un mensaje claro (no se salta) | Alarga la batería unos segundos por prueba; si otro proceso arranca a mitad de una prueba no se evita, pero queda registrado |

**Decisión.** Puerta de reposo en `tests/e2e/perf-fixture.ts`, solo para pruebas `@perf`, antes de que la prueba empiece: esperar hasta que la CPU total de la máquina esté por debajo del **15 %** en **3 ventanas seguidas de 1 s**, con un máximo de **150 s**; si no se alcanza, la prueba falla con «La máquina no está en reposo…». El diagnóstico añade `reposo-cpu` (CPU al pasar la puerta y espera) y `cpu-durante` (CPU media de la máquina durante la prueba), y los procesos con más CPU se toman con `top` (uso actual), no con `ps`. Umbrales de *long tasks* sin cambios; sin reintentos. Ficha: [[PDF-078-reposo-cpu-antes-de-perf]].

**Consecuencias.**
- La condición «carga de 1 min < 1,0 antes de lanzar» de las fichas deja de ser necesaria para la validez de la medida (la garantiza la puerta); se mantiene la regla de no lanzar otras baterías en paralelo durante una verificación.
- Si una `@perf` falla con la puerta pasada y `cpu-durante` normal (cercana al valor de referencia en reposo que deja anotado [[PDF-078-reposo-cpu-antes-de-perf]], que es lo que gasta el propio Chromium de la prueba), es una regresión de la app y se optimiza. Si `cpu-durante` es claramente mayor, se busca el proceso intruso en `top` antes de nada.

## Revisión 3 · 2026-10-19 (tras [[PDF-090-e2e-iteracion-3]], ronda 2)
- `ink.spec.ts` «2 000 eventos» falla 2/15 con una *long task* de 51-62 ms **durante el trazo**, con la puerta pasada y `cpu-durante` normal (28-29 %). Por la consecuencia anterior, se trata como regresión de la app.
- **Decisión.** Umbral sin cambios (50 ms del observador, cero entradas). Antes de optimizar, se **atribuye** la tarea con una traza de Chromium (`browser.startTracing`, categorías `devtools.timeline`, `disabled-by-default-devtools.timeline`, `disabled-by-default-v8.cpu_profiler`, `v8.gc`) de una repetición fallida; la corrección depende del hijo dominante de la tarea (ver la ficha). La instrumentación de traza no se versiona.
