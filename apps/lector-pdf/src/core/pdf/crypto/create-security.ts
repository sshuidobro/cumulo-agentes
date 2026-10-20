/**
 * Creación de un cifrado estándar nuevo: AES-256 revisión 6 (ISO 32000-2 §7.6.4.3.3, alg. 2.B, y
 * §7.6.4.4.7 a §7.6.4.4.9, algoritmos 8, 9 y 10). Puro: sin React, sin pdf.js. Decisión en ADR-0037.
 * Con el mismo `random` el resultado es determinista; con `secureRandom` cada cifrado es distinto.
 */
import { cbc, ecb } from '@noble/ciphers/aes.js';
import type { RandomBytes } from '../crypt-rules';
import { dict, bytesString, name, type PdfDict } from '../objects';
import { PERMISSION_FLAG } from '../../permissions';
import { hashAes256, saslPrep, type SecurityHandler } from './security';

/** Permisos que se conceden al abrir con la contraseña de usuario (bits de `/P`, ISO 32000-2 tabla 22). */
export interface PermissionChoice {
  /** `none` no imprime; `low` imprime en baja calidad (bit 3); `high` también en alta (bit 12). */
  readonly print: 'none' | 'low' | 'high';
  readonly modify: boolean; // bit 4 (8)
  readonly copy: boolean; // bit 5 (16)
  readonly annotate: boolean; // bit 6 (32)
  readonly fillForms: boolean; // bit 9 (256)
  readonly assemble: boolean; // bit 11 (1024)
}

/** Todo permitido. */
export const ALL_ALLOWED: PermissionChoice = {
  print: 'high',
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  assemble: true,
};

export interface NewSecurityInput {
  /** '' = se abre sin contraseña. */
  readonly userPassword: string;
  /** '' = aleatoria de 32 bytes (nadie podrá cambiar los permisos). */
  readonly ownerPassword: string;
  readonly permissions: PermissionChoice;
  readonly random: RandomBytes;
}

export interface NewSecurity {
  readonly handler: SecurityHandler;
  readonly encrypt: PdfDict;
}

/** Bits de `/P` que están a 1 por la norma: reservados 7-8 y 13-32, y el 10 («accesibilidad»). */
const RESERVED_P = 0xfffff0c0 | 0x200;
const AES_BLOCK = 16;
const FILE_KEY_BYTES = 32;
const SALT_BYTES = 8;
const PERMS_RANDOM_BYTES = 4;
const OWNER_RANDOM_BYTES = 32;
const EMPTY = new Uint8Array(0);

/** `/P` como entero con signo de 32 bits. */
export function permissionsValue(p: PermissionChoice): number {
  let value = RESERVED_P;
  if (p.print !== 'none') value |= PERMISSION_FLAG.PRINT;
  if (p.print === 'high') value |= PERMISSION_FLAG.PRINT_HIGH_QUALITY;
  if (p.modify) value |= PERMISSION_FLAG.MODIFY_CONTENTS;
  if (p.copy) value |= PERMISSION_FLAG.COPY;
  if (p.annotate) value |= PERMISSION_FLAG.MODIFY_ANNOTATIONS;
  if (p.fillForms) value |= PERMISSION_FLAG.FILL_INTERACTIVE_FORMS;
  if (p.assemble) value |= PERMISSION_FLAG.ASSEMBLE;
  return value | 0;
}

/** Crea la clave del fichero, las entradas `U`, `UE`, `O`, `OE`, `Perms` y el diccionario `/Encrypt`. */
export function createAes256Security(input: NewSecurityInput): NewSecurity {
  const { random } = input;
  const userPw = saslPrep(input.userPassword);
  // El orden de las llamadas a `random` forma parte del contrato: contraseña de propietario, clave, sales, Perms.
  const ownerPw = input.ownerPassword === '' ? randomOf(random, OWNER_RANDOM_BYTES) : saslPrep(input.ownerPassword);
  const fileKey = randomOf(random, FILE_KEY_BYTES);
  const uValSalt = randomOf(random, SALT_BYTES);
  const uKeySalt = randomOf(random, SALT_BYTES);
  const oValSalt = randomOf(random, SALT_BYTES);
  const oKeySalt = randomOf(random, SALT_BYTES);
  const permsRandom = randomOf(random, PERMS_RANDOM_BYTES);

  const p = permissionsValue(input.permissions);

  const u = concat(hashAes256(6, userPw, uValSalt, EMPTY), uValSalt, uKeySalt);
  const ue = aesNoPadding(hashAes256(6, userPw, uKeySalt, EMPTY), fileKey);
  const o = concat(hashAes256(6, ownerPw, oValSalt, u), oValSalt, oKeySalt);
  const oe = aesNoPadding(hashAes256(6, ownerPw, oKeySalt, u), fileKey);

  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p, true);
  const permsPlain = concat(pBytes, Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x54, 0x61, 0x64, 0x62]), permsRandom);
  const perms = ecb(fileKey, { disablePadding: true }).encrypt(permsPlain);

  const handler: SecurityHandler = {
    revision: 6,
    fileKey,
    stringMethod: 'aes256',
    streamMethod: 'aes256',
    encryptMetadata: true,
    permissions: p,
    authenticatedAs: 'owner',
  };

  const encrypt = dict({
    Filter: name('Standard'),
    V: 5,
    R: 6,
    Length: 256,
    CF: dict({
      StdCF: dict({ AuthEvent: name('DocOpen'), CFM: name('AESV3'), Length: 32 }),
    }),
    StmF: name('StdCF'),
    StrF: name('StdCF'),
    O: bytesString(o, true),
    U: bytesString(u, true),
    OE: bytesString(oe, true),
    UE: bytesString(ue, true),
    Perms: bytesString(perms, true),
    P: p,
    EncryptMetadata: true,
  });

  return { handler, encrypt };
}

/** Bytes aleatorios de longitud exacta; un generador que devuelva otra longitud es un error de programa. */
function randomOf(random: RandomBytes, n: number): Uint8Array {
  const out = random(n);
  if (out.length !== n) throw new RangeError(`createAes256Security: se pidieron ${n} bytes aleatorios y llegaron ${out.length}`);
  return out;
}

/** AES-256-CBC sin relleno e IV cero: cifra la clave del fichero (algoritmos 8 y 9). */
function aesNoPadding(key: Uint8Array, data: Uint8Array): Uint8Array {
  return cbc(key, new Uint8Array(AES_BLOCK), { disablePadding: true }).encrypt(data);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
