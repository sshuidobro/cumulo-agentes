---
tipo: tarea
id: PDF-098
titulo: Zoom hasta 6 400 % y cálculo de la zona de detalle
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, core, visor, zoom]
---

# PDF-098 · Zoom hasta 6 400 % y cálculo de la zona de detalle

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0025-lienzo-de-detalle]] · [[ADR-0007-zoom-y-render]]

## Objetivo
El zoom llega a 6 400 % como en Adobe, y existe la lógica pura que decide qué zona de una página se dibuja a resolución completa cuando el lienzo de la página entera está limitado.

## Contexto
- Leer: `src/core/zoom.ts`, `src/core/canvas-size.ts` (`planCanvas`, `CanvasPlan`), `tests/unit/zoom*.test.ts`, `tests/unit/canvas-size.test.ts`, `src/ui/messages.ts` (`zoomInvalid`), `src/ui/toolbar/ZoomControls.tsx` (lista de porcentajes: comprobar que usa `ZOOM_STEPS` o su propia lista).
- Tocar solo: `core/zoom.ts`, `core/canvas-size.ts` (o `core/detail.ts` nuevo), `ui/messages.ts` (una clave) y tests.

## Qué hay que hacer
1. `zoom.ts`: `MAX_ZOOM = 64`; `ZOOM_STEPS` añade `12, 16, 24, 32, 48, 64` tras `8`. `parseZoomInput` sigue acotando (ahora 10-6 400). La lista desplegable de `ZoomControls` no cambia (sigue hasta 800 % o la que tenga); solo los botones, Ctrl+rueda y el campo llegan a 6 400 %.
2. `messages.ts`: `zoomInvalid: 'Escribe un porcentaje entre 10 y 6400'`.
3. `src/core/detail.ts` (nuevo):
```ts
export interface PxRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Margen añadido a cada lado de la zona visible, como fracción de su tamaño. */
export const DETAIL_MARGIN = 0.25;
/** Zona del marco de página (px CSS, origen arriba-izquierda del marco) visible en el visor; null si no se ve. */
export function visibleInFrame(frame: PxRect, viewport: PxRect): PxRect | null;
/** Zona a dibujar en detalle: `visible` ampliada DETAIL_MARGIN por lado, recortada al marco y redondeada hacia fuera a px enteros. */
export function detailRect(frameSize: { readonly width: number; readonly height: number }, visible: PxRect): PxRect;
/** Plan completo: null si el lienzo base no está limitado (`base.capped === false`) o la página no se ve. */
export function planDetail(base: CanvasPlan, frame: PxRect, viewport: PxRect, devicePixelRatio: number): { readonly rect: PxRect; readonly canvas: CanvasPlan } | null;
/** `true` si `visible` no está contenida por completo en `drawn` (hay que redibujar). */
export function needsRedraw(drawn: PxRect, visible: PxRect): boolean;
```
   `frame` y `viewport` en las mismas coordenadas (px de contenido del visor); `visibleInFrame` devuelve la intersección **relativa al marco**. `planDetail` usa `planCanvas(rect.width, rect.height, dpr)` para el lienzo.
4. Tests unitarios `tests/unit/detail.test.ts` y ampliar los de zoom.

## Criterios de aceptación
- [ ] `nextZoom(8, 1)` → 12; `nextZoom(64, 1)` → 64; `nextZoom(64, -1)` → 48; `clampZoom(100)` → 64; `parseZoomInput('6400')` → 64; `parseZoomInput('7000 %')` → 64.
- [ ] `visibleInFrame({x:100,y:1000,width:800,height:1000}, {x:0,y:1500,width:600,height:400})` → `{ x:0, y:500, width:500, height:400 }`; sin intersección → `null`.
- [ ] `detailRect({width:800,height:1000}, {x:0,y:500,width:500,height:400})` → `{ x:0, y:400, width:625, height:600 }` (125 px a la izquierda recortados a 0, 100 px arriba y abajo).
- [ ] `planDetail` con `base.capped === false` → `null`; a 3 200 % de una A4 (≈ 25 400 × 35 900 px CSS) con visor 1 280 × 800 y dpr 1 → lienzo de `rect` a densidad 1 (`canvas.capped === false`) y área ≤ `MAX_CANVAS_PIXELS`.
- [ ] `needsRedraw`: contenida → `false`; asomando 1 px por cualquier lado → `true`.
- [ ] Ninguna función lanza con rectángulos de tamaño 0; valores no finitos → `RangeError` (bug del llamante).
- [ ] Cobertura de `detail.ts` 100 % de líneas; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; los E2E de zoom actuales siguen en verde (`pnpm --filter lector-pdf e2e` con código 0).

## Fuera de alcance
- Dibujar el lienzo de detalle (PDF-051).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
