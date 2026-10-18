---
tipo: tarea
id: PDF-031
titulo: Capa de anotaciones - dibujar, seleccionar, mover y borrar
app: pdf
estado: en-curso
depende_de: [PDF-030, PDF-010, PDF-011, PDF-013]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, anotaciones, accesibilidad]
---

# PDF-031 · Capa de anotaciones

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Encima de cada página visible, una capa SVG muestra las anotaciones nuevas y editadas (las del fichero sin tocar las sigue dibujando pdf.js en el lienzo), permite seleccionar cualquier anotación soportada con ratón o teclado, moverla arrastrando o con flechas, y borrarla con Supr. Las anotaciones del fichero editadas o borradas se ocultan del lienzo.

## Contexto
- Leer: `src/state/annotation-store.ts`, `annotation-actions.ts` (PDF-030), `src/ui/viewer/PageView.tsx`, `TextLayerView.tsx`, `src/engine/render.ts`, `src/core/annotations/{model,wrap,helvetica-widths}.ts`.
- Ocultar una anotación del fichero en el lienzo (comprobado por el líder con pdf.js 6.4.299): `doc.annotationStorage.setValue('<num>R', { noView: true })` (con generación > 0: `'<num>R<gen>'`) y renderizar con `AnnotationMode.ENABLE_STORAGE` (ya lo hace PDF-010); para volver a mostrarla, `doc.annotationStorage.remove(key)`.
- Transformación PDF → CSS: `viewport.transform` del mismo `viewport` que la capa de texto (`scale = zoomToScale(zoom)`, `rotation = (page.rotate + rotation) % 360`).

## Qué hay que hacer
1. `src/engine/annotation-visibility.ts`: `export function setFileAnnotationHidden(doc: PDFDocumentProxy, ref: PdfObjRef, hidden: boolean): void`.
2. En `annotation-actions.ts`: tras cada cambio, para cada anotación del fichero cuya entrada en `edits` cambió, llama a `setFileAnnotationHidden(doc, ref, upserts.has(id) || removed.has(id))` (también para su `popupRef`) y sube `pageVersion`. `PageView` añade `pageVersion.get(index)` a las dependencias del render del lienzo.
3. `src/ui/viewer/annotation-geometry.ts` (puro): `export function annotationOutline(a: Annotation): RectPt` (caja para selección: `rect`, con mínimo 8×8 pt) y `export function svgPathForQuads(quads: readonly Quad[]): string`.
4. `src/ui/viewer/AnnotationLayer.tsx` (dentro de `PageView`, encima de la capa de texto; props `{ pageIndex, viewport }`):
   - `<svg class="annotationLayer">` del tamaño del `viewport`, `pointer-events: none`; un `<g transform="matrix(a b c d e f)">` con `viewport.transform`.
   - Dibuja **nuevas y modificadas** de la página igual que su apariencia (PDF-027): resaltado polígonos con `mix-blend-mode: multiply` y `opacity`; subrayado/tachado líneas; nota icono 20×20; texto libre borde + `<text>` por línea (`wrapText`, fuente `Helvetica, Arial, sans-serif`, cada `<text>` con `transform="translate(x y) scale(1 -1)"` para no salir invertido); tinta `polyline` con `stroke-linecap/linejoin round`.
   - Para **todas** las soportadas de la página (también las del fichero sin tocar), una zona activa transparente (`pointer-events: visiblePainted`, `fill: transparent` y `stroke` transparente de 6 px para las líneas) con `role="button"`, `tabindex={0}` (solo la seleccionada o, si no hay, la primera de la página: *roving tabindex* entre anotaciones de la página con ↑/↓) y `aria-label` «<Tipo> de <autor>: <primeros 80 caracteres del comentario>».
   - Las ajenas no tienen zona activa.
   - Selección: clic o Intro/Espacio → `select(id)`; dibuja un rectángulo discontinuo (`annotationOutline`, color `--color-focus`). Clic en zona vacía de la página → `select(null)`.
   - Mover (solo `note`, `freetext` e `ink`; el marcado de texto va unido al texto y no se mueve): arrastrar la seleccionada (umbral 3 px) mueve una vista previa; al soltar → `updateAnnotation(translateAnnotation(a, dx, dy), 'mover')`, con `dx, dy` en puntos PDF (`viewport.convertToPdfPoint`). Flechas: 1 pt (Mayús: 10 pt), `mergeKey 'move:<id>'`.
   - Supr / Retroceso con una seleccionada → `deleteAnnotation(id)` y foco a la siguiente de la página (o al visor).
   - Las anotaciones soportadas del fichero se pueden mover (según su tipo) y borrar aunque su autor sea otro (como Acrobat), sin confirmación.
5. CSS: `.annotationLayer` `position: absolute; inset: 0; z-index` por encima de `.textLayer`. Con `tool !== 'none'` la capa de texto sigue activa para marcado; para nota/texto/dibujo la capa de anotaciones captura el puntero (PDF-033 a PDF-035 lo usan).
6. *(viene de PDF-030)* Cursor por herramienta: `Viewer.tsx` pone `data-tool={tool}` (de `useAnnotations(s => s.tool)`) en su contenedor de scroll; en `Viewer.module.css`: `[data-tool='highlight'], [data-tool='underline'], [data-tool='strikeout']` → `cursor: text` sobre la capa de texto; `[data-tool='note'], [data-tool='freetext'], [data-tool='ink']` → `cursor: crosshair` sobre `.annotationLayer`. Con `'none'` no cambia nada.
7. *(viene de PDF-030)* Importación perezosa: en `PageView`, `useEffect(() => { if (visible && scan === 'lazy') void ensurePageAnnotations(index); }, [visible, index, scan])` (`scan` con selector fino `useAnnotations(s => s.scan)`). `ensurePageAnnotations` ya evita importar dos veces la misma página.
8. Tests `tests/ui/annotation-layer.test.tsx` (jsdom; `viewport` falso con `transform` y `convertToPdfPoint` conocidos) y `tests/e2e/annotations-layer.spec.ts`.

## Criterios de aceptación
- [ ] (T) Con un `viewport` de escala 2 y rotación 0, una nota nueva en `rect [100, 700, 120, 720]` de una página de 792 pt de alto se dibuja con `transform` `matrix(2 0 0 -2 0 1584)` y su zona activa existe con `aria-label` correcto.
- [ ] (T) Clic en la zona → `selectedId`; Supr → la anotación se borra y `undo` la recupera; sobre una nota, flechas mueven 1 pt (`rect` +1 en x con →) y varias pulsaciones seguidas son una sola entrada de deshacer.
- [ ] (T) Editar una anotación del fichero llama a `setFileAnnotationHidden(..., true)`; deshacer la edición → `false`.
- [ ] (T) Las ajenas no generan zona activa; arrastrar o pulsar flechas sobre un resaltado no lo mueve.
- [ ] E2E (`annotated.pdf`): borrar con Supr el resaltado de la p1 → el píxel amarillo de su centro deja de serlo en el lienzo (tolerancia 10); Ctrl+Z → vuelve.
- [ ] E2E: mover con el ratón una nota 50 px → su `rect` cambia ≈ 50 / escala pt.
- [ ] E2E: con zoom 200 % y rotación 90° la zona activa del resaltado de la p1 coincide con el píxel amarillo (clic en el centro → seleccionado).
- [ ] (T) Con `tool 'ink'` el contenedor del visor tiene `data-tool="ink"` y `.annotationLayer` calcula `cursor: crosshair`; con `'highlight'` la capa de texto `cursor: text`.
- [ ] (T) Con `scan 'lazy'` (documento simulado de 25 000 páginas), montar `PageView` visible de la página 7 → `ensurePageAnnotations(7)` una vez (espía); con `visible: false` no se llama; con `scan 'done'` no se llama.
- [ ] Rendimiento: una página con 500 anotaciones (fixture generado en el test) se desplaza sin *long tasks* > 100 ms.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Cambiar tamaño (texto libre en PDF-034). Crear anotaciones (PDF-032 a PDF-035). Popups (PDF-033).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] replanificación — 2026-10-17
- Recibe de [[PDF-030-estado-de-anotaciones]] el cursor por herramienta y la llamada a `ensurePageAnnotations` al hacerse visible una página (pasos 6 y 7, dos criterios nuevos). La barra «Comentar» va a [[PDF-069-barra-comentar]]; esta ficha no la necesita (usa `tool` del store).
- `depende_de` corregido: faltaban PDF-010 (`PageView`), PDF-011 (zoom y rotación, criterio e2e) y PDF-013 (`TextLayerView`).
