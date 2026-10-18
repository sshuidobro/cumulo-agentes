---
tipo: tarea
id: PDF-042
titulo: Guardar formularios dentro del PDF (/V, /AS y /AP) por actualización incremental
app: pdf
estado: pendiente
depende_de: [PDF-081, PDF-082]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, formato]
---

# PDF-042 · Guardar formularios dentro del PDF (/V, /AS y /AP) por actualización incremental

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]] · [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0014-localizar-paginas-por-count]]

## Objetivo
Ctrl+S y Guardar como escriben los valores de los campos cambiados en el mismo incremento que las anotaciones, con apariencias nuevas, de forma que pdf.js, qpdf y Adobe muestran los valores y la app los vuelve a leer al reabrir.

## Contexto
- Leer: `src/core/pdf/incremental.ts` (`writeUpdate`, `DeltaWriter`, asignación de números con `next`), `src/core/pdf/object-reader.ts` (`getDict`, `resolve`), `src/core/annotations/to-pdf.ts` (estilo de `withEntries`), `src/core/forms/appearance.ts` (PDF-082), `src/core/forms/diff.ts` (PDF-080), `src/state/save-actions.ts`, `tests/support/qpdf.ts`, `tests/support/save-annotations.ts`, `tests/support/interop-samples.ts`.

## Qué hay que hacer
1. `src/core/forms/to-pdf.ts`:
```ts
export interface ObjectWrite { readonly num: number; readonly gen: number; readonly value: PdfValue }
/** Objetos que hay que escribir para los campos cambiados. `allocate` da un número de objeto nuevo. Lanza `PdfSyntaxError` si no puede leer un widget. */
export async function planFieldWrites(reader: ObjectReader, changes: readonly FieldChange[], allocate: () => PdfRef): Promise<readonly ObjectWrite[]>;
```
   Por cada cambio (en orden):
   a. Diccionarios pendientes en un `Map<"num gen", { ref, dict }>` (un objeto que es campo y widget a la vez se escribe **una** vez con todos sus cambios).
   b. Campo: lee el widget del primer `FormWidget`; si tiene `/T`, el campo es el propio widget; si no, su `/Parent` (referencia; si falta → error «estructura no legible»).
   c. `/V` del campo: texto → `encodeTextString(text)`; casilla → `name(checked ? onState : 'Off')` (onState del primer widget); opción → `name(selected ?? 'Off')`; combo → `encodeTextString(selected[0] ?? '')`; lista → `multiSelect` ? array de `encodeTextString` : `encodeTextString(selected[0] ?? '')`. Lista múltiple: `/I` = índices (en `options`) de los elegidos, ordenados; en el resto quita `/I` (`undefined`).
   d. Widgets: casilla → `/AS name(checked ? w.onState : 'Off')`; opción → `/AS name(selected === w.onState ? w.onState : 'Off')`; texto/combo/lista → `apRef = allocate()`, escribe `buildFieldAppearance(...)` en `apRef` y pone `/AP dict({ N: apRef })` (sustituye `/AP` entero).
   e. Tipos no rellenables (`signature`, `button`) o `readOnly`: se ignoran.
2. `incremental.ts`: `IncrementalInput` gana `readonly fields?: readonly FieldChange[]` (por defecto `[]`). Vacío = `isEmptyDiff(diff) && fields.length === 0`. Tras planificar las anotaciones modificadas y **antes** de reservar `xrefNum`: `const fieldWrites = await planFieldWrites(reader, fields, () => ref(next++))`. Escríbelos con `writer.object` justo después de las anotaciones modificadas. `objectCount` y `size` deben contar los nuevos.
3. `save-actions.ts`: `currentDiff()` pasa a devolver `{ diff, fields }` con `fields = diffFields(useForms.getState().fields, edits)`; `buildDelta` y la comprobación de «nada que guardar» usan ambos. Tras guardar se reabre como hoy (los valores pasan a ser los del fichero).
4. Muestra para Adobe: añade a `tests/support/interop-samples.ts` la muestra `formulario-relleno.pdf` (`form-full.pdf` con los valores del criterio 1) para la lista manual del Manual.
5. Tests: `tests/unit/forms-write.test.ts` (núcleo + pdf.js + qpdf) y ampliar `tests/ui/save-actions*.test.ts` (o el fichero de guardar que exista) con un guardado solo de campos.

## Criterios de aceptación
- [ ] Núcleo con `form-full.pdf` y cambios `nombre`=«María José», `acepto`=marcada, `color`=`Azul`, `pais`=`pt`, `idiomas`=[`Francés`,`Alemán`], `persona.apellido`=«Núñez», `rotado`=«Hola»: el fichero `original + delta` leído con pdf.js da esos `fieldValue` (`acepto` → `'Si'`, `color` → `'Azul'` en los 3 widgets, `idiomas` → `['Francés','Alemán']`) y `hasAppearance: true` en todos los widgets; `qpdf --check` código 0.
- [ ] `qpdf --json` del resultado: el widget `Rojo` tiene `/AS /Off`, el `Azul` `/AS /Azul`; `idiomas` tiene `/I [2 3]`; el objeto de `persona.apellido` (campo y widget fusionados) aparece una sola vez en el incremento.
- [ ] Reimportar el resultado con `importWidget`/`mergeFields` da `initial` igual a los valores guardados (ida y vuelta).
- [ ] El widget `nombre` de la p2 también tiene apariencia nueva con «María José» (los dos widgets del campo).
- [ ] `/NeedAppearances` del `/AcroForm` no cambia (el catálogo no se reescribe) y los campos no tocados conservan su objeto original (no están en el incremento).
- [ ] Guardar anotaciones y campos a la vez en `form-full.pdf` produce un único incremento válido (`qpdf --check` 0; pdf.js ve la anotación y los valores).
- [ ] Sin cambios de campos ni de anotaciones, Ctrl+S no escribe (`'nothing'`), como hoy.
- [ ] Delta de los 7 campos < 20 KB; `pnpm perf` sin regresiones.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- PDF cifrados (PDF-047; hoy siguen dando `save-encrypted`). Cambiar `/NeedAppearances`. Fuentes de `/DR`. E2E con la interfaz (PDF-083).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
