---
tipo: decision
id: ADR-0031
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, comparar]
---

# ADR-0031 · Comparar dos PDFs: diferencias de palabras propias y superposición por píxeles

## Contexto
Acrobat Pro «Comparar archivos» muestra cambios de texto y una superposición visual ([[PDF-063-comparar|PDF-063]], [[Paridad Adobe Acrobat]]). Requisitos: igual con documentos grandes, nada sale del ordenador, la UI no se congela.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Diff de palabras propio (Myers O(ND)) por página + superposición con lienzos** | Sin dependencias; tokens con posición para resaltar; control de memoria y cancelación | Escribir y probar el algoritmo (≈120 líneas) | propia |
| B. `diff` (jsdiff) | Probado | 40 KB; sin posiciones de ítem de pdf.js; diff de documento entero sin cortar por páginas | BSD-3 |
| C. `diff-match-patch` | Rápido por caracteres | Sin mantenimiento; diff por caracteres da ruido en texto de PDF | Apache-2.0 |

## Decisión
**Opción A.**
- **Unidad**: palabras. Texto de cada página = `buildPageText` de la búsqueda (mismo orden que la capa de texto); se normaliza (NFC, espacios colapsados, guiones de corte `-\n` unidos) y se trocea en palabras con su `TextPos` de inicio y fin (para resaltar con `rangeForMatch`).
- **Emparejado de páginas**: página i con página i (sin detectar páginas insertadas o borradas en esta iteración); páginas de más en un documento → «página añadida / eliminada».
- **Algoritmo**: Myers sobre las palabras de cada par de páginas, con tope de `D ≤ 2 000` ediciones por página (si se supera, la página se marca «muy distinta» sin detalle). Resultado: cambios `insert`, `delete`, `replace` (un `delete` seguido de `insert` contiguos) con sus palabras y posiciones.
- **Ejecución**: en el hilo principal por páginas con cesión del hilo entre páginas (como la búsqueda), progreso y cancelar; cada página ≤ 30 ms con el tope de D. Un Web Worker queda como mejora si las medidas lo piden.
- **Superposición**: las dos páginas se pintan a la misma escala en dos lienzos y se componen con `globalCompositeOperation = 'difference'`; lo que no cambia queda negro y lo distinto se ve en color. Se ofrece también vista lado a lado.
- **Vista**: un modo de pantalla propio (no un diálogo) con la lista de cambios a la izquierda (página, «se ha cambiado “página” por “hoja”») y las dos páginas a la derecha con los cambios resaltados (rojo eliminado, verde añadido, amarillo sustituido).

## Consecuencias
- Detecta cambios de texto, no de formato (fuentes, colores) ni de imágenes; la superposición sí los deja ver.
- Documentos reordenados darán muchos cambios: el emparejado por contenido queda como mejora.
- Fixture nuevo `basic-5-changed.pdf` (una palabra cambiada en la página 2).
