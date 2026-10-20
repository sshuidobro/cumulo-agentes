import { describe, expect, it } from 'vitest';
import {
  annotationsOfPage,
  dependentIds,
  isAnnotation,
  isDrawable,
  newReply,
  newReviewState,
  repliesOf,
  replyRect,
  REVIEW_STATE_LABELS,
  REVIEW_STATES,
  reviewStateOf,
  translateAnnotation,
  type Annotation,
  type ReviewState,
} from '../../../src/core/annotations';
import { newAnnotation } from './factories';

const NOW = '2026-10-19T10:00:00.000Z';
const LATER = '2026-10-19T11:00:00.000Z';
const LATEST = '2026-10-19T12:00:00.000Z';

function byId(list: readonly Annotation[]): Map<string, Annotation> {
  return new Map(list.map((a) => [a.id, a] as const));
}

function note(id = 'suite-nota'): Annotation {
  return { ...newAnnotation(id, 'note', 0), rect: [100, 600, 120, 620] };
}

describe('etiquetas de estado', () => {
  it('REVIEW_STATES en el orden del menú y con etiqueta en español para cada uno', () => {
    expect(REVIEW_STATES).toEqual(['Accepted', 'Rejected', 'Cancelled', 'Completed', 'None']);
    expect(REVIEW_STATES.map((s) => REVIEW_STATE_LABELS[s])).toEqual([
      'Aceptado',
      'Rechazado',
      'Cancelado',
      'Completado',
      'Ninguno',
    ]);
  });
});

describe('isDrawable y zona de respuestas', () => {
  it('respuestas y estados no son dibujables; el resto sí', () => {
    const parent = note();
    const reply = newReply({ id: 'suite-r', parent, contents: 'Sí', author: 'Ana', now: NOW });
    const review = newReviewState({ id: 'suite-s', parent, state: 'Accepted', author: 'Ana', now: NOW });
    expect(isDrawable(reply)).toBe(false);
    expect(isDrawable(review)).toBe(false);
    expect(isDrawable(parent)).toBe(true);
  });

  it('replyRect es una caja de 20×20 en la esquina superior izquierda del padre', () => {
    expect(replyRect(note())).toEqual([100, 600, 120, 620]);
    const wide = { ...note(), rect: [50, 100, 300, 400] as const };
    expect(replyRect(wide)).toEqual([50, 380, 70, 400]);
  });

  it('translateAnnotation mueve la caja de una respuesta y conserva el resto', () => {
    const reply = newReply({ id: 'suite-r', parent: note(), contents: 'x', author: 'Ana', now: NOW });
    const moved = translateAnnotation(reply, 10, -5);
    expect(moved).toEqual({ ...reply, rect: [110, 595, 130, 615] });
  });
});

describe('creación', () => {
  it('newReply hereda página, color y caja del padre, con opacidad 1 y origen nuevo', () => {
    const parent = note();
    const reply = newReply({ id: 'suite-r', parent, contents: 'Hecho', author: 'Ana', now: NOW });
    expect(reply).toEqual({
      type: 'reply',
      id: 'suite-r',
      parentId: 'suite-nota',
      pageIndex: 0,
      rect: replyRect(parent),
      color: parent.color,
      opacity: 1,
      contents: 'Hecho',
      author: 'Ana',
      modified: NOW,
      created: NOW,
      origin: { kind: 'new' },
    });
    expect(isAnnotation(reply)).toBe(true);
  });

  it('newReviewState guarda el estado y el padre', () => {
    const review = newReviewState({ id: 'suite-s', parent: note(), state: 'Rejected', author: 'Luis', now: NOW });
    expect(review).toMatchObject({ type: 'review', parentId: 'suite-nota', state: 'Rejected', author: 'Luis' });
    expect(isAnnotation(review)).toBe(true);
  });
});

describe('repliesOf', () => {
  it('devuelve solo las respuestas directas del padre, de la más antigua a la más nueva', () => {
    const parent = note();
    const late = newReply({ id: 'suite-late', parent, contents: 'b', author: 'Ana', now: LATER });
    const early = newReply({ id: 'suite-early', parent, contents: 'a', author: 'Ana', now: NOW });
    const review = newReviewState({ id: 'suite-s', parent, state: 'Accepted', author: 'Ana', now: NOW });
    const nested = newReply({ id: 'suite-nested', parent: late, contents: 'c', author: 'Ana', now: LATEST });
    const all = byId([parent, late, early, review, nested]);
    expect(repliesOf(all, 'suite-nota').map((r) => r.id)).toEqual(['suite-early', 'suite-late']);
    expect(repliesOf(all, 'suite-late').map((r) => r.id)).toEqual(['suite-nested']);
    expect(repliesOf(all, 'suite-sin-padre')).toEqual([]);
  });

  it('usa `created` si existe y, si no, `modified`', () => {
    const parent = note();
    const reply = newReply({ id: 'suite-r', parent, contents: 'x', author: 'Ana', now: LATER });
    const fromFile = { ...reply, id: 'suite-f', created: NOW, modified: LATEST };
    const withoutCreated = { ...reply, id: 'suite-w', created: null, modified: LATEST };
    const all = byId([parent, reply, fromFile, withoutCreated]);
    expect(repliesOf(all, 'suite-nota').map((r) => r.id)).toEqual(['suite-f', 'suite-r', 'suite-w']);
  });
});

describe('reviewStateOf', () => {
  it('es el estado con la `modified` más reciente, sea del autor que sea', () => {
    const parent = note();
    const older = newReviewState({ id: 'suite-s1', parent, state: 'Rejected', author: 'Ana', now: NOW });
    const newer = newReviewState({ id: 'suite-s2', parent, state: 'Accepted', author: 'Luis', now: LATER });
    expect(reviewStateOf(byId([parent, newer, older]), 'suite-nota')?.id).toBe('suite-s2');
  });

  it('devuelve null sin estados o si el vigente es None', () => {
    const parent = note();
    expect(reviewStateOf(byId([parent]), 'suite-nota')).toBeNull();
    const reset = newReviewState({ id: 'suite-s', parent, state: 'None', author: 'Ana', now: LATEST });
    const old = newReviewState({ id: 'suite-o', parent, state: 'Accepted', author: 'Ana', now: NOW });
    expect(reviewStateOf(byId([parent, old, reset]), 'suite-nota')).toBeNull();
  });

  it('ignora los estados de otros padres', () => {
    const parent = note();
    const other = note('suite-otra');
    const s = newReviewState({ id: 'suite-s', parent: other, state: 'Accepted', author: 'Ana', now: NOW });
    expect(reviewStateOf(byId([parent, other, s]), 'suite-nota')).toBeNull();
  });
});

describe('dependentIds', () => {
  it('incluye respuestas, respuestas de respuestas y estados, sin el propio id', () => {
    const parent = note();
    const reply = newReply({ id: 'suite-r1', parent, contents: 'a', author: 'Ana', now: NOW });
    const nested = newReply({ id: 'suite-r2', parent: reply, contents: 'b', author: 'Ana', now: LATER });
    const state = newReviewState({ id: 'suite-s', parent, state: 'Accepted', author: 'Ana', now: NOW });
    const unrelated = note('suite-otra');
    const all = byId([parent, reply, nested, state, unrelated]);
    expect([...dependentIds(all, 'suite-nota')].sort()).toEqual(['suite-r1', 'suite-r2', 'suite-s']);
    expect(dependentIds(all, 'suite-r2')).toEqual([]);
  });

  it('termina aunque los datos tengan un ciclo', () => {
    const parent = note();
    const a = newReply({ id: 'suite-a', parent, contents: '', author: 'Ana', now: NOW });
    const b = { ...newReply({ id: 'suite-b', parent: a, contents: '', author: 'Ana', now: NOW }), parentId: 'suite-a' };
    const cyclic = { ...a, parentId: 'suite-b' };
    const all = byId([parent, cyclic, b]);
    expect([...dependentIds(all, 'suite-a')].sort()).toEqual(['suite-b']);
  });
});

describe('annotationsOfPage con respuestas y estados', () => {
  it('no devuelve respuestas ni estados aunque estén en la página', () => {
    const parent = note();
    const reply = newReply({ id: 'suite-r', parent, contents: 'x', author: 'Ana', now: NOW });
    const state = newReviewState({ id: 'suite-s', parent, state: 'Accepted', author: 'Ana', now: NOW });
    const page = annotationsOfPage(byId([parent, reply, state]), 0);
    expect(page.map((a) => a.id)).toEqual(['suite-nota']);
  });
});

describe('validación de datos externos', () => {
  it('rechaza respuestas sin padre y estados con un estado desconocido', () => {
    const parent = note();
    const reply = newReply({ id: 'suite-r', parent, contents: 'x', author: 'Ana', now: NOW });
    expect(isAnnotation({ ...reply, parentId: '' })).toBe(false);
    expect(isAnnotation({ ...reply, parentId: 7 })).toBe(false);
    const state = newReviewState({ id: 'suite-s', parent, state: 'Accepted', author: 'Ana', now: NOW });
    expect(isAnnotation({ ...state, state: 'Maybe' as ReviewState })).toBe(false);
    for (const s of REVIEW_STATES) expect(isAnnotation({ ...state, state: s })).toBe(true);
  });
});
