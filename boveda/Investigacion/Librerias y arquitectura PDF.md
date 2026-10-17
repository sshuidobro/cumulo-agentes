---
tipo: investigacion
app: pdf
estado: completa
creado: 2026-10-17
actualizado: 2026-10-17
tags: [investigacion, pdf, librerias, arquitectura]
---

# Librerías y arquitectura PDF (Lector PDF)

## Preguntas
1. ¿Qué motor de render y qué librería de escritura usar (pdf.js, pdf-lib, mupdf.js, PDFium wasm, EmbedPDF), con qué licencias y compatibilidad con Vite?
2. ¿Cómo abrir y recorrer PDFs de 5 000+ páginas sin agotar memoria?
3. ¿Cómo guardar anotaciones (highlight, underline, strikeout, Text, FreeText, Ink) como anotaciones PDF estándar visibles en Adobe, sin reescribir ficheros enormes?
4. ¿Cómo generar fixtures propios (incluido 5 000 páginas) y de dónde sacar PDFs públicos?
5. ¿Cómo abrir ficheros en Tauri y en web sin cargarlos enteros en memoria?

## Resumen
- **Render, texto, búsqueda, enlaces, outline, formularios: `pdfjs-dist` 6.4.299 (Apache-2.0)**. Es el único candidato maduro, MIT/Apache y con visor de componentes (`PDFViewer`, `PDFFindController`) que ya virtualiza.
- **Escritura: no usar `pdf-lib` para guardar anotaciones sobre el PDF original.** Su `save()` reescribe el documento entero (no hay guardado incremental en su código) y está sin releases desde 2022. Sirve solo para operaciones de página (unir, girar, extraer) en ficheros de tamaño normal.
- **Anotaciones: guardado incremental** (anexar objetos + nueva tabla xref con `/Prev`). Probado en este trabajo con un generador propio: añadir un Highlight a un PDF de 5 000 páginas (1,77 MB) añade 729 bytes y pdf.js lo lee con `QuadPoints` y `/AP`. Para la primera iteración, usar `PDFDocumentProxy.saveDocument()` de pdf.js (que ya hace actualización incremental) y anexar solo el delta al fichero copiado.
- **Evitar `mupdf` (AGPL-3.0)** salvo decisión explícita; para uso personal no distribuido sería válido, pero condiciona cualquier futuro reparto. **PDFium/EmbedPDF (MIT + Apache-2.0)** es la alternativa de reserva si pdf.js falla en fidelidad o rendimiento.
- **Memoria:** pdf.js ya cachea 10 vistas de página y fuerza inicialización perezosa por encima de 5 000 páginas; hay que usar carga por rangos (`PDFDataRangeTransport` en Tauri, `File.slice` en web) y no pasar `data: Uint8Array` de ficheros grandes.

## Hallazgos

### 1. Librerías: versiones y licencias (comprobadas con `npm view` el 2026-10-17)
| Paquete | Versión | Licencia | Última modificación npm |
|---|---|---|---|
| `pdfjs-dist` | 6.4.299 | Apache-2.0 | 2026-10-03 |
| `pdf-lib` | 1.17.1 | MIT | 2022-05-12 |
| `@cantoo/pdf-lib` (fork) | 2.11.1 | MIT | 2026-09-15 |
| `@pdfme/pdf-lib` (fork) | 6.2.6 | MIT | 2026-10-16 |
| `mupdf` | 1.28.1 | **AGPL-3.0-or-later** | 2026-09-06 |
| `@embedpdf/engines` / `@embedpdf/pdfium` | 2.15.1 | MIT (envuelve PDFium, Apache-2.0) | 2026-09-16 |
| `@hyzyla/pdfium` | 3.0.0 | MIT | 2026-10-10 |
| `pdfium-wasm` | 0.0.2 | ISC | 2023-10-01 (abandonado) |
| `@tauri-apps/plugin-fs` | 2.7.1 | MIT OR Apache-2.0 | n/d |
| `vite` | 8.3.4 | n/d | n/d |

Datos de stars, issues abiertas y último commit de GitHub: **no verificado** (el acceso a GitHub estuvo bloqueado en esta sesión).

- pdf.js 6.x: paquete de ~35 MB desempaquetado, requiere Node `>=22.13.0 || >=24` solo en Node (no en navegador) y trae `@napi-rs/canvas` como dependencia opcional ([npm: pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist), comprobado con `npm view`). Incluye `build/pdf.mjs`, `build/pdf.worker.mjs`, `web/pdf_viewer.mjs`, `web/pdf_viewer.css`, cmaps, fuentes estándar y wasm (jbig2, openjpeg, qcms) inspeccionado tras `npm pack`.
- pdf-lib sin releases desde 2022: Snyk, DepScope y un artículo secundario lo consideran inactivo; sus forks `@cantoo/pdf-lib` y `@pdfme/pdf-lib` siguen publicando ([búsqueda: pdf-lib maintenance](https://snyk.io/advisor/npm-package/pdf-lib), [DepScope](https://depscope.dev/pkg/npm/pdf-lib)). Calidad de los forks: no verificada.
- pdf-lib no tiene guardado incremental: búsqueda de "incremental" en `src/` del paquete `pdf-lib@1.17.1` sin resultados (comprobado tras `npm pack`). Todas las opciones de `save()` reescriben el fichero.
- MuPDF.js ofrece creación de anotaciones y `saveToBuffer(opts)`; el soporte de guardado incremental en JS se menciona solo en un ejemplo comentado, no verificado ([mupdf wasm docs](https://mupdf.readthedocs.io/en/latest/mupdf-wasm.html), [context7 mupdf](https://context7.com/artifexsoftware/mupdf)). Licencia AGPL confirmada en npm.
- EmbedPDF: viewer MIT sobre PDFium compilado a WebAssembly, con anotaciones (highlight, notas, texto libre, tinta) según README/publicación del autor, afirmación promocional ([EmbedPDF en Show HN](https://hn.svelte.dev/item/44901683), [README @embedpdf/pdfium](https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.14.3/README.md)). Existe documentación de "save as copy" ([EmbedPDF docs](https://www.embedpdf.com/docs/engines/document-lifecycle/save-as-copy)); no pude leerla, por lo que incrementalidad: no verificado.

### 2. Memoria con documentos de 5 000+ páginas (pdf.js)
Verificado leyendo `pdfjs-dist@6.4.299` (`web/pdf_viewer.mjs`, `types/`):
- `PDFViewer` guarda un búfer de vistas con `DEFAULT_CACHE_SIZE = 10` (se amplía a `2 * páginasVisibles + 1`). Es la misma política que Mozilla introdujo en 2014 tras ver cientos de canvas de más de 20 MiB retenidos ([Nethercote, an even slimmer pdf.js](https://blog.mozilla.org/nnethercote/2014/06/16/an-even-slimmer-pdf-js/)).
- `PagesCountLimit`: por encima de **5 000** páginas se omite la precarga de todas las páginas (`FORCE_LAZY_PAGE_INIT: 5000`), por encima de **10 000** fuerza modo de desplazamiento por página (`FORCE_SCROLL_MODE_PAGE`). Un PDF de exactamente 5 000 páginas aún hace la carga ansiosa, y `disableAutoFetch` también la evita.
- Límites de canvas: `maxCanvasPixels` por defecto 4096×8192 (32 Mpx), `maxCanvasDim` 32767, `capCanvasAreaFactor` 200 %, `enableDetailCanvas` true: con zoom alto dibuja un segundo canvas solo de la zona visible sobre el canvas ampliado por CSS. `maxCanvasPixels: 0` = solo zoom CSS ([tipos de `pdf_viewer.d.ts` en pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist)).
- Carga: `getDocument` admite `range` (`PDFDataRangeTransport`), `rangeChunkSize` (por defecto 65 536), `disableStream`, `disableAutoFetch` (para que funcione hay que desactivar también el streaming), `maxImageSize`, `enableHWA`. Texto de la documentación en `types/src/display/api.d.ts`; mirror: [pdf.js API draft](https://mozilla.github.io/pdf.js/api/draft/api.js.html).
- Worker: pdf.js ejecuta parseo y operadores en un Web Worker; el principal solo pinta. `PDFDocumentLoadingTask.destroy()` libera el worker y el documento (api.d.ts).
- Medición propia (Node 22, build `legacy`, fixture de 5 000 páginas, datos completos en memoria): `getDocument` + `numPages` en 275-371 ms, RSS ~111 MB; texto de la página 5 000 extraído correctamente. Con fixtures sintéticos de contenido mínimo; no representa PDFs reales con imágenes.
- Búsqueda: `PDFFindController` recorre las páginas llamando a `getTextContent` una a una y emite eventos de progreso; para 5 000 páginas conviene un índice propio en un Worker por lotes (cancelable) además del controlador estándar. Rendimiento real de `PDFFindController` en 5 000 páginas: no verificado, medir en spike.
- Miniaturas: `PDFThumbnailViewer` renderiza bajo demanda (cola de render); usar canvas pequeños y descartarlos al salir de la ventana visible.

### 3. Anotaciones PDF estándar
- Una anotación es un diccionario `/Annot` referido desde `/Annots` de la página. Las de marcado de texto (Highlight, Underline, StrikeOut, Squiggly) exigen `/QuadPoints`; Text (nota), FreeText e Ink tienen sus campos propios (`/Name`, `/DA`, `/InkList`). Referencia: ISO 32000-1 §12.5 ([PDF 32000-1:2008 en Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf); no pude abrir el PDF en esta sesión, secciones citadas de memoria: no verificado).
- **Orden de QuadPoints:** Acrobat y otros usan el orden "en Z" (arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha) pese a lo que sugiere la especificación. pdf.js lo normaliza en `getQuadPoints` a `[minX,maxY, maxX,maxY, minX,minY, maxX,minY]` (visto en `build/pdf.worker.mjs`). Escribir en ese orden.
- **/AP obligatorio en la práctica:** escribir siempre `/AP << /N ref >>` (Form XObject con `/BBox` = `/Rect`); el Highlight usa un `ExtGState` con `/BM /Multiply` y opacidad. Si falta, los visores deben regenerarlo, pero no todos lo hacen. Con `/AP` y `/F 4` (print) el resultado se ve igual en cualquier visor. Verificado con pdf.js (`hasAppearance: true`); **no he podido probar con Adobe Acrobat Reader**: debe entrar en el plan de test manual.
- **Guardado incremental** (ISO 32000-1 §7.5.6): se anexa tras `%%EOF` los objetos nuevos o modificados, una sección xref con solo esos objetos y un trailer con `/Prev` al `startxref` anterior. Para anotar una página hay que reescribir el objeto de página (nuevo `/Annots`) o el array `/Annots` existente. Prototipo verificado (script de spike en el scratchpad, no entra en el repositorio): fichero de 1 775 941 B → 1 776 670 B (+729 B), pdf.js lo abre y devuelve `Highlight`, 8 coordenadas de `quadPoints`, `hasAppearance: true`.
- Si el fichero usa xref stream / object streams (PDF ≥1.5 típico de Adobe), el incremento también debe usar xref stream (el writer de pdf.js lo hace: `useXrefStream`). Un PDF con xref dañado exige reescritura completa.
- pdf.js trae editores de anotación (`AnnotationEditorType`: FREETEXT, HIGHLIGHT, STAMP, INK, SIGNATURE, COMMENT) y `saveDocument()` que combina `annotationStorage` y los nuevos editores con `incrementalUpdate` sobre `stream.bytes`, devolviendo el fichero entero (original + incremento) en un `Uint8Array` (visto en `build/pdf.worker.mjs` y `api.d.ts`). En un guardado incremental el resultado empieza por los bytes originales, así que el delta es `resultado.subarray(longitudOriginal)`.
- Para Text (nota) y Underline/StrikeOut, el editor de pdf.js no tiene tipo propio (solo Highlight, FreeText, Ink, Stamp...): habría que generar esos diccionarios con un writer propio. Estado de soporte en 6.x de otros subtipos: no verificado.
- **Cargar anotaciones existentes:** `page.getAnnotations()` devuelve subtipo, `rect`, `quadPoints`, `contents`, `hasAppearance`; el render de página (`AnnotationMode.ENABLE_FORMS` o `ENABLE_STORAGE`) y la capa de anotaciones de `PDFViewer` pintan las que tienen `/AP`. Borrar o editar una anotación existente exige también reescribir su objeto o `/Annots` (incremento) ó marcarla con `/F` oculto.
- Anotaciones de otros autores: conservarlas intactas (el guardado incremental lo garantiza por construcción; no reescribir `/Annots` ajenos).

### 4. Fixtures y PDFs públicos
- Generador propio sin dependencias (probado): escribe objetos con xref clásico en streaming, un `Pages` plano con N hojas (`Count`), fuente Helvetica compartida y texto distinto por página. 5 000 páginas en 0,07 s, 1,77 MB. Para PDFs con objetos comprimidos o cifrados usar `pdf-lib` en un script de dev (MIT) o `qpdf`/`mutool` si están instalados (no lo estaban en esta máquina).
- Para tamaños realistas de 5 000+ páginas con imágenes: el generador puede incrustar una imagen JPEG/Flate pequeña compartida por referencia (sin crecer) y otra por página (para stress). No implementado.
- Fixtures de anotaciones: crear con el writer incremental y validar con pdf.js en Node (`getAnnotations`). Validación en Adobe Reader: manual.
- Corpus públicos: **veraPDF corpus** (>1 500 ficheros PDF/A e ISO 32000-1; datos bajo CC-BY-4.0 según [DPC/veraPDF](https://www.dpconline.org/digipres/collaborative-projects/completed-projects/verapdf) y [PDF Association](https://www.pdfa.org/first-set-of-candidate-verapdf-corpus-files-delivered/)). El corpus de pdf.js (`test/pdfs`) y los ficheros del Govdocs/Isartor: licencias **no verificadas**; no copiar al repo sin comprobar. Regla del proyecto: ningún documento personal en el repositorio.

### 5. Abrir ficheros sin cargar todo
**Tauri 2**
- `@tauri-apps/plugin-fs` ofrece `open()` con `FileHandle` (`read`, `seek`, `stat`), por lo que se puede implementar un `PDFDataRangeTransport` que lea rangos bajo demanda ([Tauri fs reference](https://v2.tauri.app/reference/javascript/fs)). `seek` con offset negativo y `SeekMode.Start` se rechaza desde fs 2.7.0 ([notas de versión fs 2.7.0](https://v2.tauri.app/release/fs/v2.7.0/)).
- Alternativa: protocolo `asset:` + `convertFileSrc` y pasar la URL a `getDocument({url})`. El manejador de Tauri soporta `Range` (206 Partial Content), limita cada respuesta a `MAX_LEN = 1000 * 1024` B y comprueba el ámbito (403 si no permitido) ([asset.rs en tauri-apps/tauri](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/protocol/asset.rs)). Requiere activar `assetProtocol` y su scope; los ficheros elegidos en tiempo de ejecución con el diálogo pueden necesitar ampliar el ámbito o `persisted-scope` ([Asset protocol scope](https://v2.tauri.app/security/asset-protocol/)). Si el diálogo amplía el ámbito automáticamente: no verificado.
- Ventaja del `asset:` frente a `FileHandle`: pdf.js usa su cliente de red con streaming y rangos sin código propio. Desventaja: superficie de seguridad (ámbito) y dependencia de la configuración CSP. Recomendable `PDFDataRangeTransport` con comando/`FileHandle` por mínimo privilegio, pero ambas son viables; decidir tras spike.
- Guardado atómico (regla de calidad): copiar el original a un temporal en el mismo directorio (copia a nivel de SO, sin pasar por memoria), anexar el incremento y renombrar sobre el original.
**Web**
- `showOpenFilePicker()` solo en Chromium (Chrome/Edge 86+); Firefox y Safari no ([web.dev: abrir ficheros](https://web.dev/articles/files/open-one-or-multiple-files)). Con `FileSystemFileHandle.getFile()` se obtiene un `File` y `file.slice(a,b).arrayBuffer()` lee rangos sin cargar el fichero entero; los datos van a pdf.js mediante `PDFDataRangeTransport`.
- Fallback `<input type="file">`: también devuelve un `File` con `slice`, pero no permite guardar en sitio (descarga de copia).
- Guardado en sitio en web: `createWritable()` de File System Access (Chromium); en otros navegadores, descarga. Comportamiento exacto de `createWritable` con ficheros enormes: no verificado.

## Comparativa
| Criterio | pdf.js | pdf-lib | mupdf.js | PDFium (EmbedPDF) |
|---|---|---|---|---|
| Licencia | Apache-2.0 | MIT | AGPL-3.0 | MIT + Apache-2.0 |
| Mantenimiento | release 2026-10-03 | sin release desde 2022 | 2026-09 | 2026-09 |
| Calidad | visor completo, Worker, tipos TS | tipos TS, sin render | WASM, API amplia | WASM, API propia |
| Fidelidad | referencia del sector en render | no renderiza | muy alta | muy alta (motor de Chrome) |
| Escritura | `saveDocument` incremental (anotaciones/forms) | reescribe todo | sí, incremental no verificado | sí, `save as copy`, incremental no verificado |
| Tamaño | ~35 MB paquete (pdf.js + datos) | ligera | WASM grande | ~7,5 MB unpacked `@embedpdf/pdfium` |
| Riesgo | editor de anotaciones limitado | inactivo | licencia | menos integrado con React/Vite propio |

Alternativa a la combinación: **solo PDFium/EmbedPDF** para render y anotaciones. Se descarta como base porque la capa de texto, búsqueda y formularios de pdf.js son más completas y su estándar de facto, y el proyecto ya fija pdf.js en `formatos-ofimatica`; queda como plan B documentado.

## Arquitectura recomendada
```
apps/lector-pdf/
  src/core/pdf-source.ts      // abstracción: ByteSource { length, read(begin,end) }
  src/core/pdf-source.tauri.ts   // FileHandle (plugin-fs)
  src/core/pdf-source.web.ts     // File.slice
  src/core/range-transport.ts // ByteSource -> PDFDataRangeTransport
  src/core/loader.ts          // getDocument({range, disableAutoFetch, disableStream, rangeChunkSize})
  src/core/annotations/       // modelo propio + exportación a /Annot
  src/core/incremental-save.ts// delta + copia atómica
packages/pdf-incremental/     // (opcional, COM) writer incremental con tests contra pdf.js
```
Principios: `ByteSource` único para Tauri/web; el modelo de anotaciones propio (con UndoStack) separado de la serialización PDF; el escritor testeado contra pdf.js en Node (fixture + `getAnnotations`).

## Riesgos
- **Adobe no probado:** la validación de anotaciones en Adobe Reader solo es manual; incluir en el plan de test una lista de comprobación visual con capturas.
- **`saveDocument` devuelve el fichero completo:** para PDFs de cientos de MB el pico de memoria al guardar es alto (el original más el incremento). Mitigar con límite de tamaño para editar, aviso al usuario, o writer propio (que exige parser mínimo de xref/object streams).
- **pdf-lib inactivo:** cualquier función que dependa de él (unir, extraer) queda ligada a un fork no revisado.
- **AGPL de mupdf:** no incorporarla sin decisión del usuario.
- **Tamaño de pdf.js:** instalador mayor; cargar cmaps/fuentes por Tauri sin red.
- **Seguridad:** PDF es entrada no confiable; deshabilitar scripting de pdf.js (`enableScripting: false`) y no abrir enlaces sin confirmación; configuración CSP y scope de `asset:` mínimos. Valores y API exactos: no verificado.
- **FS Access API** solo en Chromium: la versión web será de peor calidad al guardar en Firefox/Safari.

## Recomendaciones
1. **Fijar ADR**: motor = `pdfjs-dist` ^6.4 (Apache-2.0) con `PDFViewer`/`PDFFindController` de `pdfjs-dist/web/pdf_viewer.mjs` y worker propio de Vite (`?url`). Plan B documentado: PDFium vía EmbedPDF (MIT). Prohibir `mupdf` salvo decisión del usuario sobre AGPL.
2. **No depender de `pdf-lib` para guardar anotaciones**; si se necesitan unir/girar/extraer páginas, evaluarlo en una ficha aparte (fork `@cantoo/pdf-lib` o `@pdfme/pdf-lib`) y aceptar reescritura completa con aviso.
3. **Guardado incremental en dos pasos**: (a) iteración inicial con `saveDocument()` de pdf.js y anexar `subarray(len)` a una copia atómica; (b) si el pico de memoria o los subtipos faltantes (Text, Underline, StrikeOut) lo exigen, writer propio en `packages/pdf-incremental` con tests contra pdf.js. Escribir `/AP` y QuadPoints en orden Z siempre.
4. **Abstracción `ByteSource`** con implementaciones Tauri (`plugin-fs` `FileHandle`) y web (`File.slice`), convertida a `PDFDataRangeTransport`; pasar `disableAutoFetch: true` y `disableStream: true` en ficheros grandes. Spike de 1 día para medir contra `asset:` y elegir.
5. **Presupuestos de memoria** (para `pruebas-calidad`): ≤10-12 canvas vivos, miniaturas lazy, `maxCanvasPixels` por defecto, destruir `loadingTask` al cerrar. Test automatizado con el fixture de 5 000 y 10 000 páginas (nota: el límite de pdf.js a 5 000/10 000 cambia el comportamiento).
6. **Búsqueda:** `PDFFindController` + índice incremental propio en Worker (cancelable, por lotes) para 5 000+ páginas; medir antes de decidir.
7. **Fixtures**: añadir a `packages/` (o `apps/lector-pdf/scripts/`) un generador de PDFs basado en el spike (sin dependencias, 5 000 páginas en <0,1 s) y un script de anotación incremental; los PDFs generados no se versionan, se crean en `globalSetup` de los tests. Corpus externos solo tras verificar licencia (veraPDF, CC-BY-4.0).
8. **Test de compatibilidad manual con Adobe Reader** para cada subtipo de anotación antes de dar la ficha por hecha; dejar capturas en la ficha.
9. **Preguntas al usuario** (producto): ¿se acepta AGPL de mupdf para uso personal si pdf.js falla? ¿Se acepta que en web (Firefox/Safari) el guardado sea por descarga?

## Fuentes
- [npm: pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) y paquete `pdfjs-dist@6.4.299` inspeccionado con `npm pack` — consultado 2026-10-17
- Comprobaciones `npm view` de pdfjs-dist, pdf-lib, @cantoo/pdf-lib, @pdfme/pdf-lib, mupdf, @embedpdf/engines, @embedpdf/pdfium, @hyzyla/pdfium, @tauri-apps/plugin-fs, vite — 2026-10-17
- [pdf.js API draft (api.js)](https://mozilla.github.io/pdf.js/api/draft/api.js.html) — 2026-10-17
- [Nethercote, an even slimmer pdf.js](https://blog.mozilla.org/nnethercote/2014/06/16/an-even-slimmer-pdf-js/) — 2026-10-17
- [Snyk: pdf-lib](https://snyk.io/advisor/npm-package/pdf-lib), [DepScope: pdf-lib](https://depscope.dev/pkg/npm/pdf-lib) — 2026-10-17
- [MuPDF wasm docs](https://mupdf.readthedocs.io/en/latest/mupdf-wasm.html), [context7: mupdf](https://context7.com/artifexsoftware/mupdf), [Artifex: Introducing MuPDF.js](https://artifex.com/blog/introducing-the-mupdf.js-api) — 2026-10-17
- [Show HN: EmbedPDF](https://hn.svelte.dev/item/44901683), [README @embedpdf/pdfium](https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.14.3/README.md), [EmbedPDF save as copy](https://www.embedpdf.com/docs/engines/document-lifecycle/save-as-copy) (no leída) — 2026-10-17
- [Tauri fs reference](https://v2.tauri.app/reference/javascript/fs), [fs 2.7.0](https://v2.tauri.app/release/fs/v2.7.0/), [Asset protocol scope](https://v2.tauri.app/security/asset-protocol/), [asset.rs](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/protocol/asset.rs) — 2026-10-17
- [web.dev: How to open one or multiple files](https://web.dev/articles/files/open-one-or-multiple-files) — 2026-10-17
- [DPC: veraPDF](https://www.dpconline.org/digipres/collaborative-projects/completed-projects/verapdf), [PDF Association: veraPDF corpus](https://www.pdfa.org/first-set-of-candidate-verapdf-corpus-files-delivered/) — 2026-10-17
- [PDF 32000-1:2008 (Adobe)](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf) — no abierta en esta sesión
- Relacionado: [[Indice investigacion]]
