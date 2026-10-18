---
tipo: tarea
id: PDF-051
titulo: Lienzo de detalle para zoom alto
app: pdf
estado: pendiente
depende_de: [PDF-098, PDF-050]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, visor, rendimiento]
---

# PDF-051 · Lienzo de detalle para zoom alto

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0025-lienzo-de-detalle]] · [[ADR-0007-zoom-y-render]] · Paridad: [[Paridad Adobe Acrobat]] (área 1)

> 2026-10-18 (líder): detallada; la lógica pura está en [[PDF-098-plan-lienzo-detalle]].

## Objetivo
Con zoom alto el lienzo de página entera se limita (ADR-0007) y se ve borroso. Encima se dibuja un segundo lienzo solo con la zona visible (más un margen) a resolución completa, como hace el visor de pdf.js, para que el texto sea nítido hasta 6 400 %.

## Contexto
- Leer: `src/ui/viewer/PageView.tsx` (efecto de dibujo, `hostRef`, `pendingRef`, liberación), `src/ui/viewer/PageFrame.tsx`, `src/ui/viewer/Viewer.tsx` (`top`, `left`, `scrollTop`, `contentY`, tamaño del visor; de aquí sale la zona visible), `src/engine/render.ts` (`RenderPageOptions`), `src/core/detail.ts` (PDF-098), `src/core/render-queue.ts` (prioridades), `src/state/render-service.ts` (`releaseCanvas`).
- En `Viewer.tsx` (ya con los modos de PDF-050) solo se añade el cálculo y paso de la zona visible.

## Qué hay que hacer
1. `engine/render.ts`: `RenderPageOptions.offset?: { readonly x: number; readonly y: number }` en px CSS; si existe, `page.getViewport({ scale, rotation, offsetX: -x, offsetY: -y })`. El modo noche usa ese mismo viewport.
2. `Viewer.tsx`: pasa a cada `PageView` visible el prop `viewportRect: PxRect | null` (zona del visor en px de contenido) y su `frameRect` (ya tiene `top/left/width/height`). Para las páginas solo de *overscan*, `null`.
3. `PageView.tsx`:
   - Tras dibujar el lienzo base, guarda su `CanvasPlan`. Si `planDetail(...)` no es `null`, programa (150 ms después del último cambio de `viewportRect`, zoom o rotación) un trabajo en la cola de render con clave `${key}:detail`, prioridad `PRIORITY_VISIBLE`, que dibuja la zona en un lienzo nuevo con `offset` y `outputScale` de su plan.
   - El lienzo de detalle va en un contenedor propio (`detailHostRef`, hermano del de la base, `position:absolute; inset:0; pointer-events:none`) con `style.left/top/width/height` = `rect` en px y `data-detail=""`; al terminar sustituye al anterior (que se libera con `releaseCanvas`).
   - Solo se redibuja si `needsRedraw(drawnRect, visible)`; mientras tanto el detalle anterior sigue visible y la base cubre lo demás.
   - Se libera (y se cancela su trabajo) cuando la página deja de ser visible, cuando `planDetail` pasa a `null` (bajar el zoom), al cambiar de documento y al desmontar.
   - Las capas de texto, anotaciones, formularios y búsqueda no cambian (siguen sobre el marco entero).
4. Tests UI `tests/ui/page-view-detail.test.tsx` (con `renderPageToCanvas` simulado) y E2E `tests/e2e/detail.spec.ts`; ampliar `performance.spec.ts`.

## Criterios de aceptación
- [ ] E2E `basic-5.pdf` a 3 200 % (escribir «3200» en el campo de zoom), visor 1 280 × 800, dpr 1: tras 1 s hay exactamente 1 lienzo `[data-detail]` en la página visible, con `canvas.width === Math.floor(rect.width × dpr)` (±1).
- [ ] E2E nitidez: captura de una zona con texto con el detalle visible y otra con `[data-detail]{visibility:hidden}` inyectado: la varianza del laplaciano (calculada en el test sobre la imagen en escala de grises) es ≥ 3 veces mayor con detalle.
- [ ] E2E: `toHaveScreenshot('detalle-3200.png', { maxDiffPixelRatio: 0.01 })` de esa zona (instantánea nueva en `render.spec.ts-snapshots` o junto al spec).
- [ ] E2E: desplazar 2 000 px a 3 200 % → a los 400 ms del último scroll el detalle cubre la nueva zona visible (su `rect` contiene la zona); durante el scroll nunca aparece blanco donde hay contenido (píxel muestreado ≠ blanco puro en una zona con texto negro: la base está debajo).
- [ ] E2E: volver a 100 % → no queda ningún `[data-detail]`; modo noche a 3 200 % → el detalle también sale invertido (píxel de fondo oscuro).
- [ ] E2E: a 6 400 % el texto sigue legible y ningún lienzo de la página supera `MAX_CANVAS_PIXELS` ni `MAX_CANVAS_DIM` (comprobado en la página con `document.querySelectorAll('canvas')`).
- [ ] Rendimiento: a 3 200 %, en 20 s de desplazamiento continuo, lienzos vivos ≤ 12 base + 1 de detalle por página visible; ninguna *long task* > 100 ms; la memoria de lienzos (Σ ancho×alto×4) ≤ 300 MB en todo momento.
- [ ] Los E2E y tests de render actuales (incluida la instantánea a 100 %) siguen pasando sin cambios.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Teselas (varios lienzos por página), dibujo progresivo por bandas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
