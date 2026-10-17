import { describe, expect, it } from 'vitest';
import { UndoStack } from '../../src/undo';
import type { Command } from '../../src/undo';
import { deleteText, insertText } from './text-commands';

const boom = (label = 'x'): Command<string> => ({
  label,
  apply: () => {
    throw new Error('apply fallo');
  },
  invert: () => boom(),
});

describe('UndoStack casos límite (QA)', () => {
  it('maxDepth 0: undo/redo devuelven false, markSaved deja limpio y luego sucio', () => {
    const s = new UndoStack('a', { maxDepth: 0 });
    s.execute(insertText(1, 'b'));
    expect(s.doc).toBe('ab');
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
    expect(s.isDirty()).toBe(true);
    s.markSaved();
    expect(s.isDirty()).toBe(false);
    s.execute(insertText(2, 'c'));
    expect(s.isDirty()).toBe(true);
  });

  it('redo tras execute: se vacía y redo() devuelve false sin cambiar doc', () => {
    const s = new UndoStack('');
    s.execute(insertText(0, 'a'));
    s.execute(insertText(1, 'b'));
    s.undo();
    s.execute(insertText(1, 'z'));
    expect(s.getState().redoDepth).toBe(0);
    expect(s.redo()).toBe(false);
    expect(s.doc).toBe('az');
  });

  it('invert que lanza: execute propaga y deja todo intacto, y la pila no queda ocupada', () => {
    const s = new UndoStack('a');
    s.execute(insertText(1, 'b'));
    const bad: Command<string> = {
      label: 'mal',
      apply: (d) => d + 'X',
      invert: () => {
        throw new Error('invert fallo');
      },
    };
    expect(() => s.execute(bad)).toThrow('invert fallo');
    expect(s.doc).toBe('ab');
    expect(s.getState().undoDepth).toBe(1);
    expect(s.execute(insertText(2, 'c'))).toBe('abc');
  });

  it('apply del inverso lanza en undo: doc y pilas intactos, se puede seguir', () => {
    const s = new UndoStack('a');
    const cmd: Command<string> = {
      label: 'raro',
      apply: (d) => d + 'b',
      invert: () => boom(),
    };
    s.execute(cmd);
    expect(() => s.undo()).toThrow('apply fallo');
    expect(s.doc).toBe('ab');
    expect(s.getState()).toMatchObject({ undoDepth: 1, redoDepth: 0, isDirty: true });
    expect(s.execute(insertText(2, 'c'))).toBe('abc');
  });

  it('apply lanza en redo: la entrada sigue en redo', () => {
    let fail = false;
    const cmd: Command<string> = {
      label: 'r',
      apply: (d) => {
        if (fail) throw new Error('redo fallo');
        return d + 'b';
      },
      invert: () => deleteText(1, 1),
    };
    const s = new UndoStack('a');
    s.execute(cmd);
    s.undo();
    fail = true;
    expect(() => s.redo()).toThrow('redo fallo');
    expect(s.doc).toBe('a');
    expect(s.getState().redoDepth).toBe(1);
    fail = false;
    expect(s.redo()).toBe(true);
    expect(s.doc).toBe('ab');
  });

  it('reentrada desde undo/redo/markSaved/clear/setMaxDepth dentro de apply lanza', () => {
    const s = new UndoStack('a');
    s.execute(insertText(1, 'b'));
    for (const f of [() => s.undo(), () => s.redo(), () => s.markSaved(), () => s.clear(), () => s.setMaxDepth(1)]) {
      const c: Command<string> = { label: 'r', apply: (d) => { f(); return d; }, invert: () => deleteText(0, 0) };
      expect(() => s.execute(c)).toThrow('UndoStack: reentrada no permitida');
    }
    expect(s.doc).toBe('ab');
    expect(s.execute(insertText(2, 'c'))).toBe('abc');
  });

  it('listener que se da de baja durante la notificación y getState en listener', () => {
    const s = new UndoStack('');
    const seen: number[] = [];
    const off = s.subscribe(() => { seen.push(1); off(); });
    s.subscribe(() => seen.push(2));
    s.execute(insertText(0, 'a'));
    s.execute(insertText(1, 'b'));
    expect(seen).toEqual([1, 2, 2]);
  });

  it('setMaxDepth a 0 vacía historial; subir no recupera', () => {
    const s = new UndoStack('');
    s.execute(insertText(0, 'a')); s.execute(insertText(1, 'b'));
    s.setMaxDepth(0);
    expect(s.getState().undoDepth).toBe(0);
    s.setMaxDepth(10);
    expect(s.undo()).toBe(false);
    expect(() => s.setMaxDepth(-2)).toThrow(RangeError);
    expect(() => s.setMaxDepth(Number.NaN)).toThrow(RangeError);
  });

  it('constructor: Infinity en maxDepth y groupDelayMs negativo lanzan RangeError', () => {
    expect(() => new UndoStack('', { maxDepth: Infinity })).toThrow(RangeError);
    expect(() => new UndoStack('', { groupDelayMs: -1 })).toThrow(RangeError);
    expect(() => new UndoStack('', { groupDelayMs: Infinity })).toThrow(RangeError);
  });

  it('Unicode: emojis, ñ y RTL ida y vuelta', () => {
    const s = new UndoStack('año');
    s.execute(insertText(3, ' 😀 שלום'));
    expect(s.doc).toBe('año 😀 שלום');
    s.undo();
    expect(s.doc).toBe('año');
    s.redo();
    expect(s.doc).toBe('año 😀 שלום');
  });

  it('clear con redo pendiente y estado guardado en el redo: sigue sucio', () => {
    const s = new UndoStack('');
    s.execute(insertText(0, 'a'));
    s.markSaved();
    s.undo();
    s.clear();
    expect(s.isDirty()).toBe(true);
    expect(s.getState().canRedo).toBe(false);
  });

  it('now por defecto no falla y now personalizado se invoca', () => {
    let calls = 0;
    const s = new UndoStack('', { now: () => ++calls });
    s.execute(insertText(0, 'a'));
    expect(calls).toBe(1);
  });
});
