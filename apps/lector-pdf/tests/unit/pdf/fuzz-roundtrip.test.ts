import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PdfSyntaxError,
  bytesString,
  dict,
  name,
  parseIndirectObject,
  parseValue,
  ref,
  serializeIndirect,
  serializeValue,
  stream,
  type PdfValue,
} from '../../../src/core/pdf';

/** PRNG determinista (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randBytes(r: () => number, max: number): Uint8Array {
  const n = Math.floor(r() * max);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
}

function randName(r: () => number): string {
  const pool = ['A', 'b', ' ', '#', '/', '(', ')', '<', '>', '[', ']', '%', 'ñ', 'é', '€', '😀', 'א', '\t', '1', '~', '!'];
  const n = 1 + Math.floor(r() * 6);
  return Array.from({ length: n }, () => pool[Math.floor(r() * pool.length)]).join('');
}

function randNumber(r: () => number): number {
  const k = Math.floor(r() * 4);
  if (k === 0) return Math.floor((r() - 0.5) * 2e9);
  if (k === 1) return Math.round((r() - 0.5) * 2e6 * 1e4) / 1e4;
  if (k === 2) return Math.floor(r() * 10);
  return Math.round((r() - 0.5) * 100 * 100) / 100;
}

function randValue(r: () => number, depth: number): PdfValue {
  const k = Math.floor(r() * (depth > 4 ? 6 : depth > 0 ? 8 : 9));
  switch (k) {
    case 0: return null;
    case 1: return r() < 0.5;
    case 2: return randNumber(r);
    case 3: return name(randName(r));
    case 4: return bytesString(randBytes(r, 40), r() < 0.5);
    case 5: return ref(1 + Math.floor(r() * 99999), Math.floor(r() * 5));
    case 6: return Array.from({ length: Math.floor(r() * 5) }, () => randValue(r, depth + 1));
    case 7: {
      const m = new Map<string, PdfValue>();
      const n = Math.floor(r() * 5);
      for (let i = 0; i < n; i++) m.set(randName(r), randValue(r, depth + 1));
      return dict(m);
    }
    default: return stream({ Type: name('X') }, randBytes(r, 60));
  }
}

describe('fuzz ida y vuelta: valores aleatorios', () => {
  it('parse(serialize(v)) == v para 3000 valores y serialize es idempotente', () => {
    const r = rng(20261017);
    for (let i = 0; i < 3000; i++) {
      const v = randValue(r, 0);
      const ser = serializeValue(v);
      // Los streams solo se leen como objeto indirecto.
      const hasStream = typeof v === 'object' && v !== null && !Array.isArray(v) && (v as { kind: string }).kind === 'stream';
      if (hasStream) {
        const ind = serializeIndirect(7, 0, v);
        const back = parseIndirectObject(ind, 0);
        expect(back.value, `caso ${i}`).toEqual(v);
        expect(serializeIndirect(7, 0, back.value)).toEqual(ind);
        continue;
      }
      const back = parseValue(ser, 0);
      expect(back.value, `caso ${i}`).toEqual(v);
      expect(back.end).toBe(ser.length);
      expect(serializeValue(back.value), `idempotencia ${i}`).toEqual(ser);
    }
  });
});

/** Redondea los reales a 4 decimales (el serializador, por diseño, no escribe más). */
function round4(v: PdfValue): PdfValue {
  if (typeof v === 'number') return Number(v.toFixed(4)) + 0;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return (v as readonly PdfValue[]).map(round4);
  const o = v as Exclude<PdfValue, null | boolean | number | readonly PdfValue[]>;
  if (o.kind === 'dict') return dict(new Map([...o.entries].map(([k, x]) => [k, round4(x)] as const)));
  if (o.kind === 'stream') return { kind: 'stream', dict: round4(o.dict) as typeof o.dict, data: o.data };
  return o;
}

function collectPdfs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) collectPdfs(p, out);
    else if (/\.pdf$/i.test(e) && st.size < 3_000_000) out.push(p);
  }
  return out;
}

/** Posiciones de "N G obj" en los bytes. */
function objectOffsets(buf: Uint8Array): number[] {
  const text = Buffer.from(buf).toString('latin1');
  const re = /(?<![0-9])(\d{1,10}) (\d{1,5}) obj\b/g;
  const offs: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) offs.push(m.index);
  return offs;
}

const root = resolve(__dirname, '../../../../../fixtures/pdf');
const files = [...collectPdfs(join(root, 'generated')), ...collectPdfs(join(root, 'corpus'))].filter(
  (f) => !/pages-(100000|20000|5000)/.test(f),
);

describe('fuzz ida y vuelta: objetos reales de fixtures y corpus', () => {
  it('hay ficheros que probar', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('parse -> serialize -> parse conserva el objeto y serialize es idempotente', { timeout: 120_000 }, () => {
    let parsed = 0;
    let failed = 0;
    let streams = 0;
    const errores: string[] = [];
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(f));
      for (const off of objectOffsets(buf)) {
        let obj;
        try {
          obj = parseIndirectObject(buf, off);
        } catch (e) {
          // Objetos en cadenas/streams binarios que casan con el patrón: solo vale PdfSyntaxError.
          if (!(e instanceof PdfSyntaxError)) errores.push(`${f}@${off}: ${String(e)}`);
          failed++;
          continue;
        }
        parsed++;
        if (!Array.isArray(obj.value) && typeof obj.value === 'object' && obj.value !== null && 'kind' in obj.value && obj.value.kind === 'stream') streams++;
        const ser = serializeIndirect(obj.num, obj.gen, obj.value);
        let again;
        try {
          again = parseIndirectObject(ser, 0);
        } catch (e) {
          errores.push(`${f}@${off}: reparse falla ${String(e)}`);
          continue;
        }
        try {
          expect(again.value).toEqual(round4(obj.value));
          expect(again.num).toBe(obj.num);
          expect(again.gen).toBe(obj.gen);
          expect(serializeIndirect(again.num, again.gen, again.value)).toEqual(ser);
        } catch (e) {
          errores.push(`${f}@${off}: ${(e as Error).message.slice(0, 200)}`);
        }
      }
    }
    expect(errores.slice(0, 5)).toEqual([]);
    expect(parsed).toBeGreaterThan(100);
    expect(streams).toBeGreaterThan(0);
    expect(failed).toBeLessThan(parsed);
  });
});

describe('fuzz de robustez: bytes mutados', () => {
  it('solo lanza PdfSyntaxError, termina rápido y el resultado válido re-serializa', { timeout: 60_000 }, () => {
    const r = rng(42);
    const seeds: Uint8Array[] = [];
    for (const f of files.slice(0, 6)) {
      const buf = new Uint8Array(readFileSync(f));
      for (const off of objectOffsets(buf).slice(0, 15)) {
        const end = Math.min(buf.length, off + 400);
        seeds.push(buf.slice(off, end));
      }
    }
    expect(seeds.length).toBeGreaterThan(20);
    const t0 = Date.now();
    for (let i = 0; i < 4000; i++) {
      const s = Uint8Array.from(seeds[Math.floor(r() * seeds.length)] ?? new Uint8Array());
      const muts = 1 + Math.floor(r() * 4);
      for (let m = 0; m < muts; m++) {
        const kind = r();
        const pos = Math.floor(r() * s.length);
        if (kind < 0.6) s[pos] = Math.floor(r() * 256);
        else if (kind < 0.8) s[pos] = '()<>[]/%'.charCodeAt(Math.floor(r() * 8));
      }
      const input = r() < 0.2 ? s.slice(0, Math.floor(r() * s.length)) : s;
      try {
        const o = parseIndirectObject(input, 0);
        const ser = serializeIndirect(o.num, o.gen, o.value);
        expect(parseIndirectObject(ser, 0).value).toEqual(o.value);
      } catch (e) {
        if (!(e instanceof PdfSyntaxError)) throw new Error(`excepción no controlada (${String(e)}) caso ${i}: ${Buffer.from(input).toString('latin1').slice(0, 120)}`, { cause: e });
        expect(typeof e.offset).toBe('number');
      }
    }
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
