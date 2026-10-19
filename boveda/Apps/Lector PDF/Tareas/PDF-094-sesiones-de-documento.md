---
tipo: tarea
id: PDF-094
titulo: Sesiones de documento - núcleo de pestañas (suspender y reanudar)
app: pdf
estado: en-test
depende_de: [PDF-090, PDF-046]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, estado, pestanas]
---

# PDF-094 · Sesiones de documento: núcleo de pestañas (suspender y reanudar)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · Sigue: [[PDF-100-pestanas-historial-busqueda-posicion]], [[PDF-101-pestanas-anotaciones-formularios-borradores]], [[PDF-095-pestanas]]

## Objetivo
Varios documentos abiertos a la vez, uno activo. Cada módulo de `state/` con estado de documento guarda y restaura su estado con un par `suspend`/`resume`; esta ficha crea el registro de pestañas y hace participar al módulo del documento (`document-actions` + `useViewer`). Sin interfaz todavía (PDF-095): se prueba con tests.

## Contexto
- Leer: `src/state/document-actions.ts` (`Session`, `openDocument`, `openRequested`, `closeDocument`, `releaseSession`, `beginReplacement`, escaneo de dimensiones), `src/state/viewer-store.ts` (`ViewerState`, `initialViewerState`), `src/state/navigation.ts` (`goToPage`), `src/state/position-sync.ts` (`flushPosition`), `src/state/unsaved-guard.ts` (`hasUnsavedChanges`), `src/state/notice.ts`, `tests/unit/document-actions.test.ts` (cómo se monta `FakePlatform` y los fixtures).
- Textos en `src/ui/messages-tabs.ts` (`tabsMsg`, creado en PDF-049; añadir claves).

## Qué hay que hacer
1. `src/state/tabs.ts`:
```ts
export const MAX_TABS = 10;
export interface TabParticipant<S> {
  readonly id: string;     // único: 'document', 'annotations', 'forms', 'history', 'search', 'position', 'sidebar', 'drafts'…
  readonly order: number;  // resume en orden ascendente, suspend en descendente. document = 0.
  suspend(): S;            // saca el estado de documento del módulo y lo deja como sin documento; cancela sus tareas en segundo plano. No libera recursos.
  resume(snapshot: S): void; // restaura exactamente y relanza las tareas en segundo plano pendientes.
  dispose(snapshot: S): Promise<void>; // libera los recursos de una pestaña suspendida que se cierra.
}
export interface TabInfo {
  readonly id: string;                 // `crypto.randomUUID()`
  readonly title: string;              // nombre del fichero (o el que se está abriendo)
  readonly status: DocStatus;          // de useViewer
  readonly dirty: boolean;
  readonly fingerprint: string | null; // pdf.fingerprint cuando está listo
  readonly path: string | null;        // file.path (Tauri) o null
}
export const useTabs: UseBoundStore<StoreApi<{ readonly tabs: readonly TabInfo[]; readonly activeId: string | null }>>;
export function registerTabParticipant<S>(p: TabParticipant<S>): void; // idempotente por id (el segundo registro reemplaza al primero; los tests lo usan)
export function isSwitchingTab(): boolean;
export function beginNewTab(title: string, path: string | null): boolean; // false (y aviso tabsMsg.tooMany) si ya hay MAX_TABS; si no, suspende la activa (si la hay), añade la nueva a la derecha de la activa y la activa
export function activateTab(id: string): void;       // no-op si ya es la activa o no existe
export function cycleTab(direction: 1 | -1): void;   // circular
export function closeTab(id: string): Promise<'closed' | 'cancelled'>;
export function findTab(match: { readonly path?: string; readonly fingerprint?: string }): TabInfo | null;
export function hasAnyUnsavedChanges(): boolean;     // activa (hasUnsavedChanges) o alguna suspendida con dirty
```
   - Las instantáneas viven en un `Map<tabId, Map<participantId, unknown>>` del módulo (no en zustand).
   - `activateTab`: `switching = true`; para cada participante (orden descendente) `snapshot = suspend()`; se guarda; para cada participante (ascendente) `resume(snapshot de la destino)`; `switching = false` en un `finally`. Un participante sin instantánea en la pestaña destino (registrado después) no se llama.
   - Mientras no está activa, `TabInfo` de la activa se mantiene al día con una suscripción a `useViewer` (`title` = `file?.name ?? loadingName`, `status`, `fingerprint`, `path`) y a `useAnnotations` (`dirty` = `hasUnsavedChanges()`); se ignoran cambios con `isSwitchingTab()`.
   - `closeTab(id)` de una pestaña **inactiva sin cambios**: `dispose` de cada participante con su instantánea y se quita (la activa no cambia). Inactiva **con cambios**: se activa primero y se sigue como activa. Activa: `confirmDiscardOrSave()`; `'cancel'` → `'cancelled'`. Si no, `closeDocument()`, se quita la pestaña y se activa la vecina de la derecha (si no, la de la izquierda); sin vecinas, `activeId = null` y la app queda en estado vacío.
   - Si la app arranca sin pestañas y se abre el primer documento, se crea la pestaña sin suspender nada.
2. `document-actions.ts` registra el participante `document` (orden 0) con instantánea `{ session: Session; viewer: ViewerState }`:
   - `suspend`: `flushPosition()`; si hay apertura en curso (`opening`), se aborta y la instantánea lleva `session: null` y `viewer` en estado vacío (la pestaña se cerrará: ver 3); si no, aborta `session.scan`, llama a `session.pdf.doc.cleanup()` (sin `await`, errores al logger), pone `session = null`, sube `openSeq` y deja `useViewer` en `initialViewerState` (conservando `dimsVersion`).
   - `resume`: `session = { ...snapshot.session, scan: new AbortController() }`, `useViewer.setState({ ...snapshot.viewer, dimsVersion: actual + 1 })`, título de ventana con `windowTitle(name, hasUnsavedChanges())` (lo recalculan después los demás participantes; basta el nombre), relanza `scanPageDims` desde la página 1 (mismas condiciones que al abrir) y `goToPage(currentPage, { yFraction: currentYFraction })` para que el visor vuelva a la misma posición.
   - `dispose`: `releaseSession(snapshot.session)` sin `endAnnotationSession` (eso es de otro participante: separa `releaseSession` en `releaseDocument(session)` + la llamada a `endAnnotationSession` donde ya estaba).
3. Apertura con pestañas (`openRequested`):
   - Ya abierto: `findTab({ path: file.path })` (si `path !== null`) → `activateTab`, `closeOpened(file)`, aviso `tabsMsg.alreadyOpen` («“<nombre>” ya está abierto.»). Tras cargar, si otra pestaña tiene el mismo `fingerprint` y `file.size`, igual: se destruye la carga, se cierra la pestaña nueva y se activa la existente.
   - Si la pestaña activa está vacía o en error → se abre en ella (como hoy, sin preguntar). Si tiene documento → `beginNewTab(file.name, file.path)`; `false` → `closeOpened(file)` y fin. **Ya no se pregunta por cambios sin guardar** al abrir otro documento: el anterior sigue en su pestaña.
   - Si la apertura en la pestaña nueva falla, la pestaña queda en estado de error (el usuario la cierra); si se cancela (también al cancelar la contraseña), la pestaña se cierra y se vuelve a la anterior.
   - Al suspender una pestaña en estado `loading` (ver 2), `activateTab` la elimina después de cambiar.
   - `reopenSaved` (guardar) y la reapertura tras «Guardar como» siguen usando `openDocument` en la pestaña activa.
4. Tests `tests/unit/tabs.test.ts` (con participantes falsos) y `tests/unit/document-tabs.test.ts` (con `FakePlatform` y fixtures reales).

## Criterios de aceptación
- [ ] Unit (falsos): con participantes de orden 0, 10 y 30, `activateTab` llama `suspend` 30→10→0 y `resume` 0→10→30; `isSwitchingTab()` es `true` dentro de las llamadas y `false` después, también si un `resume` lanza.
- [ ] Unit: `beginNewTab` ×10 → 10 pestañas; la 11.ª devuelve `false`, no cambia nada y muestra el aviso «Puedes tener hasta 10 documentos abiertos. Cierra alguno para abrir otro.».
- [ ] Unit: `cycleTab(1)` en la última va a la primera; `cycleTab(-1)` en la primera va a la última.
- [ ] Unit: `closeTab` de la activa con 3 pestañas (activa la del medio) activa la de la derecha; de la última, la de la izquierda; de la única, deja `activeId === null` y `useViewer.status === 'empty'`. `closeTab` de una inactiva sin cambios llama a `dispose` de cada participante con su instantánea y no cambia la activa; de una inactiva con `dirty` la activa antes de preguntar.
- [ ] Integración: abrir `basic-5.pdf`, ir a la p3 con `yFraction` 0.5, zoom 150 %; abrir `links.pdf` → 2 pestañas, `useViewer.file.name === 'links.pdf'`; `activateTab(primera)` → `basic-5.pdf`, `currentPage === 2`, `zoomMode` 150 %, `navRequest` hacia p3; el `LoadedPdf` es el mismo objeto (no se ha recargado: espía de `loadPdf` llamado 2 veces en total).
- [ ] Integración: abrir de nuevo `basic-5.pdf` (mismo `path` en `FakePlatform`) → no hay 3.ª pestaña, se activa la primera, aviso «“basic-5.pdf” ya está abierto.» y `closeFile` llamado para el fichero repetido.
- [ ] Integración: abrir un fichero corrupto con un documento ya abierto → 2 pestañas, la nueva en error; cerrarla → vuelve la primera intacta.
- [ ] Integración: cerrar con `closeTab` una pestaña suspendida → `doc.destroy` y `platform.closeFile` de su documento (espías); la activa no se toca.
- [ ] Integración: durante el cambio de pestaña, el escaneo de dimensiones de la que se suspende queda abortado (su `signal.aborted`), y al reanudar se lanza otro desde la página 1.
- [ ] Ninguna instantánea se escribe en preferencias ni en borradores (espía de `platform.prefs.set`: solo `positions`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `pnpm --filter lector-pdf e2e` con código 0 (los E2E actuales no cambian: con un solo documento todo es igual, salvo que abrir otro ya no pregunta por cambios sin guardar; ajustar **solo** los E2E que lo comprobaban, citándolos en el Registro).

## Fuera de alcance
- Participantes de anotaciones, formularios, historial, búsqueda, posición, panel y borradores (PDF-100 y PDF-101). Barra de pestañas y atajos (PDF-095).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/state/tabs.ts` (nuevo), `apps/lector-pdf/src/state/document-actions.ts` (participante `document`, `runOpen`, `openRequested` con pestañas), `apps/lector-pdf/src/ui/messages-tabs.ts` (`tooMany`, `alreadyOpen`), `apps/lector-pdf/src/main.tsx` (`registerDocumentParticipant()`), `apps/lector-pdf/tests/unit/tabs.test.ts` (nuevo, 15 tests), `apps/lector-pdf/tests/unit/document-tabs.test.ts` (nuevo, 9 tests con fixtures reales), `apps/lector-pdf/tests/unit/unsaved-guard.test.ts` (los 3 casos «abrir con cambios pregunta» pasan a un caso «no pregunta»), `apps/lector-pdf/tests/e2e/forms.spec.ts` y `apps/lector-pdf/tests/e2e/recent.spec.ts` (comprobaban la pregunta al abrir; ahora comprueban que no pregunta). Arreglos de preexistentes para cumplir lint/typecheck: `apps/lector-pdf/tests/helpers/save-harness.ts` (faltaban `exportFile`/`importFile` en el Platform de prueba) y `apps/lector-pdf/src/core/pdf/incremental.ts` (import sin uso).
- Qué he hecho: registro de pestañas (`activateTab`, `beginNewTab`, `closeTab`, `cycleTab`, `findTab`, `hasAnyUnsavedChanges`) con participantes ordenados; el participante `document` suspende (aborta escaneo y apertura, `doc.cleanup`) y reanuda (restaura visor, reescanea desde la página 1, `goToPage`); `openRequested` no pregunta por cambios, detecta «ya abierto» por ruta y tras cargar por `fingerprint`, reutiliza la pestaña activa si está vacía o en error y cierra la pestaña si se cancela la apertura (también la contraseña).
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos). `pnpm --filter lector-pdf typecheck` OK (0 errores). `pnpm coverage` OK: 217 ficheros, 2626 tests pasan. `pnpm --filter lector-pdf e2e` OK: 233 passed, código 0.
- Dudas o cosas que no he podido hacer:
  1. **Riesgo de pérdida de datos (decisión para el líder).** Hasta PDF-100/101 el estado de anotaciones y formularios es global. `openDocument` sigue llamando a `endAnnotationSession`/`endFormSession`, así que abrir otro documento con cambios sin guardar ya no pregunta y descarta esos cambios de la pestaña anterior sin aviso. Antes se preguntaba. Opciones: mantener la pregunta hasta PDF-100, o aceptar el riesgo en esta fase interna. Lo he implementado tal como dice la ficha.
  2. «Mismo tamaño» (`file.size`): `TabInfo` no tiene tamaño, así que la coincidencia tras cargar usa solo `fingerprint`.
  3. Registro del participante: no se hace al importar `document-actions` porque crearía un ciclo de importación con `tabs` que puede dar TDZ. Se hace con `registerDocumentParticipant()` en `main.tsx` y en los tests.
  4. «Mientras no está activa» lo he leído como «mientras está activa»: la fila de la pestaña activa se sincroniza con `useViewer` y `useAnnotations`.
  5. Solo se eliminan al cambiar las pestañas en estado `loading` (como dice la ficha). Una pestaña vacía que se cancela se cierra explícitamente en `openRequested`.
  6. Escritorio (Tauri) no probado; solo web.


### [revisor] ronda 1 — 2026-10-19 — CAMBIOS
Lint OK, `pnpm --filter lector-pdf typecheck` OK, `pnpm coverage` OK (2626 tests). `pnpm typecheck` raíz falla en `packages/platform` (SharedArrayBuffer): no tocado por este commit, preexistente (avisar al líder).
1. `apps/lector-pdf/src/state/document-actions.ts` (`openRequested`/`runOpen`, rama `dedupe`) — si se reutilizó una pestaña vacía o en error (`reuse`) y la carga resulta ser gemela de otra, tras activar la gemela queda una pestaña vacía sobrante (la ficha pide cerrar la pestaña nueva) — cerrarla y añadir un test (`document-tabs.test.ts`, caso del `fingerprint` con pestaña activa vacía).
2. `runOpen` — la coincidencia usa solo `fingerprint`, sin `file.size`: documentarlo en el comentario. (opcional)
3. Para el líder (no bloquea, la ficha lo manda): abrir otro documento descarta sin aviso las anotaciones sin guardar hasta PDF-100/101, aunque la pestaña seguiría marcada `dirty`. Decidir si se mantiene la pregunta hasta entonces.

### [programador] ronda 2 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/state/document-actions.ts` (comentario de `runOpen`: coincidencia solo por `fingerprint` y pestaña de carga eliminada al activar la gemela), `apps/lector-pdf/tests/unit/document-tabs.test.ts` (2 tests nuevos).
- Qué he hecho: revisado el punto 1 (pestaña sobrante). Con pestaña activa en error y con pestaña vacía reutilizada, la carga queda en `loading` y `activateTab` la elimina al cambiar a la gemela; añadidos dos tests de regresión que lo comprueban (pasan sin cambiar la lógica). Punto 2 documentado en el comentario. Punto 3 es decisión del líder (no tocado).
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf typecheck` OK. `pnpm exec eslint --max-warnings 0` sobre los ficheros tocados OK. `pnpm --filter lector-pdf exec vitest run --coverage` OK: 186 ficheros, 2283 tests pasan. `pnpm lint` de la raíz falla por `apps/lector-pdf/tests/e2e/view-modes.spec.ts:3` (`TestInfo` sin usar): fichero con cambios sin commit que no es de esta ficha; no lo he tocado.
- Dudas o cosas que no he podido hacer: no he ejecutado E2E en esta ronda (solo cambios de comentario y tests unitarios). El punto 3 del revisor sigue abierto para el líder.

### [revisor] ronda 2 — 2026-10-19 — APROBADO
Typecheck de lector-pdf OK; tests de tabs, document-tabs y unsaved-guard OK (33). Lint de raíz: fallo ajeno (view-modes.spec.ts, PDF-050). Punto 1 de la ronda 1 comprobado: los dos tests de regresión cubren el caso (pestaña en error y pestaña vacía reutilizadas) y pasan. Punto 3 (descarte sin aviso hasta PDF-100/101) sigue pendiente para el líder; no bloquea.
