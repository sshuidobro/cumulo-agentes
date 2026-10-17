import { describe, expect, it } from 'vitest';
import { ShortcutRegistry } from '../../src/shortcuts/index';
import type { KeyEventLike, ShortcutDef } from '../../src/shortcuts/index';

type Id = 'save' | 'find' | 'zoomIn' | 'back' | 'none';

function ev(partial: Partial<KeyEventLike> & Pick<KeyEventLike, 'key'>): KeyEventLike {
  return { code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial };
}

const defs: readonly ShortcutDef<Id>[] = [
  { id: 'save', chords: ['Mod+S', 'Mod+Shift+S'], description: 'Guardar' },
  { id: 'find', chords: ['Mod+F'], description: 'Buscar' },
  { id: 'zoomIn', chords: ['Mod+Plus', 'Mod+code:NumpadAdd'], description: 'Acercar' },
  { id: 'back', chords: ['Alt+ArrowLeft'], description: 'Atrás' },
  { id: 'none', chords: [], description: 'Sin atajos' },
];

describe('ShortcutRegistry', () => {
  const registry = new ShortcutRegistry<Id>(defs);

  it('match devuelve el id del atajo que coincide', () => {
    expect(registry.match(ev({ key: 's', ctrlKey: true }), false)).toBe('save');
    expect(registry.match(ev({ key: 'S', ctrlKey: true, shiftKey: true }), false)).toBe('save');
    expect(registry.match(ev({ key: 'f', ctrlKey: true }), false)).toBe('find');
    expect(registry.match(ev({ key: 'ArrowLeft', altKey: true }), false)).toBe('back');
  });

  it('match usa Cmd en Mac', () => {
    expect(registry.match(ev({ key: 'f', metaKey: true }), true)).toBe('find');
    expect(registry.match(ev({ key: 'f', ctrlKey: true }), true)).toBe(null);
  });

  it('match devuelve null sin coincidencia', () => {
    expect(registry.match(ev({ key: 'g', ctrlKey: true }), false)).toBe(null);
    expect(registry.match(ev({ key: 'f' }), false)).toBe(null);
  });

  it('match devuelve el id de un atajo por código físico', () => {
    expect(registry.match(ev({ key: '+', code: 'NumpadAdd', ctrlKey: true }), false)).toBe('zoomIn');
  });

  it('chordsFor devuelve los atajos formateados del id', () => {
    expect(registry.chordsFor('save', false)).toEqual(['Ctrl+S', 'Ctrl+Mayús+S']);
    expect(registry.chordsFor('save', true)).toEqual(['⌘S', '⌘⇧S']);
    expect(registry.chordsFor('zoomIn', false)).toEqual(['Ctrl++', 'Ctrl++ (teclado numérico)']);
    expect(registry.chordsFor('back', false)).toEqual(['Alt+Flecha izquierda']);
  });

  it('chordsFor devuelve lista vacía si el id no tiene atajos', () => {
    expect(registry.chordsFor('none', false)).toEqual([]);
  });

  it('list devuelve las definiciones tal como se pasaron', () => {
    expect(registry.list()).toBe(defs);
  });

  it('definir Mod+F dos veces lanza Atajo duplicado', () => {
    expect(
      () =>
        new ShortcutRegistry<Id>([
          { id: 'find', chords: ['Mod+F'], description: 'Buscar' },
          { id: 'save', chords: ['Mod+F'], description: 'Guardar' },
        ]),
    ).toThrow('Atajo duplicado: Mod+F');
  });

  it('Mod+f y Mod+F se consideran el mismo atajo', () => {
    expect(
      () =>
        new ShortcutRegistry<Id>([
          { id: 'find', chords: ['Mod+f'], description: 'Buscar' },
          { id: 'save', chords: ['Mod+F'], description: 'Guardar' },
        ]),
    ).toThrow('Atajo duplicado: Mod+F');
  });

  it('un mismo atajo repetido dentro de una definición también es duplicado', () => {
    expect(() => new ShortcutRegistry<Id>([{ id: 'find', chords: ['Mod+F', 'Mod+F'], description: 'Buscar' }])).toThrow(
      'Atajo duplicado: Mod+F',
    );
  });

  it('un atajo no válido lanza al construir el registro', () => {
    expect(() => new ShortcutRegistry<Id>([{ id: 'find', chords: ['Hyper+K'], description: 'X' }])).toThrow(
      'Atajo no válido: Hyper+K',
    );
  });
});
