---
tipo: tarea
id: PDF-035
titulo: Dibujo a mano alzada con ratón, lápiz o dedo
app: pdf
estado: pendiente
depende_de: [PDF-031]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, anotaciones]
---

# PDF-035 · Dibujo a mano

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

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
- [ ] (T) `simplifyPath` de 1 000 puntos sobre una recta con ruido < 0,1 → 2 puntos; de un cuadrado muestreado → conserva las 4 esquinas (±0,5); 100 000 puntos en < 100 ms sin desbordar la pila.
- [ ] (T) Un trazo simulado de 50 eventos → 1 anotación `ink` con `width` de la herramienta y `rect` que contiene todos los puntos; `pointercancel` → ninguna.
- [ ] (T) Dos trazos → 2 anotaciones y 2 entradas de deshacer.
- [ ] E2E: dibujar con `page.mouse` un zigzag de 5 segmentos en `basic-5.pdf` → píxeles rojos a lo largo del trazo; Ctrl+Z → desaparecen.
- [ ] E2E: con zoom 50 % y 300 % el trazo dibujado aparece bajo el puntero (píxel del punto medio, tolerancia 3 px).
- [ ] Rendimiento: un trazo de 2 000 eventos no produce *long tasks* > 50 ms.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Goma de borrar parcial, presión del lápiz, formas geométricas (PDF-057).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
