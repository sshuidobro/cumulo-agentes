---
tipo: decision
id: ADR-0016
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
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
