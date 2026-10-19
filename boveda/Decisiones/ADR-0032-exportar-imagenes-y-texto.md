---
tipo: decision
id: ADR-0032
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, exportar]
---

# ADR-0032 · Exportar páginas a imagen y el texto a TXT

## Contexto
Acrobat Pro exporta a imagen (PNG, JPEG) y a texto ([[PDF-064-exportar|PDF-064]], [[Paridad Adobe Acrobat]]). Ya existe el render para imprimir (`engine/print-render.ts`, [[ADR-0021-impresion]]) que pinta a un ppp dado, incluye los cambios sin guardar (`state/print-source.ts`) y respeta el tope de píxeles del lienzo. El navegador no puede escribir varios ficheros sueltos en una carpeta sin pedir permiso fichero a fichero.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Reutilizar el render de impresión con formato elegible; varias páginas en un ZIP con `fflate`; TXT desde el texto de la búsqueda** | Sin dependencias nuevas (`fflate` ya está); mismo resultado que imprimir; un solo diálogo de guardar | ZIP en memoria (se limita) | MIT |
| B. Un diálogo de guardar por página | Ficheros sueltos | Inviable con decenas de páginas | — |
| C. Carpeta con `showDirectoryPicker` / plugin `fs` de Tauri | Ficheros sueltos | Solo Chromium; más permisos en Tauri | — |

## Decisión
**Opción A.**
- **Imágenes**: PNG o JPEG (calidad 0,92), resolución 72, 150, 300 o 600 ppp; la escala es `printScale` (tope de píxeles del lienzo: si se recorta, se avisa con la resolución real). Una página → un fichero `<nombre>-p<N>.png`; varias → `<nombre>-imagenes.zip` con `<nombre>-p0001.png`… (relleno con ceros a la anchura del total), escrito con `zipSync` de `fflate` sin recomprimir (`level: 0`). Límite del ZIP: 1 GB estimado (`páginas × ancho × alto × 4 / 3`); por encima se pide reducir el rango o la resolución. Comentarios: incluidos u omitidos como en imprimir.
- **Texto**: UTF-8 con BOM (para que el Bloc de notas de Windows lo abra bien), saltos `\r\n`, el texto de cada página como lo concatena la búsqueda (`buildPageText`, orden de pdf.js), páginas separadas por un salto de página `\f` en su propia línea (`\r\n\f\r\n`). Rango de páginas como en imprimir.
- **Permisos** ([[ADR-0022-pdf-cifrados]]): si el PDF no permite copiar, exportar texto e imágenes está deshabilitado con «El autor de este PDF no permite copiar su contenido.».
- **Guardado**: `Platform.exportFile` ([[COM-018-exportar-fichero]]): no entra en «Recientes».
- **Progreso y cancelar**: como imprimir; nunca más de un lienzo vivo a la vez.
- **DOCX**: fuera hasta que exista el procesador de textos de la suite.

## Consecuencias
- El ZIP se construye en memoria: con 300 ppp y cientos de páginas puede ser grande; el límite lo evita.
- El TXT no reconstruye columnas ni tablas: respeta el orden de lectura de pdf.js (igual que copiar).
