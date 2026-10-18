---
tipo: tarea
id: PDF-035
titulo: Dibujo a mano alzada con ratón, lápiz o dedo
app: pdf
estado: en-test
depende_de: [PDF-031, PDF-069]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, anotaciones]
---

# PDF-035 · Dibujo a mano

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
Con la herramienta «Dibujar», el usuario traza a mano alzada sobre la página (ratón, lápiz o táctil) con el color y grosor elegidos; cada trazo es una anotación de tinta independiente que se puede deshacer, seleccionar, mover y borrar.

## Contexto
- Leer: `AnnotationLayer.tsx` (PDF-031), `src/state/annotation-actions.ts` (`inkWidth`, `colors.ink`), `src/core/annotations/model.ts` (`InkAnnotation`, `rectFromPaths`).
- Pointer Events: `pointerdown` + `setPointerCapture`, `pointermove` con `getCoalescedEvents()` si existe (más puntos con lápiz), `pointerup`/`pointercancel`. Mientras la herramienta está activa, la capa tiene `touch-action: none`.

## Qué hay que hacer
1. `src/core/annotations/simplify.ts`: `export function simplifyPath(points: readonly number[], tolerance: number): number[]` — Ramer-Douglas-Peucker iterativo (pila explícita, sin recursión) sobre `[x0,y0,x1,y1,...]`; conserva siempre el primero y el último; 1 punto → igual.
2. Herramienta `ink` en `AnnotationLayer`: al bajar el puntero empieza un trazo; los puntos se convierten a pt PDF con `viewport.convertToPdfPoint` y se recortan a la página; vista previa como `polyline` SVG (actualizada como mucho una vez por *frame*). Al soltar: `simplifyPath(points, 0.5)` → `InkAnnotation` (`paths: [simplificado]`, `width = inkWidth`, `rect = rectFromPaths(paths, width / 2 + 1)`, color de la herramienta, `opacity 1`) → `addAnnotation` (etiqueta «añadir dibujo»). `pointercancel` descarta el trazo. La herramienta sigue activa para el siguiente trazo.
3. Un segundo puntero (multitáctil) durante un trazo se ignora; con `pointerType 'touch'` y dos dedos no se dibuja (se deja hacer zoom/desplazamiento al navegador: no captures el segundo puntero).
4. `CommentToolbar`: «Grosor» (1, 2, 4, 8 pt) y «Color» con «Dibujar» activo o un dibujo seleccionado (cambian también el seleccionado: `updateAnnotation` «cambiar grosor» / «cambiar color»).
5. Tests `tests/unit/annotations/simplify.test.ts`, `tests/ui/ink.test.tsx`, `tests/e2e/ink.spec.ts`.

## Criterios de aceptación
- [ ] (T) `simplifyPath` de 1 000 puntos sobre una recta con ruido < 0,1 → 2 puntos; de un cuadrado muestreado → conserva las 4 esquinas (±0,5); 100 000 puntos sin desbordar la pila (en `tests/unit/`).
- [ ] (T, rendimiento, `tests/perf/simplify.perf.test.ts` con `measureBest`) `simplifyPath` de 100 000 puntos en < 100 ms.
- [ ] (T) Un trazo simulado de 50 eventos → 1 anotación `ink` con `width` de la herramienta y `rect` que contiene todos los puntos; `pointercancel` → ninguna.
- [ ] (T) Dos trazos → 2 anotaciones y 2 entradas de deshacer.
- [ ] E2E: dibujar con `page.mouse` un zigzag de 5 segmentos en `basic-5.pdf` → píxeles rojos a lo largo del trazo; Ctrl+Z → desaparecen.
- [ ] E2E: con zoom 50 % y 300 % el trazo dibujado aparece bajo el puntero (píxel del punto medio, tolerancia 3 px).
- [ ] Rendimiento: un trazo de 2 000 eventos no produce *long tasks* > 50 ms.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Goma de borrar parcial, presión del lápiz, formas geométricas (PDF-057).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] suite de rendimiento — 2026-10-17
Por [[ADR-0012-suite-de-rendimiento]], los asserts de tiempo de reloj (`performance.now()`) no van en `tests/unit/` ni `tests/ui/` (fallan bajo `pnpm coverage`), sino en `tests/perf/*.perf.test.ts`, que se ejecuta con `pnpm perf` (sin cobertura, en serie). Presupuestos sin cambios. Los relojes falsos inyectados (`now`) siguen en `tests/unit/`.
Si `vitest.perf.config.ts` (raíz), el script `perf` del `package.json` raíz, su entrada en `tsconfig.json` y `apps/lector-pdf/tests/perf/measure.ts` aún no existen (PDF-006 sin terminar), créalos **exactamente** como dice [[PDF-006-layout-virtual]] (Registro, entrada del líder, pasos 1-4); si existen, no los cambies.

### [lider] replanificación — 2026-10-17
- `depende_de` gana [[PDF-069-barra-comentar]]: la barra «Comentar» (`CommentToolbar`, menús Color/Grosor/Tamaño) ya no la crea PDF-030, sino PDF-069. Donde esta ficha dice «`CommentToolbar`», es el componente de PDF-069 (`src/ui/toolbar/CommentToolbar.tsx`).

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/simplify.ts` (nuevo), `apps/lector-pdf/src/core/annotations/ink.ts` (nuevo: `newInkAnnotation`), `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx`, `apps/lector-pdf/src/ui/viewer/Viewer.module.css` (`touch-action: none` con «Dibujar»), `apps/lector-pdf/src/ui/toolbar/CommentToolbar.tsx`, `apps/lector-pdf/src/state/annotation-actions.ts` (`setInkWidth` y `setInkColor` tocan el dibujo seleccionado; `selectedInk`); tests `apps/lector-pdf/tests/unit/annotations/simplify.test.ts`, `apps/lector-pdf/tests/perf/simplify.perf.test.ts`, `apps/lector-pdf/tests/ui/ink.test.tsx`, `apps/lector-pdf/tests/e2e/ink.spec.ts`.
- Qué he hecho: `simplifyPath` (RDP iterativo con pila explícita) y la herramienta «Dibujar» con Pointer Events: trazo con `setPointerCapture`, puntos coalescidos, recorte a la página, vista previa en `polyline` por frame, al soltar simplificación 0,5 pt y `addAnnotation` («añadir dibujo»); `pointercancel` descarta; segundo puntero ignorado y con dos dedos se descarta el trazo. «Grosor» y «Color» aparecen también con un dibujo seleccionado y cambian ese dibujo («cambiar grosor» / «cambiar color»).
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (143 ficheros, 1684 tests); `pnpm coverage` OK (líneas 98,97 %); `pnpm perf` OK (16 ficheros, 25 tests, incluido `simplify` de 100 000 puntos); `pnpm --filter lector-pdf e2e` OK (145 tests, incluidos los 4 de `ink.spec.ts`).
- Dudas o cosas que no he podido hacer: (1) Decisiones menores tomadas al implementar, para revisar: un clic sin arrastre no crea dibujo (una muestra repetida no se guarda y el trazo queda en un punto); con «Dibujar» activa, el trazo empieza aunque el puntero caiga sobre otra anotación (la zona no selecciona ni arrastra, igual que con «Nota»). (2) La tabla de iteración 2 del Plan sigue mostrando PDF-031 y PDF-069 como `pendiente`; sus fichas están `hecha`. (3) No he marcado las casillas de criterios: quedan para el tester.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Ejecutados: `pnpm lint`, `pnpm typecheck`, `pnpm test` (1684 OK), `pnpm perf` OK y `ink.spec.ts` (4 OK). Cumple los criterios; RDP iterativo correcto, Pointer Events con captura, segundo puntero ignorado, `pointercancel` descarta, limpieza al desmontar. Las dos decisiones menores del programador (clic sin arrastre no crea dibujo; el trazo empieza sobre otra anotación) son razonables.
1. (opcional) `AnnotationLayer.tsx:343` — si el dedo suelta con `lostpointercapture` sin `pointerup`, el trazo quedaría abierto; considerar tratarlo como cancelación.
