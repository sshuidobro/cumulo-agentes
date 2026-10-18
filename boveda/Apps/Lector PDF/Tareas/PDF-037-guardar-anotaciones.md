---
tipo: tarea
id: PDF-037
titulo: Guardar y Guardar como con anotaciones, recarga y aviso de cambios sin guardar
app: pdf
estado: hecha
depende_de: [PDF-028, PDF-030, PDF-019, COM-007, COM-010, COM-013]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad, stack-tauri]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, anotaciones, ficheros]
---

# PDF-037 · Guardar anotaciones

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0008-plataforma-ficheros]]

## Objetivo
Ctrl+S guarda las anotaciones **dentro del PDF** (anexando un incremento de forma atómica), Ctrl+Mayús+S guarda una copia con otro nombre; después se recarga el documento desde el fichero guardado en la misma posición. Si el usuario intenta cerrar la ventana o abrir otro documento con cambios sin guardar, se le pregunta. Ningún error deja el fichero a medias.

## Contexto
- Leer: `src/core/pdf/incremental.ts` (PDF-028), `src/core/pdf/object-reader.ts`, `src/state/annotation-actions.ts` (`markAnnotationsSaved`, `getEffective`), `src/core/annotations/diff.ts`, `src/state/document-actions.ts`, `position-sync.ts` (PDF-019), `packages/platform/src/types.ts` (`save`, `saveAs`, `SaveData` `append`, `closeWindow`, `onCloseRequested`), `src/ui/kit/Dialog.tsx`, `Notice.tsx`.
- Web sin File System Access (Firefox, Safari) o fichero abierto con `<input>`: `canSaveInPlace false` → «Guardar» actúa como «Guardar como», que **descarga** una copia (`SaveOutcome 'downloaded'`).
- Tras guardar, la huella del PDF puede cambiar (si el original no tenía `/ID`), por eso la posición se restaura explícitamente.
- El historial de deshacer se vacía tras guardar (diferencia con Acrobat, decidida en [[ADR-0009-anotaciones-escritor-incremental]]).

## Qué hay que hacer
1. `document-actions.ts`: `openDocument(file, opts?: { readonly restore?: ReadingPosition })` — si viene `restore`, se aplica en lugar de `lookupPosition`.
2. `src/state/save-actions.ts`:
   ```ts
   export type SaveResult = 'saved' | 'downloaded' | 'cancelled' | 'nothing' | 'failed';
   export async function save(): Promise<SaveResult>;
   export async function saveAs(): Promise<SaveResult>;
   export function isSaving(): boolean;
   ```
   - Sin cambios (`isEmptyDiff`) en `save` → `'nothing'` (en `saveAs` se guarda igualmente una copia con `delta` vacío: `{ kind: 'append', ..., delta: new Uint8Array(0) }`).
   - Construye: `openForSave(file.source)` (de `src/core/pdf`, devuelve `Result<ObjectReader>`; **no** uses `ObjectReader.open`, que lanza) → si `ok`, `buildIncrementalUpdate({ source, reader, diff, now: nowIso() })`. Cualquier `err` (de las dos) → `Notice` con `error.message` → `'failed'`, sin llamar a la plataforma.
   - `save`: si `file.canSaveInPlace` → `platform.save(file, { kind: 'append', base: file, expectedSize, delta })`; si no → `saveAs()`.
   - `saveAs`: `platform.saveAs(file.name, PDF_FILTERS, data)`; `'cancelled'` → `'cancelled'`; `'downloaded'` → `markAnnotationsSaved()`, `Notice` «Se ha descargado «<nombre>» con tus anotaciones.» → `'downloaded'` (el documento abierto sigue siendo el original con los cambios en pantalla).
   - Guardado en disco (`save` ok o `saveAs` `'saved'`): guarda la posición actual, `openDocument(nuevoFichero, { restore })` (el estado de anotaciones se reinicia desde el fichero: lo nuevo pasa a la línea base) → `'saved'`; `Notice` «Guardado.».
   - `changed-on-disk` → `Dialog` «El fichero ha cambiado» con el mensaje de la plataforma y botones «Guardar como…» / «Cancelar».
   - Mientras guarda: `isSaving()` true, botones de guardar deshabilitados, una segunda llamada devuelve `'cancelled'` sin hacer nada; el visor sigue usable.
3. Aviso de cambios sin guardar, `src/state/unsaved-guard.ts`:
   ```ts
   export function confirmDiscardOrSave(): Promise<'proceed' | 'cancel'>; // sin cambios → 'proceed'; con cambios → Dialog «¿Guardar los cambios en «<nombre>»?» con «Guardar», «No guardar», «Cancelar». Guardar → save(); 'saved' o 'downloaded' → 'proceed'; otro → 'cancel'
   export function installCloseGuard(): () => void; // platform.onCloseRequested(() => { if (!dirty) return true; void confirmDiscardOrSave().then(r => r === 'proceed' && platform.closeWindow()); return false; })
   ```
   En web, `onCloseRequested` usa `beforeunload` (aviso nativo del navegador; el diálogo propio no se puede mostrar al cerrar la pestaña): acéptalo así. `openDocument` desde «Abrir», arrastrar o «Abrir con» llama antes a `confirmDiscardOrSave()`.
4. UI: botones «Guardar» (`IconSave`, Ctrl+S) y «Guardar como…» (Ctrl+Mayús+S) en `MainToolbar`; atajos `save` `Mod+S` y `save-as` `Mod+Shift+S` en `ALLOW_IN_EDITABLE` (funcionan escribiendo una nota: antes de guardar se confirma el editor activo con `document.activeElement.blur()`).
5. Mensajes en `messages.ts`. Tests `tests/ui/save-actions.test.ts` (plataforma falsa en memoria), `tests/ui/unsaved-guard.test.tsx`, `tests/e2e/save.spec.ts`.

## Criterios de aceptación
- [ ] (T) Plataforma falsa con `canSaveInPlace` y `basic-5.pdf`: añadir un resaltado, `save()` → la plataforma recibe `append` con `expectedSize` = tamaño original y un `delta` no vacío; el documento se reabre; `baseline` contiene el resaltado (origen `file`); `undo.canUndo === false`; título sin «•».
- [ ] (T) `save()` sin cambios → `'nothing'` y la plataforma no se llama.
- [ ] (T) `canSaveInPlace false` → se llama a `saveAs`; resultado `'downloaded'` → título sin «•» y el documento no se reabre.
- [ ] (T) `changed-on-disk` → aparece el diálogo; «Guardar como…» llama a `saveAs`.
- [ ] (T) PDF con `/Encrypt` → `Notice` con el texto de `save-encrypted` y la plataforma no se llama.
- [ ] (T) PDF dañado tras abrirlo (fuente falsa cuyo contenido es `corrupt-bad-startxref.pdf`) → `Notice` con el texto de `save-unreadable`, `'failed'` y la plataforma no se llama.
- [ ] (T) `installCloseGuard`: sin cambios el callback devuelve `true`; con cambios devuelve `false` y muestra el diálogo; «No guardar» llama a `closeWindow`; «Cancelar» no.
- [ ] (T) Abrir otro documento con cambios → diálogo; «Cancelar» mantiene el actual.
- [ ] (T) La posición (página 3, zoom 150 %) se mantiene tras guardar.
- [ ] E2E (Chromium, descarga): añadir resaltado + nota a `basic-5.pdf`, Ctrl+S → se descarga un PDF; abrir el descargado en la app → la pestaña «Comentarios» lista las 2 anotaciones.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Recuperación tras cierre inesperado (PDF-038). Guardar PDFs cifrados (PDF-047). Guardar reescribiendo/compactando el fichero (PDF-052).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] ajuste por desbloqueo de PDF-028 — 2026-10-17
- `save-actions` abre el lector con `openForSave` (nuevo en [[PDF-028-escritor-incremental]]), que traduce cifrado → `save-encrypted` y estructura dañada → `save-unreadable` sin lanzar. Así el criterio del PDF cifrado es cumplible (antes `ObjectReader.open` lanzaba `encrypted`). Añadido criterio de PDF dañado.

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados (`apps/lector-pdf/`): nuevos `src/state/save-actions.ts`, `src/state/unsaved-guard.ts`, `src/state/choice.ts`, `src/ui/kit/ChoiceDialog.tsx`, `tests/helpers/save-harness.ts`, `tests/unit/save-actions.test.ts`, `tests/unit/unsaved-guard.test.ts`, `tests/ui/choice-dialog.test.tsx`, `tests/ui/save-toolbar.test.tsx`; modificados `src/state/document-actions.ts` (`openDocument(file, opts?)`, `openRequested`), `src/state/position-sync.ts` (`readCurrentPosition`, `expectRestore`), `src/ui/toolbar/MainToolbar.tsx`, `src/ui/App.tsx`, `src/ui/messages.ts`, `src/ui/shortcuts.ts`, `src/ui/use-shortcuts.ts`, `src/ui/icons.tsx` (`IconSave`, `IconSaveAs`), `src/main.tsx`.
- Qué he hecho: `save`/`saveAs` según la ficha (append con `expectedSize` = tamaño del original, lector con `openForSave`, reapertura en la misma posición, `changed-on-disk` con diálogo, bloqueo mientras guarda); aviso de cambios sin guardar al cerrar (`installCloseGuard`) y al abrir otro documento (`openRequested`); botones Guardar / Guardar como… y atajos `Mod+S` / `Mod+Shift+S` con confirmación del editor activo. Los diálogos de elección van por `askChoice` (store) y `ChoiceDialog`.
- Comandos ejecutados y resultado: `pnpm lint` → 0; `pnpm typecheck` → 0 (última pasada); `pnpm test` → 121 ficheros y 1455 tests en verde, pero el comando sale con código 1 por 3 «Unhandled Rejection» en `tests/ui/open.test.tsx` (mock de `../../src/engine` sin `getOutline`: trabajo ajeno en curso, no es de esta ficha); `pnpm coverage` (con `--coverage.reportsDirectory` propio, el directorio `coverage/` estaba ocupado por otro proceso) → 0, `save-actions.ts` 100 % líneas; `pnpm build` → 0; smoke temporal de Playwright en puerto 4397 (config y spec borrados después): abrir basic-5, botones habilitados, «Guardar como…» descarga un PDF byte a byte igual al original y muestra el aviso, sin errores de página → pasa.
- Dudas o cosas que no he podido hacer:
  1. **E2E de la ficha no escrito** (`tests/e2e/save.spec.ts`, criterio de resaltado + nota): no hay UI de resaltar ni de notas (PDF-032/PDF-033 pendientes). Pendiente hasta que existan.
  2. **Discrepancia con COM-007**: en Chromium, `platform.saveAs` abre el selector de File System Access siempre que exista `showSaveFilePicker`, también con ficheros abiertos con `<input>`. La ficha dice que ahí debe descargar. No lo he cambiado (es de COM-007); en el smoke tuve que quitar `showSaveFilePicker`. Necesita decisión del líder.
  3. **Ubicación de tests**: `vitest.config` solo recoge `tests/unit/*.test.ts` y `tests/ui/*.test.tsx`, y el jsdom no carga pdf.js (`import.meta.url` no es `file:`). Por eso `save-actions` y `unsaved-guard` van en `tests/unit/` (Node, PDF real) y el diálogo se prueba en `tests/ui/choice-dialog.test.tsx`.
  4. **Dos decisiones menores, para revisar**: (a) `save()` sin diferencias llama a `markAnnotationsSaved()` además de devolver `'nothing'`, para que el estado «sucio» no quede atascado; (b) el aviso de cierre trata `'nothing'` como «seguir» (no queda nada que perder). Ambas son coherentes con la ficha, pero no estaban escritas.
  5. El `tests/ui/annotation-layer.test.tsx` y `tests/e2e/annotations-layer.spec.ts` no son míos; en un momento fallaron por ediciones en curso de PDF-031 y en la última pasada pasan.
  6. No he hecho commit (instrucción de no usar git commit/stash/checkout con el árbol compartido).

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Comprobado: `eslint --max-warnings 0` en la raíz → 0; `vitest run` en `apps/lector-pdf` → 95 ficheros / 1143 tests en verde; los 4 ficheros de la ficha (26 tests) en verde. `pnpm typecheck` falla solo por `tests/e2e/outline.spec.ts:50` (PDF-016, ajeno). No he ejecutado E2E.
Revisión: `save`/`saveAs` cumplen la ficha (`openForSave` sin lanzar, errores como `Result` y aviso sin tocar la plataforma, bloqueo con `runExclusive` y `finally`, `changed-on-disk` con diálogo, reapertura con `restore`). Guardia de cierre y de apertura correctos y probados (Cancelar libera el fichero nuevo). Atajos en `ALLOW_IN_EDITABLE` con blur previo; textos en `messages.ts`; botones con tooltip y atajo, deshabilitados mientras guarda. Los tests cubren los 8 criterios (T) con asserts reales.
Decisiones del programador aceptadas: (a) `'nothing'` marca como guardado, (b) `'nothing'` permite seguir al cerrar. Ubicación de tests en `tests/unit/` aceptada (limitación de jsdom/pdf.js y de `vitest.config`).
Criterio E2E (resaltado + nota, descarga, reabrir y ver 2 en «Comentarios»): **procede diferirlo a PDF-039**, que ya cubre ese flujo (`annotations-flow.spec.ts`: crear con la UI, Ctrl+S, `qpdf --check`, reabrir y comprobar el panel) y depende de PDF-032/033. No es posible escribirlo antes sin UI de resaltar/notas. El smoke del programador (Guardar como descarga y avisa) cubre mientras tanto el cableado. Pido al líder reflejar en PDF-039 que incluya el caso de la nota escrita con el editor aún enfocado al pulsar Ctrl+S, y marcar aquí el criterio como trasladado.
Sin problemas bloqueantes.
(opcional) Discrepancia con COM-007 (Chromium con `showSaveFilePicker` abre el selector aunque el fichero venga de `<input>`, en vez de descargar): decisión del líder; el comportamiento actual es razonable y no impide guardar.
(opcional) Ciclo de importaciones `document-actions` ↔ `unsaved-guard` ↔ `save-actions`: hoy funciona, pero conviene romperlo si se añaden más acciones.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| 8 criterios (T) | OK | `vitest run` de `save-actions`, `unsaved-guard`, `choice-dialog`, `save-toolbar`: 26/26 en verde |
| Validez del PDF guardado | OK | nuevo `tests/unit/save-qa.test.ts`: original+delta y segundo guardado encadenado (ruta con espacios y ñ) pasan `qpdf --check` y conservan el prefijo byte a byte |
| E2E resaltado+nota | DIFERIDO a PDF-039 (aprobado por el revisor; no hay UI de resaltar/notas) | — |
| E2E de cableado | OK | nuevo `tests/e2e/save-qa.spec.ts` (puerto 4405, config temporal): Ctrl+Mayús+S descarga copia idéntica y avisa; Ctrl+S sin cambios no descarga. 2/2 |
| `pnpm lint` | 0 | |
| `pnpm typecheck` | falla solo en `tests/e2e/outline.spec.ts:50` (PDF-016, ajeno) | |
| `pnpm test` | 1454/1456; fallan 2 en `tests/ui/annotation-layer.test.tsx` (PDF-031 en reparación, ajeno) | |
| Cobertura | `save-actions.ts` 94 % líneas / 100 % funciones, `unsaved-guard.ts` 100 % | |
Tests añadidos: `tests/unit/save-qa.test.ts`, `tests/e2e/save-qa.spec.ts`. Rendimiento: no aplica (guardar no tiene presupuesto propio).
Pendiente para el líder: discrepancia con COM-007 (selector de File System Access con ficheros de `<input>`); PDF-039 debe cubrir el caso de nota con editor enfocado al pulsar Ctrl+S.
