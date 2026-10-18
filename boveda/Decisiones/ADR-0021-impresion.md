---
tipo: decision
id: ADR-0021
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, impresion]
---

# ADR-0021 · Imprimir: imágenes por página de un documento temporal con el incremento, con `window.print()`

## Contexto
Imprimir (Ctrl+P) es imprescindible ([[Paridad Adobe Acrobat]], área 7): rango, copias (las da el diálogo del sistema), ajuste a página, orientación, con o sin comentarios. Debe incluir las anotaciones y los valores de formulario **sin guardar**, funcionar en web y en Tauri, y no agotar la memoria con documentos de miles de páginas. Investigación: [[Librerias y arquitectura PDF]] (pdf.js renderiza con `intent: 'print'`).

Hechos (pdf.js 6.4.299, `getRenderingIntent`): con `intent: 'print'` y `AnnotationMode.ENABLE_STORAGE` se usa el `annotationStorage` del documento; `noPrint: true` en el storage quita una anotación de la impresión.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Render a PNG por página (150 ppp; 300 en «alta calidad») en un contenedor de impresión + `@page` + `window.print()`** | Mismo código en web y Tauri; lo que se imprime es lo que pinta pdf.js | Rasterizado; documentos enormes tardan (progreso y cancelar) | — |
| B. Imprimir el PDF con el visor del navegador (`iframe`) | Vectorial | No existe en WebKitGTK (Tauri Linux); no incluye lo no guardado | — |
| C. Impresión nativa desde Rust por SO | Vectorial | Tres implementaciones; depende del visor PDF del sistema (Adobe) | — |
| D. `PDFPrintService` de `pdf_viewer` | Hecho | Acoplado a su visor (ADR-0007 lo descarta) | Apache-2.0 |

## Decisión
**Opción A.**
- **Lo que se imprime = lo que se guardaría:** si hay cambios, se construye el incremento en memoria (`buildIncrementalUpdate`, anotaciones y campos) y se abre un **documento temporal** con `loadPdf` sobre un `ByteSource` concatenado (original por rangos + delta en memoria). Sin cambios, se imprime el documento abierto. Si el incremento no se puede construir (cifrado antes de PDF-047, estructura dañada), se imprime el original y se avisa «Los cambios sin guardar no se incluyen en la impresión».
- **Render:** `page.render({ intent: 'print', annotationMode: ENABLE_STORAGE })` a un lienzo de 150 ppp (300 con «alta calidad»), `canvas.toBlob('image/png')`, `URL.createObjectURL`, `<img>` en `#print-container` (hijo de `body`). De uno en uno, cediendo el hilo entre páginas: ninguna tarea > 100 ms; progreso «Preparando página n de N» y Cancelar. Lienzo liberado tras cada página. Las URL de blob se revocan al terminar (`afterprint`) o cancelar.
- **Sin comentarios:** en el documento temporal (o en una copia del storage) `noPrint: true` para toda anotación que no sea `Widget`.
- **Hoja:** `@page { size: <ancho>pt <alto>pt; margin: 0 }` con el tamaño de la primera página del rango; cada imagen centrada y ajustada (`object-fit: contain`). «Orientación automática» (activada por defecto) gira 90° las páginas cuya orientación no coincide con la de la hoja.
- **Límite blando:** con más de 500 páginas a imprimir se avisa del tiempo y se pide confirmación.
- `@media print` oculta toda la app salvo `#print-container`. Tauri usa el mismo `window.print()` del webview (comprobación manual en la máquina del usuario).

## Consecuencias
- Impresión rasterizada (como pdf.js en Firefox). Texto nítido a 150 ppp en papel; «alta calidad» a 300 ppp duplica tiempo y memoria.
- E2E: `window.print` se sustituye por una función que marca «listo» y se genera el PDF de impresión con `page.pdf()` de Playwright.
- Varias páginas por hoja, folleto y póster: fuera (iteración posterior, nota de paridad).
