import { describe, expect, it } from 'vitest';
import { draftSavedAt, fromDraft, toDraft } from '../../../src/core/annotations/draft';
import { EMPTY_EDITS, type Annotation, type AnnotationEdits } from '../../../src/core/annotations/model';
import type { FieldValue } from '../../../src/core/forms/model';
import { fileAnnotation, newAnnotation, T0 } from './factories';

const SAVED_AT = '2026-10-17T12:00:00.000Z';

function editsOf(upserts: readonly Annotation[], removed: readonly string[] = []): AnnotationEdits {
  return {
    upserts: new Map(upserts.map((a) => [a.id, a] as const)),
    removed: new Set(removed),
    fields: new Map(),
  };
}

/** Borrador válido con una anotación, para manipularlo en cada prueba. */
function validDraft(): Record<string, unknown> {
  return { ...toDraft(editsOf([newAnnotation('suite-1', 'note')]), 'a.pdf', SAVED_AT) };
}

describe('borrador de anotaciones: toDraft y fromDraft', () => {
  it('fromDraft(toDraft(cambios)) reconstruye los mismos cambios', () => {
    const edits = editsOf(
      [newAnnotation('suite-hl', 'highlight'), newAnnotation('suite-ink', 'ink'), fileAnnotation(7, 'underline')],
      ['ref:9R', 'ref:12R'],
    );

    const draft = toDraft(edits, 'a.pdf', SAVED_AT);
    const back = fromDraft(JSON.parse(JSON.stringify(draft)) as unknown);

    expect(back).toEqual(edits);
    expect(draft).toMatchObject({ version: 2, fileName: 'a.pdf', savedAt: SAVED_AT });
  });

  it('un borrador vacío se reconstruye vacío', () => {
    const back = fromDraft(toDraft(EMPTY_EDITS, 'a.pdf', SAVED_AT));
    expect(back).not.toBeNull();
    expect(back?.upserts.size).toBe(0);
    expect(back?.removed.size).toBe(0);
  });

  it('una anotación con color inválido invalida el borrador entero', () => {
    const draft = validDraft();
    const upserts = draft.upserts as Record<string, unknown>[];
    upserts[0] = { ...upserts[0], color: [2, 0, 0] };
    expect(fromDraft(draft)).toBeNull();
  });

  it('rechaza una versión distinta, una forma incorrecta o un valor que no es objeto', () => {
    expect(fromDraft({ ...validDraft(), version: 3 })).toBeNull();
    expect(fromDraft({ ...validDraft(), fileName: 42 })).toBeNull();
    expect(fromDraft({ ...validDraft(), upserts: 'no' })).toBeNull();
    expect(fromDraft({ ...validDraft(), removed: [1] })).toBeNull();
    expect(fromDraft(null)).toBeNull();
    expect(fromDraft('borrador')).toBeNull();
    expect(fromDraft(undefined)).toBeNull();
  });

  it('rechaza ids repetidos en las anotaciones o en los borrados', () => {
    const note = newAnnotation('suite-1', 'note');
    expect(fromDraft({ ...validDraft(), upserts: [note, note] })).toBeNull();
    expect(fromDraft({ ...validDraft(), removed: ['ref:1R', 'ref:1R'] })).toBeNull();
  });

  it('una fecha de guardado que no es ISO válida invalida el borrador', () => {
    expect(fromDraft({ ...validDraft(), savedAt: 'ayer' })).toBeNull();
  });
});

describe('borrador de anotaciones: valores de formulario (versión 2)', () => {
  const FIELDS: readonly (readonly [string, FieldValue])[] = [
    ['nombre', { kind: 'text', text: 'Luis' }],
    ['acepto', { kind: 'checkbox', checked: true }],
    ['color', { kind: 'radio', selected: 'Azul' }],
    ['idiomas', { kind: 'choice', selected: ['Español', 'Inglés'] }],
  ];

  function withFields(entries: readonly (readonly [string, FieldValue])[]): AnnotationEdits {
    return { ...EMPTY_EDITS, fields: new Map(entries) };
  }

  it('ida y vuelta con tres o más campos de tipos distintos es idéntica', () => {
    const edits = withFields(FIELDS);
    const draft = toDraft(edits, 'a.pdf', SAVED_AT);
    expect(draft.version).toBe(2);
    const back = fromDraft(JSON.parse(JSON.stringify(draft)) as unknown);
    expect(back).toEqual(edits);
    expect([...(back?.fields ?? [])]).toEqual(FIELDS);
  });

  it('un borrador v1 (sin fields) se reconstruye con fields vacío', () => {
    const v1: Record<string, unknown> = { ...toDraft(editsOf([newAnnotation('suite-1', 'note')]), 'a.pdf', SAVED_AT), version: 1 };
    delete v1.fields;
    const back = fromDraft(v1);
    expect(back).not.toBeNull();
    expect(back?.fields.size).toBe(0);
    expect(back?.upserts.size).toBe(1);
  });

  it('un borrador v2 sin la lista fields no es válido', () => {
    const v2: Record<string, unknown> = { ...toDraft(EMPTY_EDITS, 'a.pdf', SAVED_AT) };
    delete v2.fields;
    expect(fromDraft(v2)).toBeNull();
  });

  it('un valor de campo inválido invalida el borrador entero', () => {
    const draft = toDraft(withFields(FIELDS), 'a.pdf', SAVED_AT);
    const broken = { ...draft, fields: [['nombre', { kind: 'checkbox', checked: 'sí' }]] };
    expect(fromDraft(broken)).toBeNull();
    expect(fromDraft({ ...draft, fields: [['nombre', { kind: 'text' }]] })).toBeNull();
    expect(fromDraft({ ...draft, fields: [['nombre', 'Luis']] })).toBeNull();
  });

  it('nombres de campo repetidos o pares mal formados invalidan el borrador', () => {
    const draft = toDraft(EMPTY_EDITS, 'a.pdf', SAVED_AT);
    const text: FieldValue = { kind: 'text', text: 'Luis' };
    expect(fromDraft({ ...draft, fields: [['nombre', text], ['nombre', text]] })).toBeNull();
    expect(fromDraft({ ...draft, fields: [['nombre']] })).toBeNull();
    expect(fromDraft({ ...draft, fields: 'no' })).toBeNull();
  });
});

describe('draftSavedAt', () => {
  it('devuelve la fecha si es válida y null en otro caso', () => {
    expect(draftSavedAt(toDraft(EMPTY_EDITS, 'a.pdf', T0))).toBe(T0);
    expect(draftSavedAt({ savedAt: 'no es fecha' })).toBeNull();
    expect(draftSavedAt({ savedAt: 5 })).toBeNull();
    expect(draftSavedAt(undefined)).toBeNull();
  });
});
