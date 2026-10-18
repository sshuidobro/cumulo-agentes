---
tipo: tarea
id: PDF-103
titulo: Etiqueta «Firma» para sellos de la suite - núcleo
app: pdf
estado: en-revision
depende_de: [PDF-085]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, anotaciones, core]
---

# PDF-103 · Etiqueta «Firma» para sellos de la suite (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0020-firma-visual]] · Origen: duda 1 de [[PDF-085-anotacion-de-firma]] · Sigue en [[PDF-104-etiqueta-firma-conexion]]

## Objetivo
Función pura (más una asíncrona con `ObjectReader`) que averigua el `/Name` de los `/Stamp` ajenos y hace que el panel los etiquete «Firma» si es `/SuiteFirma`. La conexión con la sesión es [[PDF-104-etiqueta-firma-conexion]].

## Decisión del líder (2026-10-18)
pdf.js 6.4.299 no expone `/Name` de un `/Stamp`. Se descartan (b) objetos internos de pdf.js (frágil) y (c) marcar con `/Subj` o `/Contents` (cambia el formato ya escrito por PDF-085 y ensucia el comentario visible en Adobe). Se elige **(a) sin parser nuevo**: el lector propio `ObjectReader` (`src/core/pdf/object-reader.ts`, el mismo que usa guardar) ya lee diccionarios por referencia. Solo se consultan los `/Stamp` ajenos (uno o pocos por documento).

## Contexto
- `src/core/annotations/import.ts` → `ForeignAnnotation` (l. 33-41), `importForeign` (l. 207), `parseRef` (l. 304, hoy privada).
- `src/core/annotations/comment-list.ts` → `foreignTypeLabel` (l. 95) y sus dos usos (l. 152 y l. 201).
- `src/core/annotations/to-pdf.ts` → `SIGNATURE_STAMP_NAME`.
- `src/core/pdf/object-reader.ts` → `ObjectReader.getDict`; `src/core/pdf/objects.ts` → `dictGet`, `PdfName`.
- Test de referencia para escribir y reabrir: `tests/unit/signature-annotation.test.ts:120-140` (`openForSave(memorySource(...))`, `buildIncrementalUpdate`).

## Qué hacer
1. `import.ts`: añadir a `ForeignAnnotation` `readonly stampName?: string;` (`/Name` del sello, solo si se conoce). Exportar `parseRef` sin cambiar su firma.
2. Nuevo `src/core/annotations/stamp-names.ts`:
   ```ts
   /** `/Name` de cada `/Stamp` ajeno de las páginas, por id de anotación. Errores de lectura → se omite esa anotación (nunca lanza). */
   export async function readStampNames(reader: ObjectReader, foreign: readonly ForeignAnnotation[]): Promise<ReadonlyMap<string, string>>;
   /** Copia de la página con `stampName` puesto en los ajenos que aparecen en `names`. Sin coincidencias → devuelve el mismo objeto. */
   export function withStampNames(page: ImportedPage, names: ReadonlyMap<string, string>): ImportedPage;
   ```
   `readStampNames`: solo `subtype === 'Stamp'` con id `ref:<num>R<gen?>` (quitar `ref:` y usar `parseRef`); `getDict(ref(num, gen))`; si `dictGet(d, 'Name')` es `PdfName`, guardar su valor. Cada lectura en `try/catch`.
3. `comment-list.ts`: `foreignTypeLabel(subtype: string, stampName?: string): string` → `'Firma'` si `subtype === 'Stamp' && stampName === SIGNATURE_STAMP_NAME`; si no, como ahora. Pasar `r.stampName` en los dos usos. El texto «Firma» es el mismo de `SUPPORTED_LABELS.signature` (reutilizarlo, no duplicar la cadena).

## Criterios de aceptación
- [ ] `tests/unit/annotations/stamp-names.test.ts`, ida y vuelta: PDF de una página + firma escrita con `buildIncrementalUpdate` → `loadPdf` + `readPageAnnotations` (pdf.js) → `readStampNames(openForSave(...))` devuelve `{ 'ref:<n>R' → 'SuiteFirma' }` y `foreignTypeLabel('Stamp', 'SuiteFirma') === 'Firma'`.
- [ ] Un `/Stamp /Name /Approved` → `'Approved'` y etiqueta «Sello»; un `/Stamp` sin `/Name` → no aparece en el mapa y etiqueta «Sello».
- [ ] Ids que no son `ref:` (p. ej. `ref:?0.1`), subtipos distintos de `Stamp` y un objeto que no existe → se omiten sin lanzar; `getDict` no se llama para no-`Stamp` (espía).
- [ ] `withStampNames` con mapa vacío devuelve el mismo objeto (`toBe`); con coincidencia, solo cambia esa anotación.
- [ ] `comment-list.test.ts`: fila y filtro de tipos muestran «Firma» para un ajeno con `stampName: 'SuiteFirma'` y «Sello» sin él.
- [ ] La anotación sigue siendo `ForeignAnnotation` (no editable ni movible): ningún cambio en `importPageAnnotations` salvo el tipo.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` (en `apps/lector-pdf`) con código 0.

## Fuera de alcance
- Llamarlo desde la sesión de anotaciones y el panel real ([[PDF-104-etiqueta-firma-conexion]]).
- Hacer editables las firmas guardadas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: solo esta ficha (`estado: bloqueada`). No he tocado código.
- Qué he hecho: he leído la ficha, `to-pdf.ts` (`SIGNATURE_STAMP_NAME`), `import.ts` (`importForeign`) y `comment-list.ts` (`FOREIGN_LABELS`). Comprobado en el fuente de pdf.js instalado (`pdfjs-dist@6.4.299`, `build/pdf.worker.mjs`, `class StampAnnotation`): el constructor solo guarda `hasOwnCanvas`, `isEditable` y `noHTML`; no expone el `/Name` del `/Stamp`. El objeto que devuelve `page.getAnnotations()` para un `Stamp` no trae ese dato, así que `importForeign` no puede distinguir `/SuiteFirma` de otro sello con la API pública de pdf.js.
- Comandos ejecutados y resultado: ninguno de build/test (no había nada que compilar); solo lectura de código y del fuente de pdf.js.
- Dudas o cosas que no he podido hacer: falta decidir el mecanismo. Opciones: (a) leer el diccionario `/Stamp` del fichero con un parser propio en `core/` (nuevo código de E/S de PDF, fuera de lo previsto), (b) acceder a objetos internos de pdf.js (no es API pública, frágil), (c) marcar la firma con otro dato que pdf.js sí exponga (p. ej. `/Subj` o `/Contents`), lo que cambia el escritor de PDF-085 y el formato escrito. Pido decisión al líder sobre cuál usar; con ella lo implemento. No he hecho commit: no hay cambios de código.

### [lider] replanificación — 2026-10-18
- Elegida la opción (a) reutilizando `ObjectReader` (sin parser nuevo); (b) y (c) descartadas. Motivo en «Decisión del líder».
- La ficha se parte: esta queda en el núcleo (`stamp-names.ts`, tipo, etiqueta) y la conexión con la sesión pasa a [[PDF-104-etiqueta-firma-conexion]]. `estado: pendiente`, `intentos: 0`.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/import.ts` (`stampName?` en `ForeignAnnotation`, `parseRef` exportada), `comment-list.ts` (`foreignTypeLabel(subtype, stampName?)`, usa `SUPPORTED_LABELS.signature`), `stamp-names.ts` nuevo (`readStampNames`, `withStampNames`), `index.ts` (reexporta el módulo), `tests/unit/annotations/stamp-names.test.ts` nuevo, `tests/unit/annotations/comment-list.test.ts` (bloque nuevo al final).
- Qué he hecho: implementado la lectura del `/Name` de los `/Stamp` ajenos con `ObjectReader.getDict` (solo subtipo `Stamp` con id `ref:`, errores en `try/catch`). Ida y vuelta con firma real escrita por `buildIncrementalUpdate`, más casos de `Approved`, sin `/Name`, ids no válidos, objetos rotos y espía de `getDict`. `withStampNames` devuelve el mismo objeto si no hay cambios.
- Comandos ejecutados y resultado: `eslint` sobre mis ficheros: limpio. `pnpm typecheck`: OK. `vitest run` de los tests de anotaciones + firma: 42/42 en los dos ficheros de la ficha; cobertura en `src/core/annotations`: stamp-names 100 % líneas, comment-list 100 %, import 100 %. `pnpm lint` raíz falla por 9623 errores en `apps/lector-pdf/dist-firma/` (artefactos de build fuera de mi ficha, no tocados). `pnpm coverage` completo: 2334/2335 tests OK; único fallo `tests/ui/zoom-controls.test.tsx` («el orden es el de la barra»: foco en «Reducir»), fichero sin relación con esta ficha y que no he tocado. No he podido ejecutar `pnpm coverage` en la raíz sin conflicto porque otro proceso de vitest usaba `coverage/`; lo he ejecutado con `--coverage.reportsDirectory` propio.
- Dudas o cosas que no he podido hacer: sin dudas de diseño. Pendientes fuera de alcance: conexión con la sesión y el panel en [[PDF-104-etiqueta-firma-conexion]].
