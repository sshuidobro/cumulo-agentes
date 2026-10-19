---
tipo: tarea
id: PDF-101
titulo: Pestañas - anotaciones, formularios y borradores por documento
app: pdf
estado: hecha
depende_de: [PDF-094, PDF-048]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-19
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

### [programador] ronda 2 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/tests/unit/tabs-annotations.test.ts`, `apps/lector-pdf/tests/ui/draft-sync-tabs.test.tsx`, `apps/lector-pdf/src/state/annotation-actions.ts` (`scanFrom`: no escanea una sesión ya suspendida), `apps/lector-pdf/src/state/document-actions.ts` (`documentParticipant.suspend`: el aviso no se guarda en la instantánea del visor).
- Qué he hecho: quitados los `console.log` de depuración. Las causas de los timeouts eran dos: (1) el `afterEach` cerraba pestañas con cambios sin guardar y `closeTab` espera la respuesta del diálogo «No guardar», que nunca llegaba; ahora descarta explícitamente. (2) Producción: al volver a A el aviso de permisos reaparecía (estaba en la instantánea del visor) y una sesión suspendida arrancaba su escaneo tras abrir el lector. Corregido en `document-actions.ts` y `annotation-actions.ts`. El B del test de permisos pasa de `basic-5.pdf` a `links.pdf`: `basic-5.pdf` y `encrypted-owner-only.pdf` comparten huella (`/ID`) y la app los trata como el mismo documento (aviso «ya está abierto», correcto).
- Comandos ejecutados y resultado: `pnpm lint` → OK (0 avisos). `pnpm coverage` → 238 ficheros, 2868 tests OK, cobertura global 96,35 % líneas. `pnpm typecheck` → **falla**: 1 error en `apps/lector-pdf/tests/unit/organize/plan-qa.test.ts` (línea 16, `number | undefined`). Es un fichero sin seguir de otro agente en paralelo (organizar páginas); no lo he tocado. El resto del typecheck está limpio.
- Dudas o cosas que no he podido hacer: typecheck en rojo por ese fichero ajeno; hay que corregirlo antes de dar la ficha por buena. Sin commit (pedido así). Los criterios de aceptación se cubren con los 4 tests de `tabs-annotations.test.ts` y los 2 de `draft-sync-tabs.test.tsx`, que pasan.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
1. Lint y typecheck OK (el error de `plan-qa.test.ts` ya no existe). Los 6 tests de la ficha pasan. Cubren criterios A, escaneo desde `importedPages` (5000 páginas, sin duplicados), formulario con deshacer, permisos y borradores (sin diálogo, `closeTab` borra).
2. `pnpm coverage` con carga concurrente de otro agente: 5 fallos por timeout en tests ajenos (cifrados, page-tree). Aislados, los 4 ficheros pasan (113/113). El tester debe repetir coverage con la máquina libre.
3. (opcional) El criterio pide 2 000 páginas y el test usa `pages-5000.pdf`; es más exigente, vale.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| A: notas/deshacer/rehacer/título por pestaña | OK | `tabs-annotations.test.ts` (verde en coverage) |
| Escaneo reanudado desde `importedPages`, sin duplicados | OK | mismo fichero (pages-5000.pdf) |
| Formulario `nombre`=«Ana» y Ctrl+Z | OK | mismo fichero |
| Borradores: sin diálogo, guardado, `closeTab` borra | OK | `draft-sync-tabs.test.tsx` |
| Aviso de permisos no se repite | OK | `tabs-annotations.test.ts` |
| lint, typecheck, coverage con código 0 | OK | máquina libre: 238 ficheros, 2868 tests OK, exit=0; líneas 98,6 % (sentencias 96,35 %) |

Tests añadidos: ninguno (los de la ficha cubren todos los criterios). Rendimiento: sin presupuesto propio; suite completa sin timeouts con la máquina libre.
