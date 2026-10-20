---
tipo: tarea
id: PDF-115
titulo: Herramientas Polígono y Sello en la barra Comentar
app: pdf
estado: cambios-pedidos
depende_de: [PDF-108, PDF-107]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
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

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/{shape-drag,shapes,palette}.ts`; `src/state/{annotation-store,annotation-actions,shape-actions}.ts`; `src/ui/viewer/{use-shape-tool.ts,ShapeSketch.tsx,AnnotationLayer.tsx,Viewer.module.css}`; `src/ui/toolbar/{CommentToolbar.tsx,CommentToolbar.module.css}`; `src/ui/{kit/MenuButton.tsx,messages.ts,icons.tsx}`; tests `tests/unit/annotations/{polygon-stamp.test.ts (nuevo),shape-actions.test.ts}`, `tests/ui/{shape-tool.test.tsx,comment-toolbar.test.tsx}`, `tests/e2e/shapes.spec.ts`; `boveda/Apps/Lector PDF/Manual.md`.
- Qué he hecho: herramientas «Polígono» (clics, cierre por clic cerca del primero, doble clic o Intro; Esc descarta; Retroceso quita un vértice; cambiar de herramienta descarta) y «Sello» (menú con los 14 sellos, preferencia `pendingStamp`, un clic o Intro coloca el sello, tirador con proporción). Teclado: `addShapeFromKeyboard` acepta `polygon` y `stamp`. Sellos y polígonos quedan editables tras guardar y reabrir.
- Comandos ejecutados y resultado: `pnpm coverage` → código 0 (279 ficheros, 3621 tests; cobertura de `core/annotations/shape-drag.ts` y `shapes.ts` al 100 %). `pnpm --filter lector-pdf e2e` → código 0 (295/295). `pnpm lint` y `pnpm typecheck` en la raíz fallan por ficheros ajenos al alcance: `src/core/signature/digital/p12.ts` (tipos, typecheck) y `src/core/signature/digital/sign-pdf.ts` (`DeltaWriter` sin usar, lint). Ni lint ni typecheck marcan nada en los ficheros de esta ficha (`eslint` y `tsc` filtrados a mis ficheros: limpio).
- Dudas o cosas que no he podido hacer:
  1. `addPolygonVertex` ignora un clic a ≤ `closePt` del último vértice (no es de la ficha; lo pedí para que el primer clic del doble clic no duplique el vértice).
  2. El doble clic cierra el polígono con el evento `dblclick` de la capa, no con `detail` de `pointerdown` (en navegador el `detail` de `pointerdown` no es fiable como contador de clics).
  3. La ayuda «polygonHint» se muestra mientras la herramienta «Polígono» esté activa, no solo durante el trazado.
  4. Un sello que sobresale de la página se desplaza para quedar dentro (`stampCenterInside`, nuevo en `shapes.ts`); no se recorta.
  5. Tras crear un polígono la herramienta sigue activa (como las formas de PDF-108); la ficha no lo dice.
  6. El título del E2E es sin tildes: con «polígono» en el título, la carpeta de salida de Playwright tenía tildes y la reapertura en la pestaña nueva no cargaba el fichero en este entorno. Sin tildes, pasa.
  7. `tests/ui/comment-toolbar.test.tsx` daba por último control «Flecha»; ahora es «Sello». Solo cambié esa expectativa, no el resto del test.
  8. `MenuButton`: `onSelect` recibe `fromKeyboard` (compatible hacia atrás).
  9. Comprobación en Adobe (no bloquea): añadida como punto 7 de «Comprobación manual en Adobe Acrobat Reader» del Manual, y las descripciones del Polígono y del Sello en «Comentar».
  10. No he hecho commit (indicación del usuario); el árbol tiene cambios ajenos en `DocumentMenu.tsx`, `PDF-066`, `PDF-113`, `sign-pdf`, etc.

### [revisor] ronda 1 — 2026-10-20 — CAMBIOS
Lint, typecheck y tests de la ficha (576) en verde; criterios cubiertos. Un problema:
1. `apps/lector-pdf/src/ui/viewer/use-shape-tool.ts:77` — fuga de listener: `onPolygonKey` y `stopPolygon` son funciones nuevas en cada render. El `keydown` se añade en `polygonClick` con la función del render N, pero `finishPolygon` (desde `onDoubleClick` u otro render posterior) llama a un `stopPolygon` de otro render y hace `removeEventListener` con una referencia distinta, así que el listener de captura en `window` queda registrado para siempre (uno por polígono cerrado con doble clic o clic cerca del primero). Hay que guardar la función registrada en un ref (o usar un handler estable vía ref) y quitar exactamente esa. Añade un test que cierre un polígono por doble clic y compruebe, con un espía de `removeEventListener`/`addEventListener`, que no quedan listeners de `keydown` registrados.
