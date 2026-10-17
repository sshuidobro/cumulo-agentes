/**
 * Serializador determinista de objetos PDF: el mismo valor siempre produce los mismos bytes.
 */
import type { PdfDict, PdfName, PdfRef, PdfStream, PdfString, PdfValue } from './objects';

const TEXT_ENCODER = new TextEncoder();
const HEX_UPPER = '0123456789ABCDEF';

/** Caracteres que hay que escapar en un nombre además de los fuera de `!`..`~`. */
const NAME_SPECIAL = new Set<number>([0x23, 0x28, 0x29, 0x2f, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x25]);

/** Acumula trozos de texto ASCII y bytes crudos (solo los flujos llevan bytes no ASCII). */
class ByteWriter {
  private readonly chunks: Array<string | Uint8Array> = [];

  text(s: string): void {
    this.chunks.push(s);
  }

  raw(b: Uint8Array): void {
    this.chunks.push(b);
  }

  finish(): Uint8Array {
    const parts = this.chunks.map((c) => (typeof c === 'string' ? TEXT_ENCODER.encode(c) : c));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`número PDF no finito: ${n}`);
  if (Number.isInteger(n)) return Number.isSafeInteger(n) ? String(n) : BigInt(n).toString();
  // Reales: 4 decimales como máximo, sin ceros finales y sin exponente.
  let s = n.toFixed(4);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

function hex2(b: number): string {
  return HEX_UPPER.charAt(b >> 4) + HEX_UPPER.charAt(b & 0xf);
}

function formatName(value: string): string {
  let out = '/';
  for (const b of TEXT_ENCODER.encode(value)) {
    if (b < 0x21 || b > 0x7e || NAME_SPECIAL.has(b)) out += `#${hex2(b)}`;
    else out += String.fromCharCode(b);
  }
  return out;
}

function writeString(w: ByteWriter, s: PdfString): void {
  if (s.hex) {
    let out = '<';
    for (const b of s.bytes) out += hex2(b);
    w.text(`${out}>`);
    return;
  }
  let out = '(';
  for (const b of s.bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  w.text(`${out})`);
}

function writeValue(w: ByteWriter, v: PdfValue): void {
  if (v === null) {
    w.text('null');
  } else if (typeof v === 'boolean') {
    w.text(v ? 'true' : 'false');
  } else if (typeof v === 'number') {
    w.text(formatNumber(v));
  } else if (isArray(v)) {
    w.text('[');
    v.forEach((item, i) => {
      if (i > 0) w.text(' ');
      writeValue(w, item);
    });
    w.text(']');
  } else {
    writeObject(w, v);
  }
}

function isArray(v: PdfValue): v is readonly PdfValue[] {
  return Array.isArray(v);
}

function writeObject(w: ByteWriter, v: PdfName | PdfString | PdfRef | PdfDict | PdfStream): void {
  switch (v.kind) {
    case 'name':
      w.text(formatName(v.value));
      return;
    case 'string':
      writeString(w, v);
      return;
    case 'ref':
      w.text(`${v.num} ${v.gen} R`);
      return;
    case 'dict':
      writeDict(w, v.entries);
      return;
    case 'stream':
      writeDict(w, v.dict.entries);
      w.text('\nstream\n');
      w.raw(v.data);
      w.text('\nendstream');
      return;
  }
}

function writeDict(w: ByteWriter, entries: ReadonlyMap<string, PdfValue>): void {
  w.text('<<');
  for (const [key, value] of entries) {
    w.text(` ${formatName(key)} `);
    writeValue(w, value);
  }
  w.text(' >>');
}

/** Bytes de un valor PDF (sin `obj`/`endobj`). Lanza `RangeError` con números no finitos. */
export function serializeValue(v: PdfValue): Uint8Array {
  const w = new ByteWriter();
  writeValue(w, v);
  return w.finish();
}

/** `num gen obj` + valor + `endobj`, cada parte en su línea. */
export function serializeIndirect(num: number, gen: number, v: PdfValue): Uint8Array {
  const w = new ByteWriter();
  w.text(`${num} ${gen} obj\n`);
  writeValue(w, v);
  w.text('\nendobj\n');
  return w.finish();
}
