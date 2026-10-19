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

/** Respuestas directas de `parentId`, de la más antigua a la más nueva (`created ?? modified`). */
export function repliesOf(all: ReadonlyMap<string, Annotation>, parentId: string): readonly ReplyAnnotation[] {
  const out: ReplyAnnotation[] = [];
  for (const a of all.values()) {
    if (a.type === 'reply' && a.parentId === parentId) out.push(a);
  }
  return out
    .map((a, index) => ({ a, index, t: timeOf(a.created ?? a.modified) }))
    .sort((x, y) => x.t - y.t || x.index - y.index)
    .map((x) => x.a);
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
