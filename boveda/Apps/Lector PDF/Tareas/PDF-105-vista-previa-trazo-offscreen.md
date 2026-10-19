---
tipo: tarea
id: PDF-105
titulo: Vista previa del trazo en OffscreenCanvas (fuera del Commit del compositor)
app: pdf
estado: en-curso
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
