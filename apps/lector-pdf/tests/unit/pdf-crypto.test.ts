import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cbc } from '@noble/ciphers/aes.js';
import { md5 } from '@noble/hashes/legacy.js';
import { describe, expect, it } from 'vitest';
import { decryptBytes, encryptBytes, openSecurity, rc4, type CryptMethod, type SecurityHandler } from '../../src/core/pdf/crypto';
import { decodeStreamData } from '../../src/core/pdf/filters';
import { parseIndirectObject } from '../../src/core/pdf/parser';
import { dict, name, withEntries, type PdfDict, type PdfStream, type PdfValue } from '../../src/core/pdf/objects';
import { FIXTURES_DIR } from '../fixtures/paths';

const USER = 'usuario';
const OWNER = 'propietario';

/**
 * Cifrados con contraseña de usuario y su base sin cifrar. `marker` es el texto de la página 1 que
 * identifica su flujo de contenido.
 */
const ENCRYPTED: readonly { readonly file: string; readonly base: string; readonly marker: string }[] = [
  { file: 'encrypted-rc4-40.pdf', base: 'basic-5.pdf', marker: 'P\\341gina 1 de 5' },
  { file: 'encrypted-rc4-128.pdf', base: 'basic-5.pdf', marker: 'P\\341gina 1 de 5' },
  { file: 'encrypted-aes-128.pdf', base: 'basic-5.pdf', marker: 'P\\341gina 1 de 5' },
  { file: 'encrypted-aes-256.pdf', base: 'basic-5.pdf', marker: 'P\\341gina 1 de 5' },
  { file: 'encrypted-aes-256-objstm.pdf', base: 'compressed.pdf', marker: 'P\\341gina 1 de 50' },
  { file: 'encrypted-annotated-aes-128.pdf', base: 'annotated.pdf', marker: 'P\\341gina 1 de 3' },
];

function loadFixture(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

/**
 * `/Encrypt` (diccionario) y primer elemento de `/ID` de un fichero, sin descifrar nada.
 * Se lee con el analizador directo: `ObjectReader` rechaza los ficheros con `/Encrypt` hasta PDF-093.
 */
function securityInputs(file: string): { encrypt: PdfDict; id0: Uint8Array } {
  const bytes = loadFixture(file);
  const text = new TextDecoder('latin1').decode(bytes);
  const refs = [...text.matchAll(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/g)];
  const last = refs[refs.length - 1];
  if (last === undefined) throw new Error(`${file}: no tiene /Encrypt`);
  const encrypt = findObject(bytes, Number(last[1]));
  if (!isDictValue(encrypt)) throw new Error(`${file}: /Encrypt no es un diccionario directo`);
  const id = /\/ID\s*\[\s*<([0-9A-Fa-f]*)>/.exec(text);
  if (id?.[1] === undefined) throw new Error(`${file}: /ID no es una cadena hexadecimal`);
  return { encrypt, id0: hexToBytes(id[1]) };
}

/** Último objeto indirecto con número `num` del fichero, o `undefined`. */
function findObject(bytes: Uint8Array, num: number): PdfValue | undefined {
  const text = new TextDecoder('latin1').decode(bytes);
  let found: PdfValue | undefined;
  for (const match of text.matchAll(/(?<!\d)(\d+)\s+(\d+)\s+obj\b/g)) {
    if (Number(match[1]) !== num) continue;
    try {
      found = parseIndirectObject(bytes, match.index).value;
    } catch {
      // Coincidencia dentro de datos binarios: no es un objeto.
    }
  }
  return found;
}

/**
 * Flujo decodificado que contiene `marker`. Con `handler`, cada flujo se descifra con su número y
 * generación antes de decodificarlo. Los que no se pueden decodificar se ignoran (p. ej. `/XRef`).
 */
function contentStreamWith(bytes: Uint8Array, marker: string, handler: SecurityHandler | null): Uint8Array | null {
  const text = new TextDecoder('latin1').decode(bytes);
  for (const match of text.matchAll(/(?<!\d)(\d+)\s+(\d+)\s+obj\b/g)) {
    let parsed;
    try {
      parsed = parseIndirectObject(bytes, match.index);
    } catch {
      continue;
    }
    if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value) || !('data' in parsed.value)) continue;
    const stream: PdfStream = parsed.value;
    const data = handler === null ? stream.data : decryptBytes(handler, 'stream', parsed.num, parsed.gen, stream.data);
    try {
      const decoded = decodeStreamData({ kind: 'stream', dict: stream.dict, data });
      if (new TextDecoder('latin1').decode(decoded).includes(marker)) return decoded;
    } catch {
      // No es un flujo de contenido decodificable con su filtro.
    }
  }
  return null;
}

async function openOrThrow(file: string, password: string): Promise<SecurityHandler> {
  const { encrypt, id0 } = securityInputs(file);
  const result = openSecurity(encrypt, id0, password);
  if (!result.ok) throw new Error(`${file} con «${password}»: ${result.error}`);
  return result.value;
}

function hexToBytes(hexText: string): Uint8Array {
  return Uint8Array.from({ length: hexText.length / 2 }, (_, i) => Number.parseInt(hexText.slice(2 * i, 2 * i + 2), 16));
}

function handlerFor(method: CryptMethod, fileKey: Uint8Array): SecurityHandler {
  return {
    revision: method === 'aes256' ? 6 : 4,
    fileKey,
    stringMethod: method,
    streamMethod: method,
    encryptMetadata: true,
    permissions: -4,
    authenticatedAs: 'user',
  };
}

const KEYS: Readonly<Record<CryptMethod, Uint8Array>> = {
  none: Uint8Array.from({ length: 16 }, (_, i) => i),
  rc4: Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i),
  aes128: Uint8Array.from({ length: 16 }, (_, i) => 0x20 + i),
  aes256: Uint8Array.from({ length: 32 }, (_, i) => 0x30 + i),
};

/** IV fijo para que el cifrado sea reproducible. */
const fixedRandom = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);

function sample(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * 31 + 5) & 0xff);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** AES-CBC sin relleno, para construir textos cifrados a mano. */
function encryptRaw(key: Uint8Array, iv: Uint8Array, plain: Uint8Array): Uint8Array {
  return cbc(key, iv, { disablePadding: true }).encrypt(plain);
}

describe('RC4', () => {
  it('RFC 6229: clave 0102030405, primeros 16 bytes del flujo de ceros', () => {
    const stream = rc4(Uint8Array.from([1, 2, 3, 4, 5]), new Uint8Array(16));
    expect(hex(stream)).toBe('b2 39 63 05 f0 3d c0 27 cc c3 52 4a 0a 11 18 a8');
  });

  it('es simétrico: cifrar dos veces devuelve el original', () => {
    const key = ascii('clave');
    const data = ascii('texto de prueba');
    expect(rc4(key, rc4(key, data))).toEqual(data);
  });

  it('rechaza una clave vacía o de más de 256 bytes', () => {
    expect(() => rc4(new Uint8Array(0), new Uint8Array(1))).toThrow(RangeError);
    expect(() => rc4(new Uint8Array(257), new Uint8Array(1))).toThrow(RangeError);
  });
});

describe('MD5 de referencia', () => {
  it('MD5 de «abc» es 900150983cd24fb0d6963f7d28e17f72', () => {
    expect(Array.from(md5(ascii('abc')), (b) => b.toString(16).padStart(2, '0')).join('')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});

describe('openSecurity con los fixtures cifrados', () => {
  for (const { file } of ENCRYPTED) {
    it(`${file}: usuario → user, propietario → owner con la misma clave, incorrecta → wrong-password`, () => {
      const { encrypt, id0 } = securityInputs(file);
      const asUser = openSecurity(encrypt, id0, USER);
      const asOwner = openSecurity(encrypt, id0, OWNER);
      const wrong = openSecurity(encrypt, id0, 'mal');
      expect(asUser.ok && asUser.value.authenticatedAs).toBe('user');
      expect(asOwner.ok && asOwner.value.authenticatedAs).toBe('owner');
      expect(asUser.ok && asOwner.ok && asOwner.value.fileKey).toEqual(asUser.ok ? asUser.value.fileKey : null);
      expect(wrong).toEqual({ ok: false, error: 'wrong-password' });
    });
  }

  it('encrypted-owner-only.pdf se abre con contraseña vacía como usuario y con la de propietario como owner', () => {
    const { encrypt, id0 } = securityInputs('encrypted-owner-only.pdf');
    const asUser = openSecurity(encrypt, id0, '');
    expect(asUser.ok && asUser.value.authenticatedAs).toBe('user');
    const asOwner = openSecurity(encrypt, id0, OWNER);
    expect(asOwner.ok && asOwner.value.authenticatedAs).toBe('owner');
  });

  it('reporta revisión, métodos y longitud de clave de cada versión', async () => {
    const rc4Handler = await openOrThrow('encrypted-rc4-40.pdf', USER);
    expect([rc4Handler.revision, rc4Handler.stringMethod, rc4Handler.streamMethod, rc4Handler.fileKey.length]).toEqual([2, 'rc4', 'rc4', 5]);
    const aes128 = await openOrThrow('encrypted-aes-128.pdf', USER);
    expect([aes128.revision, aes128.stringMethod, aes128.streamMethod, aes128.fileKey.length]).toEqual([4, 'aes128', 'aes128', 16]);
    const aes256 = await openOrThrow('encrypted-aes-256.pdf', USER);
    expect([aes256.revision, aes256.stringMethod, aes256.streamMethod, aes256.fileKey.length]).toEqual([6, 'aes256', 'aes256', 32]);
  });
});

describe('descifrado del contenido de la página 1', () => {
  for (const { file, base, marker } of ENCRYPTED) {
    it(`${file} descifra al mismo contenido que ${base}`, async () => {
      const handler = await openOrThrow(file, USER);
      const decrypted = contentStreamWith(loadFixture(file), marker, handler);
      const original = contentStreamWith(loadFixture(base), marker, null);
      expect(original).not.toBeNull();
      expect(decrypted).toEqual(original);
    });
  }

  it('encrypted-owner-only.pdf descifra con contraseña vacía al contenido de basic-5.pdf', async () => {
    const handler = await openOrThrow('encrypted-owner-only.pdf', '');
    const decrypted = contentStreamWith(loadFixture('encrypted-owner-only.pdf'), 'P\\341gina 1 de 5', handler);
    expect(decrypted).toEqual(contentStreamWith(loadFixture('basic-5.pdf'), 'P\\341gina 1 de 5', null));
  });

  it('basic-5.pdf: la página 1 dice «Página 1 de 5» (WinAnsi: á = \\341)', () => {
    const content = contentStreamWith(loadFixture('basic-5.pdf'), 'P\\341gina 1 de 5', null);
    expect(content).not.toBeNull();
    expect(new TextDecoder('latin1').decode(content ?? new Uint8Array(0))).toContain('(P\\341gina 1 de 5) Tj');
  });
});

describe('cifrado y descifrado de ida y vuelta', () => {
  const methods: readonly CryptMethod[] = ['none', 'rc4', 'aes128', 'aes256'];
  const sizes = [0, 1, 15, 16, 1000] as const;

  for (const method of methods) {
    it(`${method}: decryptBytes(encryptBytes(x)) = x para 0, 1, 15, 16 y 1000 bytes`, () => {
      const handler = handlerFor(method, KEYS[method]);
      for (const size of sizes) {
        const data = sample(size);
        const encrypted = encryptBytes(handler, 'string', 12, 0, data, fixedRandom);
        expect(decryptBytes(handler, 'string', 12, 0, encrypted)).toEqual(data);
        const streamed = encryptBytes(handler, 'stream', 12, 0, data, fixedRandom);
        expect(decryptBytes(handler, 'stream', 12, 0, streamed)).toEqual(data);
      }
    });

    it(`${method}: con el mismo IV el resultado es determinista`, () => {
      const handler = handlerFor(method, KEYS[method]);
      const data = sample(100);
      const first = encryptBytes(handler, 'stream', 7, 2, data, fixedRandom);
      const second = encryptBytes(handler, 'stream', 7, 2, data, fixedRandom);
      expect(second).toEqual(first);
    });
  }

  it('AES: el texto cifrado empieza por el IV y el relleno ocupa un bloque entero', () => {
    const handler = handlerFor('aes128', KEYS.aes128);
    const encrypted = encryptBytes(handler, 'string', 1, 0, sample(1), fixedRandom);
    expect(encrypted.length).toBe(32);
    expect(encrypted.subarray(0, 16)).toEqual(fixedRandom(16));
  });

  it('AES-256: el texto cifrado no contiene el texto claro', () => {
    const handler = handlerFor('aes256', KEYS.aes256);
    const data = ascii('secreto secreto secreto');
    const encrypted = encryptBytes(handler, 'string', 3, 0, data, fixedRandom);
    expect(encrypted.length).toBe(16 + 32);
    expect(hex(encrypted)).not.toContain(hex(data.subarray(0, 8)));
  });

  it('la clave de RC4 cambia con el número y la generación del objeto', () => {
    const handler = handlerFor('rc4', KEYS.rc4);
    const data = sample(64);
    const a = encryptBytes(handler, 'stream', 1, 0, data, fixedRandom);
    expect(encryptBytes(handler, 'stream', 2, 0, data, fixedRandom)).not.toEqual(a);
    expect(encryptBytes(handler, 'stream', 1, 1, data, fixedRandom)).not.toEqual(a);
  });

  it('encryptBytes rechaza un IV que no mide 16 bytes', () => {
    const handler = handlerFor('aes128', KEYS.aes128);
    expect(() => encryptBytes(handler, 'string', 1, 0, sample(4), () => new Uint8Array(8))).toThrow(RangeError);
  });

  it('descifrado AES tolerante: relleno inválido se devuelve sin quitar; datos truncados dan vacío', () => {
    const handler = handlerFor('aes256', KEYS.aes256);
    const iv = fixedRandom(16);
    const plainBlock = Uint8Array.from({ length: 16 }, (_, i) => (i === 15 ? 0x41 : 0x42));
    const result = decryptBytes(handler, 'string', 1, 0, concatBytes(iv, encryptRaw(KEYS.aes256, iv, plainBlock)));
    expect(result).toEqual(plainBlock);
    expect(decryptBytes(handler, 'string', 1, 0, new Uint8Array(10))).toEqual(new Uint8Array(0));
    expect(decryptBytes(handler, 'string', 1, 0, new Uint8Array(16))).toEqual(new Uint8Array(0));
    expect(decryptBytes(handler, 'string', 1, 0, new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  it('con Identity (none) los datos no cambian', () => {
    const handler = handlerFor('none', KEYS.none);
    const data = sample(20);
    expect(encryptBytes(handler, 'stream', 1, 0, data, fixedRandom)).toEqual(data);
    expect(decryptBytes(handler, 'stream', 1, 0, data)).toEqual(data);
  });
});

describe('diccionarios no soportados', () => {
  it('/Filter distinto de /Standard → unsupported', () => {
    const { encrypt, id0 } = securityInputs('encrypted-aes-128.pdf');
    expect(openSecurity(withEntries(encrypt, { Filter: name('FooBar') }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
  });

  it('/V 3 → unsupported', () => {
    const { encrypt, id0 } = securityInputs('encrypted-aes-128.pdf');
    expect(openSecurity(withEntries(encrypt, { V: 3 }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
  });

  it('/CFM /None en el filtro de flujos → unsupported', () => {
    const { encrypt, id0 } = securityInputs('encrypted-aes-128.pdf');
    const cf = dict({ StdCF: dict({ CFM: name('None'), AuthEvent: name('DocOpen'), Length: 16 }) });
    expect(openSecurity(withEntries(encrypt, { CF: cf }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
  });

  it('faltan campos obligatorios o R no existe → unsupported (sin lanzar)', () => {
    const { encrypt, id0 } = securityInputs('encrypted-aes-128.pdf');
    expect(openSecurity(withEntries(encrypt, { O: undefined }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
    expect(openSecurity(withEntries(encrypt, { R: undefined }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
    expect(openSecurity(withEntries(encrypt, { R: 7 }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
  });

  it('/Length no válido en RC4 → unsupported', () => {
    const { encrypt, id0 } = securityInputs('encrypted-rc4-128.pdf');
    expect(openSecurity(withEntries(encrypt, { Length: 60 }), id0, USER)).toEqual({ ok: false, error: 'unsupported' });
  });
});
