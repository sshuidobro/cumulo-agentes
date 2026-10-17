---
tipo: decision
id: ADR-0012
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, pruebas, rendimiento, cobertura]
---

# ADR-0012 · Suite de rendimiento separada (`pnpm perf`)

## Contexto
[[PDF-006-layout-virtual]] quedó bloqueada: sus asserts de tiempo (`performance.now()`) pasan en `pnpm test`, pero fallan en `pnpm coverage` porque la instrumentación de `@vitest/coverage-v8` multiplica el tiempo de los bucles calientes (`pageAtY` 1 000 000 de consultas: 230 ms sin cobertura, 820-1 155 ms con ella; presupuesto 300 ms). Además los tests unitarios corren en paralelo y el ruido de los demás ficheros afecta a las medidas. La skill `pruebas-calidad` exige presupuestos de rendimiento y cobertura ≥ 80 % de `core/`; ninguna de las dos cosas se puede relajar. Hay otros asserts de tiempo en el mismo caso: [[PDF-002-fixtures-paginas]], [[PDF-023-modelo-anotaciones]] y fichas pendientes (PDF-005, 016, 017, 025, 035, 036).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Relajar presupuestos bajo cobertura (multiplicador si `coverage`) | Un solo comando | Mide otra cosa; presupuesto falso; prohibido por el usuario | — |
| Solo `vitest bench` con umbral | Herramienta pensada para medir | `bench` de Vitest 5 no falla por umbral; habría que escribir el assert igualmente; API cambiante | MIT |
| `test.skipIf(coverage)` dentro de `tests/unit/` | Cambio mínimo | Es saltar tests en una ejecución; confuso; ruido de paralelismo sigue | — |
| **Suite aparte `tests/perf/*.perf.test.ts` + `pnpm perf`** sin cobertura y en serie | Presupuestos intactos y medidos en condiciones limpias; cobertura no afectada; regla simple | Un comando más en la comprobación de cada ficha | MIT (Vitest ya instalado) |

## Decisión
Los asserts de **tiempo de reloj** (`performance.now()`) viven solo en `apps/<app>/tests/perf/**/*.perf.test.ts` y `packages/<pkg>/tests/perf/**/*.perf.test.ts`, y se ejecutan con `pnpm perf` (configuración `vitest.perf.config.ts` en la raíz: sin cobertura, ficheros en serie). `pnpm test` y `pnpm coverage` no los incluyen. Los presupuestos no cambian. Medición estándar: 1 pasada de calentamiento descartada y el mínimo de 5 pasadas (helper `measureBest`). `pnpm perf` con código 0 pasa a ser parte de la comprobación de toda ficha que tenga criterios de tiempo.

## Consecuencias
- Cobertura y rendimiento se miden por separado y cada uno de forma honesta.
- Los tests de comportamiento de esas funciones (resultado correcto con 1 000 000 de páginas, etc.) siguen en `tests/unit/` y cuentan para cobertura; en `tests/perf/` solo va el assert de tiempo.
- Los relojes falsos (`now` inyectado, p. ej. agrupación de deshacer en < 500 ms) **no** son asserts de tiempo de reloj y se quedan en `tests/unit/`.
- `bench` de Vitest sigue siendo opcional e informativo (`pnpm exec vitest bench --run`); no es puerta de calidad.
- Vigilar: márgenes estrechos (p. ej. `pageAtY` 231 ms frente a 300 ms). Si la máquina del usuario es más lenta, se revisa el algoritmo, no el umbral.
- COM-002 (`packages/shared`, hecha) tiene un assert de tiempo con margen 16× en `tests/`; se mueve a `tests/perf/` cuando se toque ese paquete (anotado en [[Apps/Comun/Plan|Plan de Comun]]).
