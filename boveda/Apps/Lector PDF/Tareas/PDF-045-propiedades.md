---
tipo: tarea
id: PDF-045
titulo: Propiedades del documento (Ctrl+D) y menú «Más acciones»
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, ui]
---

# PDF-045 · Propiedades del documento (Ctrl+D) y menú «Más acciones»

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Paridad: [[Paridad Adobe Acrobat]] (área 1, «Propiedades del documento, metadatos»)

## Objetivo
Diálogo «Propiedades del documento» (Ctrl+D, como Adobe) con pestañas «Descripción» y «Avanzado», abierto desde un menú nuevo «Más acciones» de la barra, que reunirá las acciones de documento (imprimir, propiedades…).

## Contexto
- Leer: `src/ui/kit/Dialog.tsx`, `src/ui/kit/MenuButton.tsx`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/shortcuts.ts`, `src/ui/App.tsx` (`VIEW_SHORTCUTS`), `src/state/viewer-store.ts` (`file`, `pdf`, `dims`, `pageLabels`), `src/core/pdf-date.ts` (`parsePdfDate`).
- pdf.js (`engine/`): `doc.getMetadata()` → `{ info: { Title, Author, Subject, Keywords, Creator, Producer, CreationDate, ModDate, PDFFormatVersion, IsLinearized, IsAcroFormPresent, IsXFAPresent, EncryptFilterName }, metadata }` (`metadata.get('dc:title')` del XMP, si existe); `doc.getMarkInfo()` → `{ Marked }` o `null`. Comprobado con el corpus veraPDF.
- Textos en `src/ui/messages-properties.ts` (`propertiesMsg`).

## Qué hay que hacer
1. `src/engine/properties.ts`:
```ts
export interface RawProperties { readonly info: Readonly<Record<string, unknown>>; readonly xmpTitle: string | null; readonly tagged: boolean | null }
export async function readRawProperties(doc: PDFDocumentProxy): Promise<RawProperties>; // nunca lanza: lo ilegible → valores vacíos
```
2. `src/core/properties.ts` (puro):
```ts
export interface DocumentProperties {
  readonly fileName: string; readonly path: string | null; readonly fileSize: number;
  readonly title: string; readonly author: string; readonly subject: string; readonly keywords: string;
  readonly creator: string; readonly producer: string;
  readonly created: string | null; readonly modified: string | null; // ISO
  readonly pdfVersion: string; readonly pageCount: number;
  readonly pageSize: { readonly widthPt: number; readonly heightPt: number }; // página actual, con /Rotate
  readonly tagged: boolean | null; readonly fastWebView: boolean; readonly encrypted: boolean;
  readonly hasForm: boolean;
}
export function buildProperties(raw: RawProperties, f: { fileName; path; fileSize; pageCount; pageSize }): DocumentProperties;
/** «A4 (210 × 297 mm)», «Carta (215,9 × 279,4 mm)» o «200 × 100 mm»; tolerancia de 1 mm; en vertical y apaisado. */
export function formatPageSize(widthPt: number, heightPt: number): string;
export function formatFileSize(bytes: number): string; // «1,7 MB (1.775.941 bytes)», «820 KB (839.680 bytes)», «512 bytes»
```
   Título: `info.Title` y, si está vacío, `xmpTitle`. Fechas con `parsePdfDate`. Formatos: A3, A4, A5, Carta, Legal.
3. `src/ui/properties/PropertiesDialog.tsx`: `Dialog` con título «Propiedades del documento», pestañas «Descripción» (fichero, ruta (solo Tauri), título, autor, asunto, palabras clave, creado, modificado, aplicación, productor) y «Avanzado» (versión PDF, nº de páginas, tamaño de página, tamaño de fichero, PDF etiquetado Sí/No/Desconocido, vista web rápida Sí/No, cifrado Sí/No, formulario Sí/No). Lista de definiciones (`<dl>`). Valores vacíos: «—». Fechas con `Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' })`. Mientras lee: «Leyendo propiedades…». Botón «Cerrar». El texto de los valores se puede seleccionar y copiar.
4. `src/ui/toolbar/DocumentMenu.tsx`: `MenuButton` con etiqueta «Más acciones» (icono nuevo `IconMore`, tres puntos) al final de la barra; entrada «Propiedades del documento…» con su atajo. Deshabilitado sin documento.
5. Atajo: `ShortcutId` `'properties'` con `['Mod+D']`, descripción «Propiedades del documento»; en `App.tsx` dentro de `VIEW_SHORTCUTS`.
6. Tests: `tests/unit/properties.test.ts`, `tests/ui/properties-dialog.test.tsx`, E2E `tests/e2e/properties.spec.ts`.

## Criterios de aceptación
- [ ] Unit: `formatPageSize(595, 842)` = «A4 (210 × 297 mm)»; `(842, 595)` = «A4 (297 × 210 mm)»; `(612, 792)` = «Carta (215,9 × 279,4 mm)»; `(200, 100)` = «70,6 × 35,3 mm»; `formatFileSize(1775941)` = «1,7 MB (1.775.941 bytes)».
- [ ] E2E con `basic-5.pdf`: Ctrl+D abre el diálogo con el foco dentro; «Páginas» = 5, «Versión PDF» = la del fichero (`1.7` u otra según el generador: tomarla del propio fichero en el test), «Cifrado» = No; Esc cierra y el foco vuelve al visor.
- [ ] E2E con `fixtures/pdf/corpus/verapdf/7.18.4-t01-pass-a.pdf`: Título «Widget-pass», Autor «veraPDF Consortium», Productor «veraPDF Test Builder 1.0», Creado 4 de enero de 2020, Vista web rápida «Sí», Formulario «Sí», PDF etiquetado «Sí».
- [ ] E2E con `incremental-updates.pdf` y `compressed.pdf`: el diálogo abre sin errores y las páginas coinciden con el visor.
- [ ] Teclado: las pestañas con ←/→; el menú «Más acciones» con Intro/flechas; tooltip con atajo en el botón.
- [ ] Ctrl+D no crea un marcador del navegador (el atajo hace `preventDefault`).
- [ ] Axe sin incidencias `serious`/`critical` con el diálogo abierto, en tema claro y oscuro.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Fuentes del documento (PDF-088). Seguridad y permisos detallados (PDF-048). Editar metadatos.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
