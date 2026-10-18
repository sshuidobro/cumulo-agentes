/**
 * Base64 (RFC 4648, con relleno) sobre `Uint8Array`, sin `btoa`/`atob`: `core/` no depende del DOM.
 * `lib` de TypeScript del proyecto no tiene `Uint8Array.prototype.toBase64`, por eso va aquí.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PAD = '=';

const DECODE: Readonly<Record<string, number>> = Object.fromEntries(
  [...ALPHABET].map((c, i) => [c, i] as const),
);

/** Codifica bytes en base64 estándar con relleno. */
export function toBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out.push(
      ALPHABET[(n >>> 18) & 63] ?? '',
      ALPHABET[(n >>> 12) & 63] ?? '',
      ALPHABET[(n >>> 6) & 63] ?? '',
      ALPHABET[n & 63] ?? '',
    );
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out.push(ALPHABET[(n >>> 18) & 63] ?? '', ALPHABET[(n >>> 12) & 63] ?? '', PAD, PAD);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out.push(ALPHABET[(n >>> 18) & 63] ?? '', ALPHABET[(n >>> 12) & 63] ?? '', ALPHABET[(n >>> 6) & 63] ?? '', PAD);
  }
  return out.join('');
}

/**
 * Decodifica base64 estándar con relleno. Devuelve `null` si la longitud no es múltiplo de 4, si hay un
 * carácter fuera del alfabeto o si el relleno no está al final. Nunca lanza.
 */
export function fromBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith(PAD) ? 1 : 0;
  const body = text.length - pad;
  // Todo lo que no es relleno debe estar en el alfabeto; el relleno no puede aparecer antes.
  for (let i = 0; i < body; i++) {
    if (DECODE[text.charAt(i)] === undefined) return null;
  }
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let at = 0;
  for (let i = 0; i < body; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      // Los caracteres de relleno valen 0 (sus bits no se usan porque no caben en la salida).
      n = (n << 6) | (DECODE[text.charAt(i + k)] ?? 0);
    }
    for (const b of [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]) {
      if (at < out.length) out[at++] = b;
    }
  }
  return out;
}
