/**
 * Plan de páginas de la vista «Organizar páginas» (PDF-053, ADR-0035). Lista inmutable de huecos
 * (`original | blank | imported`) con su giro absoluto, comandos puros con deshacer y selección de la cuadrícula.
 * No escribe PDF ni tiene interfaz: lo consumen PDF-119 (escritura) y PDF-124/PDF-125 (estado e interfaz).
 */
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

/** Tamaño máximo de una página en blanco, en puntos (PDF, 200 pulgadas). */
const MAX_BLANK_SIZE_PT = 14400;

/** Plan inicial: una página original por giro efectivo, claves `o0`, `o1`… */
export function initialPlan(rotations: readonly PageRotation[]): OrganizePlan {
  return {
    slots: rotations.map((rotate, i): PlanSlot => ({ key: `o${i}`, kind: 'original', source: i, rotate })),
    nextKey: 0,
  };
}

/** `true` si el plan deja el documento igual que `rotations` (mismas originales, mismo orden y giro). */
export function isUnchanged(plan: OrganizePlan, rotations: readonly PageRotation[]): boolean {
  return (
    plan.slots.length === rotations.length &&
    plan.slots.every((s, i) => s.kind === 'original' && s.source === i && s.rotate === rotations[i])
  );
}

export function toSaveSlots(plan: OrganizePlan): readonly SaveSlot[] {
  return plan.slots.map((s): SaveSlot => {
    switch (s.kind) {
      case 'original':
        return { kind: 'original', source: s.source, rotate: s.rotate };
      case 'blank':
        return { kind: 'blank', width: s.width, height: s.height, rotate: s.rotate };
      case 'imported':
        return { kind: 'imported', doc: s.doc, source: s.source, rotate: s.rotate };
    }
  });
}

function turn(rotate: PageRotation, delta: 90 | -90): PageRotation {
  return ((rotate + delta + 360) % 360) as PageRotation;
}

/** Comando que restaura `before` tal cual (misma etiqueta). Su `invert` restaura el plan que recibe. */
function restore(label: string, before: OrganizePlan): Command<OrganizePlan> {
  return {
    label,
    apply: () => before,
    invert: (current) => restore(label, current),
  };
}

/** Comando genérico: `fn` calcula el plan nuevo; deshacer restaura el plan anterior exacto. */
function transform(label: string, fn: (plan: OrganizePlan) => OrganizePlan): Command<OrganizePlan> {
  return {
    label,
    apply: fn,
    invert: (before) => restore(label, before),
  };
}

function checkPosition(plan: OrganizePlan, at: number): void {
  if (!Number.isInteger(at) || at < 0 || at > plan.slots.length) {
    throw new RangeError(`Posición fuera de rango: ${String(at)}`);
  }
}

function insertSlots(plan: OrganizePlan, at: number, added: readonly PlanSlot[], nextKey: number): OrganizePlan {
  return {
    slots: [...plan.slots.slice(0, at), ...added, ...plan.slots.slice(at)],
    nextKey,
  };
}

function isBlankSize(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= MAX_BLANK_SIZE_PT;
}

/** Gira ±90 los huecos de `keys`. Etiqueta «girar páginas». */
export function rotateCommand(keys: ReadonlySet<string>, delta: 90 | -90): Command<OrganizePlan> {
  return transform('girar páginas', (plan) => ({
    ...plan,
    slots: plan.slots.map((s) => (keys.has(s.key) ? { ...s, rotate: turn(s.rotate, delta) } : s)),
  }));
}

export function canDelete(plan: OrganizePlan, keys: ReadonlySet<string>): boolean {
  return plan.slots.some((s) => !keys.has(s.key));
}

/** Quita los huecos de `keys`. Si quitaría todos → `RangeError` (la UI lo impide con `canDelete`). Etiqueta «eliminar páginas». */
export function deleteCommand(keys: ReadonlySet<string>): Command<OrganizePlan> {
  return transform('eliminar páginas', (plan) => {
    if (!canDelete(plan, keys)) throw new RangeError('No se pueden eliminar todas las páginas');
    return { ...plan, slots: plan.slots.filter((s) => !keys.has(s.key)) };
  });
}

/**
 * Mueve los huecos de `keys` (conservando su orden relativo) para que queden delante del hueco que estaba en
 * `toIndex` antes de mover (`toIndex === slots.length` = al final). Etiqueta «mover páginas».
 */
export function moveCommand(keys: ReadonlySet<string>, toIndex: number): Command<OrganizePlan> {
  return transform('mover páginas', (plan) => {
    checkPosition(plan, toIndex);
    const moved: PlanSlot[] = [];
    const rest: PlanSlot[] = [];
    let insertAt = 0;
    plan.slots.forEach((s, i) => {
      if (keys.has(s.key)) {
        moved.push(s);
      } else {
        if (i < toIndex) insertAt++;
        rest.push(s);
      }
    });
    return { ...plan, slots: [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)] };
  });
}

/** Inserta una página en blanco de `width`×`height` pt (giro 0) en la posición `at`. Clave `b<nextKey>`. Etiqueta «insertar página en blanco». */
export function insertBlankCommand(at: number, width: number, height: number): Command<OrganizePlan> {
  if (!isBlankSize(width) || !isBlankSize(height)) {
    throw new RangeError(`Tamaño de página en blanco no válido: ${String(width)}×${String(height)}`);
  }
  return transform('insertar página en blanco', (plan) => {
    checkPosition(plan, at);
    const blank: PlanSlot = { key: `b${plan.nextKey}`, kind: 'blank', width, height, rotate: 0 };
    return insertSlots(plan, at, [blank], plan.nextKey + 1);
  });
}

/** Inserta `rotations.length` páginas del documento importado `doc` (fuentes 0..n-1) en `at`. Claves `i<nextKey>`… Etiqueta «insertar páginas». */
export function insertImportedCommand(at: number, doc: number, rotations: readonly PageRotation[]): Command<OrganizePlan> {
  return transform('insertar páginas', (plan) => {
    checkPosition(plan, at);
    const added = rotations.map(
      (rotate, i): PlanSlot => ({ key: `i${plan.nextKey + i}`, kind: 'imported', doc, source: i, rotate }),
    );
    return insertSlots(plan, at, added, plan.nextKey + rotations.length);
  });
}

/** Selección de la cuadrícula. `anchor`: origen de Mayús+clic; `focus`: elemento con el foco. */
export interface PlanSelection {
  readonly keys: ReadonlySet<string>;
  readonly anchor: string | null;
  readonly focus: string | null;
}

export const EMPTY_SELECTION: PlanSelection = { keys: new Set<string>(), anchor: null, focus: null };

/** Índice del hueco con clave `key`, o -1. */
export function indexOfKey(plan: OrganizePlan, key: string): number {
  return plan.slots.findIndex((s) => s.key === key);
}

export function selectOnly(key: string): PlanSelection {
  return { keys: new Set([key]), anchor: key, focus: key };
}

/** Ctrl/Cmd+clic, Espacio: alterna `key` y la convierte en origen y foco. */
export function toggleKey(sel: PlanSelection, key: string): PlanSelection {
  const keys = new Set(sel.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key, focus: key };
}

/** Mayús+clic: selecciona el rango anchor..key (sustituye la selección; `anchor` no cambia). */
export function extendTo(plan: OrganizePlan, sel: PlanSelection, key: string): PlanSelection {
  const to = indexOfKey(plan, key);
  if (to < 0) throw new RangeError(`Clave de página desconocida: ${key}`);
  const from = sel.anchor === null ? -1 : indexOfKey(plan, sel.anchor);
  if (sel.anchor === null || from < 0) return selectOnly(key);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const keys = new Set<string>();
  for (let i = lo; i <= hi; i++) {
    const slot = plan.slots[i];
    if (slot) keys.add(slot.key);
  }
  return { keys, anchor: sel.anchor, focus: key };
}

/** Selecciona todos los huecos; origen y foco en el primero (o `null` si el plan está vacío). */
export function selectAll(plan: OrganizePlan): PlanSelection {
  const first = plan.slots[0]?.key ?? null;
  return { keys: new Set(plan.slots.map((s) => s.key)), anchor: first, focus: first };
}

/** Quita de la selección las claves que ya no están en el plan (tras deshacer o borrar). */
export function pruneSelection(plan: OrganizePlan, sel: PlanSelection): PlanSelection {
  const present = new Set(plan.slots.map((s) => s.key));
  const alive = (key: string | null): string | null => (key !== null && present.has(key) ? key : null);
  return {
    keys: new Set([...sel.keys].filter((k) => present.has(k))),
    anchor: alive(sel.anchor),
    focus: alive(sel.focus),
  };
}
