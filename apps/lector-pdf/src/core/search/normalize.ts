export interface SearchOptions {
  readonly query: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly matchDiacritics: boolean;
}

export interface NormalizedText {
  readonly text: string;
  /** `map.length === text.length + 1`; `map[i]` es el índice en el original; `map[text.length]` es la longitud original. */
  readonly map: Int32Array;
}

export interface NormalizeOptions {
  readonly matchCase: boolean;
  readonly matchDiacritics: boolean;
}

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s/u;
const SOFT_HYPHEN = '­';

/**
 * Normaliza el texto para comparar: NFKC (ligaduras, anchos), sin tildes si `!matchDiacritics`,
 * en minúsculas si `!matchCase`, sin guiones blandos y con los espacios colapsados a uno.
 * Cada carácter emitido conserva el índice del punto de código original que lo produjo.
 */
export function normalizeText(raw: string, opts: NormalizeOptions): NormalizedText {
  const chars: string[] = [];
  const indices: number[] = [];
  let lastEmitted = '';
  let originalIndex = 0;

  for (const codePoint of raw) {
    const start = originalIndex;
    originalIndex += codePoint.length;
    if (codePoint === SOFT_HYPHEN) continue;

    let transformed = codePoint.normalize('NFKC');
    if (!opts.matchDiacritics) transformed = transformed.normalize('NFD').replace(COMBINING_MARKS, '');
    if (!opts.matchCase) transformed = transformed.toLocaleLowerCase('es');

    // Los espacios son BMP y de una sola unidad UTF-16, así que basta con recorrer unidades.
    for (let k = 0; k < transformed.length; k++) {
      const unit = transformed.charAt(k);
      if (WHITESPACE.test(unit)) {
        if (lastEmitted === ' ') continue;
        emit(' ', start);
      } else {
        emit(unit, start);
      }
    }
  }

  return {
    text: chars.join(''),
    map: Int32Array.from([...indices, raw.length]),
  };

  // Una entrada de `indices` por unidad UTF-16 emitida, para que map.length === text.length + 1.
  function emit(unit: string, index: number): void {
    chars.push(unit);
    indices.push(index);
    lastEmitted = unit;
  }
}

/** Consulta lista para `findInPage`: el mismo tratamiento que el texto, sin espacios sobrantes en los extremos. */
export function normalizeQuery(query: string, opts: NormalizeOptions): string {
  return normalizeText(query, opts).text.trim();
}
