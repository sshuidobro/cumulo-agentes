---
tipo: tarea
id: PDF-042
titulo: Guardar formularios dentro del PDF (/V, /AS y /AP) por actualización incremental
app: pdf
estado: cambios-pedidos
depende_de: [PDF-081, PDF-082, PDF-087]
intentos: 1
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
- PDF-087 ya extrajo `buildCurrentDelta` en `save-actions.ts`: amplíala, no la dupliques.
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
3. `save-actions.ts`: `currentDiff()` pasa a devolver `{ diff, fields }` con `fields = diffFields(useForms.getState().fields, edits)`; `buildCurrentDelta` (extraída en PDF-087, la usa también imprimir) y la comprobación de «nada que guardar» usan ambos. Tras guardar se reabre como hoy (los valores pasan a ser los del fichero).
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/forms/to-pdf.ts` (nuevo: `planFieldWrites`, `ObjectWrite`), `apps/lector-pdf/src/core/forms/index.ts`, `apps/lector-pdf/src/core/pdf/incremental.ts` (`IncrementalInput.fields`), `apps/lector-pdf/src/state/save-actions.ts` (`currentDiff` devuelve `{ diff, fields }`), `apps/lector-pdf/tests/unit/forms-write.test.ts` (nuevo, 13 tests), `apps/lector-pdf/tests/unit/save-actions.test.ts` (bloque «solo valores de formulario»), `apps/lector-pdf/tests/support/form-fields.ts` (nuevo: valores del criterio 1, lectura de campos y guardado compartidos), `apps/lector-pdf/tests/support/interop-samples.ts` (muestra `formulario-relleno.pdf`).
- Qué he hecho: `planFieldWrites` escribe `/V`, `/AS`, `/I` y `/AP` por campo, con los diccionarios fusionados (campo y widget) escritos una sola vez; se llama en el escritor incremental tras las anotaciones modificadas y antes de reservar la xref. Guardar, guardar como, imprimir y «nada que guardar» usan `{ diff, fields }`. La muestra `formulario-relleno.pdf` se genera con los valores del criterio 1.
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos); `pnpm typecheck` OK (tras corregir tres errores de tipos en mis tests); `pnpm test` OK: 188 ficheros, 2203 tests. `pnpm coverage` falló con «directorio de cobertura en uso» porque otro Vitest (del tester) estaba activo, no por código; lo repetí con `--coverage.reportsDirectory` propio: exit 0, líneas 98,71 %, ramas 92,11 %. `pnpm exec vitest run --config vitest.perf.config.ts apps/lector-pdf/tests/perf/incremental.perf.test.ts`: 2/2 OK (solo esta suite de rendimiento, las del tester no las he lanzado). `pnpm --filter lector-pdf interop:samples` OK y `qpdf --check` de `formulario-relleno.pdf` sin errores. qpdf 11 valida el resultado en todos los tests que escriben.
- Dudas o cosas que no he podido hacer: (1) Una casilla marcada cuyo primer widget no tiene `exportValue` lanza `save-unreadable` en vez de escribir un estado inventado; la ficha no lo cubre. (2) Una lista de selección múltiple sin elegidos escribe `/I []`; la ficha no lo dice. (3) La lista de comprobación del Manual no está actualizada con `formulario-relleno.pdf`: el Manual lo cierra el líder. (4) Los criterios de la ficha siguen sin marcar: los verifica el tester.

### [revisor] ronda 1 — 2026-10-18 — CAMBIOS
Comprobado: `pnpm lint` y `pnpm typecheck` OK; `forms-write.test.ts` 6 veces seguidas (13/13) y 8 veces con la CPU saturada (6 bucles, junto a `save-actions.test.ts`, 28/28): sin no determinismo. Cada test dura <130 ms, no hay hora, red, aleatoriedad ni rutas compartidas (`mkdtempSync` único). El fallo de «casilla desmarcada a /Off» no se reproduce; lo más probable es que el tester lo viese con el árbol de trabajo compartido a medio editar por otro programador. Si vuelve a verse, que anote la salida completa. No lancé e2e/perf ni la suite completa.
Código y diseño correctos (fusión campo+widget en una sola escritura, `/I` ordenado, `/AP` sustituido, xref tras los campos, errores como `Result`). Solo faltan pruebas de las dos decisiones y un criterio sin cubrir:
1. `apps/lector-pdf/tests/unit/forms-write.test.ts` — la decisión (1), casilla marcada sin `exportValue` → `PdfSyntaxError`/`save-unreadable`, no tiene ningún test. La acepto (no inventar un estado `Yes` sin apariencia correspondiente es lo prudente), pero hay que fijarla: añade un test de `planFieldWrites` con un campo `checkbox` cuyos widgets tengan `onState: null` y valor `checked: true` (lanza `PdfSyntaxError`) y otro con `checked: false` (escribe `/AS /Off` y `/V /Off` sin lanzar).
2. `apps/lector-pdf/tests/unit/forms-write.test.ts` — la decisión (2), lista múltiple sin elegidos → `/V []` y `/I []`, tampoco tiene test. La acepto (ambos son arreglos válidos según ISO 32000-1 §12.7.4.4 y es el estado coherente tras deseleccionar todo). Añade un test que guarde `idiomas` con `selected: []` y compruebe con qpdf (`qpdf --check` 0, `/V` = `[]`, `/I` = `[]`) y que al reimportar con pdf.js `initial.selected` es `[]` (ida y vuelta). Si pdf.js no lo devolviera así, decide con el líder.
3. `apps/lector-pdf/tests/unit/forms-write.test.ts:148-153` — el criterio 1 pide `pais`=`pt` en los `fieldValue` de pdf.js y el test del 133 no comprueba `pais` (solo la ida y vuelta). Añade `expect(byName('pais')[0]?.fieldValue).toBe('pt')`.
4. (opcional) `apps/lector-pdf/src/core/errors.ts:24` — `save-unreadable` dice «No se pueden guardar las anotaciones», y ahora también salta por campos de formulario; reformularlo («…guardar los cambios») en el fichero de mensajes.
