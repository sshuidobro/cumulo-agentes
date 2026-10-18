import { UndoStack } from '@suite/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDITS,
  addAnnotationCommand,
  annotationEquals,
  deleteAnnotationCommand,
  diffAnnotations,
  isEmptyDiff,
  updateAnnotationCommand,
} from '../../../src/core/annotations';
import type { Annotation, AnnotationEdits } from '../../../src/core/annotations';
import { fileAnnotation, newAnnotation } from './factories';

const EMPTY_BASE: ReadonlyMap<string, Annotation> = new Map();

function baselineOf(...list: Annotation[]): ReadonlyMap<string, Annotation> {
  return new Map(list.map((a) => [a.id, a]));
}

/** Mismo contenido de upserts y removed (sin importar el orden de los Map). */
function sameEdits(a: AnnotationEdits, b: AnnotationEdits): boolean {
  if (a.upserts.size !== b.upserts.size || a.removed.size !== b.removed.size) return false;
  for (const [id, v] of a.upserts) {
    const other = b.upserts.get(id);
    if (other === undefined || !annotationEquals(v, other)) return false;
  }
  return [...a.removed].every((id) => b.removed.has(id));
}

describe('invert de los comandos: aplicar y deshacer devuelve el estado de partida', () => {
  const start: AnnotationEdits = {
    upserts: new Map([['suite-x', newAnnotation('suite-x', 'note')]]),
    removed: new Set(),
    fields: new Map(),
  };

  const cases: [string, () => ReturnType<typeof addAnnotationCommand>][] = [
    ['añadir una nueva', () => addAnnotationCommand(newAnnotation('suite-y', 'ink'))],
    ['editar una nueva', () => updateAnnotationCommand({ ...newAnnotation('suite-x', 'note'), contents: 'hola' })],
    ['borrar una del fichero', () => deleteAnnotationCommand(fileAnnotation(7, 'underline'))],
  ];

  it.each(cases)('%s', (_name, make) => {
    const cmd = make();
    const inverse = cmd.invert(start);
    const after = cmd.apply(start);
    expect(sameEdits(after, start)).toBe(false);
    expect(sameEdits(inverse.apply(after), start)).toBe(true);
  });

  it('también con una anotación del fichero editada', () => {
    const edited = updateAnnotationCommand({ ...fileAnnotation(7, 'underline'), contents: 'x' });
    const before: AnnotationEdits = EMPTY_EDITS;
    expect(sameEdits(edited.invert(before).apply(edited.apply(before)), before)).toBe(true);
  });
});

describe('deleteAnnotationCommand', () => {
  it('una anotación nueva se quita sin marcarla como borrada', () => {
    const a = newAnnotation('suite-1', 'note');
    const doc = addAnnotationCommand(a).apply(EMPTY_EDITS);
    const after = deleteAnnotationCommand(a).apply(doc);
    expect(after.upserts.has('suite-1')).toBe(false);
    expect(after.removed.size).toBe(0);
  });

  it('una del fichero se marca como borrada y se quita su edición', () => {
    const f = fileAnnotation(7);
    const doc = updateAnnotationCommand({ ...f, contents: 'x' }).apply(EMPTY_EDITS);
    const after = deleteAnnotationCommand(f).apply(doc);
    expect(after.upserts.has(f.id)).toBe(false);
    expect(after.removed.has(f.id)).toBe(true);
  });

  it('usa la etiqueta «borrar <tipo>»', () => {
    expect(deleteAnnotationCommand(newAnnotation('s', 'highlight')).label).toBe('borrar resaltado');
    expect(deleteAnnotationCommand(newAnnotation('s', 'ink')).label).toBe('borrar dibujo');
    expect(deleteAnnotationCommand(newAnnotation('s', 'freetext')).label).toBe('borrar texto');
  });
});

describe('etiquetas de los comandos', () => {
  it.each([
    ['highlight', 'añadir resaltado'],
    ['underline', 'añadir subrayado'],
    ['strikeout', 'añadir tachado'],
    ['note', 'añadir nota'],
    ['freetext', 'añadir texto'],
    ['ink', 'añadir dibujo'],
  ] as const)('%s → %s', (type, label) => {
    expect(addAnnotationCommand(newAnnotation('s', type)).label).toBe(label);
  });

  it('editar usa «editar comentario» por defecto y acepta etiqueta y clave de agrupación', () => {
    const a = newAnnotation('s', 'note');
    expect(updateAnnotationCommand(a).label).toBe('editar comentario');
    const cmd = updateAnnotationCommand(a, 'escribir', 'note-text:s');
    expect(cmd.label).toBe('escribir');
    expect(cmd.mergeKey).toBe('note-text:s');
  });

  it('sin clave de agrupación el comando no tiene mergeKey', () => {
    expect(addAnnotationCommand(newAnnotation('s')).mergeKey).toBeUndefined();
    expect('mergeKey' in addAnnotationCommand(newAnnotation('s'))).toBe(false);
  });
});

describe('con UndoStack', () => {
  it('añadir 3, editar 1 y borrar 1 del fichero → diff correcto; deshacer ×5 vacía; rehacer ×5 restaura', () => {
    let now = 0;
    const baseline = baselineOf(fileAnnotation(7, 'underline'), fileAnnotation(8, 'underline'));
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => now });
    const n1 = newAnnotation('suite-1', 'highlight');
    const n2 = newAnnotation('suite-2', 'note');
    const n3 = newAnnotation('suite-3', 'ink');

    stack.execute(addAnnotationCommand(n1));
    now += 1000;
    stack.execute(addAnnotationCommand(n2));
    now += 1000;
    stack.execute(addAnnotationCommand(n3));
    now += 1000;
    stack.execute(updateAnnotationCommand({ ...n2, contents: 'editada' }));
    now += 1000;
    stack.execute(deleteAnnotationCommand(fileAnnotation(8, 'underline')));

    const d = diffAnnotations(baseline, stack.doc);
    expect(d.added.map((a) => a.id)).toEqual(['suite-1', 'suite-2', 'suite-3']);
    expect(d.added.find((a) => a.id === 'suite-2')?.contents).toBe('editada');
    expect(d.modified).toHaveLength(0);
    expect(d.removed.map((a) => a.id)).toEqual(['ref:8R']);
    const afterAll = stack.doc;

    for (let i = 0; i < 5; i++) expect(stack.undo()).toBe(true);
    expect(isEmptyDiff(diffAnnotations(baseline, stack.doc))).toBe(true);
    expect(stack.undo()).toBe(false);

    for (let i = 0; i < 5; i++) expect(stack.redo()).toBe(true);
    expect(sameEdits(stack.doc, afterAll)).toBe(true);
  });

  it('editar una del fichero y dejarla igual no la marca como modificada', () => {
    const f = fileAnnotation(7, 'underline');
    const baseline = baselineOf(f);
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => 0 });
    stack.execute(updateAnnotationCommand({ ...f, contents: 'cambio' }));
    expect(diffAnnotations(baseline, stack.doc).modified).toHaveLength(1);
    stack.execute(updateAnnotationCommand(f));
    expect(diffAnnotations(baseline, stack.doc).modified).toHaveLength(0);
    expect(isEmptyDiff(diffAnnotations(baseline, stack.doc))).toBe(true);
  });

  it('borrar una anotación nueva no aparece ni en removed ni en added', () => {
    const a = newAnnotation('suite-1', 'note');
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => 0 });
    stack.execute(addAnnotationCommand(a));
    stack.execute(deleteAnnotationCommand(a));
    expect(isEmptyDiff(diffAnnotations(EMPTY_BASE, stack.doc))).toBe(true);
  });

  it('updateAnnotationCommand con la misma clave dos veces en menos de 500 ms se agrupa en una entrada', () => {
    let now = 0;
    const a = newAnnotation('suite-1', 'note');
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { now: () => now });
    stack.execute(addAnnotationCommand(a));
    stack.execute(updateAnnotationCommand({ ...a, contents: 'h' }, 'escribir', 'note-text:suite-1'));
    now += 200;
    stack.execute(updateAnnotationCommand({ ...a, contents: 'ho' }, 'escribir', 'note-text:suite-1'));
    expect(stack.getState().undoDepth).toBe(2);
    stack.undo();
    expect(stack.doc.upserts.get('suite-1')).toEqual(a);
  });

  it('5 000 añadidos con maxDepth 100: la pila queda acotada y todas las anotaciones están', () => {
    const stack = new UndoStack<AnnotationEdits>(EMPTY_EDITS, { maxDepth: 100, now: () => 0 });
    for (let i = 0; i < 5000; i++) {
      stack.execute(addAnnotationCommand(newAnnotation(`suite-${i}`, 'highlight', i % 50)));
    }
    expect(stack.getState().undoDepth).toBe(100);
    expect(stack.doc.upserts.size).toBe(5000);
  });
});
