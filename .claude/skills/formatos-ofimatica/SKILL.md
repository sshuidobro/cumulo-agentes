---
name: formatos-ofimatica
description: Conocimiento experto de los formatos de documentos (PDF, DOCX/ODT, XLSX/ODS/CSV, PPTX/ODP) y de las librerías JavaScript para leerlos, mostrarlos y escribirlos con fidelidad. Úsala al planificar o programar cualquier función de abrir, mostrar, editar, importar o exportar documentos.
---

# Formatos de ofimática

La app solo es una alternativa real si **abre bien los ficheros que llegan de Microsoft Office y Adobe y guarda ficheros que esos programas abren sin quejarse**. La fidelidad del formato es el requisito número uno.

## Bases comunes
- OOXML (`.docx`, `.xlsx`, `.pptx`) = ZIP con XML (ECMA-376 / ISO 29500). ODF (`.odt`, `.ods`, `.odp`) = ZIP con XML (ISO 26300). Leer el ZIP con **fflate** o **JSZip**; parsear XML con un parser en streaming para ficheros grandes.
- Conserva lo que no entiendes: guarda las partes XML desconocidas y reescríbelas al guardar (no perder macros, comentarios, propiedades personalizadas).
- Mapea siempre a **nuestro modelo interno**; nunca edites el XML directamente desde la UI.
- Unidades: EMU (914 400 por pulgada) en OOXML, twips (1/1440") en Word, puntos en PDF. Centraliza las conversiones en un módulo con tests.

## PDF (lector)
- Render: **pdfjs-dist** (Mozilla, Apache-2.0, v6.x) con su worker; capa de texto para seleccionar/buscar y capa de anotaciones. Render perezoso por página + virtualización.
- Modificar/crear (rellenar formularios, anotar, unir, girar, extraer páginas): **pdf-lib** (MIT). Firmas y cifrado: investigar antes (ADR).
- Funciones esperadas de un lector profesional: miniaturas, índice (outline), búsqueda con resaltado, zoom/ajustar, rotación, modo noche, formularios AcroForm, anotaciones (subrayar, nota, dibujo), impresión, abrir PDFs con contraseña, enlaces internos/externos, recordar última página.

## Procesador de texto (DOCX/ODT)
- Editor: modelo estructurado tipo **ProseMirror/Tiptap** (MIT) o **Lexical** (MIT); decidir en ADR tras investigación. Paginación real (vista de página con márgenes y saltos) es el punto difícil: planificarlo pronto.
- Importar DOCX: parser propio sobre el XML (`word/document.xml`, `styles.xml`, `numbering.xml`, relaciones). **mammoth** solo sirve como referencia (pierde formato). Exportar DOCX: librería **docx** (MIT) o escritor propio.
- Imprescindibles: estilos de párrafo/carácter, listas numeradas multinivel, tablas (combinar celdas), imágenes, encabezados/pies, saltos de página/sección, notas al pie, control de cambios y comentarios (al menos conservarlos), exportar a PDF.

## Hoja de cálculo (XLSX/ODS/CSV)
- Motor de fórmulas: **HyperFormula** (GPLv3 o licencia comercial; válido para uso personal no distribuido; anotarlo en ADR) o motor propio. Compatibilidad de nombres de funciones y de errores (`#DIV/0!`, `#REF!`...) con Excel.
- Leer/escribir XLSX: **ExcelJS** (MIT) o SheetJS CE. Atención a: fechas como número de serie (sistema 1900 con el bug del 29/02/1900, y sistema 1904), formatos numéricos personalizados, cadenas compartidas, celdas combinadas, fórmulas compartidas y matriciales.
- Rejilla virtualizada en canvas o DOM virtual para 1 048 576 filas × 16 384 columnas sin congelarse; recálculo incremental por grafo de dependencias en un Worker.
- CSV: detectar separador (`,` `;` tab) y codificación (UTF-8 con/sin BOM, Windows-1252); configuración regional española (coma decimal).

## Presentaciones (PPTX/ODP)
- Leer PPTX: parser propio (`ppt/slides/slideN.xml`, layouts y masters heredados, temas). Escribir: **pptxgenjs** (MIT) o escritor propio.
- Render de diapositivas en SVG/DOM a escala con el mismo motor para editor, miniaturas y modo presentación.
- Imprescindibles: masters/diseños, cuadros de texto, formas, imágenes, tablas, notas del orador, modo presentador, transiciones básicas, exportar a PDF.

## Antes de elegir una librería
Comprueba (o pide al `investigador`): licencia, actividad del repositorio (último commit, issues abiertas), tamaño del bundle, soporte de Web Workers, y deja la decisión en un ADR de la bóveda.
