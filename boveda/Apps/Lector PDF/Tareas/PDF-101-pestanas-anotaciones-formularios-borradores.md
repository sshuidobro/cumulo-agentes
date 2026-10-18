---
tipo: tarea
id: PDF-101
titulo: Pestañas - anotaciones, formularios y borradores por documento
app: pdf
estado: pendiente
depende_de: [PDF-094, PDF-048]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, estado, pestanas, anotaciones]
---

# PDF-101 · Pestañas: anotaciones, formularios y borradores por documento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · [[ADR-0019-formularios-acroform]] · Base: [[PDF-094-sesiones-de-documento]]

## Objetivo
Cada pestaña conserva sus anotaciones sin guardar, su historial de deshacer, los valores de formulario rellenados y su borrador de recuperación. Cambiar de pestaña no pierde nada, no reimporta lo ya importado y no muestra el aviso «Hay cambios sin guardar de…».

## Contexto
- Leer: `src/state/tabs.ts`, `src/state/annotation-actions.ts` (`Session`, `fullScan`, `stack`, `memo`, `pageMemo`, `startAnnotationSession`, `endAnnotationSession`, `mergePages`, suscripción del título), `src/state/annotation-store.ts` (`preferenceState`: las preferencias **no** van en la instantánea), `src/state/form-actions.ts` y `src/state/form-store.ts` (PDF-081), `src/state/draft-sync.ts` (`Tracked`, `leave`, `offerRecovery`, suscripción a `useViewer`), `src/engine/annotations-import.ts` (`scanAnnotations`), el módulo donde PDF-048 guarda «aviso de permisos ya mostrado».
- `document-actions.ts` expone ya el `AbortSignal` del escaneo de la sesión activa; si no, añadir `currentScanSignal(): AbortSignal | null` (única línea que se toca de ese fichero).

## Qué hay que hacer
1. `engine/annotations-import.ts`: `scanAnnotations` acepta `from?: number` (0-based, por defecto 0), igual que `scanPageDims`.
2. `annotation-actions.ts`: participante `annotations` (orden 10). Instantánea:
```ts
interface AnnotationsSnapshot {
  readonly session: Session;               // pdf y pending (vacío tras abortar)
  readonly stack: UndoStack<AnnotationEdits>;
  readonly memo: typeof memo;
  readonly pageMemo: ReadonlyMap<number, { readonly version: number; readonly items: readonly Annotation[] }>;
  readonly state: Omit<AnnotationState, 'author' | 'colors' | 'inkWidth' | 'fontSize' | 'commentBarOpen'>;
  readonly importedPages: number;          // páginas ya importadas por el escaneo completo
  readonly fullScanRunning: boolean;
  readonly permissionNoticeShown: boolean; // el de PDF-048 (renombrar al nombre real)
}
```
   `suspend`: aborta `session.stop` y `fullScan`, toma todo lo anterior y deja el módulo como `endAnnotationSession()` (sin tocar las preferencias). `resume`: restaura; crea un `stop` nuevo ligado a `currentScanSignal()`; si `state.scan === 'scanning'`, relanza `scanAnnotations` con `from: importedPages` (mismo `mergePages` y paso a `'done'`); si `fullScanRunning`, `scanAllAnnotations()`; título con `windowTitle(name, state.undo.isDirty)`. `dispose`: nada.
   Para saber `importedPages`, el `onBatch` de `startAnnotationSession` guarda `nextPage` en la sesión (`Session.imported: number`, mutable).
3. `form-actions.ts`: participante `forms` (orden 20), instantánea con el estado de `useForms` y la sesión del módulo; `suspend` deja `useForms` en su estado inicial; `resume` lo restaura. Los valores en `doc.annotationStorage` siguen en el documento pdf.js, que no se destruye.
4. `draft-sync.ts`: dentro de `startDraftSync`, participante `drafts` (orden 40), instantánea `Tracked | null`. `suspend`: `cancelTimer()`, `flush(tracked)` si está sucio, `tracked.shown?.dismiss()` (cuenta como «más tarde»), devuelve `tracked` y pone `tracked = null` **sin** `leave` (no borra el borrador). `resume`: `tracked = snapshot` (sin `offerRecovery`). `dispose(t)`: `leave(t)`. La suscripción a `useViewer` y la de `useAnnotations` no hacen nada si `isSwitchingTab()`. Al desregistrar (`return` de `startDraftSync`) se quita el participante.
5. Tests `tests/unit/tabs-annotations.test.ts` y `tests/ui/draft-sync-tabs.test.tsx`.

## Criterios de aceptación
- [ ] A: crear 3 notas y deshacer 1 (2 visibles, rehacer disponible); abrir B y crear 1 resaltado; volver a A → 2 notas, `redo()` recupera la 3.ª; en B sigue el resaltado; el título de la ventana lleva «• » en ambas al estar activas.
- [ ] A con 2 000 páginas (fixture de rendimiento) mientras se importan sus anotaciones (`scan: 'scanning'`): cambiar a B y volver → el escaneo continúa desde `importedPages` (espía: la primera página pedida es `importedPages + 1`) y termina en `'done'` sin páginas duplicadas en `baseline`.
- [ ] `form-full.pdf` en A con `nombre` = «Ana»; abrir B; volver → el campo muestra «Ana», `useForms` lo tiene y Ctrl+Z lo deshace.
- [ ] Borradores: A sucio → cambiar a B no muestra ningún diálogo de recuperación (contador de `askChoice` = 0), el borrador de A está guardado en el `DraftStore`, y volver a A tampoco muestra diálogo.
- [ ] Borradores: cerrar con `closeTab` una pestaña inactiva sin cambios borra su borrador si no hay que conservarlo (`leave`), igual que cerrar el documento hoy.
- [ ] Aviso de permisos de PDF-048 (`encrypted-owner-only.pdf`): mostrado en A, cambiar a B y volver, anotar → no se repite.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Historial de vista, búsqueda, posición, panel (PDF-100). Interfaz (PDF-095).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
