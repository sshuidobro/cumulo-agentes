---
tipo: tarea
id: PDF-032
titulo: Resaltar, subrayar y tachar texto seleccionado
app: pdf
estado: en-revision
depende_de: [PDF-031, PDF-013, PDF-069]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, anotaciones]
---

# PDF-032 · Resaltar, subrayar y tachar

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
El usuario selecciona texto y lo resalta, subraya o tacha: (a) con la herramienta activa, al soltar el ratón se crea la anotación; (b) sin herramienta, aparece una barra flotante junto a la selección con «Resaltar», «Subrayar», «Tachar» y «Copiar»; (c) con teclado, pulsando el botón de la barra «Comentar» con texto seleccionado. Una selección que cruza páginas crea una anotación por página en un solo paso de deshacer.

## Contexto
- Leer: `src/ui/viewer/text-layer-registry.ts`, `TextLayerView.tsx`, `text-selection.ts` (PDF-013), `AnnotationLayer.tsx` (PDF-031), `src/state/annotation-actions.ts` (`addAnnotations`, `colors`, `author`), `src/core/annotations/model.ts` (`Quad`, orden Z, `rectFromQuads`).
- `Range.getClientRects()` devuelve un rectángulo por fragmento de línea (en px de ventana). La capa de texto de pdf.js usa `span`s posicionados con `transform`; los rectángulos ya vienen transformados.

## Qué hay que hacer
1. `src/core/annotations/line-quads.ts` (puro):
   ```ts
   export function rectsToLineQuads(rects: readonly RectPt[]): Quad[];
   ```
   Descarta rectángulos de ancho o alto < 0,5 pt. Dos rectángulos son de la misma línea si su solapamiento vertical ≥ 50 % de la altura del menor. Dentro de una línea se unen los que se solapan o están separados ≤ 0,5 × altura (huecos entre palabras); separados más → quads distintos. Cada grupo → caja envolvente → `quadFromRect`. Orden: de arriba abajo (y mayor primero) y de izquierda a derecha.
2. `src/ui/viewer/selection-to-pages.ts`:
   ```ts
   export function selectionPageRects(sel: Selection): Map<number, RectPt[]>; // página → rects en puntos PDF
   ```
   Para cada `Range` de la selección y cada `getClientRects()`: busca la capa de texto registrada cuyo `getBoundingClientRect()` contiene el centro del rectángulo; pasa las esquinas a coordenadas locales y luego a PDF con `viewport.convertToPdfPoint` (el `viewport` actual de esa página, guárdalo en el registro de PDF-013: añade `viewport` al `TextLayerHandle` registrado) y normaliza. Ignora rectángulos fuera de toda capa.
3. `src/state/markup-actions.ts`: `export function markupSelection(type: 'highlight' | 'underline' | 'strikeout', sel: Selection): number` → construye por página `TextMarkupAnnotation` (`id` nuevo, `quads`, `rect = rectFromQuads`, `color = colors[type]`, `opacity 1`, `contents ''`, autor, `modified = created = nowIso()`, `origin { kind: 'new' }`), llama a `addAnnotations(label, list)` (etiqueta «resaltar», «subrayar», «tachar»), vacía la selección y devuelve cuántas creó (0 si no había texto).
4. Herramienta activa (`tool` = uno de los tres): en `pointerup` sobre una capa de texto, si la selección no está vacía → `markupSelection(tool, sel)`.
5. `src/ui/viewer/SelectionActions.tsx`: con `tool === 'none'` y selección no vacía dentro de capas de texto (escucha `selectionchange`, con `requestAnimationFrame`), barra flotante `role="toolbar"` `aria-label="Acciones de la selección"` posicionada bajo el último rectángulo de la selección (por encima si no cabe), con 4 `IconButton`. Desaparece al vaciarse la selección, al desplazar o con Esc. No roba el foco al aparecer.
6. `CommentToolbar`: al pulsar «Resaltar», «Subrayar» o «Tachar» con texto seleccionado → `markupSelection` y **no** cambia la herramienta; sin selección → activa la herramienta (conmutador).
7. Tests `tests/unit/annotations/line-quads.test.ts`, `tests/ui/markup.test.tsx` (selección y registro simulados), `tests/e2e/markup.spec.ts`.

## Criterios de aceptación
- [ ] (T) `rectsToLineQuads` con 3 palabras de una línea separadas 3 pt (alto 12) → 1 quad; dos líneas → 2 quads ordenados de arriba abajo; separadas 20 pt en la misma línea → 2 quads; un rect de 0,2 pt de ancho se descarta.
- [ ] (T) `markupSelection` con rects en las páginas 2 y 3 → 2 anotaciones, `undoDepth` sube en 1, un `undo` las quita las dos.
- [ ] E2E (`basic-5.pdf`): doble clic en `murciélago` → aparece la barra flotante; «Resaltar» → en la capa existe un elemento con `aria-label` que empieza por «Resaltado de Usuario» y el píxel del centro de la palabra es amarillento (R>200, G>200, B<150); Ctrl+Z lo quita.
- [ ] E2E: con la herramienta «Subrayar» activa, arrastrar sobre la línea 3 de la p1 crea un subrayado cuyo `rect` cubre la línea (ancho ≥ 80 % del ancho del texto de la línea, medido con los `span` de la capa).
- [ ] E2E: seleccionar desde la mitad de la p1 hasta la mitad de la p2 con «Tachar» → 2 anotaciones (una por página).
- [ ] E2E: zoom 150 % y rotación 90°: resaltar una palabra → el resaltado cae sobre ella (píxel del centro amarillento).
- [ ] E2E teclado: Ctrl+A (texto de la página) y botón «Resaltar» de la barra «Comentar» activado con Intro → resaltado creado.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Texto vertical o en columnas complejas (se acepta lo que dé `getClientRects`). Comentario sobre el marcado (PDF-033).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] replanificación — 2026-10-17
- `depende_de` gana [[PDF-069-barra-comentar]]: la barra «Comentar» (`CommentToolbar`, menús Color/Grosor/Tamaño) ya no la crea PDF-030, sino PDF-069. Donde esta ficha dice «`CommentToolbar`», es el componente de PDF-069 (`src/ui/toolbar/CommentToolbar.tsx`).

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/core/annotations/line-quads.ts`, `src/ui/viewer/selection-to-pages.ts`, `src/state/markup-actions.ts`, `src/ui/viewer/SelectionActions.tsx` y `SelectionActions.module.css`, `tests/unit/annotations/line-quads.test.ts`, `tests/ui/markup.test.tsx`, `tests/e2e/markup.spec.ts`. Modificados: `src/engine/text.ts` (`container` y `viewport` en `TextLayerHandle`), `src/ui/viewer/text-layer-registry.ts` (`all()`), `src/ui/viewer/TextLayerView.tsx` (pointerup sobre la capa), `src/ui/toolbar/CommentToolbar.tsx`, `src/ui/App.tsx`, `src/ui/messages.ts`, `src/ui/icons.tsx` (`IconCopy`), y fakes de `tests/ui/text-selection.test.tsx`, `tests/ui/search-highlights.test.tsx`, `tests/ui/text-layer.test.tsx`.
- Qué he hecho: quads por línea (puro) y mapeo de la selección a páginas en puntos PDF; `markupSelection` crea una anotación por página en un solo paso de deshacer. Herramienta de marcado activa: al soltar sobre una capa marca la selección. Barra flotante «Acciones de la selección» (resaltar, subrayar, tachar, copiar) sin herramienta activa; «Resaltar/Subrayar/Tachar» de «Comentar» marcan la selección sin cambiar la herramienta.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` (raíz) OK; `pnpm test` 133 ficheros, 1557 tests OK; `pnpm coverage` OK (core 100 % en `line-quads.ts`); `LECTOR_E2E_PORT=4217 pnpm --filter lector-pdf e2e` 129/129 OK (incluye `markup.spec.ts` 5/5).
- Dudas o cosas que no he podido hacer: (1) `markup-actions.ts` (state) importa `selection-to-pages.ts` (ui), porque la ficha lo pide así; si se quiere separar, sería decisión del líder. (2) El arrastre de subrayado debe empezar dentro de un carácter: un `mousedown` en el hueco de la capa no inicia selección en Chromium; el E2E lo hace así. (3) Con clic de ratón en «Resaltar» de «Comentar», no he verificado en navegador real que el `mousedown` no colapse la selección (los tests de jsdom usan `fireEvent`); la barra flotante sí evita ese colapso. (4) «Copiar» usa `navigator.clipboard`; si falla solo se registra en el log, sin aviso al usuario. (5) `markupSelection` vacía la selección aunque no cree nada (decisión tomada: la ficha dice «vacía la selección»). (6) El E2E construye en `dist/` compartido: no lo ejecuté en paralelo con otro E2E. No he hecho commit.
