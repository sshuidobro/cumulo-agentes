/**
 * Redacción real (PDF-135): planificación por página, reescritura del texto glifo a glifo, imágenes, anotaciones,
 * páginas en imagen y cifrado. Los PDF de prueba se construyen en el test o son fixtures generados (basic-5.pdf,
 * annotated.pdf, form.pdf, encrypted-aes-256.pdf). La validación externa usa `pdftotext` y `qpdf`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { interpretPage, pageContentBytes, parseContent, quadBounds, type ContentOp, type GlyphBox, type Quad } from '../../../src/core/content';
import { DOC_OPS } from '../../../src/core/doc-ops/ops';
import type { OpContext } from '../../../src/core/doc-ops/protocol';
import { concatSource } from '../../../src/core/pdf/concat-source';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { dictGet, type PdfDict, type PdfValue } from '../../../src/core/pdf/objects';
import { rewriteDocument } from '../../../src/core/pdf/rewrite';
import { buildRedactionUpdate, planRedaction, type RedactArea, type RectPt } from '../../../src/core/redact/apply';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { ensureFixtures } from '../../fixtures/ensure.ts';
import { FIXTURES_DIR } from '../../fixtures/paths.ts';
import { bytes, helveticaResources, onePagePdf, openPage } from '../content/helpers';
import { scannedPageJpeg } from '../../fixtures/scanned.ts';

const NOW = '2026-10-20T10:00:00.000Z';
const LATIN1 = 'latin1';
/** Glifos de «Página 1» al inicio de la primera línea de basic-5.pdf. */
const FIRST_WORD_GLYPHS = 8;
const PAGE_WORDS = 'Página 1';
const FIXTURE_BASIC = 'basic-5.pdf';
/** Y de la línea «Página 1 de 5» en basic-5.pdf (`textPage`: 720 pt). */
const FIRST_LINE_Y = 720;

/** Redacta `data` con las zonas y devuelve el PDF reescrito completo (como lo hace la operación `redact`). */
async function redactBytes(
  data: Uint8Array,
  areas: readonly RedactArea[],
  rasterPages = new Map<number, Uint8Array>(),
): Promise<Uint8Array> {
  const source = memorySource(data);
  const reader = await ObjectReader.open(source);
  const built = await buildRedactionUpdate({ source, reader, areas, rasterPages, imageReplacements: new Map(), now: NOW });
  if (!built.ok) throw new Error(built.error.code);
  const reopened = await ObjectReader.open(concatSource(source, built.value.delta));
  const written = await rewriteDocument({ reader: reopened, encryption: null, keepEncryption: true, now: NOW });
  if (!written.ok) throw new Error(written.error.code);
  return written.value.bytes;
}

/** Caja envolvente de los `count` primeros glifos de la página `index`, con un margen que no toca el glifo siguiente. */
async function zoneOverGlyphs(data: Uint8Array, count: number, index = 0): Promise<RectPt> {
  const glyphs = await glyphsOf(data, index);
  const boxes = glyphs.slice(0, count).map((glyph) => quadBounds(glyph.quad));
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[2]));
  const y1 = Math.max(...boxes.map((b) => b[3]));
  return [x0 + 0.01, y0 - 1, x1 - 0.01, y1 + 1];
}

/** Caja de un glifo sin alcanzar a sus vecinos (0,01 pt por dentro); un glifo de ancho nulo se cubre con un margen. */
function around(glyph: GlyphBox | undefined): RectPt {
  const [x0, y0, x1, y1] = quadBounds(glyph?.quad ?? ([0, 0, 0, 0, 0, 0, 0, 0] as Quad));
  if (x1 - x0 <= 0.02) return [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
  return [x0 + 0.01, y0 - 1, x1 - 0.01, y1 + 1];
}

/** Glifos de la página `index`. */
async function glyphsOf(data: Uint8Array, index = 0): Promise<readonly GlyphBox[]> {
  const { reader, page } = await openPage(data, index);
  return (await interpretPage(reader, page)).glyphs;
}

/** Operaciones del contenido de la página `index`. */
async function contentOpsOf(data: Uint8Array, index = 0): Promise<readonly ContentOp[]> {
  const { reader, page } = await openPage(data, index);
  return parseContent(await pageContentBytes(reader, page));
}

/** Texto mostrado por `Tj`, `'` y `TJ` de la página `index`, sin ajustes. */
async function shownText(data: Uint8Array, index = 0): Promise<string> {
  const parts: string[] = [];
  for (const op of await contentOpsOf(data, index)) {
    for (const item of stringsOf(op)) parts.push(Buffer.from(item.bytes).toString(LATIN1));
  }
  return parts.join('');
}

function stringsOf(op: ContentOp): readonly { readonly bytes: Uint8Array; readonly hex: boolean }[] {
  const out: { readonly bytes: Uint8Array; readonly hex: boolean }[] = [];
  const candidates: readonly PdfValue[] = op.op === 'TJ' ? (Array.isArray(op.operands[0]) ? op.operands[0] : []) : op.operands;
  for (const value of candidates) {
    if (isString(value)) out.push(value);
  }
  return out;
}

/** Texto de una página con `pdftotext`. */
function pdftotext(data: Uint8Array, page: number, password?: string): string {
  return withFile(data, (file) => {
    const args = ['-f', String(page), '-l', String(page), ...(password === undefined ? [] : ['-upw', password]), file, '-'];
    const run = spawnSync('pdftotext', args, { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`pdftotext falló: ${run.stderr}`);
    return run.stdout;
  });
}

/** Código de salida de `qpdf --check` (0 sin errores ni avisos, 3 con avisos, 2 con errores). */
function qpdfCheck(data: Uint8Array, password?: string): number | null {
  return withFile(data, (file) => {
    const args = ['--check', ...(password === undefined ? [] : [`--password=${password}`]), file];
    return spawnSync('qpdf', args, { encoding: LATIN1 }).status;
  });
}

/** Escribe `data` en un directorio temporal, ejecuta `inDir` con la ruta y borra el directorio. */
function withFile<T>(data: Uint8Array, inDir: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'suite-redact-'));
  try {
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, data);
    return inDir(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** PDF de una página con `content` y los recursos que devuelve `resources`. */
function pageWith(content: string, resources: (b: PdfBuilder) => string = helveticaResources): Uint8Array {
  return onePagePdf(content, resources);
}

function area(pageIndex: number, rect: RectPt): RedactArea {
  return { pageIndex, rect };
}

function isString(v: PdfValue | undefined): v is { readonly kind: 'string'; readonly bytes: Uint8Array; readonly hex: boolean } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

function isDictValue(v: PdfValue | undefined): v is PdfDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'dict';
}

interface AnnotInfo {
  readonly num: number;
  readonly subtype: string;
  readonly rect: RectPt;
  readonly popup: number | null;
}

/** Anotaciones de una página: referencia, subtipo, rectángulo y referencia al `/Popup`. */
async function annotsOf(data: Uint8Array, index = 0): Promise<readonly AnnotInfo[]> {
  const { reader, page } = await openPage(data, index);
  const annots = await reader.resolve(dictGet(page, 'Annots'));
  if (!Array.isArray(annots)) return [];
  const out: AnnotInfo[] = [];
  for (const item of annots) {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || !('kind' in item) || item.kind !== 'ref') continue;
    const annot = await reader.getDict(item);
    if (annot === null) continue;
    const subtype = await reader.resolve(dictGet(annot, 'Subtype'));
    const rect = await reader.resolve(dictGet(annot, 'Rect'));
    const popup = dictGet(annot, 'Popup');
    const coords = Array.isArray(rect) ? rect.map((v) => (typeof v === 'number' ? v : 0)) : [0, 0, 0, 0];
    out.push({
      num: item.num,
      subtype: typeof subtype === 'object' && subtype !== null && !Array.isArray(subtype) && 'value' in subtype ? String(subtype.value) : '',
      rect: [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0, coords[3] ?? 0],
      popup: typeof popup === 'object' && popup !== null && !Array.isArray(popup) && 'kind' in popup && popup.kind === 'ref' ? popup.num : null,
    });
  }
  return out;
}

/** x de origen del primer ítem de pdf.js de la página 1 en la línea de la zona cuyo texto empieza por «de». */
async function firstWordAfterZoneX(data: Uint8Array): Promise<number | null> {
  // pdf.js transfiere el búfer que recibe: se le pasa una copia para no dejar `data` sin bytes.
  const task = getDocument({ data: data.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item && item.transform[5] === FIRST_LINE_Y && item.str.trimStart().startsWith('de')) {
        return item.transform[4] ?? null;
      }
    }
    return null;
  } finally {
    await task.destroy();
  }
}

/** Página con una fuente Type3 (sin medidas) y la letra «a» en 72,700. */
function type3Page(): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const page = b.alloc();
  const font = b.addObject(
    '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << >> /Encoding << /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [500] >>',
  );
  const contents = b.addStream('<< >>', 'BT /F1 20 Tf 72 700 Td (a) Tj ET');
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
  b.setObject(
    page,
    `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(contents)} 0 R >>`,
  );
  return b.build({ root: catalog });
}

/** Página con un Form XObject de caja `bbox` dibujado con la matriz identidad. */
function formPage(bbox: readonly number[]): Uint8Array {
  return onePagePdf('q /Fx Do Q', (b) => {
    const form = b.addStream(`<< /Type /XObject /Subtype /Form /BBox [${bbox.join(' ')}] >>`, '0 g 0 0 10 10 re f');
    return `<< /XObject << /Fx ${String(form)} 0 R >> >>`;
  });
}

/** Página con una imagen 1×1 dibujada en 40–200; con `twice`, otra copia del mismo nombre fuera de esa zona. */
function imagePage(twice = false): Uint8Array {
  const draw = twice
    ? 'q 160 0 0 160 40 40 cm /Im0 Do Q q 40 0 0 40 400 400 cm /Im0 Do Q'
    : 'q 160 0 0 160 40 40 cm /Im0 Do Q';
  return onePagePdf(draw, (b) => {
    const image = b.addStream(
      '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>',
      new Uint8Array([0x80]),
    );
    return `<< /XObject << /Im0 ${String(image)} 0 R >> >>`;
  });
}

/** Operación `redact` del Worker sobre `data`: devuelve los bytes del PDF reescrito. */
async function runRedact(
  data: Uint8Array,
  args: { readonly password: string | null; readonly areas: readonly RedactArea[] },
): Promise<Uint8Array> {
  const op = DOC_OPS.redact;
  if (op === undefined) throw new Error('falta la operación redact');
  const result = await op({ ...args, rasterPages: [], imageReplacements: [], now: NOW }, context(data));
  if (!result.ok) throw new Error(result.error.code);
  return (result.value as { readonly bytes: Uint8Array }).bytes;
}

function context(data: Uint8Array): OpContext {
  return { sources: [memorySource(data)], signal: new AbortController().signal, progress: () => undefined };
}

describe('planRedaction', () => {
  ensureFixtures();
  const basic = new Uint8Array(readFileSync(join(FIXTURES_DIR, FIXTURE_BASIC)));

  it('una zona sobre texto normal deja la página sin convertir en imagen', async () => {
    const reader = await ObjectReader.open(memorySource(basic));
    const rect = await zoneOverGlyphs(basic, FIRST_WORD_GLYPHS);
    expect(await planRedaction(reader, [area(0, rect)])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: false, partialImages: [] }],
    });
  });

  it('zona fuera de las páginas, de área nula o no finita → organize-invalid', async () => {
    const reader = await ObjectReader.open(memorySource(basic));
    const results = [
      await planRedaction(reader, [area(9, [0, 0, 10, 10])]),
      await planRedaction(reader, [area(0, [0, 0, 10, 0])]),
      await planRedaction(reader, [area(0, [0, 0, Number.NaN, 10])]),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('organize-invalid');
    }
  });

  it('sin zonas no hay páginas que planificar', async () => {
    const reader = await ObjectReader.open(memorySource(basic));
    expect(await planRedaction(reader, [])).toEqual({ ok: true, value: [] });
  });

  it('una fuente Type3 bajo la zona marca la página como imagen', async () => {
    const reader = await ObjectReader.open(memorySource(type3Page()));
    expect(await planRedaction(reader, [area(0, [60, 690, 200, 720])])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: true, partialImages: [] }],
    });
  });

  it('un contenido que no se puede interpretar marca la página como imagen', async () => {
    const reader = await ObjectReader.open(memorySource(pageWith('BT /F1 12 Tf 72 700 Td (sin cerrar Tj ET')));
    expect(await planRedaction(reader, [area(0, [0, 0, 100, 100])])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: true, partialImages: [] }],
    });
  });

  it('un formulario (Form XObject) que toca la zona marca la página como imagen', async () => {
    const reader = await ObjectReader.open(memorySource(formPage([0, 0, 100, 100])));
    expect(await planRedaction(reader, [area(0, [50, 50, 60, 60])])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: true, partialImages: [] }],
    });
  });

  it('una imagen que cruza la zona marca la página como imagen; una imagen entera dentro no', async () => {
    const reader = await ObjectReader.open(memorySource(imagePage()));
    expect(await planRedaction(reader, [area(0, [120, 120, 200, 200])])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: true, partialImages: [] }],
    });
    expect(await planRedaction(reader, [area(0, [40, 40, 200, 200])])).toEqual({
      ok: true,
      value: [{ pageIndex: 0, raster: false, partialImages: [] }],
    });
  });
});

describe('buildRedactionUpdate: texto y criterio original', () => {
  ensureFixtures();
  const basic = new Uint8Array(readFileSync(join(FIXTURES_DIR, FIXTURE_BASIC)));

  it('quita «Página 1» de la página 1 y deja el resto de la línea y de las páginas', async () => {
    const out = await redactBytes(basic, [area(0, await zoneOverGlyphs(basic, FIRST_WORD_GLYPHS))]);
    expect(pdftotext(out, 1)).not.toContain(PAGE_WORDS);
    expect(pdftotext(out, 1)).toContain('de 5');
    expect(await shownText(out)).toMatch(/^ de 5/);
    expect(pdftotext(out, 2)).toContain('Página 2 de 5');
    expect(qpdfCheck(out)).toBe(0);
  });

  it('la palabra redactada no aparece descomprimida en el fichero (qpdf --qdf)', async () => {
    const out = await redactBytes(basic, [area(0, await zoneOverGlyphs(basic, FIRST_WORD_GLYPHS))]);
    const flat = withFile(out, (file) => {
      const qdf = `${file}.qdf.pdf`;
      expect(spawnSync('qpdf', ['--qdf', '--object-streams=disable', file, qdf]).status).toBeLessThan(2);
      return readFileSync(qdf, LATIN1);
    });
    expect(flat).not.toContain(PAGE_WORDS);
    expect(flat).not.toContain(Buffer.from(PAGE_WORDS, LATIN1).toString('hex'));
    expect(flat).not.toContain(Buffer.from(PAGE_WORDS, LATIN1).toString('hex').toUpperCase());
  });

  it('las palabras que siguen en la línea conservan su posición (±0,5 pt)', async () => {
    const before = await glyphsOf(basic);
    const out = await redactBytes(basic, [area(0, await zoneOverGlyphs(basic, FIRST_WORD_GLYPHS))]);
    const after = await glyphsOf(out);
    expect(after.length).toBe(before.length - FIRST_WORD_GLYPHS);
    before.slice(FIRST_WORD_GLYPHS).forEach((glyph, i) => {
      const original = quadBounds(glyph.quad)[0];
      const moved = quadBounds(after[i]?.quad ?? glyph.quad)[0];
      expect(Math.abs(original - moved)).toBeLessThanOrEqual(0.5);
    });
  });

  it('pdf.js sitúa la primera palabra tras la zona en la x que tenía (±0,5 pt)', async () => {
    const before = await glyphsOf(basic);
    const out = await redactBytes(basic, [area(0, await zoneOverGlyphs(basic, FIRST_WORD_GLYPHS))]);
    // pdf.js empieza el ítem en la palabra «de», no en el espacio que la precede: su glifo es el siguiente a la zona.
    const originalX = quadBounds(before[FIRST_WORD_GLYPHS + 1]?.quad ?? ([0, 0, 0, 0, 0, 0, 0, 0] as Quad))[0];
    const redactedX = await firstWordAfterZoneX(out);
    expect(redactedX).not.toBeNull();
    expect(Math.abs((redactedX ?? 0) - originalX)).toBeLessThanOrEqual(0.5);
  });

  it('una zona sobre espacio en blanco solo pinta el rectángulo negro', async () => {
    const out = await redactBytes(basic, [area(0, [500, 10, 560, 30])]);
    expect(pdftotext(out, 1)).toContain(PAGE_WORDS);
    expect((await contentOpsOf(out, 0)).some((op) => op.op === 're')).toBe(true);
    expect(qpdfCheck(out)).toBe(0);
  });

  it('la reescritura es completa: una sola xref y sin /Prev', async () => {
    const out = await redactBytes(basic, [area(0, await zoneOverGlyphs(basic, FIRST_WORD_GLYPHS))]);
    const text = Buffer.from(out).toString(LATIN1);
    expect(text).not.toContain('/Prev');
    expect(text.match(/startxref/g)?.length).toBe(1);
  });

  it('sin zonas el delta está vacío y el tamaño esperado es el del original', async () => {
    const source = memorySource(basic);
    const reader = await ObjectReader.open(source);
    expect(await buildRedactionUpdate({ source, reader, areas: [], rasterPages: new Map(), imageReplacements: new Map(), now: NOW })).toEqual({
      ok: true,
      value: { delta: new Uint8Array(0), expectedSize: basic.length },
    });
  });

  it('una zona en una página que no existe se rechaza', async () => {
    const source = memorySource(basic);
    const reader = await ObjectReader.open(source);
    const built = await buildRedactionUpdate({ source, reader, areas: [area(5, [0, 0, 1, 1])], rasterPages: new Map(), imageReplacements: new Map(), now: NOW });
    expect(built.ok).toBe(false);
  });

  it('una operación abortada devuelve cancelled', async () => {
    const source = memorySource(basic);
    const reader = await ObjectReader.open(source);
    const controller = new AbortController();
    controller.abort();
    const built = await buildRedactionUpdate({
      source,
      reader,
      areas: [area(0, [0, 0, 10, 10])],
      rasterPages: new Map(),
      imageReplacements: new Map(),
      now: NOW,
      signal: controller.signal,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe('cancelled');
  });
});

describe('buildRedactionUpdate: operaciones de texto', () => {
  it('TJ: el glifo quitado cede su avance al ajuste vecino y el resto de cadenas se conserva', async () => {
    // A(667) B(667) C(722) D(722) en Helvetica a 20 pt: quitar la B suma −667 al ajuste −200 existente.
    const data = pageWith('BT /F1 20 Tf 72 700 Td [(AB) -200 (CD)] TJ ET');
    const glyphs = await glyphsOf(data);
    const out = await redactBytes(data, [area(0, around(glyphs[1]))]);
    expect(await shownText(out)).toBe('ACD');
    const tj = (await contentOpsOf(out)).find((op) => op.op === 'TJ');
    const items = Array.isArray(tj?.operands[0]) ? tj.operands[0] : [];
    expect(items).toContain(-867);
  });

  it('cadenas hexadecimales: los códigos que quedan conservan el tipo hexadecimal', async () => {
    const data = pageWith('BT /F1 20 Tf 72 700 Td <4142> Tj ET');
    const glyphs = await glyphsOf(data);
    const out = await redactBytes(data, [area(0, around(glyphs[0]))]);
    const tj = (await contentOpsOf(out)).find((op) => op.op === 'TJ');
    const str = Array.isArray(tj?.operands[0]) ? tj.operands[0].find(isString) : undefined;
    expect(str?.hex).toBe(true);
    expect(Buffer.from(str?.bytes ?? []).toString(LATIN1)).toBe('B');
  });

  it("el operador ' se sustituye por T* y TJ; el de \" por Tw, Tc, T* y TJ", async () => {
    const data = pageWith('BT /F1 20 Tf 14 TL 72 700 Td (ab) \' 1 2 (cd) " ET');
    const glyphs = await glyphsOf(data);
    // La «a» es el primer glifo de la línea de `'`; la «c» el tercero (primero de la línea de `"`).
    const out = await redactBytes(data, [area(0, around(glyphs[0])), area(0, around(glyphs[2]))]);
    const names = (await contentOpsOf(out)).map((op) => op.op);
    expect(names).toContain('T*');
    expect(names).toContain('Tw');
    expect(names).toContain('Tc');
    expect(names).not.toContain("'");
    expect(names).not.toContain('"');
    expect(await shownText(out)).toBe('bd');
  });

  it('con Tfs 0 el texto de la operación se quita entero', async () => {
    const data = pageWith('BT /F1 0 Tf 100 700 Td (X) Tj ET');
    const glyphs = await glyphsOf(data);
    expect(glyphs[0]?.shift).toBeNull();
    const out = await redactBytes(data, [area(0, around(glyphs[0]))]);
    expect((await contentOpsOf(out)).some((op) => op.op === 'Tj' || op.op === 'TJ')).toBe(false);
  });

  it('dos usos del mismo nombre de imagen: quitar uno no borra el recurso que usa el otro', async () => {
    const out = await redactBytes(imagePage(true), [area(0, [40, 40, 200, 200])]);
    const reader = await ObjectReader.open(memorySource(out));
    const page = await reader.getDict(await reader.pageRef(0));
    const resources = page === null ? undefined : dictGet(page, 'Resources');
    const xobjects = isDictValue(resources) ? dictGet(resources, 'XObject') : undefined;
    expect(isDictValue(xobjects) && xobjects.entries.has('Im0')).toBe(true);
    expect((await contentOpsOf(out)).filter((op) => op.op === 'Do').length).toBe(1);
  });

  it('una imagen entera dentro de la zona desaparece de la página y del fichero', async () => {
    const out = await redactBytes(imagePage(), [area(0, [40, 40, 200, 200])]);
    expect((await contentOpsOf(out)).some((op) => op.op === 'Do')).toBe(false);
    expect(Buffer.from(out).toString(LATIN1)).not.toContain('/Subtype /Image');
    expect(qpdfCheck(out)).toBe(0);
  });
});

describe('buildRedactionUpdate: anotaciones y formularios', () => {
  ensureFixtures();

  it('annotated.pdf: la nota y su popup no quedan; las demás anotaciones sí', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'annotated.pdf')));
    const before = await annotsOf(data);
    // La «nota» del fixture es el resaltado con su ventana emergente (/Popup).
    const note = before.find((a) => a.popup !== null);
    expect(note).toBeDefined();
    const out = await redactBytes(data, [area(0, note?.rect ?? [0, 0, 0, 0])]);
    const after = await annotsOf(out);
    const expected = before.filter((a) => a !== note && a.num !== note?.popup).map((a) => [a.subtype, a.rect]);
    expect(expected).toEqual([['Underline', [72, 640, 300, 660]]]);
    expect(after.map((a) => [a.subtype, a.rect])).toEqual(expected);
  });

  it('form.pdf: el widget tocado sale de la página y de /AcroForm', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'form.pdf')));
    const before = await annotsOf(data);
    const widget = before.find((a) => a.subtype === 'Widget');
    expect(widget).toBeDefined();
    const out = await redactBytes(data, [area(0, widget?.rect ?? [0, 0, 0, 0])]);
    const after = await annotsOf(out);
    expect(after.map((a) => a.rect)).toEqual(before.filter((a) => a !== widget).map((a) => a.rect));
    expect(qpdfCheck(out)).toBeLessThan(2);
  });
});

describe('buildRedactionUpdate: páginas en imagen', () => {
  it('la página en imagen queda con solo su imagen, sin texto ni anotaciones', async () => {
    const out = await redactBytes(type3Page(), [area(0, [60, 690, 200, 720])], new Map([[0, scannedPageJpeg(1)]]));
    expect(pdftotext(out, 1).trim()).toBe('');
    expect(qpdfCheck(out)).toBe(0);
    const ops = (await contentOpsOf(out)).map((op) => op.op);
    expect(ops).toContain('Do');
    expect(ops).not.toContain('Tj');
    expect(ops).not.toContain('TJ');
  });

  it('falta el JPEG de una página en imagen → organize-invalid', async () => {
    const source = memorySource(type3Page());
    const reader = await ObjectReader.open(source);
    const built = await buildRedactionUpdate({ source, reader, areas: [area(0, [60, 690, 200, 720])], rasterPages: new Map(), imageReplacements: new Map(), now: NOW });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe('organize-invalid');
  });

  it('un JPEG que no se reconoce → invalid-image', async () => {
    const source = memorySource(type3Page());
    const reader = await ObjectReader.open(source);
    const built = await buildRedactionUpdate({
      source,
      reader,
      areas: [area(0, [60, 690, 200, 720])],
      rasterPages: new Map([[0, bytes('no es un jpeg')]]),
      imageReplacements: new Map(),
      now: NOW,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.code).toBe('invalid-image');
  });
});

describe('operación redact (cifrado y argumentos)', () => {
  ensureFixtures();

  it('encrypted-aes-256.pdf: sigue cifrado, abre con «usuario» y no contiene el texto redactado', async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'encrypted-aes-256.pdf')));
    // El cifrado no cambia la disposición del texto: la zona se mide sobre basic-5.pdf sin cifrar.
    const rect = await zoneOverGlyphs(new Uint8Array(readFileSync(join(FIXTURES_DIR, FIXTURE_BASIC))), FIRST_WORD_GLYPHS);
    const out = await runRedact(data, { password: 'usuario', areas: [area(0, rect)] });
    expect(Buffer.from(out).toString(LATIN1)).toContain('/Encrypt');
    expect(pdftotext(out, 1, 'usuario')).not.toContain(PAGE_WORDS);
    expect(qpdfCheck(out, 'usuario')).toBe(0);
  });

  it('argumentos mal formados lanzan TypeError', async () => {
    const op = DOC_OPS.redact;
    if (op === undefined) throw new Error('falta la operación redact');
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, FIXTURE_BASIC)));
    const base = { password: null, now: NOW, rasterPages: [], imageReplacements: [] };
    await expect(op({ ...base, areas: 'no' }, context(data))).rejects.toThrow(TypeError);
    await expect(op({ ...base, areas: [{ pageIndex: 0, rect: [1, 2, 3] }] }, context(data))).rejects.toThrow(TypeError);
    await expect(op({ ...base, areas: [], rasterPages: [[0, 'x']] }, context(data))).rejects.toThrow(TypeError);
  });

  it('redact-plan devuelve el plan de cada página con zonas', async () => {
    const op = DOC_OPS['redact-plan'];
    if (op === undefined) throw new Error('falta la operación redact-plan');
    const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, FIXTURE_BASIC)));
    const result = await op({ password: null, areas: [{ pageIndex: 1, rect: [0, 0, 100, 100] }] }, context(data));
    expect(result).toEqual({ ok: true, value: [{ pageIndex: 1, raster: false, partialImages: [] }] });
  });
});
