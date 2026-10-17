/**
 * Codificación WinAnsi (Windows-1252) para cadenas de fuentes simples (ISO 32000-1, Anexo D).
 * Latin-1 imprimible (0x20-0x7E y 0xA0-0xFF) más los 27 caracteres de 0x80-0x9F de Windows-1252.
 */

/** Caracteres de 0x80-0x9F. Los cinco códigos sin carácter asignado (0x81, 0x8D, 0x8F, 0x90, 0x9D) no están. */
const C1_CODES: ReadonlyMap<string, number> = new Map([
  ['€', 0x80],
  ['‚', 0x82],
  ['ƒ', 0x83],
  ['„', 0x84],
  ['…', 0x85],
  ['†', 0x86],
  ['‡', 0x87],
  ['ˆ', 0x88],
  ['‰', 0x89],
  ['Š', 0x8a],
  ['‹', 0x8b],
  ['Œ', 0x8c],
  ['Ž', 0x8e],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
  ['˜', 0x98],
  ['™', 0x99],
  ['š', 0x9a],
  ['›', 0x9b],
  ['œ', 0x9c],
  ['ž', 0x9e],
  ['Ÿ', 0x9f],
]);

const UNMAPPABLE = 0x3f; // '?'

function codeOf(ch: string): number {
  const cp = ch.codePointAt(0) ?? UNMAPPABLE;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return C1_CODES.get(ch) ?? UNMAPPABLE;
}

/** Bytes WinAnsi de `s`. Cada punto de código sin representación (incluidos los emoji) se sustituye por `?`. */
export function toWinAnsi(s: string): Uint8Array {
  const chars = [...s];
  const out = new Uint8Array(chars.length);
  chars.forEach((ch, i) => {
    out[i] = codeOf(ch);
  });
  return out;
}
