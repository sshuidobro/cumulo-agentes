/**
 * Guardado de la vista Organizar (PDF-053, PDF-119, PDF-055, ADR-0028 y ADR-0035): escribe en un solo incremento el
 * orden y el giro de las páginas originales, las páginas en blanco nuevas, las páginas importadas de otros PDF
 * (con sus anotaciones y formularios) y la limpieza de los widgets de las páginas borradas. Nunca lanza: los errores
 * vuelven como `Result`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import type { RandomBytes } from '../pdf/crypt-rules';
import { finishDelta, reserveXref, startDelta } from '../pdf/delta-writer';
import { FormsBuilder } from '../pdf/new-document-forms';
import { ObjectCopier } from '../pdf/object-copier';
import { toSaveError } from '../pdf/save-error';
import type { ObjectReader } from '../pdf/object-reader';
import { dict, name, type PdfValue } from '../pdf/objects';
import {
  catalogRef,
  createAllocator,
  writePageTree,
  type AddedPage,
  type PageRotation,
  type PageSlot,
  type PageTreeOutput,
} from '../pdf/page-tree';
import { updateAcroForm, type AcroFormAdditions } from './forms-cleanup';
import type { SaveSlot } from './plan';

export interface OrganizeInput {
  readonly source: ByteSource;
  /** `openForSave` sobre `source`. */
  readonly reader: ObjectReader;
  /** Plan final de la vista Organizar, en orden. */
  readonly slots: readonly SaveSlot[];
  /** PDF importados (PDF-055): índice = `SaveSlot.doc`, abiertos con `openForSave`. Sin ellos, un hueco `imported` no es válido. */
  readonly imported?: readonly ObjectReader[];
  /** ISO 8601 (semilla de `/ID`). */
  readonly now: string;
  readonly random?: RandomBytes;
  /** Abortada → `cancelled`. */
  readonly signal?: AbortSignal;
  /** Progreso de la escritura del árbol de páginas. */
  readonly onProgress?: (done: number, total: number) => void;
}

const VALID_ROTATIONS: readonly PageRotation[] = [0, 90, 180, 270];
/** Medida de una página en blanco, en puntos (PDF, 200 pulgadas). */
const MIN_BLANK_SIZE_PT = 1;
const MAX_BLANK_SIZE_PT = 14400;

/** Escribe el plan completo como un único incremento. Sin cambios, devuelve delta vacío. */
export async function buildOrganizeUpdate(input: OrganizeInput): Promise<Result<PageTreeOutput>> {
  try {
    return await writeOrganize(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeOrganize(input: OrganizeInput): Promise<Result<PageTreeOutput>> {
  const { source, reader, slots, now, signal, onProgress } = input;
  const imported = input.imported ?? [];
  const n = await reader.pageCount();
  if (!(await isValidPlan(slots, n, imported))) return err(pdfError('organize-invalid'));

  const alloc = createAllocator(reader.xref.size);
  // Páginas usadas de cada documento importado: se reservan antes de copiar, con el mismo asignador del árbol.
  const usedFrom: number[][] = imported.map(() => []);
  for (const slot of slots) if (slot.kind === 'imported') usedFrom[slot.doc]?.push(slot.source);
  const copiers: ObjectCopier[] = [];
  for (const [doc, from] of imported.entries()) {
    const copier = new ObjectCopier({ from, alloc: () => alloc.next(), resolveNames: true });
    await copier.reservePages(usedFrom[doc] ?? []);
    copiers.push(copier);
  }

  const added: AddedPage[] = [];
  const pages: PageSlot[] = [];
  const kept = new Set<number>();
  for (const slot of slots) {
    if (signal?.aborted === true) return err(pdfError('cancelled'));
    if (slot.kind === 'original') {
      pages.push({ source: slot.source, rotate: slot.rotate });
      kept.add(slot.source);
    } else if (slot.kind === 'blank') {
      const page: AddedPage = {
        ref: alloc.next(),
        dict: dict({ Type: name('Page'), MediaBox: [0, 0, slot.width, slot.height], Resources: dict({}) }),
      };
      added.push(page);
      pages.push({ source: n + added.length - 1, rotate: slot.rotate });
    } else {
      const copier = copiers[slot.doc];
      if (copier === undefined) return err(pdfError('organize-invalid'));
      const copied = await copier.copyPage(slot.source);
      added.push({ ref: copied.ref, dict: copied.dict });
      pages.push({ source: n + added.length - 1, rotate: slot.rotate });
    }
  }

  // Formularios de las páginas importadas (ADR-0035 punto 4): campos copiados y limpios, como en PDF-123.
  const forms = new FormsBuilder();
  for (const [doc, from] of imported.entries()) {
    const copier = copiers[doc];
    if (copier === undefined) throw new RangeError('copiador de documento importado sin crear (bug)');
    await forms.addPart(from, copier, usedFrom[doc] ?? []);
  }
  const objects = new Map<number, PdfValue>();
  for (const copier of copiers) for (const [objectRef, value] of copier.drain()) objects.set(objectRef.num, value);
  forms.applyEdits(objects);
  const additions = additionsOf(forms);

  const writer = await startDelta(source, reader, input.random);
  for (const [num, value] of objects) writer.object(num, 0, value);
  const written = await writePageTree({
    reader,
    writer,
    alloc,
    pages,
    added,
    ...(signal === undefined ? {} : { signal }),
    ...(onProgress === undefined ? {} : { onProgress }),
  });
  if (!written.ok) return err(written.error);
  if (written.value === 0) return ok({ delta: new Uint8Array(0), expectedSize: source.size, rewrittenPages: 0 });

  const refs = await reader.pageRefs();
  const removed = refs.filter((_, index) => !kept.has(index));
  const root = await catalogRef(reader);
  await updateAcroForm(reader, writer, removed, root, additions);

  const { xrefNum, size } = reserveXref(reader, alloc.nextNum);
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length, rewrittenPages: written.value });
}

/** Lo que el `/AcroForm` de las páginas importadas añade al documento; `null` si no traen formulario. */
function additionsOf(forms: FormsBuilder): AcroFormAdditions | null {
  const acro = forms.acroForm();
  if (acro === null) return null;
  return { fields: forms.fieldRoots(), fonts: forms.fontEntries(), whenMissing: acro };
}

/**
 * Plan válido: no vacío; cada original con `source` en [0, n) sin repetir; cada blanco con medidas en
 * [1, 14400]; cada importado con `doc` en [0, imported.length), `source` en [0, páginas de ese doc) y sin repetir
 * el par (doc, source); giros válidos.
 */
async function isValidPlan(slots: readonly SaveSlot[], n: number, imported: readonly ObjectReader[]): Promise<boolean> {
  if (slots.length < 1) return false;
  const seen = new Set<number>();
  const seenImported = new Set<string>();
  const counts = new Map<number, number>();
  for (const slot of slots) {
    if (!VALID_ROTATIONS.includes(slot.rotate)) return false;
    if (slot.kind === 'original') {
      if (!Number.isInteger(slot.source) || slot.source < 0 || slot.source >= n || seen.has(slot.source)) return false;
      seen.add(slot.source);
    } else if (slot.kind === 'blank') {
      if (!isBlankSize(slot.width) || !isBlankSize(slot.height)) return false;
    } else {
      const from = Number.isInteger(slot.doc) ? imported[slot.doc] : undefined;
      if (from === undefined) return false;
      let count = counts.get(slot.doc);
      if (count === undefined) {
        count = await from.pageCount();
        counts.set(slot.doc, count);
      }
      if (!Number.isInteger(slot.source) || slot.source < 0 || slot.source >= count) return false;
      const key = `${slot.doc}:${slot.source}`;
      if (seenImported.has(key)) return false;
      seenImported.add(key);
    }
  }
  return true;
}

function isBlankSize(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_BLANK_SIZE_PT && value <= MAX_BLANK_SIZE_PT;
}
