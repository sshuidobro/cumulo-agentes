import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RandomBytes } from '../../../src/core/pdf/crypt-rules';
import { ALL_ALLOWED, createAes256Security, permissionsValue, type NewSecurity, type PermissionChoice } from '../../../src/core/pdf/crypto/create-security';
import { openSecurity } from '../../../src/core/pdf/crypto';
import { encryptValue } from '../../../src/core/pdf/encrypt-value';
import { dict, name, ref, stream, type PdfValue } from '../../../src/core/pdf/objects';
import { serializeIndirect } from '../../../src/core/pdf/serialize';
import { PERMISSION_FLAG, permissionsFrom } from '../../../src/core/permissions';
import { loadPdf } from '../../../src/engine';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { run, qpdfCheck } from '../../support/qpdf';

const USER = 'usuario';
const OWNER = 'propietario';
const ID0 = Uint8Array.from({ length: 16 }, (_, i) => (i * 13 + 1) & 0xff);

const NONE: PermissionChoice = { print: 'none', modify: false, copy: false, annotate: false, fillForms: false, assemble: false };

const ALL_COMBINATIONS: readonly PermissionChoice[] = (['none', 'low', 'high'] as const).flatMap((print) =>
  [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].flatMap((c) => [0, 1].flatMap((d) => [0, 1].map((e) => ({
    print,
    modify: a === 1,
    copy: b === 1,
    annotate: c === 1,
    fillForms: d === 1,
    assemble: e === 1,
  })))))),
);
/** Permisos ya elegidos para el caso de contraseña de propietario vacía: nada permitido salvo copiar. */
const NONE_ALLOWED: PermissionChoice = { ...NONE, copy: true };


/**
 * Generador determinista: el byte k de la secuencia global es (k * 37 + 11) mod 256. Así el resultado
 * no depende del azar y los valores golden son reproducibles.
 */
function fixedRandom(): RandomBytes {
  let k = 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = (k * 37 + 11) & 0xff;
      k++;
    }
    return out;
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function stringHex(value: PdfValue | undefined): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('kind' in value) || value.kind !== 'string') {
    throw new Error('se esperaba una cadena');
  }
  return hex(value.bytes);
}

function entry(security: NewSecurity, key: string): PdfValue {
  const value = security.encrypt.entries.get(key);
  if (value === undefined) throw new Error(`falta /${key}`);
  return value;
}

describe('permisos /P', () => {
  it('ALL_ALLOWED da -4 (0xFFFFFFFC con signo)', () => {
    expect(permissionsValue(ALL_ALLOWED)).toBe(-4);
  });

  it('solo imprimir en baja calidad: bit 4 activo y bit 2048 inactivo', () => {
    const value = permissionsValue({ ...NONE, print: 'low' });
    expect(value & PERMISSION_FLAG.PRINT).toBe(PERMISSION_FLAG.PRINT);
    expect(value & PERMISSION_FLAG.PRINT_HIGH_QUALITY).toBe(0);
  });

  it('sin ningún permiso: solo quedan a 1 los bits reservados', () => {
    expect(permissionsValue(NONE)).toBe(0xfffff0c0 | 0x200 | 0);
  });

  it.each(ALL_COMBINATIONS.map((c, i) => [i, c] as const))('combinación %i: permissionsFrom devuelve lo elegido', (_, choice) => {
    const value = permissionsValue(choice);
    const flags = new Set<number>(Object.values(PERMISSION_FLAG).filter((flag) => (value & flag) !== 0));
    const got = permissionsFrom(flags);
    expect(got).toEqual({
      copy: choice.copy,
      print: choice.print !== 'none',
      printHighQuality: choice.print === 'high',
      annotate: choice.annotate,
      // permissionsFrom concede rellenar formularios también con la bandera 32 (comentar); ver Registro de PDF-060.
      fillForms: choice.fillForms || choice.annotate,
      assemble: choice.assemble,
      modify: choice.modify,
    });
  });
});

describe('creación de cifrado AES-256 R6', () => {
  it('ida y vuelta: usuario, propietario y contraseña incorrecta', () => {
    const created = createAes256Security({ userPassword: USER, ownerPassword: OWNER, permissions: ALL_ALLOWED, random: fixedRandom() });

    const asUser = openSecurity(created.encrypt, ID0, USER);
    expect(asUser).toMatchObject({ ok: true, value: { authenticatedAs: 'user', revision: 6, stringMethod: 'aes256', streamMethod: 'aes256' } });
    if (!asUser.ok) return;
    expect(asUser.value.fileKey).toEqual(created.handler.fileKey);
    expect(asUser.value.permissions).toBe(-4);

    const asOwner = openSecurity(created.encrypt, ID0, OWNER);
    expect(asOwner).toMatchObject({ ok: true, value: { authenticatedAs: 'owner' } });
    if (asOwner.ok) expect(asOwner.value.fileKey).toEqual(created.handler.fileKey);

    expect(openSecurity(created.encrypt, ID0, 'otra')).toEqual({ ok: false, error: 'wrong-password' });
  });

  it('el manejador devuelto coincide con la forma prevista', () => {
    const created = createAes256Security({ userPassword: USER, ownerPassword: OWNER, permissions: ALL_ALLOWED, random: fixedRandom() });
    expect(created.handler).toEqual({
      revision: 6,
      fileKey: created.handler.fileKey,
      stringMethod: 'aes256',
      streamMethod: 'aes256',
      encryptMetadata: true,
      permissions: -4,
      authenticatedAs: 'owner',
    });
    expect(created.handler.fileKey).toHaveLength(32);
  });

  it('contraseña de usuario vacía: se abre sin contraseña como usuario', () => {
    const created = createAes256Security({ userPassword: '', ownerPassword: OWNER, permissions: ALL_ALLOWED, random: fixedRandom() });
    const opened = openSecurity(created.encrypt, ID0, '');
    expect(opened).toMatchObject({ ok: true, value: { authenticatedAs: 'user' } });
    if (opened.ok) expect(opened.value.fileKey).toEqual(created.handler.fileKey);
  });

  it('contraseña de propietario vacía: se genera una aleatoria de 32 bytes y la de usuario sigue funcionando', () => {
    const created = createAes256Security({ userPassword: USER, ownerPassword: '', permissions: NONE_ALLOWED, random: fixedRandom() });
    expect(openSecurity(created.encrypt, ID0, USER)).toMatchObject({ ok: true, value: { authenticatedAs: 'user' } });
    expect(openSecurity(created.encrypt, ID0, '')).toEqual({ ok: false, error: 'wrong-password' });
  });

  it('contraseñas con tildes y ñ: SASLprep normaliza, así que la forma NFD también abre', () => {
    const precomposed = 'señor-ÁÉÍÓÚ-ñandú';
    const decomposed = precomposed.normalize('NFD');
    expect(decomposed).not.toBe(precomposed);
    const created = createAes256Security({ userPassword: precomposed, ownerPassword: OWNER, permissions: ALL_ALLOWED, random: fixedRandom() });
    const asPrecomposed = openSecurity(created.encrypt, ID0, precomposed);
    const asDecomposed = openSecurity(created.encrypt, ID0, decomposed);
    expect(asPrecomposed).toMatchObject({ ok: true, value: { authenticatedAs: 'user' } });
    expect(asDecomposed).toMatchObject({ ok: true, value: { authenticatedAs: 'user' } });
  });

  it('con random fijo el resultado es determinista (golden de U, UE, O, OE, Perms y clave)', () => {
    const created = createAes256Security({ userPassword: USER, ownerPassword: OWNER, permissions: ALL_ALLOWED, random: fixedRandom() });
    expect(hex(created.handler.fileKey)).toBe('0b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186');
    expect(stringHex(entry(created, 'U'))).toBe(
      '18430f79eceda10d688220aa932555254d162d3127219fefb04d991991d1b3adabd0f51a3f6489aed3f81d42678cb1d6',
    );
    expect(stringHex(entry(created, 'UE'))).toBe('03fe97eb4b8cec4fb19a85bb96bc332f9f93f5d9e59b5b65766b0e363ea5cf6f');
    expect(stringHex(entry(created, 'O'))).toBe(
      'faed0cd5466532487002678ba4fad7d23452d9bbe27701d5d15400fae11c4019fb20456a8fb4d9fe23486d92b7dc0126',
    );
    expect(stringHex(entry(created, 'OE'))).toBe('8c72db7c62b3b8c28c1e54ac47c064b4a7825a156aaf8b9b23468f6f7e27cdbe');
    expect(stringHex(entry(created, 'Perms'))).toBe('e19c580239aacf42dbf12a7c982e721a');
  });

  it('el diccionario /Encrypt tiene la forma de ISO 32000-2 para V 5 / R 6', () => {
    const created = createAes256Security({ userPassword: USER, ownerPassword: OWNER, permissions: ALL_ALLOWED, random: fixedRandom() });
    expect(entry(created, 'Filter')).toEqual(name('Standard'));
    expect(entry(created, 'V')).toBe(5);
    expect(entry(created, 'R')).toBe(6);
    expect(entry(created, 'Length')).toBe(256);
    expect(entry(created, 'StmF')).toEqual(name('StdCF'));
    expect(entry(created, 'StrF')).toEqual(name('StdCF'));
    expect(entry(created, 'P')).toBe(-4);
    expect(entry(created, 'EncryptMetadata')).toBe(true);
    const cf = entry(created, 'CF');
    expect(cf).toMatchObject({ kind: 'dict' });
  });

  it('un random que no devuelve la longitud pedida es un error de programa', () => {
    const broken: RandomBytes = () => new Uint8Array(3);
    expect(() => createAes256Security({ userPassword: USER, ownerPassword: OWNER, permissions: ALL_ALLOWED, random: broken })).toThrow(RangeError);
  });
});

describe('PDF mínimo cifrado con la contraseña nueva', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdf-create-security-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** PDF de una página con texto en un flujo cifrado; `/Encrypt` sin cifrar, xref clásica y `/ID`. */
  function buildEncryptedPdf(created: NewSecurity, random: RandomBytes): Uint8Array {
    const { handler, encrypt } = created;
    const enc = (num: number, v: PdfValue): Uint8Array => serializeIndirect(num, 0, encryptValue(handler, num, 0, v, random));
    const content = stream({}, new TextEncoder().encode('BT /F1 18 Tf 20 100 Td (Hola mundo) Tj ET'));
    const objects: Uint8Array[] = [
      enc(1, dict({ Type: name('Catalog'), Pages: ref(2) })),
      enc(2, dict({ Type: name('Pages'), Kids: [ref(3)], Count: 1 })),
      enc(
        3,
        dict({
          Type: name('Page'),
          Parent: ref(2),
          MediaBox: [0, 0, 300, 200],
          Resources: dict({ Font: dict({ F1: dict({ Type: name('Font'), Subtype: name('Type1'), BaseFont: name('Helvetica') }) }) }),
          Contents: ref(4),
        }),
      ),
      enc(4, content),
      serializeIndirect(5, 0, encrypt),
    ];
    const header = new TextEncoder().encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
    const parts: Uint8Array[] = [header];
    const offsets: number[] = [];
    let size = header.length;
    for (const object of objects) {
      offsets.push(size);
      parts.push(object);
      size += object.length;
    }
    const idHex = hex(ID0);
    const xrefAt = size;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    parts.push(new TextEncoder().encode(xref));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  it('qpdf muestra R = 6 y AESv3, y pdf.js lo abre con la contraseña de usuario y lee el texto', async () => {
    const random = fixedRandom();
    const created = createAes256Security({ userPassword: USER, ownerPassword: OWNER, permissions: ALL_ALLOWED, random });
    const data = buildEncryptedPdf(created, random);
    const path = join(dir, 'proteger.pdf');
    writeFileSync(path, data);

    const info = run(['--show-encryption', `--password=${USER}`, path]);
    expect(info.status).toBe(0);
    expect(info.stdout).toMatch(/R = 6/);
    expect(info.stdout).toMatch(/AESv3/);

    const check = qpdfCheck(path, USER);
    expect(check.code).toBe(0);

    const loaded = await loadPdf(memorySource(data), { assetBaseUrl: nodeAssetBase(), password: USER });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      expect(loaded.value.numPages).toBe(1);
      const page = await loaded.value.doc.getPage(1);
      const text = await page.getTextContent();
      const str = text.items.map((item) => ('str' in item ? item.str : '')).join('');
      expect(str).toContain('Hola mundo');
    } finally {
      await loaded.value.destroy();
    }
  });
});
