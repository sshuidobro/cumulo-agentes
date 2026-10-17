import { describe, expect, it } from 'vitest';
import { UndoStack } from '../../src/undo';
import type { Command, UndoState } from '../../src/undo';
import { deleteText, insertText } from './text-commands';

/** `performance` es global en Node 22, pero tsconfig no incluye ni los tipos DOM ni los de Node. */
const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

/** Añade una letra al final del documento; útil para secuencias largas. */
function appendLetter(stack: UndoStack<string>, letter: string): void {
  stack.execute(insertText(stack.doc.length, letter));
}

describe('UndoStack', () => {
  it('deshacer y rehacer restauran el documento exacto (inserción y borrado)', () => {
    const stack = new UndoStack('hola');

    stack.execute(insertText(4, ' mundo'));
    expect(stack.doc).toBe('hola mundo');
    expect(stack.undo()).toBe(true);
    expect(stack.doc).toBe('hola');
    expect(stack.redo()).toBe(true);
    expect(stack.doc).toBe('hola mundo');

    const borrar = new UndoStack('hola');
    borrar.execute(deleteText(0, 2));
    expect(borrar.doc).toBe('la');
    borrar.undo();
    expect(borrar.doc).toBe('hola');
    borrar.redo();
    expect(borrar.doc).toBe('la');
  });

  it('undo y redo sin nada devuelven false y no notifican', () => {
    const stack = new UndoStack('');
    const states: UndoState[] = [];
    stack.subscribe((state) => states.push(state));

    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(states).toHaveLength(0);
  });

  it('ejecutar tras deshacer vacía el redo', () => {
    const stack = new UndoStack('');
    stack.execute(insertText(0, 'A'));
    stack.undo();
    expect(stack.getState().canRedo).toBe(true);

    stack.execute(insertText(0, 'B'));
    expect(stack.getState().canRedo).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(stack.doc).toBe('B');
  });

  it('el límite maxDepth descarta las entradas más antiguas', () => {
    const stack = new UndoStack('', { maxDepth: 3 });
    for (const letter of ['a', 'b', 'c', 'd', 'e']) {
      appendLetter(stack, letter);
    }
    expect(stack.getState().undoDepth).toBe(3);
    expect(stack.doc).toBe('abcde');

    expect(stack.undo()).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(stack.undo()).toBe(false);
    expect(stack.doc).toBe('ab');
  });

  it('maxDepth 0 aplica los cambios sin historial y los da por sucios', () => {
    const stack = new UndoStack('', { maxDepth: 0 });
    stack.execute(insertText(0, 'a'));

    expect(stack.doc).toBe('a');
    expect(stack.getState().canUndo).toBe(false);
    expect(stack.isDirty()).toBe(true);
  });

  it('setMaxDepth recorta el historial y valida los parámetros', () => {
    const stack = new UndoStack('');
    for (const letter of ['a', 'b', 'c']) {
      appendLetter(stack, letter);
    }
    expect(stack.getState().undoDepth).toBe(3);

    stack.setMaxDepth(1);
    expect(stack.getState().undoDepth).toBe(1);

    expect(() => new UndoStack('', { maxDepth: -1 })).toThrow(RangeError);
    expect(() => new UndoStack('', { maxDepth: -1 })).toThrow('maxDepth debe ser un entero >= 0');
    expect(() => new UndoStack('', { maxDepth: 1.5 })).toThrow(RangeError);
    expect(() => new UndoStack('', { groupDelayMs: Number.NaN })).toThrow(RangeError);
    expect(() => new UndoStack('', { groupDelayMs: Number.NaN })).toThrow(
      'groupDelayMs debe ser un número >= 0',
    );
    expect(() => new UndoStack('', { groupDelayMs: -1 })).toThrow(RangeError);
    expect(() => new UndoStack('', { groupDelayMs: 0 })).not.toThrow();
  });

  it('el guardado sigue las transiciones de isDirty', () => {
    const stack = new UndoStack('');
    expect(stack.isDirty()).toBe(false);

    stack.execute(insertText(0, 'a'));
    expect(stack.isDirty()).toBe(true);

    stack.undo();
    expect(stack.isDirty()).toBe(false);

    stack.redo();
    expect(stack.isDirty()).toBe(true);

    stack.markSaved();
    expect(stack.isDirty()).toBe(false);

    stack.execute(insertText(1, 'b'));
    expect(stack.isDirty()).toBe(true);

    stack.undo();
    expect(stack.isDirty()).toBe(false);
  });

  it('un estado guardado en una rama abandonada ya no se puede alcanzar', () => {
    const stack = new UndoStack('');
    stack.execute(insertText(0, 'A'));
    stack.markSaved();
    stack.undo();
    stack.execute(insertText(0, 'B'));

    expect(stack.isDirty()).toBe(true);
    stack.undo();
    expect(stack.isDirty()).toBe(true);
    stack.redo();
    expect(stack.isDirty()).toBe(true);
  });

  it('un guardado recortado por el límite ya no se puede alcanzar', () => {
    const stack = new UndoStack('', { maxDepth: 2 });
    stack.markSaved();
    for (const letter of ['a', 'b', 'c']) {
      appendLetter(stack, letter);
    }
    stack.undo();
    stack.undo();

    expect(stack.doc).toBe('a');
    expect(stack.isDirty()).toBe(true);
  });

  it('el guardado en la base sigue alcanzable tras el recorte que elimina la entrada guardada', () => {
    const stack = new UndoStack('', { maxDepth: 2 });
    appendLetter(stack, 'a');
    stack.markSaved();
    appendLetter(stack, 'b');
    appendLetter(stack, 'c');
    stack.undo();
    stack.undo();

    expect(stack.doc).toBe('a');
    expect(stack.isDirty()).toBe(false);
  });

  it('clear conserva el estado sucio', () => {
    const sinGuardar = new UndoStack('');
    sinGuardar.execute(insertText(0, 'a'));
    sinGuardar.clear();
    expect(sinGuardar.getState().canUndo).toBe(false);
    expect(sinGuardar.isDirty()).toBe(true);

    const guardado = new UndoStack('');
    guardado.execute(insertText(0, 'a'));
    guardado.markSaved();
    guardado.clear();
    expect(guardado.getState().canUndo).toBe(false);
    expect(guardado.isDirty()).toBe(false);
  });

  it('getState devuelve exactamente el estado esperado', () => {
    const stack = new UndoStack('');
    stack.execute(insertText(0, 'a'));

    expect(stack.getState()).toEqual({
      canUndo: true,
      canRedo: false,
      undoLabel: 'escribir',
      redoLabel: null,
      undoDepth: 1,
      redoDepth: 0,
      isDirty: true,
    });

    stack.undo();
    expect(stack.getState()).toEqual({
      canUndo: false,
      canRedo: true,
      undoLabel: null,
      redoLabel: 'escribir',
      undoDepth: 0,
      redoDepth: 1,
      isDirty: false,
    });
  });

  it('subscribe notifica en cada operación de cambio y deja de notificar tras darse de baja', () => {
    const stack = new UndoStack('');
    const states: UndoState[] = [];
    const unsubscribe = stack.subscribe((state) => states.push(state));

    stack.execute(insertText(0, 'a'));
    stack.undo();
    stack.redo();
    stack.markSaved();
    stack.clear();
    stack.setMaxDepth(1);
    expect(states.map((s) => s.undoDepth)).toEqual([1, 0, 1, 1, 0, 0]);
    expect(states[0]?.isDirty).toBe(true);
    expect(states[3]?.isDirty).toBe(false);

    unsubscribe();
    stack.execute(insertText(0, 'b'));
    expect(states).toHaveLength(6);
  });

  it('si apply lanza, execute propaga el error y no cambia el estado', () => {
    const stack = new UndoStack('hola');
    stack.execute(insertText(4, '!'));
    const antes = stack.getState();
    const fallo: Command<string> = {
      label: 'fallar',
      apply: () => {
        throw new Error('fallo de prueba');
      },
      invert: () => insertText(0, ''),
    };

    expect(() => stack.execute(fallo)).toThrow('fallo de prueba');
    expect(stack.doc).toBe('hola!');
    expect(stack.getState()).toEqual(antes);
    expect(stack.isDirty()).toBe(antes.isDirty);
  });

  it('un comando que llama a execute provoca el error de reentrada y la pila sigue usable', () => {
    const stack = new UndoStack('');
    const reentrante: Command<string> = {
      label: 'reentrante',
      apply: (doc) => {
        stack.execute(insertText(0, 'x'));
        return doc;
      },
      invert: () => insertText(0, ''),
    };

    expect(() => stack.execute(reentrante)).toThrow(
      new Error('UndoStack: reentrada no permitida'),
    );
    expect(stack.getState().undoDepth).toBe(0);

    stack.execute(insertText(0, 'z'));
    expect(stack.doc).toBe('z');
  });

  it('rendimiento: 100 000 ejecuciones con maxDepth 100 terminan en menos de 1000 ms', () => {
    const restar: Command<number> = {
      label: 'restar 1',
      apply: (n) => n - 1,
      invert: () => sumar,
    };
    const sumar: Command<number> = {
      label: 'sumar 1',
      apply: (n) => n + 1,
      invert: () => restar,
    };
    const stack = new UndoStack(0, { maxDepth: 100 });

    const inicio = clock.now();
    for (let i = 0; i < 100_000; i++) {
      stack.execute(sumar);
    }
    const duracion = clock.now() - inicio;

    expect(stack.doc).toBe(100_000);
    expect(stack.getState().undoDepth).toBe(100);
    expect(duracion).toBeLessThan(1000);
  });
});
