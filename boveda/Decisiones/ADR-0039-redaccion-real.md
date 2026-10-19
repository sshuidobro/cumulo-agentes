---
tipo: decision
id: ADR-0039
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, redaccion, seguridad]
---

# ADR-0039 · Redacción real: reescribir contenido y el fichero completo

## Contexto
[[PDF-062-redactar|PDF-062]]: eliminar de verdad lo que hay bajo las zonas marcadas (texto, imágenes y anotaciones), no solo taparlo. Investigación: [[Paridad Adobe Acrobat]] §12 (ninguna librería permisiva lo hace; pdf-lib no puede). Dos trampas:
1. Un incremento deja las revisiones antiguas en el fichero: el texto seguiría en los bytes.
2. Saber qué glifo cae en una zona exige interpretar el flujo de contenido con las métricas de la fuente.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **A. Intérprete de contenido propio + reescritura completa**; páginas que no se saben interpretar → se convierten en imagen | Quita solo lo cubierto; el resto sigue siendo texto; garantía total gracias a la imagen de respaldo | Mucho código (intérprete, métricas, imágenes) |
| B. Convertir siempre en imagen las páginas con zonas | Simple y seguro | Se pierde el texto seleccionable de toda la página |
| C. Solo tapar con un rectángulo negro | Trivial | No es redacción: el texto sigue ahí |

## Decisión
**Opción A**, por fases:
1. `src/core/content/`: analizador de flujos de contenido y un intérprete que calcula la caja de cada glifo (fuentes simples con `/Widths`; Type0 con `Identity-H`/`Identity-V` y `/W`) y la caja de cada imagen. Lo que no sabe medir (Type3, otras CMap, texto dentro de Form XObjects que tocan la zona) lo marca como **no soportado** ([[PDF-062-redactar|PDF-062]]).
2. Aplicar ([[PDF-135-redactar-aplicar|PDF-135]]): glifos que tocan una zona → sustituidos por un desplazamiento `TJ` del mismo ancho (el resto no se mueve); imágenes completamente dentro y anotaciones que tocan la zona → fuera; rectángulos negros encima. Página no soportada → se sustituye por una imagen de 300 ppp dibujada con pdf.js con las zonas en negro.
3. Imágenes parcialmente cubiertas ([[PDF-136-redactar-imagenes|PDF-136]]): JPEG → se decodifica en el navegador, se pinta de negro y se vuelve a codificar; Flate 8 bits gris o RGB → en el núcleo; el resto → página en imagen.
4. Siempre se guarda con **reescritura completa** (`rewriteDocument`, [[ADR-0037-proteger-reescritura-aes256]]): no quedan revisiones antiguas. Los dibujos vectoriales bajo la zona quedan tapados pero no se borran (se dice en el diálogo).

## Consecuencias
- El criterio de aceptación se comprueba sobre los bytes: `qpdf --qdf --object-streams=disable` del resultado no contiene el texto, además de `pdftotext`.
- La redacción no se puede deshacer tras guardar; el diálogo de confirmación lo explica.
- Metadatos (`/Info`, XMP) y texto oculto fuera de las zonas no se tocan (posible «Quitar información oculta» futura).
