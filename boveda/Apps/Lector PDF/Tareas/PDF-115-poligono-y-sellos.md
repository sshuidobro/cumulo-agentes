---
tipo: tarea
id: PDF-115
titulo: Herramientas Polígono y Sello en la barra Comentar
app: pdf
estado: pendiente
depende_de: [PDF-108, PDF-107]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, anotaciones, ui]
---

# PDF-115 · Herramientas Polígono y Sello en la barra «Comentar»

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0029-formas-y-sellos]] · Antes: [[PDF-108-herramientas-de-formas]], [[PDF-107-importar-formas-y-sellos]]

## Objetivo
El usuario dibuja polígonos con clics y coloca sellos predefinidos («APROBADO», «BORRADOR»…), con ratón o teclado; se editan, deshacen, guardan y, al reabrir, siguen siendo editables.

## Contexto
- [[ADR-0029-formas-y-sellos]] («Sellos», «Interfaz»).
- `src/core/annotations/shapes.ts`: `STAMP_NAMES`, `STAMP_LABELS`, `stampRectAt`, `newPolygonShape`, `newStamp`, `resizeBox`.
- Hechos en PDF-108: `src/core/annotations/shape-drag.ts`, `src/state/shape-actions.ts`, `src/ui/viewer/use-shape-tool.ts`, cambios en `AnnotationLayer.tsx`, `CommentToolbar.tsx`, `Viewer.module.css`.
- Patrón de herramienta con elemento pendiente: firma (`state/annotation-actions.ts` → `chooseSignature`, `placeSignature`, `placeSignatureFromKeyboard`; `ui/signature/SignatureMenu.tsx`; `pendingSignature` en el store).
- `src/ui/kit/MenuButton.tsx` (`MenuEntry`), `src/core/signature/signature.ts` → `resizeKeepingAspect`.

## Qué hay que hacer
1. Store: `AnnotationTool` gana `'polygon'` (`ColorTool`, color por defecto rojo en `DEFAULT_TOOL_COLORS`) y `'stamp'` (no es `ColorTool`); estado nuevo `pendingStamp: StampName` (por defecto `'Approved'`, preferencia `pendingStamp`).
2. `shape-drag.ts`: `export const POLYGON_CLOSE_PX = 8;` y
```ts
/** Vértices tras un clic en (x, y): si hay ≥ 3 y el clic está a ≤ closePt del primero → { vertices, closed: true }. Los puntos se recortan a la página. */
export function addPolygonVertex(vertices: readonly number[], x: number, y: number, closePt: number, page: RectPt): { readonly vertices: readonly number[]; readonly closed: boolean };
/** Polígono por defecto para el teclado: pentágono regular de radio 48 pt centrado en (cx, cy), recortado a la página. */
export function defaultPolygon(cx: number, cy: number, page: RectPt): readonly number[];
```
3. `shape-actions.ts`: `createPolygon(pageIndex, vertices)`; `chooseStamp(name: StampName)` (fija `pendingStamp`, guarda la preferencia y activa la herramienta `'stamp'`); `placeStamp(pageIndex, center, pageBox): string` (sello de `pendingStamp` centrado y recortado a la página, seleccionado; la herramienta vuelve a `'none'`, como la firma); `addShapeFromKeyboard` acepta `'polygon'` (usa `defaultPolygon`) y `'stamp'` (usa `placeStamp` en el centro visible). `resizeShape` acepta sellos con `resizeKeepingAspect`.
4. `use-shape-tool.ts`:
   - `polygon`: cada clic añade un vértice (`addPolygonVertex` con `closePt` = `POLYGON_CLOSE_PX` en puntos según el zoom); el `sketch` (`{ kind: 'polygon'; vertices; cursor: [x, y] }`) muestra la polilínea y el tramo hasta el puntero. Cierra: clic cerca del primero, doble clic o Intro (con ≥ 3 vértices) → `createPolygon`. Escape o cambiar de herramienta descarta. Retroceso quita el último vértice.
   - `stamp`: un clic → `placeStamp`.
5. `CommentToolbar.tsx`: botón «Polígono» (`IconPolygon`) tras «Flecha» y botón de menú «Sello» (`IconStamp`, `MenuButton`) con las 14 entradas (`STAMP_LABELS`, en el orden de `STAMP_NAMES`, la elegida marcada); elegir una entrada → `chooseStamp`; con teclado (Intro en la entrada) → además `addShapeFromKeyboard('stamp')`. `Viewer.module.css`: `polygon` con cursor de cruz y `stamp` con `cursor: copy` (como `signature`).
6. Mensajes en `src/ui/messages.ts`: `toolPolygon` «Polígono», `toolStamp` «Sello», `stampMenu` «Elegir sello», `polygonHint` «Haz clic para añadir vértices; doble clic o Intro para terminar» (texto de ayuda en la barra mientras se dibuja, `aria-live="polite"`).
7. Tests: unit de `addPolygonVertex`/`defaultPolygon`, UI `tests/ui/shape-tool.test.tsx` (polígono por clics y sello) y E2E en `tests/e2e/shapes.spec.ts`.

## Criterios de aceptación
- [ ] Unit: tras 3 vértices, un clic a 3 pt del primero (con `closePt` 4) cierra con 3 vértices; un clic a 10 pt añade el 4.º; ningún vértice sale de la página.
- [ ] UI: 4 clics + doble clic → un `polygon` de 4 vértices seleccionado y una sola entrada de deshacer («añadir polígono»); Escape a mitad no deja nada; Retroceso quita el último vértice del `sketch`.
- [ ] UI: elegir «BORRADOR» en el menú y hacer clic → `stamp` `Draft` centrado en el clic, seleccionado, herramienta `none`; con teclado (menú → Intro) se coloca en la página actual sin ratón.
- [ ] E2E (`basic-5.pdf`): dibujar un polígono y colocar los sellos «APROBADO» y «NO APROBADO»; redimensionar un sello mantiene la proporción; Ctrl+S; recargar → los tres siguen **editables** (se pueden mover y borrar: no son de solo lectura en el panel) y el panel muestra «Polígono» y «Sello» ×2.
- [ ] El sello guardado se abre con `qpdf --check` código 0 y su `/AP` lleva el texto «APROBADO» (`qpdf --show-object` del flujo decodificado contiene `(APROBADO) Tj`).
- [ ] Lista de comprobación manual en Adobe Reader añadida al [[Apps/Lector PDF/Manual|Manual]] (sección «Comprobar en Adobe»): el sello se lista como «Sello» y el polígono como «Polígono» (la comprueba el usuario; no bloquea la ficha).
- [ ] Botones con `aria-label`, `title`, foco visible; el menú de sellos navegable con flechas e Intro (`MenuButton`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Sellos personalizados (imagen o texto propio), sellos dinámicos con fecha, polilíneas, editar vértices.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
