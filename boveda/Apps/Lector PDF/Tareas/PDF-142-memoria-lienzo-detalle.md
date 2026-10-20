---
tipo: tarea
id: PDF-142
titulo: Memoria del lienzo base con zoom alto (385 MB > 300 MB)
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [pruebas-calidad, stack-typescript-react, formatos-ofimatica]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, rendimiento, regresion, detalle]
---

# PDF-142 · Memoria del lienzo base con zoom alto

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0025-lienzo-de-detalle]], [[ADR-0012-suite-de-rendimiento]], [[ADR-0016-e2e-long-tasks-en-serie]] · Origen: [[PDF-095-pestanas]] (Registro, ronda 5) · Relacionadas: [[PDF-051-lienzo-de-detalle]], [[PDF-141-e2e-rojos-en-head]]

## Replanificación (líder, 2026-10-20)
El plan original (bisectar `defec48..HEAD`) se descarta: la prueba ya fallaba en `defec48` (385,43 MB), así que no es una regresión. Informe del explorador: `registros/contexto/PDF-142.md`. Causa decidida: a 3 200 % cada página montada (visible + *overscan*) tiene un lienzo base capado a `MAX_CANVAS_PIXELS` = 128 MiB; 3 páginas = 384 MiB. Arreglo decidido en la enmienda de [[ADR-0025-lienzo-de-detalle]]: en modo detalle, la base se limita a 32 MiB.

## Objetivo
Que `tests/e2e/detail.spec.ts:212` (`@perf`) pase **sin tocar** `MAX_CANVAS_MB = 300` ni `MAX_LIVE_CANVASES_PER_PAGE = 13`, limitando el lienzo base de las páginas que llevan lienzo de detalle.

## Contexto
- `apps/lector-pdf/src/core/canvas-size.ts` → `MAX_CANVAS_PIXELS`, `CanvasPlan`, `planCanvas` (líneas 1-40).
- `apps/lector-pdf/src/core/detail.ts` → `planDetail` (línea 56; solo usa `base.capped`, no cambia).
- `apps/lector-pdf/src/ui/viewer/PageView.tsx:115` (`basePlan`).
- `apps/lector-pdf/tests/unit/canvas-size.test.ts` (añadir casos).
- Prueba: `apps/lector-pdf/tests/e2e/detail.spec.ts:212-237`. Lanzar en reposo (ADR-0016): `cd apps/lector-pdf && pnpm exec playwright test tests/e2e/detail.spec.ts:212 --project=chromium-perf --no-deps`.

## Qué hay que hacer
1. En `canvas-size.ts` añadir y exportar:
   ```ts
   /** Tope del lienzo base cuando la página usa lienzo de detalle (32 MiB, ADR-0025 enmienda). */
   export const CAPPED_BASE_PIXELS = 8_388_608;
   /** Como planCanvas, pero si el plan sale capado reduce la escala para no pasar de CAPPED_BASE_PIXELS. */
   export function planBaseCanvas(cssWidth: number, cssHeight: number, devicePixelRatio: number): CanvasPlan
   ```
   Pseudocódigo: `const plan = planCanvas(w, h, dpr); if (!plan.capped) return plan; const scale = Math.min(plan.outputScale, Math.sqrt(CAPPED_BASE_PIXELS / (w * h))); return { width: max(1, floor(w*scale)), height: max(1, floor(h*scale)), outputScale: scale, capped: true };`
2. `PageView.tsx:115`: usar `planBaseCanvas` en lugar de `planCanvas` (mismo `useMemo` y dependencias). Nada más en `PageView.tsx`.
3. Tests unitarios en `tests/unit/canvas-size.test.ts`:
   - página no capada (612 × 792, dpr 1): `planBaseCanvas` devuelve lo mismo que `planCanvas`.
   - página capada (612 × 792 a 3 200 % → 19 584 × 25 344, dpr 1): `width*height <= CAPPED_BASE_PIXELS`, `capped === true`, `outputScale < planCanvas(...).outputScale`, lados ≤ `MAX_CANVAS_DIM`.
   - página capada solo por lado (100 × 40 000, dpr 1): sigue cumpliendo los dos topes.
   - entradas inválidas (0, NaN) lanzan igual que `planCanvas`.
4. Medir con la prueba `@perf` y anotar los MB.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf exec vitest run tests/unit/canvas-size.test.ts` pasa; el caso «página capada» falla si `PageView`/`planBaseCanvas` devuelve el plan de `planCanvas`.
- [ ] `detail.spec.ts:212` en `chromium-perf` pasa **3 veces seguidas** en reposo; los 3 valores de MB (≤ 300) y la salida del comando copiados en el Registro.
- [ ] `git diff` de `detail.spec.ts` vacío (presupuestos y prueba intactos).
- [ ] `detail.spec.ts` completo pasa, incluida la legibilidad a 6 400 % (el detalle sigue a densidad completa).
- [ ] `tabs-performance.spec.ts`, `render.spec.ts` y `performance.spec.ts` siguen en verde.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `pnpm --filter lector-pdf e2e` con código 0 (salvo fallos ya asignados a [[PDF-141-e2e-rojos-en-head]], citados por nombre).
- [ ] Si la long task > 100 ms vuelve a aparecer en esta prueba, anotar su duración en el Registro (no es motivo de rechazo si las 3 ejecuciones exigidas pasan).

## Fuera de alcance
- Cambiar presupuestos de ADR-0025/ADR-0012, quitar lienzos de *overscan*, tocar `planDetail` o la liberación de lienzos.

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

### [lider] replanificación — 2026-10-20
- No es regresión: falla igual en `defec48`. Causa: lienzos base capados a 128 MiB en 3 páginas montadas. Arreglo: `planBaseCanvas` con tope de 32 MiB en modo detalle (enmienda de [[ADR-0025-lienzo-de-detalle]]). Ficha reescrita; `pendiente`, intentos 0.
