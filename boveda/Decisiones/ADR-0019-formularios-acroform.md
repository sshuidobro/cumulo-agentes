---
tipo: decision
id: ADR-0019
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, formularios, formato]
---

# ADR-0019 · Formularios AcroForm: pintar con pdf.js, editar con capa propia, guardar con el escritor incremental

## Contexto
Rellenar formularios es imprescindible ([[Paridad Adobe Acrobat]], área 5). Hay que decidir cómo se ven, cómo se editan y cómo se guardan los campos AcroForm sin romper lo que ya funciona: lienzo con `AnnotationMode.ENABLE_STORAGE` y anotaciones del fichero ocultadas con `noView` ([[ADR-0007-motor-y-visor-pdf]]), historial único `UndoStack` ([[ADR-0005-modelo-deshacer-rehacer]]) y escritor incremental propio ([[ADR-0009-anotaciones-escritor-incremental]]). Investigación: [[Librerias y arquitectura PDF]].

Hechos comprobados por el líder el 2026-10-18 en `pdfjs-dist@6.4.299` (`legacy/build/pdf.worker.mjs` y prueba en Node con `form.pdf` y `7.18.4-t01-pass-a.pdf`):
- Con `ENABLE_STORAGE` (sin `ANNOTATIONS_FORMS`) el worker **pinta los widgets en el lienzo con el valor de `annotationStorage`**: texto con `_getAppearance` (genera la apariencia con el valor), casillas y botones de opción con su apariencia activada/desactivada según un booleano, listas con un array de valores de exportación. `noView` también oculta widgets.
- Con `ENABLE_FORMS` el worker **no** pinta los widgets y **no** recibe `annotationStorage`: dejaría de funcionar la ocultación `noView` de las anotaciones editadas.
- Formato de valores en `annotationStorage` por id de widget (`"9R"`): texto `string`; casilla `boolean`; botón de opción `boolean` (true en el widget elegido); combo `string` (valor de exportación); lista `string[]`.
- `page.getAnnotations()` da por widget: `fieldName` (nombre completo), `fieldType` (`Tx`/`Btn`/`Ch`/`Sig`), `fieldValue`, `rect`, `checkBox`, `radioButton`, `pushButton`, `exportValue` (casilla), `buttonValue` (opción), `options` (`{exportValue, displayValue}`), `multiLine`, `maxLen`, `comb`, `password`, `readOnly`, `required`, `combo`, `multiSelect`, `fieldFlags`, `textAlignment`, `defaultAppearanceData` (`fontSize`, `fontColor` 0-255) y `alternativeText` (`/TU`). `getFieldObjects()` devolvió `{}` en Node: no se usa.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| A. `AnnotationLayer` de pdf.js con `renderForms` y `ENABLE_FORMS` | Controles HTML ya hechos | Rompe `noView` (el lienzo deja de recibir el storage); su deshacer no es el nuestro; estilos y teclado ajenos; mezcla enlaces y popups que ya hacemos nosotros | Apache-2.0 |
| **B. Lienzo con `ENABLE_STORAGE` + capa HTML propia para editar + valores en nuestro historial** | Lo que se ve es lo que pinta pdf.js con el valor; un solo deshacer; misma arquitectura que las anotaciones; imprimir sale gratis | Hay que escribir la capa (texto, listas, casillas, opciones, tabulación) | propia |
| C. Guardar con `saveDocument()` de pdf.js | Apariencias de pdf.js | Descarga el fichero entero al worker y devuelve el fichero completo; dos escritores encadenados | Apache-2.0 |
| D. pdf-lib (`PDFForm`) | API cómoda | Reescribe el fichero entero; sin mantenimiento | MIT |

## Decisión
**Opción B**, con el escritor incremental propio para guardar.
- **Modelo** (`src/core/forms/`): `FormField` por nombre completo con sus `FormWidget` (id de pdf.js, referencia, página, rect, estado activado, giro `/MK /R`). Importación por página desde `page.getAnnotations()` (la misma llamada que ya importa anotaciones; los widgets dejan de ignorarse en silencio y van a `ImportedPage.widgets`).
- **Valores en el historial común:** `AnnotationEdits` gana `fields: ReadonlyMap<nombre, FieldValue>` (solo los que difieren del fichero). Un único `UndoStack`, un único «sin guardar», un único borrador (versión 2, lee la 1).
- **Ver:** cada cambio se copia a `doc.annotationStorage` de cada widget del campo (o se borra la clave si vuelve al valor del fichero) y se repinta la página. El lienzo sigue en `ENABLE_STORAGE`.
- **Editar:** capa `FormLayer` (controles HTML nativos `input`, `textarea`, `select`) encima de la página. En reposo el control es transparente y se ve lo que pinta pdf.js; con el foco es opaco y muestra el texto que se escribe. El valor se confirma al salir del campo, con Intro (una línea) o al cambiar una lista/casilla: **una entrada de deshacer por campo confirmado**. Esc deshace lo escrito sin confirmar.
- **Guardar:** por cada campo cambiado se reescribe el diccionario del campo con `/V` (y `/I` en listas múltiples), cada widget con `/AS` (casillas y opciones) o con un `/AP /N` nuevo generado por nosotros (texto, combo, lista). La apariencia usa Helvetica WinAnsi propia (como el texto libre), tamaño y color de `/DA`, alineación `/Q`, peine (`comb`), multilínea, fondo y borde de `/MK` y giro `/MK /R`. **`/NeedAppearances` no se toca.**
- **Fuera:** JavaScript de campos (cálculo, formato, validación: nunca se ejecuta), XFA, envío por red, crear o editar campos (Pro), firmar campos `/Sig` (firma digital, PDF-066: se muestran, no se rellenan), botones de acción.

## Consecuencias
- Lo que se ve en pantalla antes de guardar es la apariencia de pdf.js; al guardar y reabrir, la nuestra. Diferencias menores de fuente si el formulario usa una fuente propia en `/DR` (se usa Helvetica). Caracteres fuera de WinAnsi (no latinos) se ven bien en la app y se guardan bien en `/V`, pero la apariencia muestra `?`; mejora anotada en el Plan (incrustar fuente), la misma que el texto libre.
- Imprimir ([[ADR-0021-impresion]]) imprime los valores porque imprime el documento con el incremento.
- Los borradores de recuperación guardan también los valores de los campos.
- Vigilar al actualizar pdf.js: formato de valores de `annotationStorage` para widgets y propiedades de `getAnnotations()`; cubiertos por tests con versión exacta.
