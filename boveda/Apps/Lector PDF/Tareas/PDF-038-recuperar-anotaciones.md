---
tipo: tarea
id: PDF-038
titulo: Recuperar anotaciones no guardadas tras un cierre inesperado
app: pdf
estado: en-test
depende_de: [PDF-037, COM-012]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/core/annotations/draft.ts`, `apps/lector-pdf/src/state/draft-sync.ts`, `apps/lector-pdf/tests/unit/annotations/draft.test.ts`, `apps/lector-pdf/tests/ui/draft-sync.test.tsx`, `apps/lector-pdf/tests/e2e/recover.spec.ts`. Modificados: `src/core/annotations/index.ts` (reexporta draft), `src/state/annotation-actions.ts` (`recoverEdits`, una entrada «recuperar cambios»), `src/state/unsaved-guard.ts` (fuera de la lista: «No guardar» borra antes el borrador), `src/ui/messages.ts`, `src/main.tsx` (`startDraftSync(createIdbDraftStore('lector-pdf'))`).
- Qué he hecho: `toDraft`/`fromDraft`/`draftSavedAt` puros con validación completa (cualquier entrada inválida → `null`). Sincronización: borrador con debounce de 2 s, escritura al ocultarse la página, borrado al quedar limpio o al descartar, aviso «Recuperar»/«Descartar» al abrir (la aplicación espera a que termine el escaneo), borrado de borradores inválidos o de más de 30 días al arrancar, y errores del almacén solo como `logger.warn`.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (128 ficheros, 1528 tests); `pnpm coverage` OK; `pnpm --filter lector-pdf e2e` OK (82 pasados, incluido `recover.spec.ts`).
- Dudas o cosas que no he podido hacer:
  1. El E2E de la ficha pedía «crear un resaltado». Todavía no hay interfaz para crear anotaciones (PDF-031, PDF-032 y PDF-069 están pendientes), así que el E2E borra con Supr un resaltado del fichero, recarga, y comprueba que se ofrece «Recuperar» y que lo aplica. Cuando PDF-032 esté, conviene añadir el caso de creación.
  2. «Esc» en el aviso no está fijado por la ficha: lo he tratado como «conservar el borrador para la próxima vez» (no aplica ni borra). Si se prefiere otra cosa, es un cambio de una línea (`cancel`).
  3. En el Plan, PDF-037 y COM-012 aparecen como `pendiente`, pero su código existe (`state/save-actions.ts`, `packages/platform/src/drafts.ts`) y lo he usado tal cual. No he revisado sus fichas.
  4. Limitación: el borrado de «No guardar» se espera antes de seguir, pero si el navegador o la ventana se cierran justo después, el borrado podría no completarse.
  5. No he hecho commit (lo pidió el usuario).

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Lint, typecheck, test (1528) y coverage en verde; `recover.spec.ts` pasa. Criterios cubiertos con tests reales (ida y vuelta, debounce 2 s, recuperar como una entrada deshacible, descartar, put rechazado, borrador inválido, purga de 30 días).
1. (opcional) `tests/e2e/recover.spec.ts` — usa supresión en vez de crear un resaltado porque aún no hay interfaz de creación; añadir el caso de creación cuando llegue PDF-032. El tester debe dar por válida esta desviación.
2. (opcional) `draft-sync.ts:191-194` — si el usuario edita con el aviso de recuperación aún abierto, el borrador antiguo se sobrescribe; improbable con el diálogo modal.
