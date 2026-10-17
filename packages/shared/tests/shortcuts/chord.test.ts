import { describe, expect, it } from 'vitest';
import {
  chordId,
  formatChord,
  isEditableTarget,
  matchChord,
  parseChord,
} from '../../src/shortcuts/index';
import type { KeyEventLike } from '../../src/shortcuts/index';

/** Evento sin modificadores por defecto; cada test activa solo lo que necesita. */
function ev(partial: Partial<KeyEventLike> & Pick<KeyEventLike, 'key'>): KeyEventLike {
  return { code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial };
}

describe('parseChord', () => {
  it('parsea modificadores y tecla en minúscula', () => {
    expect(parseChord('Mod+Shift+N')).toEqual({ key: 'n', code: null, mod: true, shift: true, alt: false });
  });

  it('acepta modificadores sin distinguir mayúsculas', () => {
    expect(parseChord('mod+ALT+f3')).toEqual({ key: 'f3', code: null, mod: true, shift: false, alt: true });
  });

  it('traduce Plus, Minus y el espacio', () => {
    expect(parseChord('Mod+Plus').key).toBe('+');
    expect(parseChord('Minus').key).toBe('-');
    expect(parseChord('Mod+ ').key).toBe('Space');
    expect(parseChord('Mod+Space').key).toBe('Space');
  });

  it('acepta códigos físicos con code:', () => {
    expect(parseChord('Mod+code:NumpadAdd')).toEqual({ key: '', code: 'NumpadAdd', mod: true, shift: false, alt: false });
  });

  it('lanza con texto vacío, modificador desconocido, tecla vacía o code: vacío', () => {
    expect(() => parseChord('')).toThrow('Atajo no válido: ');
    expect(() => parseChord('Hyper+K')).toThrow('Atajo no válido: Hyper+K');
    expect(() => parseChord('Mod+')).toThrow('Atajo no válido: Mod+');
    expect(() => parseChord('Mod+code:')).toThrow('Atajo no válido: Mod+code:');
    expect(() => parseChord('+')).toThrow('Atajo no válido: +');
  });
});

describe('chordId', () => {
  it('es igual para escrituras equivalentes y solo incluye modificadores activos', () => {
    expect(chordId(parseChord('Mod+F'))).toBe(chordId(parseChord('mod+f')));
    expect(chordId(parseChord('Shift+Mod+N'))).toBe('mod+shift+n');
    expect(chordId(parseChord('Alt+ArrowLeft'))).toBe('alt+ArrowLeft');
    expect(chordId(parseChord('Mod+code:NumpadAdd'))).toBe('mod+code:NumpadAdd');
  });
});

describe('matchChord', () => {
  it('Ctrl+Mayús+N coincide con Mod+Shift+N en Windows y no en Mac', () => {
    const e = ev({ key: 'N', ctrlKey: true, shiftKey: true });
    const c = parseChord('Mod+Shift+N');
    expect(matchChord(e, c, false)).toBe(true);
    expect(matchChord(e, c, true)).toBe(false);
  });

  it('Meta+F coincide con Mod+F en Mac y no en Windows', () => {
    const e = ev({ key: 'f', metaKey: true });
    const c = parseChord('Mod+F');
    expect(matchChord(e, c, true)).toBe(true);
    expect(matchChord(e, c, false)).toBe(false);
  });

  it('Ctrl+Meta+F no coincide con Mod+F en ninguna plataforma', () => {
    const e = ev({ key: 'f', ctrlKey: true, metaKey: true });
    expect(matchChord(e, parseChord('Mod+F'), false)).toBe(false);
    expect(matchChord(e, parseChord('Mod+F'), true)).toBe(false);
  });

  it('Ctrl+Mayús++ coincide con Mod+Plus (el + ignora Mayús)', () => {
    const e = ev({ key: '+', ctrlKey: true, shiftKey: true });
    expect(matchChord(e, parseChord('Mod+Plus'), false)).toBe(true);
  });

  it('Ctrl+0 coincide con Mod+0, pero Ctrl+Mayús+0 no (los dígitos exigen Mayús exacta)', () => {
    const c = parseChord('Mod+0');
    expect(matchChord(ev({ key: '0', ctrlKey: true }), c, false)).toBe(true);
    expect(matchChord(ev({ key: '0', ctrlKey: true, shiftKey: true }), c, false)).toBe(false);
  });

  it('Alt+ArrowLeft no coincide con ArrowLeft y sí con Alt+ArrowLeft', () => {
    const e = ev({ key: 'ArrowLeft', altKey: true });
    expect(matchChord(e, parseChord('ArrowLeft'), false)).toBe(false);
    expect(matchChord(e, parseChord('Alt+ArrowLeft'), false)).toBe(true);
  });

  it('una tecla sin modificador no coincide si Ctrl o Meta están pulsadas', () => {
    expect(matchChord(ev({ key: 'F3', ctrlKey: true }), parseChord('F3'), false)).toBe(false);
    expect(matchChord(ev({ key: 'F3', metaKey: true }), parseChord('F3'), true)).toBe(false);
    expect(matchChord(ev({ key: 'F3' }), parseChord('F3'), false)).toBe(true);
  });

  it('exige que Mayús coincida cuando la tecla es letra y el atajo no la pide', () => {
    expect(matchChord(ev({ key: 'S', ctrlKey: true, shiftKey: true }), parseChord('Mod+S'), false)).toBe(false);
  });

  it('compara por code: con el código físico y respeta Mayús', () => {
    const c = parseChord('Mod+code:NumpadAdd');
    expect(matchChord(ev({ key: '+', code: 'NumpadAdd', ctrlKey: true }), c, false)).toBe(true);
    expect(matchChord(ev({ key: '+', code: 'Equal', ctrlKey: true }), c, false)).toBe(false);
    expect(matchChord(ev({ key: '+', code: 'NumpadAdd', ctrlKey: true, shiftKey: true }), c, false)).toBe(false);
  });

  it('normaliza la tecla del evento: espacio y mayúsculas', () => {
    expect(matchChord(ev({ key: ' ', ctrlKey: true }), parseChord('Mod+Space'), false)).toBe(true);
  });

  it('una tecla que no coincide devuelve false', () => {
    expect(matchChord(ev({ key: 'g', ctrlKey: true }), parseChord('Mod+F'), false)).toBe(false);
  });
});

describe('formatChord', () => {
  it('fuera de Mac usa Ctrl, Mayús y Alt en ese orden', () => {
    expect(formatChord(parseChord('Mod+Shift+N'), false)).toBe('Ctrl+Mayús+N');
    expect(formatChord(parseChord('Alt+Shift+Mod+ArrowLeft'), false)).toBe('Ctrl+Mayús+Alt+Flecha izquierda');
  });

  it('en Mac usa ⌘, ⇧ y ⌥ sin separador', () => {
    expect(formatChord(parseChord('Mod+Shift+N'), true)).toBe('⌘⇧N');
    expect(formatChord(parseChord('Mod+Alt+Shift+N'), true)).toBe('⌘⇧⌥N');
  });

  it('traduce los nombres de tecla al español', () => {
    expect(formatChord(parseChord('Alt+ArrowLeft'), false)).toBe('Alt+Flecha izquierda');
    expect(formatChord(parseChord('PageDown'), false)).toBe('Av Pág');
    expect(formatChord(parseChord('ArrowRight'), false)).toBe('Flecha derecha');
    expect(formatChord(parseChord('ArrowUp'), false)).toBe('Flecha arriba');
    expect(formatChord(parseChord('ArrowDown'), false)).toBe('Flecha abajo');
    expect(formatChord(parseChord('PageUp'), false)).toBe('Re Pág');
    expect(formatChord(parseChord('Home'), false)).toBe('Inicio');
    expect(formatChord(parseChord('End'), false)).toBe('Fin');
    expect(formatChord(parseChord('Escape'), false)).toBe('Esc');
    expect(formatChord(parseChord('Enter'), false)).toBe('Intro');
    expect(formatChord(parseChord('Delete'), false)).toBe('Supr');
    expect(formatChord(parseChord('Backspace'), false)).toBe('Retroceso');
    expect(formatChord(parseChord('Mod+Space'), false)).toBe('Ctrl+Espacio');
  });

  it('muestra en mayúscula las letras y deja tal cual el resto de teclas', () => {
    expect(formatChord(parseChord('Mod+F3'), false)).toBe('Ctrl+F3');
    expect(formatChord(parseChord('Mod+Q'), false)).toBe('Ctrl+Q');
    expect(formatChord(parseChord('Mod+Plus'), false)).toBe('Ctrl++');
    expect(formatChord(parseChord('Mod+Minus'), true)).toBe('⌘-');
  });

  it('formatea códigos físicos conocidos y, si no, muestra el código tal cual', () => {
    expect(formatChord(parseChord('Mod+code:NumpadAdd'), false)).toBe('Ctrl++ (teclado numérico)');
    expect(formatChord(parseChord('Mod+code:NumpadSubtract'), false)).toBe('Ctrl+- (teclado numérico)');
    expect(formatChord(parseChord('Mod+code:Numpad5'), true)).toBe('⌘Numpad5');
  });
});

describe('isEditableTarget', () => {
  it('es true para INPUT de texto', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
  });

  it('es false para INPUT de tipo checkbox, radio, button, submit, range o color', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color']) {
      expect(isEditableTarget({ tagName: 'INPUT', type })).toBe(false);
    }
  });

  it('es true para TEXTAREA, SELECT y elementos contentEditable', () => {
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ isContentEditable: true })).toBe(true);
  });

  it('es false para otros elementos, null, primitivos o isContentEditable falso', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget({ isContentEditable: false, tagName: 'DIV' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget('INPUT')).toBe(false);
  });
});
