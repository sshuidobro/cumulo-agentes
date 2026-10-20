---
tipo: tarea
id: PDF-108
titulo: Herramientas Rectángulo, Elipse, Línea y Flecha en la barra Comentar
app: pdf
estado: hecha
depende_de: [PDF-057, PDF-101, PDF-050, PDF-051, PDF-097]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, anotaciones, ui]
---

# PDF-108 · Herramientas Rectángulo, Elipse, Línea y Flecha en la barra «Comentar»

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0029-formas-y-sellos]] · Antes: [[PDF-057-formas-y-sellos]] · Sigue: [[PDF-115-poligono-y-sellos]]

## Objetivo
El usuario dibuja rectángulos, elipses, líneas y flechas con el ratón (o los crea con el teclado), los selecciona, mueve, redimensiona (rectángulo y elipse), cambia color y grosor, borra, deshace y guarda dentro del PDF.

## Contexto
- [[ADR-0029-formas-y-sellos]] («Interfaz»).
- `src/core/annotations/shapes.ts` (PDF-057): `newBoxShape`, `newLineShape`, `resizeBox`; `palette.ts`: `DEFAULT_TOOL_COLORS`, `INK_WIDTHS`, `DEFAULT_INK_WIDTH`.
- `src/state/annotation-store.ts`: `AnnotationTool`, `ColorTool`, `AnnotationState`, `initialAnnotationState`.
- `src/state/annotation-actions.ts`: `addAnnotation`, `updateAnnotation`, `newAnnotationId`, `nowIso`, `select`, `setTool`, `setToolColor`, `addNoteFromKeyboard` (patrón de creación con teclado, líneas ~740-760), `PREF`, `isColorRecord` (línea ~866), `loadPrefs` (líneas ~135-150).
- `src/core/signature/signature.ts` → `keyboardSignatureCenter`, `resizeKeepingAspect`.
- `src/ui/viewer/AnnotationLayer.tsx`: `MOVABLE` (l. 57), `Resizable` (l. 59), `beginFreeTextCreate` (patrón de arrastre con `followPointer` y `sketch`, l. 255-290), `beginResize` (l. 294-320), `onLayerPointerDown` (l. 322), render del `sketch` (l. 570-575).
- `src/ui/toolbar/CommentToolbar.tsx`: `TOOLS`, `visibleControls`, `colorTargetOf`, `onToolClick`; `src/ui/icons.tsx`; `src/ui/messages.ts` (`toolInk`, etiquetas de grosor).
- `src/ui/viewer/Viewer.module.css` líneas 39-62 (cursor y `pointer-events` por `data-tool`).

## Qué hay que hacer
1. `src/core/annotations/shape-drag.ts` (puro):
```ts
export const MIN_SHAPE_PT = 4;
export const DEFAULT_BOX_PT = { width: 144, height: 96 } as const;
export const DEFAULT_LINE_PT = 144;
/** Caja del arrastre recortada a `page`. `keepRatio` (Mayús): cuadrado/círculo del lado menor. Si el arrastre es < MIN_SHAPE_PT en ambos ejes → caja por defecto centrada en (sx, sy), recortada a la página. */
export function dragBox(sx: number, sy: number, ex: number, ey: number, keepRatio: boolean, page: RectPt): RectPt;
/** Puntos [inicio, fin] recortados a `page`. `snap` (Mayús): ángulo a múltiplos de 45°. Arrastre < MIN_SHAPE_PT → línea horizontal de DEFAULT_LINE_PT desde (sx, sy). */
export function dragLine(sx: number, sy: number, ex: number, ey: number, snap: boolean, page: RectPt): readonly [number, number, number, number];
/** Tirador inferior derecho: esquina superior izquierda fija, ancho y alto mínimos MIN_SHAPE_PT. `dh` positivo = más alto. */
export function resizeBoxRect(r: RectPt, dx: number, dh: number): RectPt;
```
2. `palette.ts`: `DEFAULT_TOOL_COLORS` gana `square`, `circle`, `line`, `arrow` = rojo. `annotation-store.ts`: `AnnotationTool` gana `'square' | 'circle' | 'line' | 'arrow'` (son `ColorTool`); estado nuevo `shapeWidth: (typeof INK_WIDTHS)[number]` (por defecto `DEFAULT_INK_WIDTH`). `isColorRecord` acepta registros guardados sin las claves nuevas y `loadPrefs` las completa con los valores por defecto (no se pierden los colores que el usuario ya tenía). Preferencia nueva `shapeWidth`.
3. `src/state/shape-actions.ts`:
```ts
export type ShapeTool = 'square' | 'circle' | 'line' | 'arrow';
export function isShapeTool(t: AnnotationTool): t is ShapeTool;
export function createBox(pageIndex: number, kind: 'square' | 'circle', rect: RectPt): string;      // añade, selecciona, devuelve id; la herramienta sigue activa
export function createLine(pageIndex: number, points: readonly [number, number, number, number], arrow: boolean): string;
/** Teclado: forma por defecto centrada en keyboardSignatureCenter(…, visibleFraction 1) de la página actual; la selecciona y devuelve la herramienta a 'none'. */
export function addShapeFromKeyboard(tool: ShapeTool): string | null;
export function selectedShape(): BoxShapeAnnotation | LineShapeAnnotation | PolygonAnnotation | undefined;
/** Fija el grosor de la herramienta y, si hay una forma seleccionada, el suyo (rect recalculado: lineRect/verticesRect; en cajas no cambia). Una entrada de deshacer «cambiar grosor». */
export function setShapeWidth(width: AnnotationState['shapeWidth']): void;
/** Color de la forma seleccionada (una entrada «cambiar color»). */
export function setShapeColor(color: Rgb): void;
export function resizeShape(id: string, rect: RectPt): void; // solo square/circle; entrada «cambiar tamaño»
```
4. `src/ui/viewer/use-shape-tool.ts`:
```ts
export type ShapeSketch = { readonly kind: 'square' | 'circle'; readonly rect: RectPt } | { readonly kind: 'line' | 'arrow'; readonly points: readonly [number, number, number, number] };
export function useShapeTool(pageIndex: number, viewport: PageViewport, pageBounds: () => RectPt): { readonly sketch: ShapeSketch | null; onPointerDown(e: PointerEvent<SVGSVGElement>): void };
```
   Igual que `beginFreeTextCreate`: solo botón 0, con herramienta de forma, sin editor abierto y no sobre `[data-annot-id], [data-resize-id]`; `followPointer` actualiza el `sketch` con `dragBox`/`dragLine` (Mayús = `e.shiftKey`); al soltar llama a `createBox`/`createLine`; `pointercancel` o Escape (`keydown` en `window` mientras arrastra) cancela sin crear.
5. `AnnotationLayer.tsx`: llama a `onPointerDown` del hook en `onLayerPointerDown`; pinta el `sketch` (rect, elipse o línea con punta) con `styles.sketch` dentro del grupo transformado; `MOVABLE` gana `square`, `circle`, `line`, `polygon`, `stamp`; `Resizable` gana `BoxShapeAnnotation`, y `beginResize` usa `resizeBoxRect` + `resizeShape` para ellas.
6. `CommentToolbar.tsx`: cuatro botones tras «Dibujar» (`IconSquare`, `IconCircle`, `IconLine`, `IconArrow` en `icons.tsx`, SVG 20×20 con `aria-hidden`), con `title`/`aria-label` `msg.toolSquare` «Rectángulo», `toolCircle` «Elipse», `toolLine` «Línea», `toolArrow` «Flecha». Con teclado (`fromKeyboard`) y la herramienta inactiva → `addShapeFromKeyboard`. Menú «Grosor» visible con herramienta de forma o forma seleccionada → `setShapeWidth`; «Color» con forma seleccionada → `setShapeColor` (si no, color de la herramienta).
7. `Viewer.module.css`: añade `square`, `circle`, `line`, `arrow` a la regla de `pointer-events: auto; cursor: crosshair` y a la de `touch-action: none`.
8. Tests: `tests/unit/annotations/shape-drag.test.ts`, `tests/unit/annotations/shape-actions.test.ts`, `tests/ui/shape-tool.test.tsx` (arrastre sintético con `fireEvent.pointerDown/Move/Up` como en `tests/ui/ink.test.tsx`), y `tests/e2e/shapes.spec.ts`.

## Criterios de aceptación
- [ ] Unit: `dragBox(100,100,40,160,false,página)` = `[40,100,100,160]`; con `keepRatio` = `[40,100,100,160]` recortado al lado menor (60); arrastre de 2 pt → caja 144×96 centrada; nunca sale de la página. `dragLine` con `snap` de (0,0) a (100,90) → ángulo 45°.
- [ ] Unit: `setShapeWidth(8)` con una flecha seleccionada → una sola entrada de deshacer y su `rect` contiene las puntas; deshacer devuelve el grosor anterior.
- [ ] Unit: preferencias antiguas sin `square` en `colors` → se cargan los colores guardados y `square` = rojo.
- [ ] UI: con la herramienta «Rectángulo», arrastrar en la capa crea un `square` con el color y grosor de la herramienta y lo selecciona; Escape durante el arrastre no crea nada; un arrastre que empieza sobre otra anotación no crea forma.
- [ ] UI: activar «Flecha» con Intro desde la barra crea una flecha en la página actual, seleccionada; las flechas del teclado la mueven (zona con `role="button"`).
- [ ] E2E (`basic-5.pdf`): dibujar rectángulo, elipse, línea y flecha en la página 1; Ctrl+Z quita la flecha y Ctrl+Y la devuelve; mover el rectángulo arrastrando; redimensionar la elipse con su tirador; cambiar el color de la línea a azul; Ctrl+S; recargar → el panel de comentarios lista «Rectángulo», «Elipse», «Línea», «Flecha» y un píxel del borde del rectángulo en el lienzo de pdf.js es rojo (R > 180, G < 100, B < 100).
- [ ] Botones con `aria-label`, `title` y foco visible; los cuatro alcanzables con las flechas del foco itinerante de la barra; tema oscuro sin cambios de contraste (axe sin violaciones nuevas en `tests/e2e/annotations-a11y.spec.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; sin *long tasks* nuevas (arrastre sobre `pages-5000.pdf` en el E2E: ninguna > 100 ms, prueba `@perf`).

## Fuera de alcance
- Polígono y sellos (PDF-115). Relleno desde la interfaz (se conserva el del fichero). Editar los extremos de una línea o los vértices; redimensionar líneas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/shape-drag.ts` (nuevo), `src/state/shape-actions.ts` (nuevo), `src/ui/viewer/use-shape-tool.ts` (nuevo), `src/ui/viewer/ShapeSketch.tsx` (nuevo), `src/core/annotations/palette.ts`, `src/state/annotation-store.ts`, `src/state/annotation-actions.ts` (preferencias `shapeWidth`, `isColorRecord` tolerante, `rememberShapeWidth`), `src/ui/viewer/AnnotationLayer.tsx`, `src/ui/toolbar/CommentToolbar.tsx`, `src/ui/icons.tsx`, `src/ui/messages.ts`, `src/ui/viewer/Viewer.module.css`; tests: `tests/unit/annotations/shape-drag.test.ts`, `tests/unit/annotations/shape-actions.test.ts`, `tests/ui/shape-tool.test.tsx`, `tests/e2e/shapes.spec.ts`, `tests/e2e/annotations-a11y.spec.ts` (caso de tema oscuro), `tests/ui/comment-toolbar.test.tsx` (ver dudas).
- Qué he hecho: geometría pura de arrastre (caja, línea con Mayús a 45°, tirador) y acciones de forma (crear, teclado, grosor, color, tamaño) sobre la pila de deshacer común; cuatro botones tras «Dibujar» con el arrastre en la capa (Escape cancela), menú «Color» y «Grosor» que actúan sobre la forma seleccionada, tirador de rectángulo y elipse, y preferencia de grosor de formas. Las preferencias antiguas sin colores de formas cargan rojo sin perder los demás colores.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` exit 0 (272 ficheros, 3542 tests en verde); `pnpm e2e` (lector-pdf, incluido `@perf` en `chromium-perf`) 285 passed, exit 0; `shapes.spec.ts` (E2E y `@perf` sobre `pages-5000.pdf`) en verde. Puerto y build propios (`LECTOR_E2E_PORT=4291`, `LECTOR_E2E_OUTDIR=dist-shapes`) porque el 4173 lo ocupaba otro proceso; el directorio de build se borró al terminar.
- Dudas o cosas que no he podido hacer:
  - Criterio tomado al implementar: con Mayús, si el lado menor del arrastre queda por debajo de `MIN_SHAPE_PT`, se usa la caja por defecto (la ficha solo lo fijaba para arrastres pequeños en ambos ejes).
  - `tests/ui/comment-toolbar.test.tsx`: dos tests usaban «Dibujar» como último control de la barra (Fin, ←). Ahora el último es «Flecha»; cambié solo esa aserción, no la lógica del foco itinerante.
  - El título del E2E va sin tildes: con tildes en la carpeta de salida, el fichero guardado no llega a la pestaña nueva con `setInputFiles`. Es una limitación del test, no de la app; conviene vigilarla en otros specs con títulos acentuados que reabran ficheros.
  - Con una forma seleccionada, «Color» cambia solo esa forma (no el color por defecto de la herramienta), como indica la ficha; el color por defecto se cambia con la herramienta sin selección.
  - No he hecho el Manual (lo escribe el líder al cerrar la iteración).

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- Lint y typecheck OK; tests de shape-drag, shape-actions, shape-tool y comment-toolbar en verde (54). Criterios cubiertos, nada fuera de alcance, núcleo puro, una sola entrada de deshacer por acción, listeners de arrastre limpiados al desmontar, preferencias antiguas toleradas.
- (opcional) `shape-drag.ts` `dragBox` con `keepRatio`: el recorte a la página puede dejar una caja no cuadrada junto al borde; aceptable.
- Pendiente para el tester: E2E completo (`shapes.spec.ts`, a11y, `@perf`) y `pnpm coverage`; no relanzados en revisión.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Unit shape-drag / shape-actions / preferencias antiguas | OK | `pnpm coverage` exit 0, incluye `shape-drag.test.ts`, `shape-actions.test.ts` |
| UI rectángulo, Escape, arrastre sobre anotación, flecha por teclado | OK | `tests/ui/shape-tool.test.tsx` en la batería de coverage |
| E2E basic-5 (dibujar, deshacer/rehacer, mover, redimensionar, color, guardar, recargar, píxel rojo) | OK | `LECTOR_E2E_PORT=4611 pnpm --filter lector-pdf e2e`: 285 passed, exit 0 |
| Botones accesibles, foco itinerante, axe tema oscuro | OK | `annotations-a11y.spec.ts` dentro del e2e completo |
| lint, typecheck, coverage, e2e con código 0; sin long tasks | OK | lint y typecheck sin errores; coverage líneas 98,61 %; `shapes.spec.ts:168 @perf` pages-5000 en verde |

Tests añadidos: ninguno (los del programador cubren cada criterio).
Rendimiento: arrastre sobre `pages-5000.pdf` sin long tasks > 100 ms (@perf verde).
