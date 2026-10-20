/**
 * Edición de texto por líneas (ADR-0042, PDF-145): dadas las líneas editadas de un documento, quita de verdad sus
 * glifos (sin mover el resto), escribe el texto nuevo con la fuente estándar, tamaño y color de la línea original en
 * su misma línea base, y devuelve el fichero reescrito entero. Nunca lanza: los errores esperables vuelven como
 * `Result`; los argumentos mal formados (bugs de la interfaz) lanzan `RangeError`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { firstUnmappable, toWinAnsi } from '../annotations/winansi';
import type { RectPt } from '../annotations/model';
import { bytesString, dict, name, PdfSyntaxError, stream, withEntries, type PdfRef, type PdfValue } from '../pdf/objects';
import { interpretPage, removeGlyphs, serializeContent, type ContentOp, type PageContent } from '../content';
import { pdfError } from '../errors';
import { finishDelta, reserveXref, startDelta, type DeltaWriter } from '../pdf/delta-writer';
import { flateEncode } from '../pdf/filters';
import type { RandomBytes } from '../pdf/crypt-rules';
import type { ObjectReader } from '../pdf/object-reader';
import { catalogRef, createAllocator, type ObjectAllocator } from '../pdf/page-tree';
import { effectiveResources, freeResourceName, withResource } from '../pdf/page-content';
import { toSaveError } from '../pdf/save-error';
import { locateLine } from './line';
import { standardBaseFont } from './standard-font';

/** Una línea editada: `hint` es la misma caja que se usó en `findEditableLine`; `text` es una línea («» borra la línea). */
export interface LineEdit {
  readonly pageIndex: number;
  readonly hint: RectPt;
  readonly text: string;
}

export interface EditTextInput {
  readonly source: ByteSource;
  readonly reader: ObjectReader;
  readonly edits: readonly LineEdit[];
  readonly now: string;
  readonly random?: RandomBytes;
  readonly signal?: AbortSignal;
}

/** Nombre base de los recursos de fuente añadidos a la página (`SuiteEd`, `SuiteEd1`…). */
const FONT_RESOURCE_BASE = 'SuiteEd';
const FONT_ENCODING = 'WinAnsiEncoding';

/** Estado de una pasada de escritura. */
interface Context {
  readonly reader: ObjectReader;
  readonly writer: DeltaWriter;
  readonly alloc: ObjectAllocator;
  /** Un objeto de fuente por nombre estándar en todo el incremento. */
  readonly fonts: Map<string, PdfRef>;
}

interface Located {
  readonly glyphs: readonly number[];
  readonly edit: LineEdit;
  readonly origin: readonly [number, number];
  readonly fontSize: number;
  readonly color: readonly [number, number, number];
  readonly baseFont: string;
}

export async function buildTextEditUpdate(input: EditTextInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>> {
  try {
    return await writeTextEdit(input);
  } catch (error: unknown) {
    // Un RangeError es un bug de quien llama (argumentos que no encajan): no se convierte en error de usuario.
    if (error instanceof RangeError) throw error;
    return err(toSaveError(error));
  }
}

async function writeTextEdit(input: EditTextInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>> {
  const { source, reader, signal } = input;
  const grouped = editsByPage(input.edits, await reader.pageCount());
  if (!grouped.ok) return grouped;
  const byPage = grouped.value;
  if (byPage.size === 0) return ok({ delta: new Uint8Array(0), expectedSize: source.size });

  const ctx: Context = {
    reader,
    writer: await startDelta(source, reader, input.random),
    alloc: createAllocator(reader.xref.size),
    fonts: new Map<string, PdfRef>(),
  };
  for (const [pageIndex, edits] of byPage) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    const changed = await writePage(ctx, pageIndex, edits);
    if (!changed.ok) return changed;
  }

  const root = await catalogRef(reader);
  const { xrefNum, size } = reserveXref(reader, ctx.alloc.nextNum);
  const delta = finishDelta(ctx.writer, { reader, root, size, xrefNum, now: input.now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length });
}

/** Ediciones agrupadas por página (ascendente), en el orden recibido. Índices y cajas inválidos → RangeError; texto no representable → error. */
function editsByPage(edits: readonly LineEdit[], pageCount: number): Result<Map<number, LineEdit[]>> {
  const byPage = new Map<number, LineEdit[]>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.pageIndex) || edit.pageIndex < 0 || edit.pageIndex >= pageCount) {
      throw new RangeError(`página fuera de rango: ${String(edit.pageIndex)}`);
    }
    if (!edit.hint.every(Number.isFinite)) throw new RangeError('hint no finito');
    if (edit.hint[0] === edit.hint[2] || edit.hint[1] === edit.hint[3]) throw new RangeError('hint de área 0');
  }
  if (edits.some((edit) => firstUnmappable(edit.text) !== null)) return err(pdfError('edit-text-invalid'));
  for (const edit of edits) {
    const list = byPage.get(edit.pageIndex) ?? [];
    list.push(edit);
    byPage.set(edit.pageIndex, list);
  }
  return ok(new Map([...byPage.entries()].sort(([a], [b]) => a - b)));
}

/** Reescribe la página: quita los glifos de sus líneas y añade el texto nuevo. Ediciones fuera de la página → error. */
async function writePage(ctx: Context, pageIndex: number, edits: readonly LineEdit[]): Promise<Result<true>> {
  const pageRef = await ctx.reader.pageRef(pageIndex);
  const pageDict = await ctx.reader.getDict(pageRef);
  if (pageDict === null) throw new PdfSyntaxError(`página ${String(pageIndex + 1)} ilegible`, 0);

  let content: PageContent;
  try {
    content = await interpretPage(ctx.reader, pageDict);
  } catch {
    return err(pdfError('edit-line-missing'));
  }
  const resources = await effectiveResources(ctx.reader, pageDict);

  const located: Located[] = [];
  const removed = new Set<number>();
  for (const edit of edits) {
    const line = await locateLine(ctx.reader, resources, content, edit.hint);
    if (!line.ok) return err(pdfError('edit-line-missing'));
    for (const glyph of line.value.glyphs) {
      if (removed.has(glyph)) throw new RangeError('dos ediciones comparten glifos');
      removed.add(glyph);
    }
    located.push({
      glyphs: line.value.glyphs,
      edit,
      origin: line.value.origin,
      fontSize: line.value.style.fontSize,
      color: line.value.style.color,
      baseFont: standardBaseFont(line.value.style.font),
    });
  }

  let nextResources = resources;
  const pageFonts = new Map<string, string>();
  const textOps: ContentOp[] = [];
  for (const line of located) {
    if (line.edit.text === '') continue;
    let resName = pageFonts.get(line.baseFont);
    if (resName === undefined) {
      const fontRef = await fontObject(ctx, line.baseFont);
      resName = freeResourceName(nextResources, 'Font', FONT_RESOURCE_BASE);
      nextResources = withResource(nextResources, 'Font', resName, fontRef);
      pageFonts.set(line.baseFont, resName);
    }
    textOps.push(...textLineOps(line, resName));
  }

  const ops = removeGlyphs(content, (_, index) => removed.has(index));
  const contentRef = ctx.alloc.next();
  const streamBody = stream({ Filter: name('FlateDecode') }, flateEncode(serializeContent([opOf('q'), ...ops, opOf('Q'), ...textOps])));
  ctx.writer.object(contentRef.num, 0, streamBody);
  ctx.writer.object(pageRef.num, pageRef.gen, withEntries(pageDict, { Contents: contentRef, Resources: nextResources }));
  return ok(true);
}

/** Objeto de fuente estándar (una vez por incremento). */
async function fontObject(ctx: Context, baseFont: string): Promise<PdfRef> {
  const known = ctx.fonts.get(baseFont);
  if (known !== undefined) return known;
  const fontRef = ctx.alloc.next();
  ctx.writer.object(fontRef.num, 0, dict({
    Type: name('Font'),
    Subtype: name('Type1'),
    BaseFont: name(baseFont),
    Encoding: name(FONT_ENCODING),
  }));
  ctx.fonts.set(baseFont, fontRef);
  return fontRef;
}

/** Operaciones de texto de una línea nueva: origen en la línea base original, fuente, tamaño y color. */
function textLineOps(line: Located, resName: string): ContentOp[] {
  const [x, y] = line.origin;
  const [r, g, b] = line.color;
  return [
    opOf('BT'),
    { op: 'Tf', operands: [name(resName), line.fontSize] },
    opOf('Tc', 0),
    opOf('Tw', 0),
    opOf('Tz', 100),
    opOf('Ts', 0),
    opOf('Tr', 0),
    opOf('rg', r, g, b),
    opOf('Tm', 1, 0, 0, 1, x, y),
    { op: 'Tj', operands: [bytesString(toWinAnsi(line.edit.text), false)] },
    opOf('ET'),
  ];
}

function opOf(operator: string, ...operands: readonly PdfValue[]): ContentOp {
  return { op: operator, operands };
}
