/**
 * Interoperabilidad de respuestas y estados de revisión (PDF-058, ADR-0030): una nota nueva con dos respuestas y
 * un estado `Accepted` escritos sobre `basic-5.pdf` deben pasar `qpdf --check`, leerse en pdf.js como `/Text` hijas
 * de la nota (con `inReplyTo`, `replyType` y `state`), tener apariencia vacía, y volver a importarse igual. Además:
 * una respuesta a una anotación del fichero apunta a su objeto original, y una respuesta cuyo padre no se escribe
 * no se escribe. Requiere `qpdf` en el PATH.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  diffAnnotations,
  newReply,
  newReviewState,
  parseRef,
  repliesOf,
  reviewStateOf,
  type Annotation,
  type AnnotationEdits,
  type NoteAnnotation,
  type PdfObjRef,
} from '../../../src/core/annotations';
import { loadPdf, readPageAnnotations } from '../../../src/engine';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { qpdfCheck, qpdfObjects, run } from '../../support/qpdf';
import { additionsDiff, saveAnnotations } from '../../support/save-annotations';
import { STANDARD_AUTHOR, STANDARD_DATE } from '../../support/standard-annotations';

const assetBaseUrl = nodeAssetBase();
const FILE_TIMEOUT = 120_000;
const FALLBACK = '2026-10-17T12:00:00.000Z';
const LATER = '2026-10-17T13:00:00.000Z';
const LATEST = '2026-10-17T14:00:00.000Z';

const NOTE: NoteAnnotation = {
  id: 'suite-nota',
  type: 'note',
  pageIndex: 0,
  rect: [300, 700, 320, 720],
  color: [1, 1, 0],
  opacity: 1,
  contents: 'Revisar la cita',
  author: STANDARD_AUTHOR,
  modified: STANDARD_DATE,
  created: STANDARD_DATE,
  origin: { kind: 'new' },
  icon: 'Note',
  open: false,
};
const REPLY_1 = newReply({ id: 'suite-r1', parent: NOTE, contents: 'Conforme', author: 'Ana', now: STANDARD_DATE });
const REPLY_2 = newReply({ id: 'suite-r2', parent: NOTE, contents: 'Segunda respuesta', author: 'Luis', now: LATER });
const STATE = newReviewState({ id: 'suite-s', parent: NOTE, state: 'Accepted', author: 'Ana', now: LATEST });

let workDir = '';
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'replies-interop-'));
});
afterAll(() => {
  if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
});

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function refOf(refs: ReadonlyMap<string, PdfObjRef>, id: string): PdfObjRef {
  const ref = refs.get(id);
  if (ref === undefined) throw new Error(`no se escribió ${id}`);
  return ref;
}

/** Diccionario de qpdf (`--json=2`) del objeto `ref`. */
function dictOf(path: string, ref: PdfObjRef): Record<string, unknown> {
  const dict = asRecord(qpdfObjects(path)[`obj:${ref.num} ${ref.gen} R`]?.value);
  if (dict === undefined) throw new Error(`qpdf no ve el diccionario ${ref.num} ${ref.gen} R`);
  return dict;
}

/** Contenido decodificado del flujo `/AP /N` de la anotación `ref` (qpdf). */
function appearanceText(path: string, ref: PdfObjRef): string {
  const ap = asRecord(dictOf(path, ref)['/AP']);
  const normal = typeof ap?.['/N'] === 'string' ? ap['/N'] : '';
  const num = Number(normal.split(' ')[0] ?? '');
  const result = run(['--show-object=' + String(num), '--filtered-stream-data', path]);
  return result.stdout.trim();
}

async function openWith(data: Uint8Array) {
  const loaded = await loadPdf(memorySource(data), { assetBaseUrl });
  if (!loaded.ok) throw new Error(`pdf.js no abre el fichero: ${loaded.error.code}`);
  return loaded.value;
}

describe('interoperabilidad · respuestas y estados sobre basic-5.pdf', () => {
  it('qpdf --check da 0; pdf.js ve dos respuestas y un estado hijos de la nota, con apariencia vacía', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data, out } = await saveAnnotations(original, additionsDiff([NOTE, REPLY_1, REPLY_2, STATE]));
    const outPath = join(workDir, 'replies.pdf');
    writeFileSync(outPath, data);

    expect(qpdfCheck(outPath).code).toBe(0);

    const noteRef = refOf(out.written, 'suite-nota');
    const replyRefs = [refOf(out.written, 'suite-r1'), refOf(out.written, 'suite-r2')];
    const stateRef = refOf(out.written, 'suite-s');
    const parentId = `${String(noteRef.num)}R`;

    const loaded = await openWith(data);
    try {
      const page = await loaded.doc.getPage(1);
      const raw: unknown = await page.getAnnotations();
      const annots = (Array.isArray(raw) ? raw : []).map(asRecord);
      const children = annots.filter((a) => a?.inReplyTo === parentId);
      const replies = children.filter((a) => a?.replyType === 'R' && a.state === undefined);
      const states = children.filter((a) => a?.stateModel === 'Review');
      expect(replies).toHaveLength(2);
      expect(states).toHaveLength(1);
      expect(states[0]?.state).toBe('Accepted');
      for (const a of children) expect(a?.hasAppearance).toBe(true);
    } finally {
      await loaded.destroy();
    }

    for (const ref of [...replyRefs, stateRef]) {
      expect(appearanceText(outPath, ref)).toBe('');
      expect(dictOf(outPath, ref)['/IRT']).toBe(`${String(noteRef.num)} 0 R`);
    }
  }, FILE_TIMEOUT);

  it('reabrir e importar da 1 nota, 2 respuestas en orden de creación y el estado vigente', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data, out } = await saveAnnotations(original, additionsDiff([NOTE, REPLY_1, REPLY_2, STATE]));
    const noteId = `ref:${String(refOf(out.written, 'suite-nota').num)}R`;

    const loaded = await openWith(data);
    try {
      const page = await loaded.doc.getPage(1);
      const imported = await readPageAnnotations(page, FALLBACK);
      expect(imported.foreign).toEqual([]);
      const all = new Map(imported.supported.map((a) => [a.id, a] as const));
      expect(imported.supported.filter((a) => a.type === 'note')).toHaveLength(1);
      expect(repliesOf(all, noteId).map((r) => r.contents)).toEqual(['Conforme', 'Segunda respuesta']);
      expect(reviewStateOf(all, noteId)?.state).toBe('Accepted');
    } finally {
      await loaded.destroy();
    }
  }, FILE_TIMEOUT);
});

describe('interoperabilidad · respuestas a anotaciones del fichero', () => {
  it('una respuesta al resaltado de annotated.pdf usa como /IRT el objeto original del resaltado', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'annotated.pdf')));
    const highlight = await firstHighlight(bytes);
    const reply = newReply({ id: 'suite-r-hl', parent: highlight, contents: 'De acuerdo', author: 'Ana', now: LATER });

    const { data, out } = await saveAnnotations(bytes, additionsDiff([reply]));
    const outPath = join(workDir, 'annotated-reply.pdf');
    writeFileSync(outPath, data);

    expect(qpdfCheck(outPath).code).toBe(0);
    const parent = parseRef(highlight.id.slice('ref:'.length));
    expect(parent).not.toBeNull();
    expect(dictOf(outPath, refOf(out.written, 'suite-r-hl'))['/IRT']).toBe(`${String(parent?.num)} 0 R`);
  }, FILE_TIMEOUT);

  it('una respuesta a un resaltado borrado en el mismo cambio no se escribe', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'annotated.pdf')));
    const highlight = await firstHighlight(bytes);
    const reply = newReply({ id: 'suite-r-gone', parent: highlight, contents: 'Huérfana', author: 'Ana', now: LATER });
    const baseline = await baselineOf(bytes);
    const edits: AnnotationEdits = {
      upserts: new Map<string, Annotation>([[reply.id, reply]]),
      removed: new Set([highlight.id]),
      fields: new Map(),
    };

    const { data, out } = await saveAnnotations(bytes, diffAnnotations(baseline, edits));
    const outPath = join(workDir, 'annotated-removed.pdf');
    writeFileSync(outPath, data);

    expect(qpdfCheck(outPath).code).toBe(0);
    expect(out.written.has('suite-r-gone')).toBe(false);
    expect(out.written.has(highlight.id)).toBe(false);
  }, FILE_TIMEOUT);

  it('una respuesta a una nota nueva que no está en el mismo cambio no se escribe', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const { data, out } = await saveAnnotations(original, additionsDiff([REPLY_1]));
    const outPath = join(workDir, 'orphan-reply.pdf');
    writeFileSync(outPath, data);

    expect(qpdfCheck(outPath).code).toBe(0);
    expect(out.written.has('suite-r1')).toBe(false);
  }, FILE_TIMEOUT);
});

/** Primer resaltado de la página 1 de `bytes`, tal como lo importa la app. */
async function firstHighlight(bytes: Uint8Array): Promise<Annotation> {
  const found = (await baselineOf(bytes)).values();
  for (const a of found) if (a.type === 'highlight') return a;
  throw new Error('annotated.pdf no tiene resaltados');
}

/** Línea base de la página 1 de `bytes`. */
async function baselineOf(bytes: Uint8Array): Promise<ReadonlyMap<string, Annotation>> {
  const loaded = await openWith(bytes);
  try {
    const page = await loaded.doc.getPage(1);
    const imported = await readPageAnnotations(page, FALLBACK);
    return new Map(imported.supported.map((a) => [a.id, a] as const));
  } finally {
    await loaded.destroy();
  }
}
