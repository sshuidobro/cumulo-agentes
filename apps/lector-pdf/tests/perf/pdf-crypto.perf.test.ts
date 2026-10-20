import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSecurity } from '../../src/core/pdf/crypto';
import { parseIndirectObject } from '../../src/core/pdf/parser';
import { type PdfDict } from '../../src/core/pdf/objects';
import { FIXTURES_DIR } from '../fixtures/paths';
import { measureBest } from './measure';

/** `/Encrypt` y primer `/ID` leídos del texto del fichero (el analizador de `ObjectReader` rechaza cifrados hasta PDF-093). */
function encryptInputs(file: string): { encrypt: PdfDict; id0: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
  const text = new TextDecoder('latin1').decode(bytes);
  const refs = [...text.matchAll(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/g)];
  const last = refs[refs.length - 1];
  if (last === undefined) throw new Error(`${file}: no tiene /Encrypt`);
  let encrypt: PdfDict | null = null;
  for (const match of text.matchAll(/(?<!\d)(\d+)\s+(\d+)\s+obj\b/g)) {
    if (Number(match[1]) !== Number(last[1])) continue;
    const parsed = parseIndirectObject(bytes, match.index);
    if (typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value) && 'kind' in parsed.value && parsed.value.kind === 'dict') {
      encrypt = parsed.value;
    }
  }
  const id = /\/ID\s*\[\s*<([0-9A-Fa-f]*)>/.exec(text);
  if (encrypt === null || id?.[1] === undefined) throw new Error(`${file}: no se pueden leer /Encrypt y /ID`);
  const hexId = id[1];
  return { encrypt, id0: Uint8Array.from({ length: hexId.length / 2 }, (_, i) => Number.parseInt(hexId.slice(2 * i, 2 * i + 2), 16)) };
}

describe('rendimiento del manejador de seguridad', () => {
  it('openSecurity con AES-256 (R6) tarda menos de 50 ms (mejor de 5)', () => {
    const { encrypt, id0 } = encryptInputs('encrypted-aes-256.pdf');
    const { value, ms } = measureBest(() => openSecurity(encrypt, id0, 'usuario'));
    expect(value.ok && value.value.authenticatedAs).toBe('user');
    expect(ms).toBeLessThan(50);
  });
});
