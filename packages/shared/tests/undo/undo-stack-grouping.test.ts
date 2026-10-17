import { describe, expect, it } from 'vitest';
import { UndoStack } from '../../src/undo';
import type { Command, UndoState } from '../../src/undo';
import { deleteText, insertText } from './text-commands';

const GROUP_ERROR = 'UndoStack: operación no permitida dentro de group()';

/** Reloj falso: el test controla `t` y cada `execute` ve ese instante. */
function clockAt(): { now: () => number; set: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
  };
}

/** Comando de borrado con clave de agrupación (text-commands no la admite). */
function deleteWithKey(pos: number, length: number, mergeKey: string): Command<string> {
  return { ...deleteText(pos, length), mergeKey };
}

describe('UndoStack · agrupación', () => {
  it('teclear agrupa en una entrada y deshacer/rehacer la recorren entera', () => {
    const clock = clockAt();
    const stack = new UndoStack('', { now: clock.now });

    clock.set(0);
    stack.execute(insertText(0, 'h', 'typing'));
    clock.set(100);
    stack.execute(insertText(1, 'o', 'typing'));
    clock.set(200);
    stack.execute(insertText(2, 'la', 'typing'));

    expect(stack.doc).toBe('hola');
    expect(stack.getState().undoDepth).toBe(1);
    expect(stack.getState().undoLabel).toBe('escribir');

    expect(stack.undo()).toBe(true);
    expect(stack.doc).toBe('');
    expect(stack.redo()).toBe(true);
    expect(stack.doc).toBe('hola');
  });

  it('la ventana de agrupación es de 500 ms por defecto y es inclusiva', () => {
    const clock = clockAt();
    const stack = new UndoStack('', { now: clock.now });
    clock.set(0);
    stack.execute(insertText(0, 'a', 'typing'));
    clock.set(501);
    stack.execute(insertText(1, 'b', 'typing'));
    expect(stack.getState().undoDepth).toBe(2);

    const exacto = new UndoStack('', { now: clock.now });
    clock.set(0);
    exacto.execute(insertText(0, 'a', 'typing'));
    clock.set(500);
    exacto.execute(insertText(1, 'b', 'typing'));
    expect(exacto.getState().undoDepth).toBe(1);
  });

  it('groupDelayMs personalizado cambia la ventana y 0 solo agrupa en el mismo instante', () => {
    const clock = clockAt();
    const corta = new UndoStack('', { now: clock.now, groupDelayMs: 250 });
    clock.set(0);
    corta.execute(insertText(0, 'a', 'typing'));
    clock.set(251);
    corta.execute(insertText(1, 'b', 'typing'));
    expect(corta.getState().undoDepth).toBe(2);

    const cero = new UndoStack('', { now: clock.now, groupDelayMs: 0 });
    clock.set(0);
    cero.execute(insertText(0, 'a', 'typing'));
    cero.execute(insertText(1, 'b', 'typing'));
    expect(cero.getState().undoDepth).toBe(1);
  });

  it('con groupDelayMs 0 y el mismo instante, teclear agrupa', () => {
    const stack = new UndoStack('', { groupDelayMs: 0, now: () => 0 });
    stack.execute(insertText(0, 'a', 'typing'));
    stack.execute(insertText(1, 'b', 'typing'));
    expect(stack.getState().undoDepth).toBe(1);
  });

  it('una clave distinta o ausente no agrupa', () => {
    const clock = clockAt();
    const distinta = new UndoStack('abc', { now: clock.now });
    clock.set(0);
    distinta.execute(insertText(3, 'd', 'typing'));
    distinta.execute(deleteWithKey(0, 1, 'delete'));
    expect(distinta.getState().undoDepth).toBe(2);

    const ausente = new UndoStack('', { now: clock.now });
    clock.set(0);
    ausente.execute(insertText(0, 'a'));
    ausente.execute(insertText(1, 'b'));
    expect(ausente.getState().undoDepth).toBe(2);
  });

  it('closeGroup entre dos letras con la misma clave y el mismo instante no agrupa', () => {
    const stack = new UndoStack('', { now: () => 0 });
    stack.execute(insertText(0, 'a', 'typing'));
    stack.closeGroup();
    stack.execute(insertText(1, 'b', 'typing'));
    expect(stack.getState().undoDepth).toBe(2);
  });

  it('tras undo y redo, la siguiente letra en el mismo instante abre entrada nueva', () => {
    const stack = new UndoStack('', { now: () => 0 });
    stack.execute(insertText(0, 'h', 'typing'));
    stack.execute(insertText(1, 'o', 'typing'));
    expect(stack.getState().undoDepth).toBe(1);

    stack.undo();
    stack.redo();
    stack.execute(insertText(2, 'l', 'typing'));

    expect(stack.doc).toBe('hol');
    expect(stack.getState().undoDepth).toBe(2);
  });

  it('guardar corta la agrupación: la letra posterior queda sucia y deshacerla limpia el guardado', () => {
    const stack = new UndoStack('', { now: () => 0 });
    stack.execute(insertText(0, 'a', 'typing'));
    stack.markSaved();
    stack.execute(insertText(1, 'b', 'typing'));

    expect(stack.getState().undoDepth).toBe(2);
    expect(stack.isDirty()).toBe(true);

    stack.undo();
    expect(stack.isDirty()).toBe(false);
    expect(stack.doc).toBe('a');
  });

  it('group con borrado y escritura produce una entrada y un único aviso al listener', () => {
    const stack = new UndoStack('hola');
    const states: UndoState[] = [];
    stack.subscribe((state) => states.push(state));

    stack.group('reemplazar', () => {
      stack.execute(deleteText(0, 4));
      stack.execute(insertText(0, 'adiós'));
    });

    expect(stack.doc).toBe('adiós');
    expect(stack.getState().undoDepth).toBe(1);
    expect(stack.getState().undoLabel).toBe('reemplazar');
    expect(states).toHaveLength(1);

    expect(stack.undo()).toBe(true);
    expect(stack.doc).toBe('hola');
    expect(stack.redo()).toBe(true);
    expect(stack.doc).toBe('adiós');
  });

  it('los grupos anidados caen en la entrada del exterior', () => {
    const stack = new UndoStack('');
    stack.group('exterior', () => {
      stack.execute(insertText(0, 'A'));
      stack.group('interior', () => {
        stack.execute(insertText(1, 'B'));
      });
    });

    expect(stack.doc).toBe('AB');
    expect(stack.getState().undoDepth).toBe(1);
    expect(stack.getState().undoLabel).toBe('exterior');
  });

  it('un grupo vacío, anidado o no, no cambia la pila, no avisa y no altera isDirty', () => {
    const stack = new UndoStack('');
    const states: UndoState[] = [];
    stack.subscribe((state) => states.push(state));

    stack.group('vacio', () => undefined);
    stack.group('exterior', () => {
      stack.group('interior', () => undefined);
    });

    expect(stack.getState().undoDepth).toBe(0);
    expect(states).toHaveLength(0);
    expect(stack.isDirty()).toBe(false);
  });

  it('si el grupo lanza, deshace sus cambios, restaura el redo y relanza el error', () => {
    const stack = new UndoStack('x');
    stack.execute(insertText(1, 'y'));
    stack.undo();
    const antes = stack.getState();
    expect(antes.canRedo).toBe(true);

    const states: UndoState[] = [];
    stack.subscribe((state) => states.push(state));

    expect(() =>
      stack.group('g', () => {
        stack.execute(insertText(1, 'z'));
        throw new Error('fallo');
      }),
    ).toThrow('fallo');

    expect(stack.doc).toBe('x');
    expect(stack.getState().undoDepth).toBe(antes.undoDepth);
    expect(stack.getState().canRedo).toBe(true);
    expect(states).toHaveLength(0);
  });

  it('group devuelve el valor de fn', () => {
    const stack = new UndoStack('');
    expect(stack.group('g', () => 42)).toBe(42);
  });

  it('undo y markSaved dentro de group lanzan el error de operación no permitida', () => {
    const stack = new UndoStack('');
    stack.execute(insertText(0, 'a'));
    stack.group('g', () => {
      stack.execute(insertText(1, 'b'));
      expect(() => stack.undo()).toThrow(new Error(GROUP_ERROR));
      expect(() => stack.markSaved()).toThrow(GROUP_ERROR);
    });
    expect(stack.doc).toBe('ab');
  });

  it('una letra con clave justo después de cerrar un grupo no entra en la entrada del grupo', () => {
    const stack = new UndoStack('', { now: () => 0 });
    stack.group('pegar', () => {
      stack.execute(insertText(0, 'ab'));
    });
    stack.execute(insertText(2, 'c', 'typing'));

    expect(stack.getState().undoDepth).toBe(2);
    expect(stack.getState().undoLabel).toBe('escribir');
    expect(stack.doc).toBe('abc');
  });

  it('con maxDepth 2 y tres grupos de tecleo separados por closeGroup, quedan 2 entradas', () => {
    const stack = new UndoStack('', { maxDepth: 2, now: () => 0 });
    for (const [pos, letter] of [
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
    ] as const) {
      stack.closeGroup();
      stack.group('escribir', () => {
        stack.execute(insertText(pos, letter, 'typing'));
      });
    }

    expect(stack.getState().undoDepth).toBe(2);
    expect(stack.doc).toBe('abc');
  });
});
