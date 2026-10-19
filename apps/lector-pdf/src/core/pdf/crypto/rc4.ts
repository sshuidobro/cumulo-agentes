/**
 * RC4 (ARC4) para el cifrado estándar de PDF (ISO 32000-1 §7.6.2). Solo para leer y escribir
 * ficheros cifrados con RC4; el algoritmo es inseguro y no se usa para nada nuevo.
 */

/** Cifra o descifra (RC4 es simétrico) `data` con `key` (1 a 256 bytes). Devuelve bytes nuevos. */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length === 0 || key.length > 256) throw new RangeError(`rc4: la clave debe tener entre 1 y 256 bytes (tiene ${key.length})`);
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (s[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    swap(s, i, j);
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + (s[a] ?? 0)) & 0xff;
    swap(s, a, b);
    const keystream = s[((s[a] ?? 0) + (s[b] ?? 0)) & 0xff] ?? 0;
    out[k] = (data[k] ?? 0) ^ keystream;
  }
  return out;
}

function swap(s: Uint8Array, i: number, j: number): void {
  const t = s[i] ?? 0;
  s[i] = s[j] ?? 0;
  s[j] = t;
}
