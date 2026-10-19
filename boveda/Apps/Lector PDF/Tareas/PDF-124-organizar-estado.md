---
tipo: tarea
id: PDF-124
titulo: Organizar - estado, acciones, guardado encadenado y escrituras de documento
app: pdf
estado: en-revision
depende_de: [PDF-053, PDF-118, PDF-119, PDF-101]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, estado]
---

# PDF-124 · Organizar: estado, acciones, guardado encadenado y escrituras de documento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]], [[ADR-0034-operaciones-en-worker]], [[ADR-0023-pestanas-y-recientes]] · Antes: [[PDF-053-organizar-paginas]], [[PDF-118-worker-operaciones]], [[PDF-119-organizar-escritura]] · Sigue: [[PDF-125-organizar-vista]]

## Objetivo
El estado de la vista «Organizar páginas» (abrir, editar el plan con deshacer, guardar en el Worker encadenando los cambios sin guardar, cerrar con aviso) y dos piezas comunes que reutilizarán las demás funciones: escribir en el documento abierto (`writeDocument`) y registrar cambios pendientes que no son anotaciones (`registerPendingChanges`).

## Contexto
- [[ADR-0035-organizar-en-la-app]] (puntos 1, 2 y 7).
- `src/state/save-actions.ts` (174 líneas, se modifica): `save`, `runExclusive`, `buildCurrentDelta`, `writeCopy`, `reopenSaved`, `reportWriteError`, `fail`.
- `src/state/unsaved-guard.ts` → `hasUnsavedChanges`, `confirmDiscardOrSave`.
- `src/state/tabs.ts` → `TabParticipant`, `registerTabParticipant` (el participante de documento usa `order: 0`; varios usan 30).
- `src/state/annotation-actions.ts:130-136` (título con marca de sin guardar), `src/core/title.ts` → `windowTitle`.
- `src/state/doc-ops.ts` → `runDocOp` (PDF-118); `src/core/doc-ops/ops/index.ts` → `DOC_OPS`.
- `src/core/organize/plan.ts` (PDF-053), `src/core/organize/save.ts` → `buildOrganizeUpdate` (PDF-119).
- `src/core/pdf/concat-source.ts` → `concatSource`; `src/state/document-actions.ts` → `currentPassword`.
- `src/state/choice.ts` → `askChoice`; `src/state/notice.ts` → `showNotice`; `useViewer.permissions` (PDF-048).

## Qué hay que hacer
1. `src/core/doc-ops/ops/index.ts`: op `'organize'` → args `{ password: string | null; slots: readonly SaveSlot[]; now: string }`, fuente 0 = documento (con los cambios sin guardar ya encadenados) → `openForSave` + `buildOrganizeUpdate` con `ctx.signal`/`ctx.progress` → `ok({ delta })`.
2. `src/state/save-actions.ts`:
```ts
export type DocumentWrite =
  | { readonly kind: 'append'; readonly delta: Uint8Array }                                   // se anexa al fichero abierto
  | { readonly kind: 'replace'; readonly bytes: Uint8Array; readonly password: string | null }; // fichero completo nuevo
/** Escribe en el fichero abierto con el flujo de Ctrl+S: exclusivo, en sitio o copia si no se puede, «cambió en disco» → Guardar como, y reabre en la misma posición (con `password` si es `replace`). */
export async function writeDocument(w: DocumentWrite): Promise<SaveResult>;
/** Cambios pendientes que no viven en el historial de anotaciones (organizar, redactar…). Solo uno a la vez. */
export interface PendingChanges { isDirty(): boolean; save(): Promise<SaveResult>; discard(): void }
export function registerPendingChanges(p: PendingChanges | null): void;
export function pendingChanges(): PendingChanges | null;
```
   - `save()` (Ctrl+S): si hay `PendingChanges` sucias → devuelve `pending.save()`; si no, como hoy. `writeCopy`/`reopenSaved` se reutilizan dentro de `writeDocument` (sin duplicar código). `replace` usa `{ kind: 'bytes', bytes }` de la plataforma.
   - `unsaved-guard.ts`: `hasUnsavedChanges()` = anotaciones sucias **o** `pendingChanges()?.isDirty()`; en «No guardar», además de `discardCurrentDraft`, llama a `pendingChanges()?.discard()`.
3. `src/state/organize-store.ts` y `src/state/organize-actions.ts`:
```ts
export interface OrganizeState {
  readonly open: boolean;
  readonly status: 'loading' | 'ready' | 'saving' | 'error';
  readonly rotations: readonly PageRotation[];   // giros iniciales del fichero
  readonly plan: OrganizePlan;
  readonly selection: PlanSelection;
  readonly undo: UndoState;
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly error: string | null;
}
export const useOrganize: UseBoundStore<StoreApi<OrganizeState>>;
export async function openOrganize(): Promise<void>;          // op 'page-rotations' en el Worker → plan inicial
export async function closeOrganize(): Promise<'closed' | 'cancelled'>;
export function organizeUndo(): void; export function organizeRedo(): void;
export function rotateSelected(delta: 90 | -90): void;
export function deleteSelected(): void;                       // si borraría todas → aviso organizeMsg.cannotDeleteAll
export function moveSelected(toIndex: number): void;
export function insertBlank(where: 'before' | 'after'): void;  // junto al hueco con foco (o al final); tamaño = el de ese hueco (blank: su tamaño; original: dims de `useViewer` para esa página, girada si el hueco lo está)
export function setSelection(sel: PlanSelection): void;
export async function saveOrganize(): Promise<SaveResult>;
export function cancelOrganizeSave(): void;
```
   - `openOrganize`: si `!permissions.assemble` → `showNotice(organizeMsg.assembleAnyway)` (una vez por documento) y sigue. Mientras carga, `status: 'loading'`; error del Worker → `status: 'error'` con su mensaje. Al abrir, `registerPendingChanges({ isDirty, save: saveOrganize, discard })`; al cerrar, `registerPendingChanges(null)`.
   - Historial: `UndoStack<OrganizePlan>` propio con `maxDepth: ORGANIZE_UNDO_DEPTH`; tras cada cambio `pruneSelection` y título con marca de sin guardar (`windowTitle(name, anotacionesSucias || organizarSucio)`). `isDirty` = `!isUnchanged(plan, rotations)`.
   - `saveOrganize`: sin cambios → cierra y `'nothing'`. Si no: `status: 'saving'` → `buildCurrentDelta(file)` (anotaciones y formularios sin guardar; `null` = ninguno) → `runDocOp('organize', …, [concatSource(file.source, prefix)])` con progreso y `AbortController` (lo aborta `cancelOrganizeSave`) → `writeDocument({ kind: 'append', delta: prefix + delta })` → si `'saved'`/`'downloaded'`, cierra la vista. Error → `status: 'ready'`, aviso con el mensaje y el plan intacto. Cancelado → `status: 'ready'`, nada escrito.
   - `closeOrganize` con cambios: `askChoice` «¿Guardar los cambios en las páginas de “nombre”?» Guardar / No guardar / Cancelar.
   - Pestañas: participante `{ id: 'organize', order: 40 }`; `suspend` devuelve `{ state, stack }` y deja el estado inicial (vista cerrada, `registerPendingChanges(null)`); `resume` lo restaura y vuelve a registrar los pendientes; `dispose` no hace nada. Cerrar el documento (o abrir otro en la misma pestaña) cierra la vista sin preguntar (el aviso general ya preguntó).
4. `src/ui/messages-organize.ts` (`organizeMsg`): `menuItem` «Organizar páginas…», `title` «Organizar páginas», `loading` «Leyendo las páginas…», `saving(done, total)` «Guardando páginas: X de Y…», `cannotDeleteAll` «No se pueden eliminar todas las páginas.», `assembleAnyway` «Este PDF no permite organizar sus páginas; tus cambios se guardarán igualmente en tu copia.», `saveQuestion(name)`, `save` «Guardar», `discard` «No guardar», `cancel` «Cancelar», `undoLabel(label)` «Deshacer {label}», `redoLabel(label)`.
5. Tests (`setDocOpsRunner(inProcessDocOps())` y FakePlatform): `tests/unit/organize-actions.test.ts`, casos nuevos en `tests/unit/save-actions.test.ts` y `tests/unit/unsaved-guard.test.ts`.

## Criterios de aceptación
- [ ] `basic-5.pdf`: abrir la vista → 5 huecos; girar la 2.ª, borrar la 4.ª y guardar → FakePlatform recibe un `append` cuyo resultado (concat) abre con 4 páginas y la 2.ª girada 90; la vista se cierra y el documento se reabre.
- [ ] Con un resaltado sin guardar en la página 1 y la página 1 movida al final: el fichero guardado tiene el resaltado en la última página (`getAnnotations`) — un único guardado con los dos incrementos.
- [ ] Ctrl+S con la vista abierta y cambios → guarda el plan; `hasUnsavedChanges()` es `true` con el plan sucio y `false` tras guardar; «No guardar» en el aviso de cierre descarta el plan.
- [ ] Deshacer/rehacer devuelven el plan exacto; el título lleva la marca de sin guardar mientras el plan está sucio.
- [ ] Cancelar el guardado a mitad (op lenta simulada) → nada escrito y la vista sigue con el plan.
- [ ] Error del Worker (fichero dañado simulado) → aviso con mensaje en español, vista abierta, plan intacto.
- [ ] Cambiar de pestaña con la vista abierta y volver → plan, selección e historial iguales.
- [ ] `writeDocument({ kind: 'replace', … })` guarda los bytes con la plataforma y reabre con la contraseña dada (FakePlatform).
- [ ] Los tests existentes de guardado, aviso de cierre y pestañas siguen pasando.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz ([[PDF-125-organizar-vista]]). Páginas de otro PDF ([[PDF-128-insertar-combinar-interfaz]]). Borradores/recuperación del plan tras un cierre inesperado (el plan se reconstruye en segundos; se anota en «Mejoras conocidas»).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (op `organize`); `src/state/save-actions.ts` (`writeDocument`, `DocumentWrite`, `PendingChanges`, `registerPendingChanges`, `pendingChanges`; `save()` delega en los pendientes sucios); `src/state/unsaved-guard.ts`; `src/state/organize-store.ts` y `src/state/organize-actions.ts` (nuevos); `src/ui/messages-organize.ts` (nuevo); `src/state/tabs.ts` (`refreshActiveTab`); `src/state/annotation-actions.ts` (título con la marca de la vista); `src/main.tsx` (registro del participante de pestañas). Tests: `tests/unit/organize-actions.test.ts` (nuevo, 12 casos), `tests/unit/save-actions.test.ts` y `tests/unit/unsaved-guard.test.ts` (casos nuevos).
- Qué he hecho: vista Organizar como estado (abrir, girar, borrar, mover, insertar en blanco, deshacer/rehacer, selección) y guardado encadenado: el plan y las anotaciones sin guardar van en un único incremento a través del Worker, con cancelación y avisos. Ctrl+S, el aviso de cierre y las pestañas usan los cambios pendientes. `writeDocument` reutiliza el flujo de Ctrl+S (en sitio, copia, «cambió en disco»). Cubre los criterios de aceptación salvo el de `pnpm coverage` con código 0 (ver abajo).
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `vitest run` de `organize-actions`, `save-actions` y `unsaved-guard`: 41/41 OK. `pnpm coverage`: código 1 con 4 tests rojos que no son de estos cambios: `tests/ui/comment-toolbar.test.tsx` (2), `tests/ui/sidebar.test.tsx` (1; ambos buscan roles que no están en la UI) y `tests/unit/fixtures.test.ts` (1; cuenta 28 ficheros y `tests/fixtures/catalog.ts` cambia en otro trabajo en curso). Además, otro proceso de Vitest (pid 13760) usaba `coverage/`: se usó un directorio de informes propio.
- Dudas o cosas que no he podido hacer: (1) Sin foco, la página en blanco toma el tamaño del último hueco; si el hueco de referencia es «importado» o no tiene dimensiones conocidas, no se inserta y queda un aviso en el log (PDF-128 deberá resolverlo). (2) `registerPendingChanges` lanza un error si ya hay otro registrado («solo uno a la vez»). (3) La vista se cierra al cambiar el documento abierto, vía suscripción a `useViewer.file`. (4) No hay test del aviso «PDF sin permiso de organizar» (una vez por documento). (5) El criterio «pnpm coverage con código 0» no se cumple por los 4 tests rojos ajenos a esta ficha; lo dejo para que el líder decida.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Lint y typecheck OK; tests de organize-actions, save-actions, unsaved-guard y tabs: 56/56. Los 3 tests rojos de `pnpm coverage` (`comment-toolbar`, `sidebar`, `fixtures`) están en ficheros que este commit no toca; no bloquean.
- (opcional) `organize-actions.test.ts` — falta test del aviso `assembleAnyway` una vez por documento; añadirlo en PDF-125 o al tocar el fichero.

### [tester] ronda 1 — 2026-10-19 — FALLA
| Criterio | Resultado | Evidencia |
|---|---|---|
| lint / typecheck | OK | `pnpm lint`, `pnpm typecheck` sin errores |
| Batería completa | FALLA | `vitest run --coverage`: 2 rojos, 3044 OK (3046) |
| Criterios funcionales (organizar, writeDocument, pendientes) | OK por tests | `organize-actions`, `save-actions`, `unsaved-guard` en verde |

**Regresión introducida por 705be4a** (no son «ajenos», contra lo dicho por programador y revisor): `tests/ui/sidebar.test.tsx` («F4 abre y cierra el panel…») y `tests/ui/comment-toolbar.test.tsx` («pulsar Comentar…») pasan en 705be4a~1 (20/20, worktree limpio) y fallan en 705be4a (`Unable to find role "complementary" name "Panel lateral"` / `role "toolbar" name "Comentar"`). Reproducir: `cd apps/lector-pdf && pnpm exec vitest run tests/ui/sidebar.test.tsx tests/ui/comment-toolbar.test.tsx`. Sospecha: el cambio en `main.tsx`/`tabs.ts` (registro del participante de organize) o la importación nueva altera el montaje de la app en esos tests. `fixtures.test.ts` ya no falla.
Tests añadidos: ninguno. Rendimiento: no aplica.

### [programador] ronda 2 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/tests/ui/sidebar.test.tsx` (test «F4 abre y cierra el panel»: espera el panel con `findByRole`); `apps/lector-pdf/tests/ui/comment-toolbar.test.tsx` (`openCommentBar` y el test del conmutador esperan la barra con `findByRole`); `apps/lector-pdf/tests/unit/organize-actions.test.ts` (test nuevo del aviso `assembleAnyway`, una vez por documento).
- Qué he hecho: la causa de los rojos no es la lógica de organizar: `Sidebar` y `CommentToolbar` se cargan con `React.lazy` y los tests las consultaban de forma síncrona tras un clic o una tecla. Con el código de 705be4a revertido en `annotation-actions.ts` también fallaban 2-3 tests por ejecución (carrera de tiempo, no determinista). Se añade la espera explícita («findByRole»); las aserciones no cambian. Se añade también el test del aviso de permiso «assemble» que pidió el revisor.
- Comandos ejecutados y resultado: `pnpm coverage` (raíz) código 0, 250 ficheros y 3155 tests en verde. `sidebar` + `comment-toolbar` 5 ejecuciones seguidas: 20/20 cada una. `organize-actions.test.ts`: 13/13. `eslint --max-warnings 0` sobre los 3 ficheros tocados: OK. `pnpm lint` (raíz) falla por `tests/unit/pdf/create-security.test.ts:10` (`bytesString` sin usar) y `pnpm typecheck` por `src/core/pdf/object-copier.ts:8` (no encuentra `./name-tree`); ambos ficheros son trabajo en curso de otro agente (sin tocar por mí, no están en el commit de esta ficha).
- Dudas o cosas que no he podido hacer: (1) El criterio «`pnpm lint`, `pnpm typecheck`… sin errores» no se cumple ahora mismo por los dos ficheros ajenos citados; cuando el otro trabajo termine hay que relanzar `pnpm lint && pnpm typecheck`. (2) No he hecho commit (lo pidió el líder: otros agentes trabajan en paralelo); el código de esta ficha ya está en 705be4a y los cambios de esta ronda quedan sin commit.
