import { describe, expect, it } from 'vitest';
import { ShortcutRegistry, formatChord, isEditableTarget, matchChord, parseChord } from '../../src';
import type { KeyEventLike } from '../../src';

const ev = (o: Partial<KeyEventLike>): KeyEventLike => ({
  key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o,
});

describe('QA atajos: casos límite', () => {
  it('modificadores sin distinguir mayúsculas y orden libre', () => {
    expect(parseChord('mOd+ALT+shift+x')).toEqual({ key: 'x', code: null, mod: true, shift: true, alt: true });
  });
  it('rechaza basura', () => {
    for (const t of ['+', 'Mod++', 'Mod+Mod+', '++', 'Mod+code:', 'Ctrl+S']) {
      expect(() => parseChord(t), t).toThrow('Atajo no válido');
    }
  });
  it('Unicode: ñ, tildes y emojis', () => {
    expect(matchChord(ev({ key: 'Ñ', ctrlKey: true, shiftKey: true }), parseChord('Mod+Shift+ñ'), false)).toBe(true);
    expect(matchChord(ev({ key: '😀', ctrlKey: true }), parseChord('Mod+😀'), false)).toBe(true);
    expect(formatChord(parseChord('Mod+ñ'), false)).toBe('Ctrl+Ñ');
  });
  it('teclas muertas / IME no coinciden con nada', () => {
    const r = new ShortcutRegistry([{ id: 'a', chords: ['Mod+S'], description: 'x' }]);
    expect(r.match(ev({ key: 'Dead', ctrlKey: true }), false)).toBeNull();
    expect(r.match(ev({ key: 'Process', ctrlKey: true }), false)).toBeNull();
    expect(r.match(ev({ key: '', ctrlKey: true }), false)).toBeNull();
  });
  it('Mayús extra en atajo de letra no coincide; Space funciona', () => {
    expect(matchChord(ev({ key: 's', ctrlKey: true, shiftKey: true }), parseChord('Mod+S'), false)).toBe(false);
    expect(matchChord(ev({ key: ' ' }), parseChord('Space'), false)).toBe(true);
  });
  it('code: exige Mayús coherente', () => {
    expect(matchChord(ev({ code: 'NumpadAdd', ctrlKey: true }), parseChord('Mod+code:NumpadAdd'), false)).toBe(true);
    expect(matchChord(ev({ code: 'NumpadAdd', ctrlKey: true, altKey: true }), parseChord('Mod+code:NumpadAdd'), false)).toBe(false);
  });
  it('duplicados: dentro del mismo def, entre ids y orden de modificadores', () => {
    expect(() => new ShortcutRegistry([{ id: 'a', chords: ['Mod+S', 'mod+s'], description: '' }])).toThrow('Atajo duplicado');
    expect(() => new ShortcutRegistry([
      { id: 'a', chords: ['Mod+Shift+Alt+K'], description: '' },
      { id: 'b', chords: ['Alt+Shift+Mod+k'], description: '' },
    ])).toThrow('Atajo duplicado');
    expect(() => new ShortcutRegistry([{ id: 'a', chords: ['Hyper+K'], description: '' }])).toThrow('Atajo no válido');
  });
  it('registro vacío y chordsFor de id sin atajos', () => {
    const r = new ShortcutRegistry<'a'>([{ id: 'a', chords: [], description: '' }]);
    expect(r.match(ev({ key: 'a' }), false)).toBeNull();
    expect(r.chordsFor('a', true)).toEqual([]);
  });
  it('isEditableTarget: variantes', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    for (const type of ['radio', 'button', 'submit', 'range', 'color']) {
      expect(isEditableTarget({ tagName: 'INPUT', type })).toBe(false);
    }
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget('INPUT')).toBe(false);
    expect(isEditableTarget(42)).toBe(false);
  });
});
