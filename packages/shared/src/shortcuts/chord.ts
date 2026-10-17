/** Atajo ya parseado. Lógica pura: no toca el DOM. */
export interface KeyChord {
  /** Normalizada: letras/dígitos en minúscula, '+', '-', 'ArrowLeft', 'F3', 'Space'... Vacía si el atajo usa `code:`. */
  readonly key: string;
  /** Solo si se escribió `code:X` (código físico de la tecla, p. ej. 'NumpadAdd'). */
  readonly code: string | null;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/** Subconjunto de `KeyboardEvent` que necesita el registro. */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const PLUS_ALIAS = 'Plus';
const MINUS_ALIAS = 'Minus';
const CODE_PREFIX = 'code:';
const NON_TEXT_INPUT_TYPES: ReadonlySet<unknown> = new Set(['checkbox', 'radio', 'button', 'submit', 'range', 'color']);

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ArrowLeft: 'Flecha izquierda',
  ArrowRight: 'Flecha derecha',
  ArrowUp: 'Flecha arriba',
  ArrowDown: 'Flecha abajo',
  PageUp: 'Re Pág',
  PageDown: 'Av Pág',
  Home: 'Inicio',
  End: 'Fin',
  Escape: 'Esc',
  Enter: 'Intro',
  Delete: 'Supr',
  Backspace: 'Retroceso',
  Space: 'Espacio',
};

const CODE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  NumpadAdd: '+ (teclado numérico)',
  NumpadSubtract: '- (teclado numérico)',
};

/** Tecla de un único carácter que no es letra ni dígito: en muchos teclados exige Mayús. */
function ignoresShift(key: string): boolean {
  return Array.from(key).length === 1 && !/^[\p{L}\p{Nd}]$/u.test(key);
}

/** Normaliza una tecla (de un atajo o de un evento) a la forma canónica del registro. */
function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  return Array.from(key).length === 1 ? key.toLowerCase() : key;
}

/**
 * Parsea texto tipo "Mod+Shift+N". Lanza si el texto no es válido: un atajo mal escrito es un bug.
 */
export function parseChord(text: string): KeyChord {
  const invalid = (): Error => new Error(`Atajo no válido: ${text}`);
  const parts = text.split('+');
  const last = parts.pop();
  if (last === undefined || last === '') throw invalid();

  let mod = false;
  let shift = false;
  let alt = false;
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'mod':
        mod = true;
        break;
      case 'shift':
        shift = true;
        break;
      case 'alt':
        alt = true;
        break;
      default:
        throw invalid();
    }
  }

  if (last.startsWith(CODE_PREFIX)) {
    const code = last.slice(CODE_PREFIX.length);
    if (code === '') throw invalid();
    return { key: '', code, mod, shift, alt };
  }

  const name = last === PLUS_ALIAS ? '+' : last === MINUS_ALIAS ? '-' : last;
  return { key: normalizeKey(name), code: null, mod, shift, alt };
}

/** Forma canónica para comparar atajos: "mod+shift+alt+<key|code:X>", solo con modificadores activos. */
export function chordId(c: KeyChord): string {
  const parts: string[] = [];
  if (c.mod) parts.push('mod');
  if (c.shift) parts.push('shift');
  if (c.alt) parts.push('alt');
  parts.push(c.code === null ? c.key : `code:${c.code}`);
  return parts.join('+');
}

/**
 * Indica si el evento dispara el atajo. `Mod` es Ctrl en Windows/Linux y Cmd (meta) en Mac;
 * la otra tecla debe estar suelta. Sin `Mod` en el atajo, ni Ctrl ni Cmd pueden estar pulsadas.
 */
export function matchChord(e: KeyEventLike, c: KeyChord, isMac: boolean): boolean {
  const primary = isMac ? e.metaKey : e.ctrlKey;
  const other = isMac ? e.ctrlKey : e.metaKey;
  if (primary !== c.mod || other) return false;
  if (e.altKey !== c.alt) return false;

  if (c.code !== null) return e.code === c.code && e.shiftKey === c.shift;

  if (normalizeKey(e.key) !== c.key) return false;
  return ignoresShift(c.key) || e.shiftKey === c.shift;
}

/** Texto del atajo para tooltips y menús, en español. Fuera de Mac: "Ctrl+Mayús+N"; en Mac: "⌘⇧N". */
export function formatChord(c: KeyChord, isMac: boolean): string {
  const keyName =
    c.code !== null
      ? (CODE_DISPLAY_NAMES[c.code] ?? c.code)
      : (DISPLAY_NAMES[c.key] ?? (Array.from(c.key).length === 1 ? c.key.toUpperCase() : c.key));

  if (isMac) {
    return `${c.mod ? '⌘' : ''}${c.shift ? '⇧' : ''}${c.alt ? '⌥' : ''}${keyName}`;
  }
  const mods: string[] = [];
  if (c.mod) mods.push('Ctrl');
  if (c.shift) mods.push('Mayús');
  if (c.alt) mods.push('Alt');
  return [...mods, keyName].join('+');
}

/** `true` si el destino es un control de texto editable (no se deben capturar atajos de letras). */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  if ('isContentEditable' in target && target.isContentEditable === true) return true;
  const tagName = 'tagName' in target ? target.tagName : undefined;
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName !== 'INPUT') return false;
  const type = 'type' in target ? target.type : undefined;
  return !NON_TEXT_INPUT_TYPES.has(type);
}
