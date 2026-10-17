---
tipo: tarea
id: PDF-038
titulo: Recuperar anotaciones no guardadas tras un cierre inesperado
app: pdf
estado: pendiente
depende_de: [PDF-037, COM-012]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, anotaciones, recuperacion]
---

# PDF-038 · Recuperación de anotaciones

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]] (borradores en IndexedDB)

## Objetivo
Si la app o el ordenador se cierran con anotaciones sin guardar, al volver a abrir ese mismo PDF se ofrece «Recuperar» o «Descartar» los cambios. Los borradores se guardan solos, solo en el equipo, y se borran al guardar o descartar.

## Contexto
- Leer: `packages/platform/src/drafts.ts` (`DraftStore`, `createIdbDraftStore`, COM-012), `src/state/annotation-actions.ts`, `src/core/annotations/model.ts` (`isAnnotation`), `src/state/save-actions.ts` (PDF-037).
- Clave del borrador: `'pdf:' + fingerprint + ':' + file.size`. Base IndexedDB `lector-pdf`.

## Qué hay que hacer
1. `src/core/annotations/draft.ts` (puro):
   ```ts
   export interface AnnotationDraft { readonly version: 1; readonly fileName: string; readonly savedAt: string; readonly upserts: readonly Annotation[]; readonly removed: readonly string[] }
   export function toDraft(edits: AnnotationEdits, fileName: string, savedAt: string): AnnotationDraft;
   export function fromDraft(v: unknown): AnnotationEdits | null; // valida con isAnnotation cada entrada; cualquier cosa inválida → null
   ```
2. `src/state/draft-sync.ts`: `export function startDraftSync(store: DraftStore): () => void`
   - Con documento abierto y `undo.isDirty`: guarda `toDraft(...)` con *debounce* de 2 000 ms y en `pagehide`/`visibilitychange` oculto (inmediato).
   - Al quedar limpio (guardado, deshecho todo) o cerrar sin cambios → `store.delete(clave)`.
   - Al abrir un documento: `store.get(clave)` → `fromDraft`; si es válido y no vacío → `Dialog` «Hay cambios sin guardar de la última vez en «<nombre>» (<fecha>).» con «Recuperar» / «Descartar». «Recuperar» → aplica los cambios como **un comando** deshacible («recuperar cambios», `setEntryCommand` por entrada dentro de `stack.group`) cuando el escaneo de anotaciones termina (o inmediatamente en modo `lazy`); «Descartar» → borra el borrador. Un borrador inválido se borra sin preguntar (y `logger.warn`).
   - Errores de IndexedDB → `logger.warn` y la app sigue (sin borradores); nunca bloquea al usuario.
3. Limpieza: al arrancar, borra borradores con `savedAt` de hace más de 30 días.
4. `main.tsx`: `startDraftSync(createIdbDraftStore('lector-pdf'))`.
5. Tests `tests/unit/annotations/draft.test.ts`, `tests/ui/draft-sync.test.tsx` (`DraftStore` en memoria con `factory null`), `tests/e2e/recover.spec.ts`.

## Criterios de aceptación
- [ ] (T) `fromDraft(toDraft(edits))` reconstruye `edits` igual; `fromDraft` con una anotación de color inválido → `null`.
- [ ] (T) Tras añadir una nota y avanzar 2 000 ms (temporizadores falsos) el borrador existe; tras guardar se borra.
- [ ] (T) Abrir el mismo documento con borrador → diálogo; «Recuperar» → las anotaciones aparecen, `isDirty` true, un `undo` las quita todas; «Descartar» → borrador borrado.
- [ ] (T) `DraftStore` que rechaza en `put` → la app sigue sin errores visibles (solo `logger.warn`).
- [ ] E2E: crear un resaltado, esperar 2,5 s, recargar la página (simula cierre), abrir el mismo fichero → aparece «Recuperar»; recuperar → el resaltado está.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Sincronizar entre equipos (nunca: los datos no salen del ordenador).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
