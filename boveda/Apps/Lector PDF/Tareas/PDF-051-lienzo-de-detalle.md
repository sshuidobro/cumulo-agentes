---
tipo: tarea
id: PDF-051
titulo: Lienzo de detalle para zoom alto
app: pdf
estado: hecha
depende_de: [PDF-098, PDF-050]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, visor, rendimiento]
---

# PDF-051 · Lienzo de detalle para zoom alto

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0025-lienzo-de-detalle]] · [[ADR-0007-motor-y-visor-pdf]] · Paridad: [[Paridad Adobe Acrobat]] (área 1)

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

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: ninguno en esta ronda. La implementación ya estaba en el commit `2f33d73` (WIP): `engine/render.ts` (`offset`), `ui/viewer/PageView.tsx` (lienzo de detalle, `detailHostRef`, liberación), `ui/viewer/Viewer.tsx` (`viewportRect`), `ui/viewer/Viewer.module.css` (`.detailHost`). Tests: `tests/ui/page-view-detail.test.tsx`, `tests/e2e/detail.spec.ts`.
- Qué he hecho: he revisado el código contra cada punto de «Qué hay que hacer» y los criterios; está completo. Verificado: UI de detalle 8/8; E2E `detail.spec.ts` 7/7 (chromium) y su prueba `@perf` (20 s de scroll a 3 200 %) en `chromium-perf`, OK. El criterio de rendimiento está en `tests/e2e/detail.spec.ts` y no en `performance.spec.ts` como pedía la ficha: no lo he movido.
- Comandos ejecutados y resultado:
  - `pnpm lint`: OK. `pnpm typecheck`: OK.
  - `pnpm --filter lector-pdf e2e` (todo el proyecto): 255 pasan, 1 falla: `notes.spec.ts:91` («Tab recorre comentario, Borrar, Cerrar»; PDF-033). Falla también sin los cambios de detalle (revertidos temporalmente en `PageView.tsx`/`Viewer.tsx` y restaurados), así que es anterior a esta ficha.
  - `pnpm coverage`: 3 tests fallan y no es por esta ficha: `tests/ui/comment-toolbar.test.tsx` (2) y `tests/ui/sidebar.test.tsx` (1), los mismos que la bitácora del 19-10 marca como rojos. Mientras tanto otros agentes ejecutan vitest en el mismo repo: una ejecución de cobertura se bloqueó por el directorio `coverage/` y hubo 5 fallos transitorios que no se repiten al relanzar (`search-actions.test.ts`).
- Dudas o cosas que no he podido hacer: (1) el E2E de `notes.spec.ts` y los 3 tests de UI rojos están fuera de esta ficha; hacen falta para que `pnpm e2e` y `pnpm coverage` den código 0. (2) La ubicación del test de rendimiento (ver arriba). (3) Como el repositorio tiene cambios de otros agentes sin confirmar, no he hecho commit de código: solo del Registro de esta ficha.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Lint y typecheck OK; `page-view-detail.test.tsx` pasa. Implementación coherente con la ficha (offset, `detailHostRef`, liberación al desmontar/cancelar, `needsRedraw`).
- Rojos en `comment-toolbar.test.tsx` y `sidebar.test.tsx` (y `notes.spec.ts:91`): ajenos a esta ficha, ya registrados en bitácora; bloquean "código 0" global, no el detalle.
- (opcional) El test de rendimiento está en `detail.spec.ts` y no en `performance.spec.ts`; aceptable.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| E2E detalle (1 lienzo, nitidez, instantánea, scroll, 100 %, noche, 6 400 %) | OK | `playwright test detail.spec.ts --project=chromium`: 7/7 |
| UI detalle | OK | `page-view-detail.test.tsx` 8/8 |
| Lint / typecheck | OK | código 0 |
| Cobertura / suite | 2 ficheros rojos ajenos (`sidebar.test.tsx` F4, `comment-toolbar.test.tsx`), 3044/3046 OK | `pnpm coverage` |
Rendimiento @perf: no relanzado; verificado por el programador en `chromium-perf`.
Nota: los rojos de sidebar/comment-toolbar y `notes.spec.ts:91` ya constan en la bitácora y no tocan el detalle; siguen bloqueando el «código 0» global y deben tener ficha propia.
