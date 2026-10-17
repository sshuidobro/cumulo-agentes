---
tipo: tarea
id: PDF-037
titulo: Guardar y Guardar como con anotaciones, recarga y aviso de cambios sin guardar
app: pdf
estado: pendiente
depende_de: [PDF-028, PDF-030, PDF-019, COM-007, COM-010, COM-013]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad, stack-tauri]
creado: 2026-10-17
actualizado: 2026-10-17
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
   - Construye: `ObjectReader.open(file.source)` → `buildIncrementalUpdate({ source, reader, diff, now: nowIso() })`. `err` → `Notice` con el mensaje → `'failed'`.
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
- [ ] (T) `installCloseGuard`: sin cambios el callback devuelve `true`; con cambios devuelve `false` y muestra el diálogo; «No guardar» llama a `closeWindow`; «Cancelar» no.
- [ ] (T) Abrir otro documento con cambios → diálogo; «Cancelar» mantiene el actual.
- [ ] (T) La posición (página 3, zoom 150 %) se mantiene tras guardar.
- [ ] E2E (Chromium, descarga): añadir resaltado + nota a `basic-5.pdf`, Ctrl+S → se descarga un PDF; abrir el descargado en la app → la pestaña «Comentarios» lista las 2 anotaciones.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Recuperación tras cierre inesperado (PDF-038). Guardar PDFs cifrados (PDF-047). Guardar reescribiendo/compactando el fichero (PDF-052).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
