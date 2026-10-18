import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import {
  diffAnnotations,
  type Annotation,
  type AnnotationDiff,
  type AnnotationEdits,
} from '../../../src/core/annotations';
import { buildIncrementalUpdate, openForSave, type IncrementalOutput } from '../../../src/core/pdf/incremental';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dict, dictGet, name, withEntries, type PdfRef } from '../../../src/core/pdf/objects';
import { loadPdf, readPageAnnotations, type LoadedPdf } from '../../../src/engine';
import { appendIncrementalUpdate } from '../../fixtures/pdf-builder';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { countingSource, nodeAssetBase } from '../../helpers/pdfjs-node';
import { fileAnnotation, newAnnotation, T0 } from '../annotations/factories';
import { bytes, latin1 } from './helpers';

const assetBaseUrl = nodeAssetBase();
const OPEN_TIMEOUT = 30_000;
const NOW = '2026-10-18T09:30:00.000Z';

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Diferencia entre una línea base y unos cambios (sin pasar por la UI). */
function diffOf(
  baseline: readonly Annotation[],
  upserts: readonly Annotation[],
  removed: readonly Annotation[] = [],
): AnnotationDiff {
  const edits: AnnotationEdits = {
    upserts: new Map(upserts.map((a) => [a.id, a] as const)),
    removed: new Set(removed.map((a) => a.id)),
    fields: new Map(),
  };
  return diffAnnotations(new Map(baseline.map((a) => [a.id, a] as const)), edits);
}

async function save(data: Uint8Array, diff: AnnotationDiff): Promise<IncrementalOutput> {
  const source = memorySource(data);
  const opened = await openForSave(source);
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  const result = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW });
  if (!result.ok) throw new Error(`save: ${result.error.code}`);
  return result.value;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function openPdf(data: Uint8Array): Promise<LoadedPdf> {
  const result = await loadPdf(memorySource(data), { assetBaseUrl });
  if (!result.ok) throw new Error(`pdf.js no abre el resultado: ${result.error.code}`);
  return result.value;
}

/** Subtipos, apariencia, contenido y título de las anotaciones que pdf.js ve en una página (1-based). */
async function pdfAnnotations(loaded: LoadedPdf, pageNumber: number) {
  const page = await loaded.doc.getPage(pageNumber);
  return page.getAnnotations();
}

/** Lo que pdf.js ve de anotaciones en la página; cierra el documento al terminar. */
async function withPdf<T>(data: Uint8Array, fn: (loaded: LoadedPdf) => Promise<T>): Promise<T> {
  const loaded = await openPdf(data);
  try {
    return await fn(loaded);
  } finally {
    await loaded.destroy();
  }
}

/** Subtipos de pdf.js ordenados, para comparar sin depender del orden de entrega. */
function subtypesOf(annots: readonly { readonly subtype?: string }[]): string[] {
  return annots.map((a) => a.subtype ?? '').sort();
}

/** Número de `%%EOF` del fichero. */
function eofCount(data: Uint8Array): number {
  return latin1(data).split('%%EOF').length - 1;
}

/** Valor de `/Annots` de una página, como referencia si es indirecta. */
async function annotsRefOf(reader: ObjectReader, pageIndex: number): Promise<PdfRef | null> {
  const page = await reader.getDict(await reader.pageRef(pageIndex));
  const value = page === null ? undefined : dictGet(page, 'Annots');
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && value.kind === 'ref'
    ? value
    : null;
}

describe('buildIncrementalUpdate · basic-5.pdf con seis anotaciones nuevas', () => {
  const pageOneAdds = [
    { ...newAnnotation('suite-hl', 'highlight', 0), contents: 'Resaltado', author: 'Ana Pérez' },
    { ...newAnnotation('suite-ul', 'underline', 0), color: [0, 0, 1] as const },
    { ...newAnnotation('suite-so', 'strikeout', 0), color: [1, 0, 0] as const },
  ];
  const pageTwoAdds = [
    { ...newAnnotation('suite-note', 'note', 1), contents: 'Nota ñandú 😀', author: 'Ana Pérez' },
    { ...newAnnotation('suite-ft', 'freetext', 1), contents: 'Texto libre', textColor: [0, 0, 1] as const },
    { ...newAnnotation('suite-ink', 'ink', 1), paths: [[10, 20, 40, 60, 80, 20], [5, 5]] },
  ];

  it('pdf.js ve los subtipos en su página, con apariencia y datos del modelo', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const out = await save(original, diffOf([], [...pageOneAdds, ...pageTwoAdds]));
    const data = concat(original, out.delta);

    await withPdf(data, async (loaded) => {
      const p1 = await pdfAnnotations(loaded, 1);
      const p2 = await pdfAnnotations(loaded, 2);
      expect(p1.map((a) => a.subtype)).toEqual(['Highlight', 'Underline', 'StrikeOut']);
      // pdf.js entrega los popups al final: se compara sin depender de ese orden.
      expect(subtypesOf(p2)).toEqual(['FreeText', 'Ink', 'Popup', 'Text']);
      for (const a of [...p1, ...p2]) {
        if (a.subtype !== 'Popup') expect(a.hasAppearance).toBe(true);
      }

      const highlight = p1[0];
      expect(highlight?.titleObj?.str).toBe('Ana Pérez');
      expect(highlight?.contentsObj?.str).toBe('Resaltado');
      // Quad de la fábrica: x1 y2, x2 y2, x1 y1, x2 y1.
      expectQuads(highlight?.quadPoints, [10, 40, 110, 40, 10, 20, 110, 20]);

      const note = p2[0];
      expect(note?.contentsObj?.str).toBe('Nota ñandú 😀');
      expect(note?.titleObj?.str).toBe('Ana Pérez');

      const ink = p2.find((a) => a.subtype === 'Ink');
      expectClose(flatten(ink?.inkLists), [10, 20, 40, 60, 80, 20, 5, 5]);
    });
  }, OPEN_TIMEOUT);

  it('los primeros size bytes son idénticos al original y el tamaño anunciado es exacto', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const out = await save(original, diffOf([], [...pageOneAdds, ...pageTwoAdds]));
    const data = concat(original, out.delta);
    expect(out.expectedSize).toBe(data.length);
    expect(data.subarray(0, original.length)).toEqual(original);
  });

  it('basic-5.pdf usa tabla clásica: "trailer" con /Prev; el delta no tiene xref stream', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const out = await save(original, diffOf([], pageOneAdds));
    const text = latin1(out.delta);
    expect(text).toMatch(/\nxref\n/);
    expect(text).toMatch(/\ntrailer\n/);
    expect(text).toContain('/Prev 1696');
    expect(text).not.toContain('/Type /XRef');
  });

  it('compressed.pdf usa xref stream: /Type /XRef y ningún "trailer"', async () => {
    const original = fixtureBytes('compressed.pdf');
    const out = await save(original, diffOf([], pageOneAdds));
    const text = latin1(out.delta);
    expect(text).toContain('/Type /XRef');
    expect(text).not.toMatch(/\ntrailer\n/);
    expect(text).toContain('/Prev 7696');
    await withPdf(concat(original, out.delta), async (loaded) => {
      expect((await pdfAnnotations(loaded, 1)).map((a) => a.subtype)).toEqual(['Highlight', 'Underline', 'StrikeOut']);
    });
  });

  it('es determinista: misma entrada y mismo "now" dan los mismos bytes', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const diff = diffOf([], [...pageOneAdds, ...pageTwoAdds]);
    const a = await save(original, diff);
    const b = await save(original, diff);
    expect(b.delta).toEqual(a.delta);
    expect([...a.written.entries()]).toEqual([...b.written.entries()]);
  });

  it('devuelve el objeto escrito de cada anotación nueva (id → número)', async () => {
    const out = await save(fixtureBytes('basic-5.pdf'), diffOf([], pageOneAdds));
    expect(out.written.get('suite-hl')).toEqual({ num: expect.any(Number), gen: 0 });
    expect(out.written.size).toBe(3);
  });

  it('un diff vacío devuelve delta vacío y el tamaño original', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const out = await save(original, diffOf([], []));
    expect(out.delta.length).toBe(0);
    expect(out.expectedSize).toBe(original.length);
    expect(out.written.size).toBe(0);
  });

  it('un original que no termina en salto de línea recibe uno antes del incremento', async () => {
    const original = fixtureBytes('basic-5.pdf');
    const trimmed = original.subarray(0, original.length - 1);
    const out = await save(trimmed, diffOf([], pageOneAdds));
    expect(out.delta[0]).toBe(0x0a);
  });

  it('página inexistente → error save-unreadable, sin excepciones', async () => {
    const data = fixtureBytes('basic-5.pdf');
    const source = memorySource(data);
    const reader = await ObjectReader.open(source);
    const bad = newAnnotation('suite-bad', 'highlight', 99);
    const result = await buildIncrementalUpdate({ source, reader, diff: diffOf([], [bad]), now: NOW });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-unreadable' }) });
  });
});

describe('buildIncrementalUpdate · annotated.pdf (borrar, modificar, añadir)', () => {
  async function baselineOf(data: Uint8Array): Promise<readonly Annotation[]> {
    return withPdf(data, async (loaded) => {
      const all: Annotation[] = [];
      for (let p = 1; p <= 3; p++) {
        const page = await loaded.doc.getPage(p);
        all.push(...(await readPageAnnotations(page, T0)).supported);
      }
      return all;
    });
  }

  it('borrar el resaltado de la página 1 quita él y su popup; el subrayado sigue', async () => {
    const data = fixtureBytes('annotated.pdf');
    const baseline = await baselineOf(data);
    const highlight = baseline.find((a) => a.type === 'highlight');
    expect(highlight).toBeDefined();
    if (highlight === undefined) return;
    const out = await save(data, diffOf(baseline, [], [highlight]));
    await withPdf(concat(data, out.delta), async (loaded) => {
      const p1 = await pdfAnnotations(loaded, 1);
      expect(p1.map((a) => a.subtype)).toEqual(['Underline']);
    });
  });

  it('modificar el comentario de la nota de la página 2 reescribe su texto y deja intacto el Square de la página 3', async () => {
    const data = fixtureBytes('annotated.pdf');
    const baseline = await baselineOf(data);
    const note = baseline.find((a) => a.type === 'note');
    expect(note).toBeDefined();
    if (note === undefined) return;
    const edited = { ...note, contents: 'Nota cambiada ñ' };
    const out = await save(data, diffOf(baseline, [edited]));
    await withPdf(concat(data, out.delta), async (loaded) => {
      const p2 = await pdfAnnotations(loaded, 2);
      const updated = p2.find((a) => a.subtype === 'Text');
      expect(updated?.contentsObj?.str).toBe('Nota cambiada ñ');
      const p3 = await pdfAnnotations(loaded, 3);
      expect(p3.map((a) => a.subtype)).toContain('Square');
    });
  });

  it('añadir en la página 2 (/Annots indirecto) reescribe el array y no el objeto página', async () => {
    const data = fixtureBytes('annotated.pdf');
    const reader = await ObjectReader.open(memorySource(data));
    const annotsRef = await annotsRefOf(reader, 1);
    expect(annotsRef).not.toBeNull();
    const pageRef = await reader.pageRef(1);
    const baseline = await baselineOf(data);

    const out = await save(data, diffOf(baseline, [newAnnotation('suite-p2', 'underline', 1)]));
    const text = latin1(out.delta);
    expect(text).not.toMatch(new RegExp(`(^|\\n)${pageRef.num} ${pageRef.gen} obj\\n`));
    expect(annotsRef).not.toBeNull();
    if (annotsRef !== null) expect(text).toMatch(new RegExp(`(^|\\n)${annotsRef.num} ${annotsRef.gen} obj\\n\\[`));

    await withPdf(concat(data, out.delta), async (loaded) => {
      const p2 = await pdfAnnotations(loaded, 2);
      expect(subtypesOf(p2)).toEqual(['FreeText', 'Ink', 'Popup', 'Text', 'Underline']);
    });
  });

  it('guardar dos veces seguidas: el segundo incremento se lee sobre el primero', async () => {
    const data = fixtureBytes('basic-5.pdf');
    const first = await save(data, diffOf([], [newAnnotation('suite-1', 'highlight', 0), newAnnotation('suite-2', 'note', 0)]));
    const afterFirst = concat(data, first.delta);

    const reader = await ObjectReader.open(memorySource(afterFirst));
    const source = memorySource(afterFirst);
    const baseline = await withPdf(afterFirst, async (loaded) => (await readPageAnnotations(await loaded.doc.getPage(1), T0)).supported);
    expect(baseline.map((a) => a.type)).toEqual(['highlight', 'note']);
    const highlight = baseline.find((a) => a.type === 'highlight');
    expect(highlight).toBeDefined();
    if (highlight === undefined) return;

    const second = await buildIncrementalUpdate({
      source,
      reader,
      diff: diffOf(baseline, [newAnnotation('suite-3', 'underline', 0)], [highlight]),
      now: NOW,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const finalBytes = concat(afterFirst, second.value.delta);

    expect(eofCount(finalBytes)).toBe(eofCount(data) + 2);
    await withPdf(finalBytes, async (loaded) => {
      const p1 = await pdfAnnotations(loaded, 1);
      // La nota conserva su popup: no se borra en el segundo guardado.
      expect(subtypesOf(p1)).toEqual(['Popup', 'Text', 'Underline']);
    });
  });
});

describe('buildIncrementalUpdate · errores', () => {
  it('trailer con /Encrypt → save-encrypted, sin excepción', async () => {
    const data = fixtureBytes('basic-5.pdf');
    const reader = await ObjectReader.open(memorySource(data));
    // El lector rechaza cifrados al abrir; aquí se simula el trailer cifrado sobre un lector válido.
    Object.defineProperty(reader, 'xref', {
      value: { ...reader.xref, trailer: withEntries(reader.xref.trailer, { Encrypt: dict({ Filter: name('Standard') }) }) },
    });
    const source = memorySource(data);
    const result = await buildIncrementalUpdate({ source, reader, diff: diffOf([], [newAnnotation('s', 'highlight')]), now: NOW });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-encrypted' }) });
  });

});

describe('openForSave', () => {
  it('corrupt-bad-startxref.pdf → save-unreadable, sin excepción', async () => {
    const result = await openForSave(memorySource(fixtureBytes('corrupt-bad-startxref.pdf')));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-unreadable' }) });
  });

  it('corrupt-empty.pdf → save-unreadable, sin excepción', async () => {
    const result = await openForSave(memorySource(fixtureBytes('corrupt-empty.pdf')));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-unreadable' }) });
  });

  it('un PDF cifrado de verdad (trailer /Encrypt) → save-encrypted, sin excepción', async () => {
    const encrypted = appendIncrementalUpdate(
      fixtureBytes('basic-5.pdf'),
      new Map([[1, '<< /Type /Catalog /Pages 2 0 R >>']]),
      '/Encrypt 9 0 R',
    );
    const result = await openForSave(memorySource(encrypted));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-encrypted' }) });
  });

  it('basic-5.pdf → ok, con la xref leída', async () => {
    const result = await openForSave(memorySource(fixtureBytes('basic-5.pdf')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.xref.size).toBeGreaterThan(0);
  });
});

describe('buildIncrementalUpdate · PDF pequeños de borde', () => {
  /** PDF de tabla clásica escrito a mano: cada objeto en su offset y una xref exacta. */
  function classicPdf(objects: Readonly<Record<number, string>>, trailer = ''): Uint8Array {
    let text = '%PDF-1.7\n';
    const offsets = new Map<number, number>();
    const nums = Object.keys(objects).map(Number).sort((a, b) => a - b);
    for (const n of nums) {
      offsets.set(n, text.length);
      text += `${n} 0 obj\n${objects[n] ?? ''}\nendobj\n`;
    }
    const size = Math.max(...nums) + 1;
    const xrefAt = text.length;
    let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let n = 1; n < size; n++) {
      const off = offsets.get(n);
      table += off === undefined ? '0000000000 65535 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    return bytes(`${text}${table}trailer\n<< /Size ${size} /Root 1 0 R ${trailer}>>\nstartxref\n${xrefAt}\n%%EOF\n`);
  }

  const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
  const PAGES = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const OLD_UNDERLINE = '<< /Type /Annot /Subtype /Underline /Rect [10 10 100 30] /QuadPoints [10 30 100 30 10 10 100 10] /C [1 0 0] /T (Ana) /Contents (vieja) >>';
  const OLD_POPUP = '<< /Type /Annot /Subtype /Popup /Rect [120 10 200 50] /Parent 4 0 R >>';

  function pageWith(annots: string, trailer = '', extra: Readonly<Record<number, string>> = {}): Uint8Array {
    return classicPdf(
      {
        1: CATALOG,
        2: PAGES,
        3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] ${annots} >>`,
        4: OLD_UNDERLINE,
        ...extra,
      },
      trailer,
    );
  }

  async function saveWith(data: Uint8Array, diff: AnnotationDiff): Promise<Awaited<ReturnType<typeof buildIncrementalUpdate>>> {
    const source = memorySource(data);
    const reader = await ObjectReader.open(source);
    return buildIncrementalUpdate({ source, reader, diff, now: NOW });
  }

  const oldAnnot = (): Annotation => fileAnnotation(4, 'underline', 0);

  it('sin /Annots: se crea el array en la página y el resultado lo ve pdf.js', async () => {
    const data = pageWith('');
    const result = await saveWith(data, diffOf([], [newAnnotation('suite-a', 'underline', 0)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await withPdf(concat(data, result.value.delta), async (loaded) => {
      expect((await pdfAnnotations(loaded, 1)).map((a) => a.subtype)).toEqual(['Underline']);
    });
  });

  it('/Annots null se trata como ausente', async () => {
    const data = pageWith('/Annots null');
    const result = await saveWith(data, diffOf([], [newAnnotation('suite-a', 'underline', 0)]));
    expect(result.ok).toBe(true);
  });

  it('/Annots directo: borra la anotación antigua y añade la nueva en la página reescrita', async () => {
    const data = pageWith('/Annots [4 0 R]');
    const result = await saveWith(data, diffOf([oldAnnot()], [newAnnotation('suite-a', 'strikeout', 0)], [oldAnnot()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(latin1(result.value.delta)).toMatch(/(^|\n)3 0 obj\n/);
    await withPdf(concat(data, result.value.delta), async (loaded) => {
      expect((await pdfAnnotations(loaded, 1)).map((a) => a.subtype)).toEqual(['StrikeOut']);
    });
  });

  it('borrar una nota quita también su popup aunque el origen no lo declare (/Popup del diccionario)', async () => {
    const annotated = classicPdf({
      1: CATALOG,
      2: PAGES,
      3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Annots [4 0 R] >>',
      4: '<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (nota) /Popup 5 0 R >>',
      5: OLD_POPUP,
    });
    const note = fileAnnotation(4, 'note', 0);
    const result = await saveWith(annotated, diffOf([note], [], [note]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await withPdf(concat(annotated, result.value.delta), async (loaded) => {
      expect(await pdfAnnotations(loaded, 1)).toEqual([]);
    });
  });

  it('/Annots indirecto a un objeto que no es array → save-unreadable', async () => {
    const data = pageWith('/Annots 5 0 R', '', { 5: '<< /Foo 1 >>' });
    const result = await saveWith(data, diffOf([], [newAnnotation('suite-a', 'underline', 0)]));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-unreadable' }) });
  });

  it('/Annots que no es array ni referencia → save-unreadable', async () => {
    const data = pageWith('/Annots 7');
    const result = await saveWith(data, diffOf([], [newAnnotation('suite-a', 'underline', 0)]));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'save-unreadable' }) });
  });

  it('conserva el /ID original como id0 y el /Info del trailer', async () => {
    const data = pageWith('', '/ID [<aabbcc> <ddeeff>] /Info 6 0 R', { 6: '<< /Title (x) >>' });
    const result = await saveWith(data, diffOf([], [newAnnotation('suite-a', 'underline', 0)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = latin1(result.value.delta);
    // El serializador escribe el hex en mayúsculas: mismos bytes que el original.
    expect(text).toContain('/ID [<AABBCC> <');
    expect(text).toContain('/Info 6 0 R');
  });

  it('sin /ID en el original, ambos identificadores son nuevos e iguales', async () => {
    const data = pageWith('');
    const result = await saveWith(data, diffOf([], [newAnnotation('suite-a', 'underline', 0)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const match = /\/ID \[<([0-9A-F]+)> <([0-9A-F]+)>\]/.exec(latin1(result.value.delta));
    expect(match?.[1]).toHaveLength(32);
    expect(match?.[1]).toBe(match?.[2]);
  });
});

describe('buildIncrementalUpdate · presupuestos de lectura (ADR-0014)', () => {
  function annotationsAt(pages: readonly number[]): AnnotationDiff {
    return diffOf([], pages.map((p, i) => newAnnotation(`suite-${i}`, 'highlight', p)));
  }

  it('pages-5000.pdf + 10 anotaciones: delta < 50 KB y bytes leídos < 35 % del fichero', async () => {
    const data = fixtureBytes('pages-5000.pdf');
    const pages = [0, 499, 1000, 1999, 2500, 3000, 3500, 4000, 4500, 4999];
    const source = countingSource(memorySource(data));
    const reader = await ObjectReader.open(source);
    const result = await buildIncrementalUpdate({ source, reader, diff: annotationsAt(pages), now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.delta.length).toBeLessThan(50 * 1024);
    expect(source.bytesRead / data.length).toBeLessThan(0.35);
  }, OPEN_TIMEOUT);

  it('pages-100000.pdf + 10 anotaciones en páginas repartidas: bytes leídos < 16 % del fichero', async () => {
    const data = fixtureBytes('pages-100000.pdf');
    const pages = [0, 12345, 25000, 37777, 50000, 62500, 75000, 87654, 99000, 99999];
    const source = countingSource(memorySource(data));
    const reader = await ObjectReader.open(source);
    const result = await buildIncrementalUpdate({ source, reader, diff: annotationsAt(pages), now: NOW });
    expect(result.ok).toBe(true);
    expect(source.bytesRead / data.length).toBeLessThan(0.16);
  }, OPEN_TIMEOUT);
});

/** Aplana números, listas y typed arrays (pdf.js entrega `quadPoints` y `inkLists` así). */
function flatten(v: unknown): number[] {
  if (typeof v === 'number') return [v];
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) return v.flatMap((item: unknown) => flatten(item));
  return [];
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(Math.abs(v - (expected[i] ?? NaN))).toBeLessThanOrEqual(0.01));
}

function expectQuads(actual: unknown, expected: readonly number[]): void {
  expectClose(flatten(actual), expected);
}
