/**
 * Ficheros de prueba de la firma digital para las pruebas E2E (PDF-139), generados en `global-setup` en una carpeta
 * temporal: el certificado `.p12` de prueba, un PDF firmado con una revisión posterior (anotación añadida) y otro
 * firmado con un byte alterado dentro del rango firmado. Nada se versiona.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { DOC_OPS } from '../../src/core/doc-ops/ops/index.ts';
import type { OpContext } from '../../src/core/doc-ops/protocol.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { certFixtures, TEST_P12_PASSWORD } from './certs.ts';

/** Fecha fija de la firma: las pruebas no dependen de la hora. */
export const SIGNED_AT = '2026-10-20T10:00:00.000Z';

export const SIGNING_FILES = {
  p12: 'prueba.p12',
  signed: 'firmado.pdf',
  modified: 'firmado-modificado.pdf',
  altered: 'firmado-alterado.pdf',
} as const;

/** Firma `bytes` con el certificado de prueba (operación `sign` del núcleo, la misma que usa la app). */
async function signBytes(bytes: Uint8Array, pageIndex: number, rect: readonly [number, number, number, number] | null): Promise<Uint8Array> {
  const sign = DOC_OPS.sign;
  if (sign === undefined) throw new Error('falta la operación sign');
  const ctx: OpContext = {
    sources: [memorySource(bytes)],
    signal: new AbortController().signal,
    progress: () => undefined,
  };
  const result = await sign({
    password: null,
    p12: certFixtures().rsaAes,
    p12Password: TEST_P12_PASSWORD,
    pageIndex,
    rect,
    reason: 'Revisado',
    location: 'Madrid',
    now: SIGNED_AT,
  }, ctx);
  if (!result.ok) throw new Error(`firma de prueba: ${result.error.message}`);
  const { delta } = result.value as { readonly delta: Uint8Array };
  return concat(bytes, delta);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Añade una revisión incremental con una anotación de texto (nota posterior a la firma). Lee el `/Root`, el `/Size` y el
 * `startxref` de la última revisión y apunta el nuevo `xref` al anterior con `/Prev`.
 */
function appendAnnotationRevision(signed: Uint8Array): Uint8Array {
  const text = Buffer.from(signed).toString('latin1');
  const prev = Number(lastGroup(text, /startxref\s+(\d+)/g));
  const trailer = text.slice(text.lastIndexOf('trailer'));
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(trailer)?.[1];
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1]);
  if (root === undefined || !Number.isFinite(prev) || !Number.isFinite(size)) throw new Error('trailer no reconocido');
  const num = size;
  const object = `${num} 0 obj\n<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (Nota posterior a la firma) >>\nendobj\n`;
  const objectOffset = signed.length + 1;
  const xrefOffset = objectOffset + object.length;
  const xref = `xref\n0 1\n0000000000 65535 f \n${num} 1\n${String(objectOffset).padStart(10, '0')} 00000 n \n`;
  const tail = `trailer\n<< /Size ${num + 1} /Root ${root} /Prev ${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return concat(signed, Buffer.from(`\n${object}${xref}${tail}`, 'latin1'));
}

/** Primer grupo de la última coincidencia de `pattern` (con grupo de captura), o cadena vacía. */
function lastGroup(text: string, pattern: RegExp): string {
  const matches = [...text.matchAll(pattern)];
  return matches[matches.length - 1]?.[1] ?? '';
}

/** Cambia un byte dentro del rango firmado (la versión del encabezado). */
function alterSignedByte(signed: Uint8Array): Uint8Array {
  const out = new Uint8Array(signed);
  const index = Buffer.from(out).indexOf('%PDF-1.');
  if (index < 0) throw new Error('encabezado no reconocido');
  const at = index + 7;
  out[at] = out[at] === 0x36 ? 0x35 : 0x36;
  return out;
}

/** Escribe los ficheros de prueba de la firma en `dir`. */
export async function writeSigningFixtures(dir: string): Promise<void> {
  const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
  const signed = await signBytes(original, 0, null);
  writeFileSync(join(dir, SIGNING_FILES.p12), certFixtures().rsaAes);
  writeFileSync(join(dir, SIGNING_FILES.signed), signed);
  writeFileSync(join(dir, SIGNING_FILES.modified), appendAnnotationRevision(signed));
  writeFileSync(join(dir, SIGNING_FILES.altered), alterSignedByte(signed));
}
