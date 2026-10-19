---
tipo: tarea
id: PDF-053
titulo: Organizar - modelo del plan de páginas, selección y deshacer (núcleo)
app: pdf
estado: pendiente
depende_de: [PDF-052]
intentos: 0
skills: [stack-typescript-react, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-053 · Organizar: modelo del plan de páginas, selección y deshacer (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]], [[ADR-0028-reescribir-pdfs]] · Paridad: [[Paridad Adobe Acrobat]] · Siguen: [[PDF-119-organizar-escritura]], [[PDF-124-organizar-estado]]

## Objetivo
Un módulo puro `src/core/organize/plan.ts` con la lista de páginas pendiente de la vista «Organizar páginas» (orden, giro, páginas en blanco e importadas), sus comandos con deshacer y la lógica de selección (clic, Ctrl+clic, Mayús+clic, teclado). Sin interfaz ni escritura.

## Contexto
- [[ADR-0035-organizar-en-la-app]] (puntos 1 y 5).
- `src/core/pdf/page-tree.ts` → `PageRotation`, `PageSlot` (líneas 16-22).
- `packages/shared/src/undo/types.ts` → `Command<D>` (`label`, `apply`, `invert`).
- Patrón de comandos puros: `src/core/annotations/commands.ts`.

## Qué hay que hacer
1. `src/core/organize/plan.ts`:
```ts
import type { Command } from '@suite/shared';
import type { PageRotation } from '../pdf/page-tree';

/** Hueco del documento resultante. `key` es estable (no cambia al mover) y único en el plan. */
export type PlanSlot =
  | { readonly key: string; readonly kind: 'original'; readonly source: number; readonly rotate: PageRotation }
  | { readonly key: string; readonly kind: 'blank'; readonly width: number; readonly height: number; readonly rotate: PageRotation }
  | { readonly key: string; readonly kind: 'imported'; readonly doc: number; readonly source: number; readonly rotate: PageRotation };

export interface OrganizePlan {
  readonly slots: readonly PlanSlot[];
  /** Contador para claves nuevas (`b<n>`, `i<n>`). */
  readonly nextKey: number;
}

/** Lo que recibe el escritor (PDF-119): sin claves. */
export type SaveSlot =
  | { readonly kind: 'original'; readonly source: number; readonly rotate: PageRotation }
  | { readonly kind: 'blank'; readonly width: number; readonly height: number; readonly rotate: PageRotation }
  | { readonly kind: 'imported'; readonly doc: number; readonly source: number; readonly rotate: PageRotation };

export const ORGANIZE_UNDO_DEPTH = 30;

/** Plan inicial: una página original por giro efectivo, claves `o0`, `o1`… */
export function initialPlan(rotations: readonly PageRotation[]): OrganizePlan;
/** `true` si el plan deja el documento igual que `rotations` (mismas originales, mismo orden y giro). */
export function isUnchanged(plan: OrganizePlan, rotations: readonly PageRotation[]): boolean;
export function toSaveSlots(plan: OrganizePlan): readonly SaveSlot[];

/** Gira ±90 los huecos de `keys`. Etiqueta «girar páginas». */
export function rotateCommand(keys: ReadonlySet<string>, delta: 90 | -90): Command<OrganizePlan>;
/** Quita los huecos de `keys`. Si quitaría todos → `RangeError` (la UI lo impide con `canDelete`). Etiqueta «eliminar páginas». */
export function deleteCommand(keys: ReadonlySet<string>): Command<OrganizePlan>;
export function canDelete(plan: OrganizePlan, keys: ReadonlySet<string>): boolean;
/**
 * Mueve los huecos de `keys` (conservando su orden relativo) para que queden delante del hueco que estaba en
 * `toIndex` antes de mover (`toIndex === slots.length` = al final). Etiqueta «mover páginas».
 */
export function moveCommand(keys: ReadonlySet<string>, toIndex: number): Command<OrganizePlan>;
/** Inserta una página en blanco de `width`×`height` pt (giro 0) en la posición `at`. Clave `b<nextKey>`. Etiqueta «insertar página en blanco». */
export function insertBlankCommand(at: number, width: number, height: number): Command<OrganizePlan>;
/** Inserta `rotations.length` páginas del documento importado `doc` (fuentes 0..n-1) en `at`. Claves `i<nextKey>`… Etiqueta «insertar páginas». */
export function insertImportedCommand(at: number, doc: number, rotations: readonly PageRotation[]): Command<OrganizePlan>;

/** Selección de la cuadrícula. `anchor`: origen de Mayús+clic; `focus`: elemento con el foco. */
export interface PlanSelection {
  readonly keys: ReadonlySet<string>;
  readonly anchor: string | null;
  readonly focus: string | null;
}
export const EMPTY_SELECTION: PlanSelection;
export function selectOnly(key: string): PlanSelection;                                        // clic
export function toggleKey(sel: PlanSelection, key: string): PlanSelection;                     // Ctrl/Cmd+clic, Espacio
export function extendTo(plan: OrganizePlan, sel: PlanSelection, key: string): PlanSelection;  // Mayús+clic: rango anchor..key (anchor no cambia)
export function selectAll(plan: OrganizePlan): PlanSelection;                                  // focus = el actual o el primero
/** Quita de la selección las claves que ya no están en el plan (tras deshacer o borrar). */
export function pruneSelection(plan: OrganizePlan, sel: PlanSelection): PlanSelection;
/** Índice del hueco con clave `key`, o -1. */
export function indexOfKey(plan: OrganizePlan, key: string): number;
```
2. Reglas:
   - Giro: `(rotate + delta + 360) % 360`.
   - Todos los comandos son puros (nunca mutan el plan) y `invert(before)` devuelve un comando que restaura `before` tal cual (misma etiqueta). Así deshacer devuelve exactamente el plan anterior.
   - `moveCommand` con `toIndex` dentro del bloque seleccionado o fuera de `[0, slots.length]`: fuera de rango → `RangeError`; dentro del bloque → mueve igualmente (los no seleccionados conservan su orden).
   - `insertBlankCommand`: `width` y `height` finitos en `[1, 14400]` (si no, `RangeError`).
3. `src/core/organize/index.ts` que reexporta lo público.
4. Tests `tests/unit/organize/plan.test.ts`.

## Criterios de aceptación
- [ ] `initialPlan([0, 90, 0])` → 3 huecos `original` con claves `o0..o2` y giros dados; `isUnchanged` → `true`; tras `rotateCommand({o1}, -90)` → `false`; tras deshacerlo (`invert` aplicado) → `true` y el plan es `toEqual` al inicial.
- [ ] `moveCommand({o0, o2}, 5)` sobre 5 páginas → orden de fuentes `[1, 3, 4, 0, 2]`; `moveCommand({o3}, 0)` → `[3, 0, 1, 2, 4]`; `toIndex = -1` y `6` → `RangeError`.
- [ ] `deleteCommand({o1})` → 4 huecos; `canDelete(plan, todas)` → `false` y `deleteCommand(todas)` lanza `RangeError`.
- [ ] `insertBlankCommand(2, 595, 842)` → hueco `blank` con clave `b<n>` en la posición 2 y `nextKey` incrementado; `toSaveSlots` lo da sin clave.
- [ ] `insertImportedCommand(1, 0, [0, 90])` → dos huecos `imported` con `doc: 0`, `source` 0 y 1, giros dados.
- [ ] Selección: `selectOnly('o2')` → `anchor = focus = 'o2'`; `extendTo(plan, sel, 'o4')` → `{o2, o3, o4}`; `toggleKey` quita y pone; `pruneSelection` quita claves borradas y deja `focus` en `null` si su clave ya no existe.
- [ ] Rendimiento (en el test, sin medir tiempos): 100 000 huecos, `moveCommand` de 1 000 claves y `rotateCommand` de 50 000 claves terminan (el test no supera el *timeout* por defecto de Vitest).
- [ ] Cobertura de `src/core/organize/plan.ts` ≥ 95 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Escritura del PDF ([[PDF-119-organizar-escritura]]), estado de la app y Worker ([[PDF-124-organizar-estado]]), interfaz ([[PDF-125-organizar-vista]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `boveda/Apps/Lector PDF/Tareas/PDF-053-organizar-paginas.md` (solo estado y fecha).
- Qué he hecho: no he implementado nada. La ficha está marcada como «por detallar»: no define firmas, ficheros, pasos ni criterios concretos, y el propio texto dice que no hay que empezar hasta que el líder la complete. Tampoco hay decisiones de diseño tomadas (p. ej., formato de los cambios de orden de página, cómo se guarda el giro, si el borrado va en el mismo comando de deshacer).
- Comandos ejecutados y resultado: ninguno (no hay código que verificar).
- Dudas o cosas que no he podido hacer: falta que el líder detalle la ficha (firmas, ficheros, pasos, criterios de aceptación y «Fuera de alcance») y confirme si requiere ADR. Dependencia PDF-052 (`boveda/Apps/Lector PDF/Tareas/PDF-052-organizar-adr.md`): no he revisado su estado. Ficha pasada a `bloqueada`.

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0035-organizar-en-la-app]]. La función «girar, borrar y reordenar» se parte: este núcleo (PDF-053), escritura ([[PDF-119-organizar-escritura]]), Worker ([[PDF-118-worker-operaciones]]), estado ([[PDF-124-organizar-estado]]), vista ([[PDF-125-organizar-vista]]) y arrastrar + e2e ([[PDF-126-organizar-arrastrar-e2e]]). El criterio original (reordenar `pages-5000.pdf`, índice y enlaces correctos) pasa a PDF-126. `estado: pendiente`, `intentos: 0`.
