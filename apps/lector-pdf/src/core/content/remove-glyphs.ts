/**
 * Borrado de glifos sin mover el resto (ADR-0039, PDF-135): los glifos que se quitan se sustituyen por ajustes de `TJ`
 * de su mismo ancho, así que lo que queda en la página no cambia de sitio. La redacción y la edición de texto usan esta
 * misma función.
 */
import { bytesString, type PdfString, type PdfValue } from '../pdf/objects';
import type { ContentOp } from './content-parser';
import type { GlyphBox, PageContent } from './interpreter';

/**
 * Operaciones de la página con los glifos para los que `remove` devuelve true sustituidos por ajustes de `TJ` del
 * mismo ancho (el resto no se mueve). Una operación con algún glifo quitado de `shift === null` se sustituye solo por
 * su prefijo de estado (como hoy en la redacción). Las operaciones cuyo índice está en `skip` se omiten. Las demás se
 * devuelven tal cual y en el mismo orden.
 * `index` es la posición del glifo en `content.glyphs`.
 */
export function removeGlyphs(
  content: PageContent,
  remove: (glyph: GlyphBox, index: number) => boolean,
  skip?: ReadonlySet<number>,
): ContentOp[] {
  const glyphsByOp = groupGlyphs(content.glyphs);
  const ops: ContentOp[] = [];
  for (const [index, op] of content.ops.entries()) {
    if (skip?.has(index) === true) continue;
    const glyphs = glyphsByOp.get(index);
    if (glyphs === undefined) ops.push(op);
    else ops.push(...editText(op, glyphs, remove));
  }
  return ops;
}

/** Glifo con su posición en `content.glyphs`. */
interface IndexedGlyph {
  readonly glyph: GlyphBox;
  readonly index: number;
}

/**
 * Operaciones de texto con sus glifos quitados. Sin glifos que `remove` marque, la operación no cambia. Si un glifo
 * no tiene avance expresable (`Tfs` 0), se quita el texto de la operación. `'` y `"` conservan su `T*` (y `Tw`/`Tc`).
 */
function editText(
  operation: ContentOp,
  glyphs: readonly IndexedGlyph[],
  remove: (glyph: GlyphBox, index: number) => boolean,
): readonly ContentOp[] {
  const removed = glyphs.map(({ glyph, index }) => remove(glyph, index));
  if (!removed.some((flag) => flag)) return [operation];
  const prefix = statePrefix(operation);
  const unexpressible = glyphs.some(({ glyph }, index) => removed[index] === true && glyph.shift === null);
  if (unexpressible) return prefix;
  const items = textItems(operation);
  return [...prefix, { op: 'TJ', operands: [redactItems(items, glyphs.map((g) => g.glyph), removed)] }];
}

/** Operaciones que hay que conservar delante de un `TJ` equivalente: `'` → `T*`; `"` → `aw Tw ac Tc T*`. */
function statePrefix(operation: ContentOp): ContentOp[] {
  if (operation.op === "'") return [opOf('T*')];
  if (operation.op === '"') {
    const [aw = 0, ac = 0] = operation.operands;
    return [{ op: 'Tw', operands: [aw] }, { op: 'Tc', operands: [ac] }, opOf('T*')];
  }
  return [];
}

/** Cadenas y ajustes de la operación de texto, en orden. `Tj`/`'` tienen una cadena; `"`, la tercera operando. */
function textItems(operation: ContentOp): readonly PdfValue[] {
  if (operation.op === 'TJ') {
    const [items] = operation.operands;
    return Array.isArray(items) ? items : [];
  }
  const index = operation.op === '"' ? 2 : 0;
  return [operation.operands[index] ?? null];
}

/**
 * Elementos de `TJ` con los glifos quitados sustituidos por su ajuste; los ajustes vecinos se suman. Los códigos que
 * se quedan van en cadenas del mismo tipo (literal o hexadecimal) que su original.
 */
function redactItems(items: readonly PdfValue[], glyphs: readonly GlyphBox[], removed: readonly boolean[]): PdfValue[] {
  const out: PdfValue[] = [];
  let run: number[] = [];
  let runHex = false;
  const flush = (): void => {
    if (run.length > 0) out.push(bytesString(Uint8Array.from(run), runHex));
    run = [];
  };
  const addNumber = (value: number): void => {
    flush();
    const last = out[out.length - 1];
    if (typeof last === 'number') out[out.length - 1] = last + value;
    else out.push(value);
  };

  let index = 0;
  for (const item of items) {
    if (typeof item === 'number') {
      addNumber(item);
      continue;
    }
    if (!isString(item)) continue;
    let at = 0;
    while (at < item.bytes.length) {
      const glyph = glyphs[index];
      if (glyph === undefined || at + glyph.length > item.bytes.length) throw new RangeError('glifos desalineados con la cadena de texto');
      if (removed[index] === true) {
        addNumber(glyph.shift ?? 0);
      } else {
        if (run.length === 0) runHex = item.hex;
        for (const byte of item.bytes.subarray(at, at + glyph.length)) run.push(byte);
      }
      at += glyph.length;
      index += 1;
    }
  }
  flush();
  return out;
}

function groupGlyphs(glyphs: readonly GlyphBox[]): Map<number, IndexedGlyph[]> {
  const groups = new Map<number, IndexedGlyph[]>();
  glyphs.forEach((glyph, index) => {
    const list = groups.get(glyph.op) ?? [];
    list.push({ glyph, index });
    groups.set(glyph.op, list);
  });
  return groups;
}

function opOf(operator: string, ...operands: readonly number[]): ContentOp {
  return { op: operator, operands };
}

function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}
