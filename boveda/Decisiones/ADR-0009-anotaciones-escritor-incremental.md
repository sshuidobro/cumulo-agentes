---
tipo: decision
id: ADR-0009
app: pdf
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, pdf, anotaciones, formato]
---

# ADR-0009 · Anotaciones: modelo propio y escritor incremental propio

## Contexto
El usuario quiere "subrayar y hacer notas". Deben guardarse **dentro del PDF como anotaciones estándar** (visibles en Adobe y otros) y funcionar con documentos enormes. Investigación: [[Librerias y arquitectura PDF]] (secciones 3 y riesgos) y [[Paridad Adobe Acrobat]] (área 4).
Hechos:
- `pdf-lib` reescribe el fichero entero al guardar y no publica desde 2022.
- `saveDocument()` de pdf.js hace guardado incremental, pero solo para sus editores (FreeText, Highlight, Ink, Stamp, Signature): **no sabe escribir Underline, StrikeOut ni Text (nota)**, que son justo lo que pide el usuario, y devuelve el fichero completo en memoria.
- Prueba del líder (2026-10-17): un incremento escrito a mano con Underline, StrikeOut, Text+Popup, Ink y FreeText lo lee pdf.js con subtipo, `quadPoints`, `inkLists`, `contentsObj`, `color` e id `"<num>R"` correctos.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| `pdf-lib` / forks | API cómoda | Reescribe todo (lento y arriesgado con ficheros grandes); fork sin auditar | MIT |
| `saveDocument()` de pdf.js | Ya existe | Sin subrayar, tachar ni nota; fichero completo en memoria | Apache-2.0 |
| mupdf | Completo | AGPL | AGPL |
| **Escritor incremental propio** (`core/pdf/`) | Delta de pocos KB aunque el PDF tenga 5 000 páginas; conserva por construcción todo lo que no tocamos (firmas incluidas); todos los subtipos | Hay que escribir un lector de xref y un serializador (acotados y con tests contra pdf.js y qpdf) | propia |

## Decisión
**Escritor incremental propio** en `apps/lector-pdf/src/core/pdf/` + **modelo de anotaciones propio** en `src/core/annotations/`.
- **Modelo:** unión discriminada inmutable `Annotation` (`highlight | underline | strikeout | note | freetext | ink`) en coordenadas PDF (puntos, origen abajo-izquierda). Todo cambio es un `Command<AnnotationDoc>` de `@suite/shared` (`UndoStack`, [[ADR-0005-modelo-deshacer-rehacer]]). Al guardar se calcula la diferencia con la **línea base** leída del fichero: añadidas, modificadas, borradas.
- **Lectura de anotaciones existentes:** con `page.getAnnotations()` de pdf.js. Subtipos soportados se editan; el resto (Link, Widget, Stamp, Square…) no se tocan nunca.
- **Escritura:** se anexa tras el último `%%EOF`: objetos nuevos (anotación, `/AP /N` como Form XObject, `/Popup` para notas), el objeto de página (o el array `/Annots` indirecto) reescrito con las referencias nuevas, los objetos de anotaciones modificadas reescritos (conservando claves desconocidas), una sección xref (tabla clásica si la última era tabla; *xref stream* sin comprimir si era stream) y trailer con `/Prev`, `/Size`, `/Root`, `/Info`, `/ID`.
- **Siempre `/AP`**, `/F 4` (imprimir), `/M` y `/CreationDate`, `/T` (autor), `/NM` (id único), QuadPoints en orden "Z" `[x1,y2, x2,y2, x1,y1, x2,y1]` por línea. Resaltado con `ExtGState /BM /Multiply`.
- **Lector de xref:** tabla clásica, *xref stream* (FlateDecode + predictor PNG), híbridos (`/XRefStm`), cadena `/Prev`, *object streams*. Descompresión con **`fflate@0.8.3`** (MIT, síncrono, sin dependencias). Lee por rangos desde `ByteSource`.
- **No soportado en la iteración 2** (error claro, sin tocar el fichero): PDF cifrado (`/Encrypt`) → ficha PDF-047; xref ilegible → "Guardar como" reconstruido en la iteración de organizar páginas.
- **Verificación:** cada test de escritura relee con pdf.js (subtipo, geometría, `hasAppearance`) y, en la ficha de interoperabilidad, con **qpdf** (`qpdf --check` y `qpdf --json`, herramienta de desarrollo instalada con apt). Comprobación visual en Adobe Reader: lista manual en el Manual.

## Consecuencias
- Guardar anotaciones en un PDF de 5 000 páginas añade KB, no MB, y tarda milisegundos.
- Tras guardar se recarga el documento desde el fichero nuevo y el historial de deshacer se vacía (diferencia con Acrobat, documentada).
- El texto libre usa Helvetica (WinAnsi): caracteres fuera de Latin-1 se ven en nuestra app y en el `/Contents`, pero la apariencia los sustituye por `?` hasta incrustar una fuente (mejora futura anotada en el Plan).
- Base reutilizable para formularios (PDF-042), firma visual (PDF-043) y cifrado (PDF-047).
