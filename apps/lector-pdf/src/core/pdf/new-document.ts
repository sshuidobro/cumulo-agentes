/**
 * Creación de un PDF nuevo con páginas de una o varias fuentes (PDF-121, ADR-0028): copia cada página elegida con
 * `ObjectCopier`, construye un árbol `/Pages` de hasta 32 hijos y escribe el fichero completo con `writeCompleteFile`.
 * Nunca lanza: los errores vuelven como `Result`.
 */
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';
import { writeCompleteFile } from './file-writer';
import { toSaveError } from './incremental';
import { FormsBuilder } from './new-document-forms';
import { ObjectCopier } from './object-copier';
import type { ObjectReader } from './object-reader';
import { copyOutlineBranch, type OutlineBranch } from './outline-copy';
import { dict, name, ref, withEntries, type PdfDict, type PdfRef, type PdfValue } from './objects';
import { createAllocator, type PageRotation, type PageSlot } from './page-tree';
import { planPageTree, type TreeNode } from './page-tree-layout';
import { encodeTextString, pdfDate } from './text-string';

export interface NewDocumentPart {
  readonly reader: ObjectReader;
  readonly pages: readonly PageSlot[];
  /** Título de la rama del índice de esta parte (con `outline: 'branches'`). Por defecto «Documento N». */
  readonly title?: string;
}

export interface NewDocumentInput {
  /** Fuentes en este orden; las páginas de cada una van en el orden de `pages`. */
  readonly parts: readonly NewDocumentPart[];
  /**
   * `'branches'`: el índice tiene una rama por parte (con su índice copiado) y el visor abre con el índice visible.
   * Por defecto `'none'`. Las partes sin páginas no tienen rama.
   */
  readonly outline?: 'none' | 'branches';
  /** Título para `/Info /Title` (opcional). */
  readonly title?: string;
  /** ISO 8601: fechas de `/Info` y semilla de `/ID`. */
  readonly now: string;
  readonly signal?: AbortSignal;
  /** Páginas copiadas: cada 100 y al final (`done === total`). */
  readonly onProgress?: (done: number, total: number) => void;
}

export interface NewDocumentOutput {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
}

const VALID_ROTATIONS: readonly PageRotation[] = [0, 90, 180, 270];
/** Números fijos: catálogo, raíz `/Pages` e `/Info`. Los demás objetos empiezan en `FIRST_FREE_NUM`. */
const CATALOG_NUM = 1;
const PAGES_NUM = 2;
const INFO_NUM = 3;
const FIRST_FREE_NUM = 4;
const PRODUCER = 'Cúmulo Lector PDF';
const PROGRESS_EVERY = 100;

interface CopiedSlot {
  readonly ref: PdfRef;
  readonly dict: PdfDict;
  readonly rotate: PageRotation;
}

interface NodeEntry {
  readonly node: TreeNode;
  readonly ref: PdfRef;
  readonly parent: PdfRef | null;
  readonly kids: PdfValue[];
}

/** Crea un PDF nuevo con las páginas de `parts`, en orden. Un único fichero completo, sin incremento. */
export async function buildNewDocument(input: NewDocumentInput): Promise<Result<NewDocumentOutput>> {
  try {
    return await writeNewDocument(input);
  } catch (error: unknown) {
    return err(toSaveError(error));
  }
}

async function writeNewDocument(input: NewDocumentInput): Promise<Result<NewDocumentOutput>> {
  const { parts, title, now, signal, onProgress } = input;
  const total = parts.reduce((n, part) => n + part.pages.length, 0);
  if (total < 1) return err(pdfError('organize-invalid'));
  for (const part of parts) {
    const count = await part.reader.pageCount();
    if (!isValidPart(part.pages, count)) return err(pdfError('organize-invalid'));
  }
  const aborted = (): boolean => signal?.aborted === true;
  if (aborted()) return err(pdfError('cancelled'));

  const alloc = createAllocator(FIRST_FREE_NUM);
  const objects = new Map<number, PdfValue>();
  const slots: CopiedSlot[] = [];
  const branches: OutlineBranch[] = [];
  const forms = new FormsBuilder();
  for (const [index, part] of parts.entries()) {
    const copier = new ObjectCopier({ from: part.reader, alloc: () => alloc.next(), resolveNames: true });
    await copier.reservePages(part.pages.map((slot) => slot.source));
    let firstRef: PdfRef | undefined;
    for (const slot of part.pages) {
      if (aborted()) return err(pdfError('cancelled'));
      const copied = await copier.copyPage(slot.source);
      firstRef ??= copied.ref;
      slots.push({ ref: copied.ref, dict: copied.dict, rotate: slot.rotate });
      reportProgress(onProgress, slots.length, total);
    }
    await forms.addPart(part.reader, copier, part.pages.map((slot) => slot.source));
    for (const [objectRef, value] of copier.drain()) objects.set(objectRef.num, value);
    forms.applyEdits(objects);
    if (input.outline === 'branches' && firstRef !== undefined) {
      const branch = await copyOutlineBranch(part.reader, copier, part.title ?? `Documento ${index + 1}`, firstRef);
      for (const [objectRef, value] of branch.objects) objects.set(objectRef.num, value);
      branches.push(branch);
    }
  }

  const rootRef = ref(PAGES_NUM);
  const tree = planPageTree(total);
  const nodes: NodeEntry[] = [{ node: tree, ref: rootRef, parent: null, kids: [] }];
  const parentOfSlot: PdfRef[] = [];
  // Recorrido de arriba abajo: los nodos intermedios toman números después de los de las páginas copiadas.
  for (const entry of nodes) {
    for (const kid of entry.node.kids) {
      if ('slot' in kid) {
        parentOfSlot[kid.slot] = entry.ref;
        entry.kids.push(at(slots, kid.slot).ref);
      } else {
        const childRef = alloc.next();
        entry.kids.push(childRef);
        nodes.push({ node: kid.node, ref: childRef, parent: entry.ref, kids: [] });
      }
    }
  }

  for (const entry of nodes) {
    const d: Record<string, PdfValue> = { Type: name('Pages'), Kids: entry.kids, Count: entry.node.count };
    if (entry.parent !== null) d.Parent = entry.parent;
    objects.set(entry.ref.num, dict(d));
  }
  for (const [i, slot] of slots.entries()) {
    const rotate = slot.rotate === 0 ? undefined : slot.rotate;
    objects.set(slot.ref.num, withEntries(slot.dict, { Parent: at(parentOfSlot, i), Rotate: rotate }));
  }

  const catalog: Record<string, PdfValue> = { Type: name('Catalog'), Pages: rootRef };
  const acroForm = forms.acroForm();
  if (acroForm !== null) catalog.AcroForm = acroForm;
  if (branches.length > 0) {
    const outlinesRef = alloc.next();
    linkBranches(objects, branches, outlinesRef);
    objects.set(outlinesRef.num, dict({
      Type: name('Outlines'),
      First: at(branches, 0).ref,
      Last: at(branches, branches.length - 1).ref,
      Count: branches.reduce((sum, branch) => sum + 1 + branch.visibleCount, 0),
    }));
    catalog.Outlines = outlinesRef;
    catalog.PageMode = name('UseOutlines');
  }
  objects.set(CATALOG_NUM, dict(catalog));
  const info: Record<string, PdfValue> = {
    Producer: encodeTextString(PRODUCER),
    CreationDate: pdfDate(now),
    ModDate: pdfDate(now),
  };
  if (title !== undefined) info.Title = encodeTextString(title);
  objects.set(INFO_NUM, dict(info));

  const list: (readonly [number, PdfValue])[] = [];
  for (let num = CATALOG_NUM; num < alloc.nextNum; num++) {
    const value = objects.get(num);
    if (value === undefined) throw new RangeError(`objeto ${num} sin contenido (bug)`);
    list.push([num, value]);
  }
  const bytes = writeCompleteFile({
    objects: list,
    root: ref(CATALOG_NUM),
    info: ref(INFO_NUM),
    seed: `${now}|${total}`,
  });
  return ok({ bytes, pageCount: total });
}

/** Enlaza las ramas entre sí y con el nodo `/Outlines`: cada raíz de rama recibe `/Parent`, `/Prev` y `/Next`. */
function linkBranches(objects: Map<number, PdfValue>, branches: readonly OutlineBranch[], outlinesRef: PdfRef): void {
  for (const [i, branch] of branches.entries()) {
    const root = objects.get(branch.ref.num);
    if (root === undefined || typeof root !== 'object' || root === null || Array.isArray(root) || !('kind' in root) || root.kind !== 'dict') {
      throw new RangeError(`raíz de rama ${branch.ref.num} no es un diccionario (bug)`);
    }
    objects.set(branch.ref.num, withEntries(root, {
      Parent: outlinesRef,
      Prev: branches[i - 1]?.ref,
      Next: branches[i + 1]?.ref,
    }));
  }
}

/** Una parte válida: páginas en [0, n), sin repetir dentro de la parte, con giro válido. */
function isValidPart(pages: readonly PageSlot[], n: number): boolean {
  const seen = new Set<number>();
  for (const slot of pages) {
    if (!Number.isInteger(slot.source) || slot.source < 0 || slot.source >= n || seen.has(slot.source)) return false;
    seen.add(slot.source);
    if (!VALID_ROTATIONS.includes(slot.rotate)) return false;
  }
  return true;
}

/** Elemento de `items` que existe: lanza si el índice está fuera de rango (bug de quien llama). */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`índice ${index} fuera de rango`);
  return item;
}

function reportProgress(onProgress: NewDocumentInput['onProgress'], done: number, total: number): void {
  if (onProgress === undefined) return;
  if (done === total || done % PROGRESS_EVERY === 0) onProgress(done, total);
}
