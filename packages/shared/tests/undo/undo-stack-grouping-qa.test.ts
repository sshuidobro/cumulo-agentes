import { describe, expect, it } from 'vitest';
import { UndoStack } from '../../src/undo';
import type { Command } from '../../src/undo';
import { insertText } from './text-commands';

function mk(opts: { maxDepth?: number; groupDelayMs?: number } = {}) {
  let t = 0;
  const s = new UndoStack('', { ...opts, now: () => t });
  return { s, set: (n: number) => { t = n; } };
}

describe('QA agrupación: casos límite', () => {
  it('el grupo interior que lanza y el exterior que lo atrapa no anula (según ficha)', () => {
    const { s } = mk();
    s.group('ext', () => {
      s.execute(insertText(0, 'a'));
      try {
        s.group('int', () => {
          s.execute(insertText(1, 'b'));
          throw new Error('x');
        });
      } catch { /* atrapado */ }
    });
    expect(s.doc).toBe('ab');
    expect(s.getState().undoDepth).toBe(1);
    s.undo();
    expect(s.doc).toBe('');
  });

  it('el grupo exterior que lanza tras un interior correcto lo anula todo y la pila sigue usable', () => {
    const { s } = mk();
    s.execute(insertText(0, 'x'));
    expect(() =>
      s.group('e', () => {
        s.group('i', () => s.execute(insertText(1, 'y')));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.doc).toBe('x');
    expect(s.getState().undoDepth).toBe(1);
    s.group('g', () => s.execute(insertText(1, 'z')));
    expect(s.doc).toBe('xz');
    expect(s.getState().undoDepth).toBe(2);
    expect(s.undo()).toBe(true);
  });

  it('un comando cuyo apply lanza dentro de group anula el grupo y no deja busy', () => {
    const { s } = mk();
    const bad: Command<string> = { label: 'm', apply: () => { throw new Error('apply'); }, invert: (d) => ({ label: 'i', apply: () => d, invert: () => bad }) };
    expect(() => s.group('g', () => { s.execute(insertText(0, 'a')); s.execute(bad); })).toThrow('apply');
    expect(s.doc).toBe('');
    expect(s.getState().undoDepth).toBe(0);
    s.execute(insertText(0, 'q'));
    expect(s.doc).toBe('q');
  });

  it('operaciones prohibidas dentro de group (redo, clear, setMaxDepth) lanzan y no rompen el grupo', () => {
    const { s } = mk();
    s.group('g', () => {
      s.execute(insertText(0, 'a'));
      for (const f of [() => s.redo(), () => s.clear(), () => s.setMaxDepth(5), () => s.undo(), () => s.markSaved()]) {
        expect(f).toThrow('UndoStack: operación no permitida dentro de group()');
      }
      s.execute(insertText(1, 'b'));
    });
    expect(s.getState().undoDepth).toBe(1);
    expect(s.doc).toBe('ab');
  });

  it('group con error a mitad: tras fallo, redo conserva y dirty no cambia', () => {
    const { s } = mk();
    s.execute(insertText(0, 'a'));
    s.markSaved();
    s.undo();
    expect(s.isDirty()).toBe(true);
    expect(() => s.group('g', () => { s.execute(insertText(0, 'z')); throw new Error('e'); })).toThrow('e');
    expect(s.isDirty()).toBe(true);
    expect(s.getState().redoDepth).toBe(1);
    s.redo();
    expect(s.doc).toBe('a');
    expect(s.isDirty()).toBe(false);
  });

  it('group exitoso vacía redo; y no agrupa con entrada previa abierta', () => {
    const { s } = mk();
    s.execute(insertText(0, 'a', 'typing'));
    s.group('g', () => s.execute(insertText(1, 'b', 'typing')));
    expect(s.getState().undoDepth).toBe(2);
    s.undo();
    s.group('g2', () => s.execute(insertText(1, 'c')));
    expect(s.getState().redoDepth).toBe(0);
  });

  it('bordes de tiempo: ventana deslizante y reloj hacia atrás', () => {
    const { s, set } = mk();
    s.execute(insertText(0, 'a', 'k'));
    set(500);
    s.execute(insertText(1, 'b', 'k'));
    set(1000);
    s.execute(insertText(2, 'c', 'k'));
    expect(s.getState().undoDepth).toBe(1);
    set(1501);
    s.execute(insertText(3, 'd', 'k'));
    expect(s.getState().undoDepth).toBe(2);
  });

  it('clear y setMaxDepth: clear corta agrupación', () => {
    const { s } = mk();
    s.execute(insertText(0, 'a', 'k'));
    s.clear();
    s.execute(insertText(1, 'b', 'k'));
    expect(s.getState().undoDepth).toBe(1);
    expect(s.isDirty()).toBe(true);
  });

  it('maxDepth con grupos: el grupo cuenta como una entrada y recorta la más antigua', () => {
    const { s } = mk({ maxDepth: 2 });
    s.execute(insertText(0, 'a'));
    s.group('g1', () => { s.execute(insertText(1, 'b')); s.execute(insertText(2, 'c')); });
    s.group('g2', () => { s.execute(insertText(3, 'd')); s.execute(insertText(4, 'e')); });
    expect(s.getState().undoDepth).toBe(2);
    s.undo(); s.undo();
    expect(s.doc).toBe('a');
    expect(s.undo()).toBe(false);
  });

  it('maxDepth 0 con group no deja entradas ni rompe', () => {
    const { s } = mk({ maxDepth: 0 });
    s.group('g', () => s.execute(insertText(0, 'a')));
    expect(s.doc).toBe('a');
    expect(s.getState().undoDepth).toBe(0);
    s.execute(insertText(1, 'b', 'k'));
    s.execute(insertText(2, 'c', 'k'));
    expect(s.getState().undoDepth).toBe(0);
  });

  it('un mergeKey vacío "" se trata como clave válida', () => {
    const { s } = mk();
    s.execute(insertText(0, 'a', ''));
    s.execute(insertText(1, 'b', ''));
    expect(s.getState().undoDepth).toBe(1);
  });

  it('isDirty tras agrupar sobre entrada guardada con group y tras rollback de guardado', () => {
    const { s } = mk();
    s.group('g', () => s.execute(insertText(0, 'a')));
    s.markSaved();
    expect(s.isDirty()).toBe(false);
    expect(() => s.group('g', () => { s.execute(insertText(1, 'b')); throw new Error('e'); })).toThrow();
    expect(s.isDirty()).toBe(false);
    s.execute(insertText(1, 'c', 'k'));
    expect(s.isDirty()).toBe(true);
    s.undo();
    expect(s.isDirty()).toBe(false);
  });

  it('listener: una notificación por group y ninguna si falla', () => {
    const { s } = mk();
    let n = 0;
    s.subscribe(() => { n++; });
    s.group('g', () => { s.execute(insertText(0, 'a')); s.group('h', () => s.execute(insertText(1, 'b'))); });
    expect(n).toBe(1);
    expect(() => s.group('g', () => { s.execute(insertText(2, 'c')); throw new Error('e'); })).toThrow();
    expect(n).toBe(1);
  });

  it('group reentrante desde apply lanza error de reentrada sin dañar estado', () => {
    const { s } = mk();
    const cmd: Command<string> = { label: 'r', apply: (d) => { s.group('x', () => 1); return d; }, invert: () => insertText(0, '') };
    expect(() => s.execute(cmd)).toThrow('reentrada');
    s.execute(insertText(0, 'a'));
    expect(s.doc).toBe('a');
  });
});
