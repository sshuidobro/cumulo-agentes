/**
 * Cifrado de un objeto que se escribe en un incremento (ISO 32000-1 §7.6.2, ADR-0022). Las reglas de
 * qué se cifra están en `crypt-rules.ts`, compartidas con la lectura.
 */
import { encryptBytes, type SecurityHandler } from './crypto';
import { streamIsPlain, transformObject, type RandomBytes } from './crypt-rules';
import type { PdfValue } from './objects';

/**
 * Copia de `v` (objeto `num gen`) con todas sus cadenas cifradas y, en los flujos que no sean
 * `/XRef` ni estén exentos, los datos cifrados con `/Length` actualizado. `random` aporta los IV de AES.
 */
export function encryptValue(h: SecurityHandler, num: number, gen: number, v: PdfValue, random: RandomBytes): PdfValue {
  return transformObject(
    v,
    (d) => streamIsPlain(d, h),
    (kind, data) => encryptBytes(h, kind, num, gen, data, random),
  );
}
