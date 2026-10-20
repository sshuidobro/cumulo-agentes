---
tipo: decision
id: ADR-0036
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, edicion]
---

# ADR-0036 · Añadir texto e imagen al contenido aplanando anotaciones marcadas

## Contexto
[[PDF-059-anadir-texto-imagen|PDF-059]]: añadir texto e imágenes como **contenido** de la página (no como comentario), que se pueda seleccionar y buscar tras guardar. Ya existen texto libre (`freetext`) e imagen de firma (`signature` con `art.kind: 'image'`), con colocación, edición, deshacer, borradores y apariencia (`buildAppearance`). Investigación: [[Paridad Adobe Acrobat]] (§ edición).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **A. Anotación marcada `flatten: true` que al guardar se dibuja en el contenido** (su apariencia como Form XObject + `Do` al final de la página) | Reutiliza colocación, edición, deshacer, borrador, recuperación y apariencia; mismo aspecto antes y después de guardar | Tras guardar ya no es editable (igual que el resto del contenido) |
| B. Modelo nuevo de «elementos de contenido» con su propia capa | Separación limpia | Duplica herramientas, historial, borradores y guardado |
| C. Aplicar al momento con una escritura inmediata | Simple | Sin deshacer ni recuperación; rompe el flujo Ctrl+S |

## Decisión
**Opción A.** `FreeTextAnnotation` y `SignatureAnnotation` ganan `readonly flatten?: true`. Al guardar (`incremental.ts`), las anotaciones nuevas con `flatten` no se escriben como anotaciones: su apariencia se escribe como Form XObject y la página recibe `/Contents [q, …originales, Q + q /SuiteFlatN Do Q]` y `/Resources` propios con el XObject. El código común de «anexar contenido a una página» vive en `src/core/pdf/page-content.ts` y lo reutilizan el OCR ([[PDF-061-ocr|PDF-061]]) y la redacción.
Texto en Helvetica WinAnsi (como el texto libre): se selecciona y se busca con pdf.js.

## Consecuencias
- No aparecen en el panel de comentarios ni se exportan a XFDF.
- Caracteres fuera de WinAnsi salen como «?» (misma limitación conocida que el texto libre; ver «Mejoras conocidas» del Plan).
- Deshacer después de guardar no existe (igual que las anotaciones).
