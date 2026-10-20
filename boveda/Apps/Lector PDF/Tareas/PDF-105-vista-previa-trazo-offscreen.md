---
tipo: tarea
id: PDF-105
titulo: Vista previa del trazo en OffscreenCanvas (fuera del Commit del compositor)
app: pdf
estado: hecha
depende_de: []
intentos: 0
skills: [stack-typescript-react, pruebas-calidad, calidad-profesional]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-3, anotaciones, rendimiento]
---

# PDF-105 · Vista previa del trazo en OffscreenCanvas

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0018-vista-previa-del-trazo-en-canvas]] (revisión 2026-10-19) · [[ADR-0016-e2e-long-tasks-en-serie]] · Desbloquea: [[PDF-090-e2e-iteracion-3]]

## Objetivo
`ink.spec.ts` «2 000 eventos» (@perf) en verde 15/15 sin tocar el umbral de 50 ms. Las trazas de PDF-090 (ronda 3) muestran que la *long task* (≈ 74 ms) es un `Commit` del compositor de ≈ 69 ms **durante el trazo**. Hipótesis: el lienzo de vista previa (página entera × `dpr`, 2D sin GPU en Chromium headless) obliga a copiar su mapa de bits en el `Commit` del hilo principal. Con `transferControlToOffscreen()` los frames del lienzo van al compositor por su propio canal y no pasan por ese `Commit`.

## Contexto
- `apps/lector-pdf/src/ui/viewer/ink-preview.ts` (entero, ~55 líneas).
- `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx` → `InkStroke` (l. 68-80), `requestInkPreview` (l. 358-373).
- `apps/lector-pdf/tests/unit/ink-preview.test.ts` → `describe('prepareInkCanvas')` (l. 58-).
- `apps/lector-pdf/tests/e2e/ink.spec.ts:141-159` (la prueba; **no se modifica**).
- Trazas: `/tmp/claude-0/-home-claude-cumulo-agentes/409a8bbc-9d52-502a-8457-def03208983e/scratchpad/ink-trace-r2.json` y `-r3.json`.

## Qué hacer
1. **Contraste (no se versiona).** En `requestInkPreview`, poner temporalmente `return;` como primera línea (sin vista previa). Lanzar 2 tandas de `pnpm --filter lector-pdf e2e --project=chromium-perf --no-deps --repeat-each=5 -g "2 000 eventos"`. Anotar resultados en el Registro y quitar el `return;` (`git diff` sin ese cambio).
   - Si sin vista previa sigue habiendo fallos → la hipótesis es falsa: **no hacer el paso 2**, ficha a `bloqueada` y escalar al líder con los resultados.
   - Si 10/10 en verde → paso 2.
2. **Arreglo** en `ink-preview.ts`:
   - Nuevo tipo `export type InkDrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;`.
   - `prepareInkCanvas(...)` devuelve `InkDrawingContext | null`. Fija `canvas.style.width/height` como ahora. Luego:
     ```ts
     const pxW = Math.round(viewport.width * dpr), pxH = Math.round(viewport.height * dpr);
     let ctx: InkDrawingContext | null;
     if (typeof canvas.transferControlToOffscreen === 'function') {
       const off = canvas.transferControlToOffscreen();
       off.width = pxW; off.height = pxH;
       ctx = off.getContext('2d');
     } else {
       canvas.width = pxW; canvas.height = pxH;
       ctx = canvas.getContext('2d');
     }
     if (ctx === null) return null;
     // setTransform, lineWidth, lineCap, lineJoin, strokeStyle: igual que ahora
     ```
   - Si `transferControlToOffscreen` lanza (lienzo ya transferido), dejar que se propague: es un bug (el lienzo se monta nuevo en cada trazo por `inkActive`).
   - `AnnotationLayer.tsx`: `InkStroke.ctx` pasa a `InkDrawingContext | null` (import del tipo). Nada más cambia: el dibujo sigue en el hilo principal con `drawInkSegments`; sin worker.
3. **Test unitario** en `ink-preview.test.ts`, nuevo `it` en `prepareInkCanvas`: con `HTMLCanvasElement.prototype.transferControlToOffscreen` simulado (`vi.fn` que devuelve `{ width: 0, height: 0, getContext: () => fakeContext() }`), comprueba que se llama una vez, que el objeto devuelto queda con `width = 150` y `height = 75` (viewport 100×50, dpr 1,5), que `canvas.width` del elemento no cambia y que el contexto recibe el mismo `setTransform` que el caso actual. El `it` existente (sin `transferControlToOffscreen` en jsdom) sigue sin cambios y en verde.

## Criterios de aceptación
- [ ] Paso 1 anotado en el Registro (2 tandas sin vista previa: N/5, N/5) y `git diff` sin el `return;`.
- [ ] 3 tandas de `--repeat-each=5 -g "2 000 eventos"` con el arreglo → **15/15** en verde. `git diff -- apps/lector-pdf/tests/e2e/` vacío (umbral de 50 ms intacto).
- [ ] `pnpm --filter lector-pdf e2e --project=chromium -g "trazo|dibujo|Dibujo|ink"` → 0 (la vista previa se ve y las posiciones del trazo no cambian).
- [ ] `pnpm lint`, `pnpm --filter lector-pdf typecheck`, `pnpm test` → 0; cobertura de `ink-preview.ts` 100 % de líneas.
- [ ] Sin `waitForTimeout`, `test.skip`, `.only`.

## Fuera de alcance
- Dibujar en un Web Worker, cambiar `drawInkSegments`, la anotación SVG final o el umbral de la prueba. Las baterías completas ×3 (las hace [[PDF-090-e2e-iteracion-3]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/ink-preview.ts`, `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx` (tipo `InkDrawingContext` en ` InkStroke.ctx`), `apps/lector-pdf/tests/unit/ink-preview.test.ts` (nuevo `it` con `transferControlToOffscreen` simulado), esta ficha.
- Qué he hecho: Paso 1 (contraste) con `return;` temporal en `requestInkPreview`: 2 tandas sin vista previa, ambas 5/5 en verde (10/10), así que la hipótesis sigue en pie y se aplicó el paso 2. Se quitó el `return;` (el diff de `AnnotationLayer.tsx` solo contiene el tipo). `prepareInkCanvas` usa `transferControlToOffscreen()` cuando existe, con fallback a `canvas.getContext` en jsdom; no se capturan excepciones de un lienzo ya transferido. `git diff -- apps/lector-pdf/tests/e2e/` vacío.
- Comandos ejecutados y resultado:
  - Paso 1 sin vista previa, `e2e --project=chromium-perf --no-deps --repeat-each=5 -g "2 000 eventos"`: tanda 1 → 5/5 passed (3.3 min); tanda 2 → 5/5 passed (3.3 min).
  - Con el arreglo, misma orden, 3 tandas: 5/5, 5/5, 5/5 → **15/15** en verde.
  - `e2e --project=chromium -g "trazo|dibujo|Dibujo|ink"` → 15 passed, 0 fallos.
  - `pnpm lint` → 0 avisos. `pnpm --filter lector-pdf typecheck` → 0 errores. `pnpm coverage` → 197 ficheros, 2375 tests en verde. `ink-preview.ts` → 100 % de líneas (ramas 80 %, sin criterio sobre ramas).
- Dudas o cosas que no he podido hacer: Ninguna para los criterios. Nota: el `Commit` largo de ≈ 69 ms del hilo principal no se ha medido de nuevo con trazas (`ink-trace-r*.json`); el 15/15 es la evidencia del criterio. Los cambios de `boveda/` que aparecen en `git status` (Plan, PDF-090, ADR-0016/0018/0027) son de otros agentes y no se han tocado ni commiteado.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
Lint y typecheck en 0; test unitario de `ink-preview` en verde. Diff mínimo y fiel a la ficha; el lienzo se remonta por trazo (`setInkActive` false/true), así que `transferControlToOffscreen` no se llama dos veces. Test cubre transferencia, dimensiones dpr y que el elemento no cambia. E2E 15/15 y contraste 10/10 anotados por el programador (no re-ejecutados).
1. (opcional) `ink-preview.ts` — si `getContext('2d')` devolviera `null` tras transferir, el reintento por frame lanzaría; caso prácticamente imposible.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Paso 1 anotado, sin `return;` | OK | Registro del programador (10/10); `git diff HEAD~1` de src solo con tipo y offscreen |
| 3 tandas «2 000 eventos» | 15/15 | `e2e --project=chromium-perf --no-deps --repeat-each=5` ×3 → 5 passed ×3 (3.3 min c/u); e2e sin cambios |
| e2e ink/trazo/dibujo | OK | `--project=chromium -g "trazo\|dibujo\|Dibujo\|ink"` → 15 passed |
| lint, typecheck, tests | OK | 0 avisos, 0 errores; 197 ficheros, 2375 tests en verde |
| Sin waitForTimeout/skip/only | OK | grep vacío |
Tests añadidos: ninguno (el `it` del programador cubre el criterio).
