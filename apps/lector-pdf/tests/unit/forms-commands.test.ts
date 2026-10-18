import { UndoStack } from '@suite/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_EDITS, addAnnotationCommand, type AnnotationEdits } from '../../src/core/annotations';
import { setFieldCommand, type FieldValue } from '../../src/core/forms';
import { newAnnotation } from './annotations/factories';

const LUIS: FieldValue = { kind: 'text', text: 'Luis' };
const ANA: FieldValue = { kind: 'text', text: 'Ana' };

function withField(name: string, value: FieldValue): AnnotationEdits {
  return { ...EMPTY_EDITS, fields: new Map([[name, value]]) };
}

describe('setFieldCommand', () => {
  it('usa la etiqueta «rellenar» con el nombre del campo', () => {
    expect(setFieldCommand('nombre', LUIS, 'Nombre').label).toBe('rellenar «Nombre»');
  });

  it('fija el valor sin tocar el documento original', () => {
    const doc = setFieldCommand('nombre', LUIS, 'Nombre').apply(EMPTY_EDITS);
    expect(doc.fields.get('nombre')).toEqual(LUIS);
    expect(EMPTY_EDITS.fields.size).toBe(0);
  });

  it('con valor undefined borra la clave (vuelve al valor del fichero)', () => {
    const doc = setFieldCommand('nombre', undefined, 'Nombre').apply(withField('nombre', LUIS));
    expect(doc.fields.has('nombre')).toBe(false);
  });

  it('conserva upserts y removed', () => {
    const add = newAnnotation('suite-1', 'note');
    const start: AnnotationEdits = {
      upserts: new Map([[add.id, add]]),
      removed: new Set(['ref:4R']),
      fields: new Map(),
    };
    const doc = setFieldCommand('nombre', LUIS, 'Nombre').apply(start);
    expect(doc.upserts).toEqual(start.upserts);
    expect([...doc.removed]).toEqual(['ref:4R']);
  });

  it('invert devuelve el valor previo, o la ausencia de valor', () => {
    const cmd = setFieldCommand('nombre', LUIS, 'Nombre');
    const fromEmpty = cmd.invert(EMPTY_EDITS);
    expect(fromEmpty.apply(cmd.apply(EMPTY_EDITS)).fields.has('nombre')).toBe(false);

    const before = withField('nombre', ANA);
    const back = cmd.invert(before).apply(cmd.apply(before));
    expect(back.fields.get('nombre')).toEqual(ANA);
  });
});

describe('setFieldCommand con UndoStack', () => {
  it('escribir, deshacer y rehacer el valor de un campo', () => {
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => 0 });
    stack.execute(setFieldCommand('nombre', LUIS, 'Nombre'));
    expect(stack.doc.fields.get('nombre')).toEqual(LUIS);

    expect(stack.undo()).toBe(true);
    expect(stack.doc.fields.has('nombre')).toBe(false);

    expect(stack.redo()).toBe(true);
    expect(stack.doc.fields.get('nombre')).toEqual(LUIS);
  });

  it('una anotación añadida después conserva los valores de campo', () => {
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => 0 });
    stack.execute(setFieldCommand('nombre', LUIS, 'Nombre'));
    stack.execute(addAnnotationCommand(newAnnotation('suite-1', 'note')));
    expect(stack.doc.fields.get('nombre')).toEqual(LUIS);
    expect(stack.doc.upserts.has('suite-1')).toBe(true);
  });

  it('deshacer un valor de campo no toca las anotaciones ni los borrados', () => {
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => 0 });
    stack.execute(addAnnotationCommand(newAnnotation('suite-1', 'note')));
    stack.execute(setFieldCommand('nombre', LUIS, 'Nombre'));
    stack.undo();
    expect(stack.doc.upserts.has('suite-1')).toBe(true);
    expect(stack.doc.fields.has('nombre')).toBe(false);
    expect(stack.doc.removed.size).toBe(0);
  });
});
