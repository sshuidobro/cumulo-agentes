---
tipo: decision
id: ADR-0030
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, anotaciones, formato]
---

# ADR-0030 · Respuestas, estados de revisión y XFDF

## Contexto
Responder a comentarios, marcarlos como aceptados/rechazados y exportar/importar comentarios en XFDF ([[PDF-058-respuestas-xfdf|PDF-058]], [[Paridad Adobe Acrobat]] área «Comentar»). Base: [[ADR-0009-anotaciones-escritor-incremental]], [[ADR-0029-formas-y-sellos]].

Comprobado en `pdfjs-dist@6.4.299`: `getAnnotations()` da `inReplyTo` (`"12R"`) y `replyType` (`"R"` o `"Group"`) en toda anotación de marcado, y `state`/`stateModel` en las `/Text`. La capa de pdf.js no trata las respuestas de forma especial (las dibujaría como iconos si no tienen apariencia).

ISO 32000-1 §12.5.6.10 y Adobe: una respuesta es una `/Text` con `/IRT` al padre y `/RT /R`; un estado de revisión es otra `/Text` oculta con `/IRT`, `/State` y `/StateModel (Review)`; Acrobat lista ambas bajo el comentario padre y no las dibuja.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Tipos `reply` y `review` en el modelo; XML propio mínimo para XFDF** | Compatible con Adobe; mismo historial, borrador y guardado; sin dependencias; parser sin entidades externas (entrada no confiable) | Escribir y probar el parser (≈150 líneas) | propia |
| B. Campo `inReplyTo` en todas las anotaciones | Un tipo menos | Toca todos los constructores y tests; mezcla respuestas con anotaciones dibujables | — |
| C. `fast-xml-parser` / `saxes` | Parser hecho | Dependencia para un formato pequeño; superficie de ataque (entidades, prototipos) | MIT / ISC |
| D. `DOMParser` | Nativo en el navegador | No existe en Node (tests de `core/`) ni en Workers | — |

## Decisión
**Opción A.**
- **Modelo**: `ReplyAnnotation` (`type: 'reply'`, `parentId`) y `ReviewStateAnnotation` (`type: 'review'`, `parentId`, `state: 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'None'`). `rect` = caja de 20×20 en la esquina superior izquierda del padre, `color` = la del padre, `opacity` 1. No se dibujan en la página ni tienen zona: solo aparecen en el panel de comentarios.
- **PDF** al escribir: ambas `/Text` con `/IRT` al padre (referencia del fichero o la recién asignada en el mismo incremento), `/Name /Comment`, **`/AP` vacía** (Form XObject sin contenido, así ningún visor pinta un icono). Respuesta: `/RT /R`, `/F 28`. Estado: `/State`, `/StateModel (Review)`, `/F 30` (oculta, como Adobe).
- **Leer**: `/Text` con `inReplyTo` y `replyType` `R` → `reply` (aunque esté oculta); con `state` y `stateModel === 'Review'` → `review`. `replyType` `Group` y el modelo `Marked` se ignoran (no se importan ni se listan; el guardado incremental los conserva intactos).
- **Estado de un comentario** = el `review` más reciente (`modified`) de cualquier autor. Cambiar el estado añade un `review` nuevo del autor actual (Adobe guarda el historial igual).
- **Borrar** un comentario borra también sus respuestas y estados en la misma entrada de deshacer.
- **XFDF** (Adobe XFDF 3.0): exportar todas las anotaciones editables (incluidas formas, sellos, respuestas y estados) con `name` = nuestro `id` e `inreplyto` = `id` del padre; los ajenos y las firmas no se exportan. Importar: cada elemento soportado pasa a anotación **nueva** (`suite-…`) en una sola entrada de deshacer; un `name` que ya existe en el documento se omite (importar dos veces no duplica); `inreplyto` se resuelve contra los `name` del propio XFDF y los `id` del documento. Elementos desconocidos o con datos no válidos se cuentan y se informa «Se han omitido N comentarios que no se pueden importar.».
- **Parser XML** propio (`src/core/xfdf/xml.ts`): elementos, atributos, texto, CDATA, comentarios, las 5 entidades predefinidas y referencias numéricas; **rechaza** `<!DOCTYPE` y `<!ENTITY` (sin expansión de entidades). Límites: 20 MB de entrada y 200 000 elementos. Si otras apps de la suite necesitan XML, se moverá a `packages/shared` en su ADR.

## Consecuencias
- Respuestas y estados viajan por el historial, el borrador y el guardado incremental existentes.
- Fuera: FDF binario, `<contents-richtext>` (se importa solo `<contents>` en texto plano), adjuntar el XFDF a un correo, sincronizar revisiones compartidas.
