---
tipo: tarea
id: PDF-031
titulo: Capa de anotaciones - dibujar, seleccionar, mover y borrar
app: pdf
estado: en-test
depende_de: [PDF-030, PDF-010, PDF-011, PDF-013]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
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
- [x] Rendimiento: una página con 500 anotaciones (fixture generado en el test) se desplaza sin *long tasks* > 100 ms. Medido: tarea larga máxima 0 ms al desplazar (E2E, 3 repeticiones).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Cambiar tamaño (texto libre en PDF-034). Crear anotaciones (PDF-032 a PDF-035). Popups (PDF-033).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] replanificación — 2026-10-17
- Recibe de [[PDF-030-estado-de-anotaciones]] el cursor por herramienta y la llamada a `ensurePageAnnotations` al hacerse visible una página (pasos 6 y 7, dos criterios nuevos). La barra «Comentar» va a [[PDF-069-barra-comentar]]; esta ficha no la necesita (usa `tool` del store).
- `depende_de` corregido: faltaban PDF-010 (`PageView`), PDF-011 (zoom y rotación, criterio e2e) y PDF-013 (`TextLayerView`).

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/engine/annotation-visibility.ts` (nuevo), `src/ui/viewer/AnnotationLayer.tsx`, `AnnotationLayer.module.css`, `annotation-geometry.ts`, `annotation-shapes.tsx` (nuevos), `src/ui/viewer/PageView.tsx`, `Viewer.tsx`, `Viewer.module.css`, `src/state/annotation-actions.ts`, `src/ui/messages.ts` (nombres de tipo y de zona); tests `tests/ui/annotation-layer.test.tsx`, `tests/ui/annotation-tool-cursor.test.tsx`, `tests/ui/page-view-annotations.test.tsx`, `tests/unit/annotations/annotation-geometry.test.ts`, `tests/perf/annotation-layer.perf.test.tsx`, `tests/e2e/annotations-layer.spec.ts`; esta ficha.
- Qué he hecho: capa SVG por página con las nuevas y modificadas (formas como PDF-027) y una zona activa por anotación soportada (roving tabindex, nombre accesible). Seleccionar, mover con ratón (umbral 3 px) o flechas (1 pt, 10 con Mayús; una sola entrada de deshacer), Supr/Retroceso con el foco a la siguiente. Las del fichero editadas o borradas se ocultan en el lienzo al cambiar y se vuelven a mostrar al deshacer. Importación perezosa al hacerse visible una página y cursor por `data-tool`.
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos), `pnpm typecheck` OK, `pnpm coverage` OK (120 ficheros, 1441 tests, código 0). `pnpm test` 1423 tests OK pero código 1 por 3 errores no capturados en `tests/ui/open.test.tsx` (falta `getOutline` en el mock; es de PDF-016, en el árbol). `pnpm perf`: mi test OK; `search.perf` (PDF-017) falla en aislado (66 ms frente a 50 ms), no es de esta ficha. E2E con config temporal en el puerto 4396: `annotations-layer.spec.ts` 3/3 OK; suite completa 67/69, los 2 fallos (`remember` y `render` de basic-5) son timeouts de carga con dos workers y pasan en aislado (3/3).
- Dudas o cosas que no he podido hacer:
  1. Decisión a revisar: con una anotación movible seleccionada (nota, texto, dibujo), ↑/↓ la mueven; si no, ↑/↓ recorren las zonas de la página. Así no chocan el movimiento y el roving tabindex.
  2. Criterio de rendimiento (500 anotaciones sin long tasks al desplazar): solo cubierto en parte. El test de `pnpm perf` mide en jsdom el montaje y el cambio de selección (< 100 ms); no mide long tasks en el navegador durante el desplazamiento.
  3. El cursor (`crosshair`, `text`) se revisa en el CSS; jsdom no aplica CSS, así que no hay test automático. `data-tool` sí tiene test.
  4. `data-tool` muestra la herramienta de anotación si no es `none`, y si no la de vista (selección o mano), para no romper la herramienta mano.
  5. Sin comentario, el nombre accesible no lleva dos puntos. Pulsar sobre una anotación la selecciona, y el arrastre empieza desde ese mismo gesto.
  6. No he hecho commit: la instrucción era no usar git commit/stash/checkout con otras fichas en el árbol. No he tocado ficheros de PDF-015, PDF-018 ni PDF-037.

### [revisor] ronda 1 — 2026-10-18 — CAMBIOS
Comprobado: lint 0 avisos; tests de la ficha (18 ficheros, 225 tests) OK; E2E `annotations-layer` 3/3 en puerto 4401 (y 12/12 con `--repeat-each=4`; un primer intento falló una vez en el test de Supr/Ctrl+Z, no reproducible, probable carga por revisiones en paralelo). El typecheck solo falla en `tests/e2e/outline.spec.ts` (PDF-016, ajeno). Código, accesibilidad, ocultación en el lienzo y deshacer correctos.
1. `tests/perf/annotation-layer.perf.test.tsx` / `tests/e2e/annotations-layer.spec.ts` — el criterio «una página con 500 anotaciones se desplaza sin long tasks > 100 ms» no tiene ningún test que lo compruebe (el de jsdom solo mide montaje y selección, y el programador lo declara cubierto «en parte») — añadir un E2E que genere un PDF con 500 anotaciones en una página (fixture generado en el test), desplace el visor y verifique con `PerformanceObserver({ type: 'longtask' })` que ninguna pasa de 100 ms (patrón ya usado en `tests/e2e/viewer.spec.ts:105`). Anotar el resultado en la ficha.
2. (opcional) `AnnotationLayer.tsx:152` — con el foco en una zona no seleccionada (Tab) Supr no hace nada; valorar seleccionar al enfocar por teclado o que Supr actúe sobre la zona enfocada.
3. (opcional) `tests/e2e/annotations-layer.spec.ts:36` — `pixelAt` usa `locator('canvas')` sin acotar; durante el cambio de lienzo puede haber dos y fallar por modo estricto. Usar `.last()`.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx` (Supr sobre la zona enfocada); `tests/ui/annotation-layer.test.tsx` (test Tab + Supr); `tests/e2e/annotations-layer.spec.ts` (`pixelAt` robusto y test de 500 anotaciones con long tasks); `tests/perf/annotation-layer.perf.test.tsx` renombrado a `annotation-layer.perf.test.ts` (sin JSX); esta ficha.
- Qué he hecho: (1) E2E nuevo: PDF de 3 páginas con 500 resaltados en la página 1, se desplaza con la rueda y `PerformanceObserver` de long tasks solo para tareas que empiezan durante el desplazamiento: máximo 0 ms. (2) Supr/Retroceso actúan sobre la zona enfocada aunque no esté seleccionada (llegada con Tab); la selección no cambia y `deleteAnnotation` la limpia si era la borrada. (3) `pixelAt` usa el último lienzo con tamaño en pantalla y devuelve `null` en vez de lanzar (dentro de `expect.poll` un throw no se reintenta). El test de rendimiento de jsdom no se ejecutaba con `pnpm perf`: el patrón solo recoge `*.perf.test.ts` y el fichero era `.tsx`; ahora es `.ts` con `createElement`.
- Comandos ejecutados y resultado:
  - `pnpm lint`: OK (código 0).
  - `pnpm coverage`: OK, 122 ficheros, 1457 tests, código 0.
  - `pnpm typecheck` (`tsc -p tsconfig.json`): solo falla `tests/e2e/outline.spec.ts(50,45)` (PDF-016, ajeno a esta ficha); ningún error en ficheros míos.
  - `pnpm exec vitest run --config vitest.perf.config.ts annotation-layer`: pasa; en una ejecución midió 163 ms al montar 500 anotaciones (carga del sistema, load average 8) y en dos reintentos pasó.
  - E2E `annotations-layer.spec.ts` con config temporal en el puerto 4404 (en el scratchpad, fuera del repo): 4 tests × 3 repeticiones, 12/12 OK; el de long tasks 0 ms.
- Dudas o cosas que no he podido hacer:
  1. Decisión a revisar: Supr borra la zona enfocada aunque no esté seleccionada (el criterio original hablaba de «seleccionada»). Alternativa: seleccionar al enfocar, pero cambia el test de Supr que espera selección nula tras borrar.
  2. `pnpm e2e` completo no lo he ejecutado: el árbol lo usan otras fichas. Solo he corrido el E2E de esta ficha.
  3. El perf de jsdom queda en `pnpm perf` sin JSX. Si se quiere `.tsx`, hay que ampliar el `include` de `vitest.perf.config.ts` (config compartida, no la he tocado).
  4. No he hecho commit (instrucción de no usar git commit/stash/checkout con las otras fichas en el árbol).

### [revisor] ronda 2 — 2026-10-18 — APROBADO
Comprobado: `pnpm lint` 0 avisos; `pnpm typecheck` OK (ya sin el fallo ajeno); `pnpm test` 122 ficheros, 1457 tests OK; tests de la ficha 226 OK; perf de jsdom OK; E2E `annotations-layer` 4 tests x2 repeticiones = 8/8 en puerto 4409 (el de 500 anotaciones sin long tasks). Los tres puntos de la ronda 1 resueltos. Supr sobre la zona enfocada y la decisión ↑/↓ (mover si hay movible seleccionada, si no recorrer) son razonables y quedan aceptadas. Sin problemas bloqueantes.
