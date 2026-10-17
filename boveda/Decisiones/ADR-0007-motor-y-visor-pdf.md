---
tipo: decision
id: ADR-0007
app: pdf
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, pdf, arquitectura]
---

# ADR-0007 · Motor de render y visor virtualizado propio del lector PDF

## Contexto
El usuario pide un lector que "funcione de manera correcta, sin importar cuántas páginas tenga el PDF". Investigación: [[Librerias y arquitectura PDF]] y [[Paridad Adobe Acrobat]].
Hechos comprobados por el líder el 2026-10-17 con `pdfjs-dist@6.4.299` (borrador fuera del repo):
- `PDFViewer` de pdf.js crea un nodo por página y **por encima de 10 000 páginas fuerza el modo "una página"** (`FORCE_SCROLL_MODE_PAGE`); por encima de 5 000 omite la precarga. El comportamiento cambia con el número de páginas.
- La API de bajo nivel (`getDocument`, `PDFPageProxy.render`, `TextLayer`, `getTextContent`, `getAnnotations`, `getOutline`) es pública y estable.
- Carga por rangos (`PDFDataRangeTransport`, `disableAutoFetch`, `disableStream`) en Node con un PDF de 5 000 páginas: abre en ~600 ms.
- `TextLayer.textDivs[i]` corresponde 1:1 a los ítems de `getTextContent()` que tienen `str` (los de contenido marcado no generan span).
- Una anotación existente se puede ocultar del lienzo con `doc.annotationStorage.setValue('<num>R', { noView: true })` si se renderiza con `annotationMode: AnnotationMode.ENABLE_STORAGE` (código `mustBeViewed` del worker).
- Los navegadores limitan la altura de un elemento (Firefox ~17,8 M px): 50 000 páginas × 1 100 px no caben en un scroll nativo.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| A. `PDFViewer` + `PDFFindController` + `AnnotationLayer` de `pdfjs-dist/web/pdf_viewer.mjs` | Mucho hecho (zoom, búsqueda, enlaces) | Comportamiento distinto con >5 000 y >10 000 páginas; DOM de todas las páginas; difícil de integrar con React, nuestro modelo de anotaciones y nuestro tema; búsqueda acoplada al visor | Apache-2.0 |
| **B. Visor propio sobre la API de bajo nivel de pdf.js** | Mismo comportamiento con 5 o 100 000 páginas; solo existen en el DOM las páginas visibles; control total de memoria, búsqueda y capas | Más código propio (layout, cola de render, enlaces, búsqueda) | Apache-2.0 |
| C. PDFium/EmbedPDF (WASM) | Fidelidad de Chrome | API propia, menos integrado; capa de texto y búsqueda menos maduras | MIT + Apache-2.0 |
| D. mupdf.js | Muy completo | AGPL-3.0 | AGPL |

## Decisión
**Opción B.** `pdfjs-dist@6.4.299` (versión exacta) como motor; visor, búsqueda, enlaces e índice propios.
- **Un único punto de entrada a pdf.js:** solo `apps/lector-pdf/src/engine/**` importa `pdfjs-dist` (regla de lint). El resto de la app usa tipos y funciones de `engine/` y lógica pura de `core/`.
- **Carga:** siempre por rangos desde un `ByteSource` (ver [[ADR-0008-plataforma-ficheros]]) con `disableAutoFetch: true`, `disableStream: true`, `rangeChunkSize: 65536`, `isEvalSupported: false`, `enableXfa: false`. JavaScript de los PDF nunca se ejecuta (no se usa el *sandbox* de scripting).
- **Layout virtual propio** (`core/layout.ts`): alturas por página en `Float64Array`, búsqueda binaria de la página visible, y **escalado del scroll** cuando la altura total supera `MAX_SCROLL_HEIGHT = 8 000 000` px: un único camino de código para cualquier tamaño.
- **Dimensiones de página:** se supone el tamaño de la página 1 para todas y se corrige en segundo plano por lotes (hasta 20 000 páginas; por encima, se corrige al renderizar cada página) sin saltos de scroll (anclaje).
- **Render:** cola propia con prioridad y cancelación, 2 trabajos simultáneos, lienzo limitado a 33 554 432 píxeles, solo páginas visibles ± 1. Los lienzos de páginas que salen se liberan (`width = height = 0`) y se llama a `page.cleanup()`.
- **Anotaciones existentes:** se pintan en el lienzo con `AnnotationMode.ENABLE_STORAGE`; las que el usuario edita o borra se ocultan con `noView` y las dibuja nuestra capa (ver [[ADR-0009-anotaciones-escritor-incremental]]).
- **Capa de texto:** `TextLayer` de pdf.js + estilos de `pdfjs-dist/web/pdf_viewer.css`. La búsqueda usa los mismos ítems (`getTextContent({ includeMarkedContent: true })` filtrando los que tienen `str`) para poder resaltar sobre los spans.
- **Enlaces e índice:** capa propia a partir de `getAnnotations()` (subtipo `Link`) y `getOutline()`; las URL externas solo `http:`, `https:` y `mailto:`, siempre con confirmación.
- **Modo noche:** parámetro `pageColors` de `render()` (no invierte las imágenes).
- **Plan B** documentado: PDFium (EmbedPDF, MIT) si pdf.js falla en fidelidad o rendimiento. **mupdf queda prohibido** salvo decisión del usuario sobre la AGPL.

## Consecuencias
- Hay que construir y probar: layout, cola de render, búsqueda incremental, enlaces, índice y miniaturas (fichas PDF-006 a PDF-018).
- Por encima de 10 000 páginas no hay cambio de modo; el precio es que con el scroll escalado un píxel de barra equivale a varios de contenido (la rueda del ratón sigue moviendo lo esperado).
- Con zoom muy alto la página se ve algo borrosa (límite de lienzo) hasta que exista el "lienzo de detalle" (ficha PDF-051).
- Build: se usa `pdfjs-dist/legacy/build/*` en todas partes, ver [[ADR-0013-pdfjs-build-legacy]].
- Vigilar actualizaciones de pdf.js: la API `TextLayer`, `annotationStorage` y `pageColors` se fijan con versión exacta y se cubren con tests.
