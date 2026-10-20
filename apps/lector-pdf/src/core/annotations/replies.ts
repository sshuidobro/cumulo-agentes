/**
 * Respuestas y estados de revisión de los comentarios (PDF-058, ADR-0030). Son anotaciones del modelo
 * que no se dibujan en la página: viven en el panel de comentarios y se escriben como `/Text` con `/IRT`.
 */

import type { Annotation, ReplyAnnotation, ReviewState, ReviewStateAnnotation, RectPt } from './model';

/** Estados en el orden en que los muestra el menú. */
export const REVIEW_STATES: readonly ReviewState[] = ['Accepted', 'Rejected', 'Cancelled', 'Completed', 'None'];

export const REVIEW_STATE_LABELS: Readonly<Record<ReviewState, string>> = {
  Accepted: 'Aceptado',
  Rejected: 'Rechazado',
  Cancelled: 'Cancelado',
  Completed: 'Completado',
  None: 'Ninguno',
};

export function isReviewState(v: unknown): v is ReviewState {
  return typeof v === 'string' && (REVIEW_STATES as readonly string[]).includes(v);
}

/** Lado de la caja de la respuesta o del estado, en puntos (mismo tamaño que el icono de nota). */
const REPLY_SIZE = 20;

/** `reply` y `review` no se dibujan ni tienen zona en la página: solo aparecen en el panel. */
export function isDrawable(a: Annotation): boolean {
  return a.type !== 'reply' && a.type !== 'review';
}

/** Caja de 20×20 en la esquina superior izquierda de `parent.rect`. */
export function replyRect(parent: Annotation): RectPt {
  const [x1, , , y2] = parent.rect;
  return [x1, y2 - REPLY_SIZE, x1 + REPLY_SIZE, y2];
}

export function newReply(i: {
  id: string;
  parent: Annotation;
  contents: string;
  author: string;
  now: string;
}): ReplyAnnotation {
  return {
    type: 'reply',
    id: i.id,
    parentId: i.parent.id,
    pageIndex: i.parent.pageIndex,
    rect: replyRect(i.parent),
    color: i.parent.color,
    opacity: 1,
    contents: i.contents,
    author: i.author,
    modified: i.now,
    created: i.now,
    origin: { kind: 'new' },
  };
}

export function newReviewState(i: {
  id: string;
  parent: Annotation;
  state: ReviewState;
  author: string;
  now: string;
}): ReviewStateAnnotation {
  return {
    type: 'review',
    id: i.id,
    parentId: i.parent.id,
    state: i.state,
    pageIndex: i.parent.pageIndex,
    rect: replyRect(i.parent),
    color: i.parent.color,
    opacity: 1,
    contents: '',
    author: i.author,
    modified: i.now,
    created: i.now,
    origin: { kind: 'new' },
  };
}

function timeOf(iso: string): number {
  return Date.parse(iso);
}

/** Ordena respuestas de la más antigua a la más nueva (`created ?? modified`); a igualdad, el orden de entrada. */
function sortByCreated(list: readonly ReplyAnnotation[]): ReplyAnnotation[] {
  return list
    .map((a, index) => ({ a, index, t: timeOf(a.created ?? a.modified) }))
    .sort((x, y) => x.t - y.t || x.index - y.index)
    .map((x) => x.a);
}

/** Respuestas directas de `parentId`, de la más antigua a la más nueva (`created ?? modified`). */
export function repliesOf(all: ReadonlyMap<string, Annotation>, parentId: string): readonly ReplyAnnotation[] {
  const out: ReplyAnnotation[] = [];
  for (const a of all.values()) {
    if (a.type === 'reply' && a.parentId === parentId) out.push(a);
  }
  return sortByCreated(out);
}

/**
 * Respuestas y estados de todos los padres en un solo recorrido: el panel de comentarios lo necesita para muchas filas
 * (con `repliesOf` y `reviewStateOf` por cada una sería cuadrático). Mismas reglas que esas dos funciones.
 */
export interface ReplyIndex {
  /** Respuestas directas por id de padre, en el orden de `repliesOf`. */
  readonly replies: ReadonlyMap<string, readonly ReplyAnnotation[]>;
  /** Estado vigente por id de padre (el de `reviewStateOf`, sin `None`). */
  readonly states: ReadonlyMap<string, ReviewState>;
}

export function indexReplies(all: ReadonlyMap<string, Annotation>): ReplyIndex {
  const byParent = new Map<string, ReplyAnnotation[]>();
  const latest = new Map<string, ReviewStateAnnotation>();
  for (const a of all.values()) {
    if (a.type === 'reply') {
      const list = byParent.get(a.parentId);
      if (list === undefined) byParent.set(a.parentId, [a]);
      else list.push(a);
    } else if (a.type === 'review') {
      const current = latest.get(a.parentId);
      if (current === undefined || timeOf(a.modified) > timeOf(current.modified)) latest.set(a.parentId, a);
    }
  }
  const replies = new Map<string, readonly ReplyAnnotation[]>();
  for (const [parentId, list] of byParent) replies.set(parentId, sortByCreated(list));
  const states = new Map<string, ReviewState>();
  for (const [parentId, a] of latest) {
    if (a.state !== 'None') states.set(parentId, a.state);
  }
  return { replies, states };
}

/** Estado vigente: el `review` con `modified` más reciente; `null` si no hay ninguno o es 'None'. */
export function reviewStateOf(
  all: ReadonlyMap<string, Annotation>,
  parentId: string,
): ReviewStateAnnotation | null {
  let latest: ReviewStateAnnotation | null = null;
  for (const a of all.values()) {
    if (a.type !== 'review' || a.parentId !== parentId) continue;
    if (latest === null || timeOf(a.modified) > timeOf(latest.modified)) latest = a;
  }
  if (latest === null || latest.state === 'None') return null;
  return latest;
}

/**
 * Comentario raíz del hilo al que pertenece `id`: la propia anotación si no es respuesta; si lo es, sube por `parentId`
 * hasta el primer no-respuesta (la ventana de comentario muestra todo el hilo).
 */
export function threadRootId(all: ReadonlyMap<string, Annotation>, id: string): string {
  let current = id;
  const seen = new Set<string>();
  let a = all.get(current);
  while (a?.type === 'reply' && !seen.has(current)) {
    seen.add(current);
    current = a.parentId;
    a = all.get(current);
  }
  return current;
}

/** Ids que dependen de `id` (respuestas y estados, recursivo: respuestas de respuestas). Sin `id`. */
export function dependentIds(all: ReadonlyMap<string, Annotation>, id: string): readonly string[] {
  const found: string[] = [];
  const seen = new Set<string>([id]);
  const queue: string[] = [id];
  for (let head = 0; head < queue.length; head++) {
    const parent = queue[head];
    if (parent === undefined) continue;
    for (const a of all.values()) {
      if (a.type !== 'reply' && a.type !== 'review') continue;
      if (a.parentId !== parent || seen.has(a.id)) continue;
      seen.add(a.id);
      found.push(a.id);
      queue.push(a.id);
    }
  }
  return found;
}
