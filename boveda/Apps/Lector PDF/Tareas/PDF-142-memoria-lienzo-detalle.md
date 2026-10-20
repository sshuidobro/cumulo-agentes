---
tipo: tarea
id: PDF-142
titulo: Regresión de memoria del lienzo de detalle con zoom alto (385 MB > 300 MB)
app: pdf
estado: bloqueada
depende_de: []
intentos: 0
skills: [pruebas-calidad, stack-typescript-react, formatos-ofimatica]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, rendimiento, regresion, detalle]
---

# PDF-142 · Regresión de memoria del lienzo de detalle con zoom alto

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0025-lienzo-de-detalle]], [[ADR-0012-suite-de-rendimiento]], [[ADR-0016-e2e-long-tasks-en-serie]] · Origen: [[PDF-095-pestanas]] (Registro, ronda 5) · Relacionadas: [[PDF-051-lienzo-de-detalle]], [[PDF-141-e2e-rojos-en-head]]

## Objetivo
Que `tests/e2e/detail.spec.ts:212` («con zoom alto, 20 s de desplazamiento…», `@perf`) vuelva a pasar **sin tocar el presupuesto** `MAX_CANVAS_MB = 300` ni `MAX_LIVE_CANVASES_PER_PAGE = 13`. Hoy falla de forma determinista con 385–389 MB de lienzos vivos. PDF-051 lo daba por bueno (código en `2f33d73`, registro en `defec48`), así que es una regresión del código, no del presupuesto (decisión del líder, 2026-10-20).

## Contexto
- Prueba: `apps/lector-pdf/tests/e2e/detail.spec.ts:212-237` (cálculo de MB en 230-236; constantes en líneas 8-9).
- Código del detalle: `apps/lector-pdf/src/core/detail.ts` (zona de detalle) y `apps/lector-pdf/src/ui/viewer/PageView.tsx` (lienzo base + detalle). Visor: `apps/lector-pdf/src/ui/viewer/Viewer.tsx`.
- ADR-0025 opción A: un lienzo de detalle por página visible, del tamaño de página ∩ visor + 25 % de margen. Memoria esperada ≤ tamaño del visor × densidad por página visible.
- Commits sospechosos entre `defec48` (bueno según PDF-051) y HEAD que tocan render o lienzos: `00fd66f` (OCR, PDF-133), `d993057` (PDF-107, formas y sellos editables: posible lienzo extra por página), `8a53421`/`2f33d73`. `813a19b` solo cambia el foco en `Viewer.tsx` (pestañas) y no es sospechoso.
- Lanzar perf con la máquina en reposo (ADR-0016): `cd apps/lector-pdf && pnpm exec playwright test tests/e2e/detail.spec.ts:212 --project=chromium-perf --no-deps`.

## Qué hay que hacer
1. **Confirmar en `defec48`** (en un `git worktree` aparte, sin tocar la rama de trabajo: `git worktree add ../wt-bisect defec48`, `pnpm install --frozen-lockfile`): la prueba pasa y anota los MB medidos. Si **no** pasa en `defec48`, para y escribe en el Registro los MB de `defec48` y HEAD; el líder decide.
2. **Bisectar** en ese worktree: `git bisect start HEAD defec48` y `git bisect run` con un script en el scratchpad que ejecute la prueba anterior (código ≠ 0 = malo; si el build falla, `exit 125`). Anota el primer commit malo.
3. **Diagnosticar** en HEAD con un `page.evaluate` temporal (no se commitea) que liste `canvas` vivos con `width`, `height`, `className`/`data-testid` y página padre. Identificar qué lienzos sobran (p. ej. lienzos de detalle de páginas ya no visibles, lienzo de anotaciones u OCR a resolución de zoom, lienzos huérfanos al cambiar zoom).
4. **Corregir en `src/`** la causa (liberar con `canvas.width = canvas.height = 0` al desmontar/salir de vista, limitar el lienzo extra al tamaño de la zona visible como el de detalle, o no crearlo a zoom alto), según lo que muestre el paso 3. Si la corrección exige cambiar la arquitectura de ADR-0025 o de la capa que lo provoca, para y pide decisión al líder en el Registro.
5. Test unitario en `tests/unit/` del cálculo o de la liberación corregida (el que corresponda a la causa).
6. Quitar el worktree (`git worktree remove ../wt-bisect`).

## Criterios de aceptación
- [ ] Registro con: MB en `defec48`, primer commit malo según `git bisect`, lista de lienzos que sobraban y la causa.
- [ ] `detail.spec.ts:212` en `chromium-perf` pasa **3 veces seguidas** en reposo; MB medidos ≤ 300 anotados en el Registro. `MAX_CANVAS_MB` y `MAX_LIVE_CANVASES_PER_PAGE` sin cambios (`git diff` de esas líneas vacío).
- [ ] `detail.spec.ts` completo, `tabs-performance.spec.ts`, `render.spec.ts` y `performance.spec.ts` siguen en verde.
- [ ] La función corregida (zona visible, nitidez a 6 400 %, anotaciones u OCR, la que sea) sigue igual: `detail.spec.ts` (6 400 % legible) y los E2E de la función del commit culpable pasan.
- [ ] Test unitario nuevo que falla antes del arreglo y pasa después.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `pnpm --filter lector-pdf e2e` con código 0 (salvo fallos ya asignados a PDF-141, citados por nombre).

## Fuera de alcance
- Cambiar los presupuestos de ADR-0025/ADR-0012. Optimizar memoria más allá de volver a ≤ 300 MB.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: ninguno en `src/` ni `tests/` (solo esta ficha: `estado: bloqueada`). Worktree temporal `../wt-bisect` creado y retirado; fichero temporal `tests/e2e/zz-probe.spec.ts` creado para medir y borrado.
- Qué he hecho: paso 1. Ejecutado `detail.spec.ts:212` (`chromium-perf`, `--no-deps`, `LECTOR_E2E_PORT=4403`) en `defec48` y en HEAD. **Premisa no cumplida: la prueba también falla en `defec48`**, así que no hay commit bueno que marcar y no tiene sentido bisectar (paso 2 omitido). Según la ficha, paro aquí y dejo la decisión al líder.
  - `defec48`: falla en la aserción de MB con **385,43 MB** (límite 300). Presupuesto de lienzos (0) y long tasks pasaban en esa ejecución.
  - HEAD (`db4b579`): medido con una copia temporal de la prueba que solo sustituye las aserciones por `console.log`: presupuesto de lienzos 0 (cumple), **384,06 MB**, long tasks entre 50 y 95 ms en esa ejecución. En una ejecución anterior de la prueba original, HEAD falló por una long task de 114 ms antes de llegar a la aserción de MB (test intermitente en esa aserción).
  - Conclusión: la regresión de memoria no está entre `defec48` y HEAD; ya existe en `defec48`, o el entorno mide distinto a la fecha de PDF-051. Hace falta mirar commits anteriores (p. ej. `2f33d73` y antes) o revisar si PDF-051 se validó con otra configuración.
- Comandos ejecutados y resultado: `pnpm exec playwright test tests/e2e/detail.spec.ts:212 --project=chromium-perf --no-deps` en HEAD: 1 fallo (long task 114 ms antes de la aserción de MB). En `defec48`: 1 fallo, `Expected <= 300, Received 385.43`. Probe en HEAD: 1 pasa, MB 384,06. `pnpm install --frozen-lockfile` en el worktree: OK.
- Dudas o cosas que no he podido hacer: pasos 2 a 6 no ejecutados (bisect sin commit bueno; diagnóstico y arreglo no tienen sentido hasta saber si el objetivo es `defec48` u otro commit). Decisión pendiente del líder: ¿buscar un commit anterior válido (`git bisect` con `2f33d73` o previo como bueno) o revisar si el presupuesto de 300 MB casa con el número de lienzos de ADR-0025? Aviso: `git status` muestra cambios sin commitear en PDF-095 y PDF-141 que no son míos y no los he tocado.
