/**
 * Guardado de la vista Organizar (PDF-053, PDF-119, ADR-0028 y ADR-0035): escribe en un solo incremento el orden
 * y el giro de las páginas originales, las páginas en blanco nuevas y la limpieza de los widgets de las páginas
 * borradas. Nunca lanza: los errores vuelven como `Result`.
 */
import type { ByteSource } from '@suite/platform';
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import type { RandomBytes } from '../pdf/crypt-rules';
import { finishDelta, reserveXref, startDelta } from '../pdf/delta-writer';
import { toSaveError } from '../pdf/save-error';
import type { ObjectReader } from '../pdf/object-reader';
import { dict, name } from '../pdf/objects';
import {
  catalogRef,
  createAllocator,
  writePageTree,
  type AddedPage,
  type PageRotation,
  type PageSlot,
  type PageTreeOutput,
} from '../pdf/page-tree';
import { removePageWidgets } from './forms-cleanup';
import type { SaveSlot } from './plan';

export interface OrganizeInput {
  readonly source: ByteSource;
  /** `openForSave` sobre `source`. */
  readonly reader: ObjectReader;
  /** Plan final de la vista Organizar, en orden. */
  readonly slots: readonly SaveSlot[];
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
  const n = await reader.pageCount();
  if (!isValidPlan(slots, n)) return err(pdfError('organize-invalid'));
  if (signal?.aborted === true) return err(pdfError('cancelled'));

  const alloc = createAllocator(reader.xref.size);
  const added: AddedPage[] = [];
  const pages: PageSlot[] = [];
  const kept = new Set<number>();
  for (const slot of slots) {
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
      return err(pdfError('organize-invalid'));
    }
  }

  const writer = await startDelta(source, reader, input.random);
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
  await removePageWidgets(reader, writer, removed, root);

  const { xrefNum, size } = reserveXref(reader, alloc.nextNum);
  const delta = finishDelta(writer, { reader, root, size, xrefNum, now, sourceSize: source.size });
  return ok({ delta, expectedSize: source.size + delta.length, rewrittenPages: written.value });
}

/**
 * Plan válido: no vacío; cada original con `source` en [0, n) sin repetir; cada blanco con medidas en
 * [1, 14400]; giros válidos. Cualquier `imported` lo invalida (lo habilita PDF-055).
 */
function isValidPlan(slots: readonly SaveSlot[], n: number): boolean {
  if (slots.length < 1) return false;
  const seen = new Set<number>();
  for (const slot of slots) {
    if (!VALID_ROTATIONS.includes(slot.rotate)) return false;
    if (slot.kind === 'original') {
      if (!Number.isInteger(slot.source) || slot.source < 0 || slot.source >= n || seen.has(slot.source)) return false;
      seen.add(slot.source);
    } else if (slot.kind === 'blank') {
      if (!isBlankSize(slot.width) || !isBlankSize(slot.height)) return false;
    } else {
      return false;
    }
  }
  return true;
}

function isBlankSize(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_BLANK_SIZE_PT && value <= MAX_BLANK_SIZE_PT;
}
