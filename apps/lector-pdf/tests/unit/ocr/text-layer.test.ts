import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { afterAll, describe, expect, it } from 'vitest';
import { buildOcrUpdate, ocrOperators, type OcrPage } from '../../../src/core/ocr/text-layer';
import { openForSave } from '../../../src/core/pdf/incremental';
import { ensureFixtures } from '../../fixtures/ensure.ts';
import { FIXTURES_DIR } from '../../fixtures/paths.ts';
import { qpdfCheck, run } from '../../support/qpdf';

const NOW = '2026-10-20T10:00:00.000Z';
const FONT = 'F';
const PAINT_OPERATORS = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n', 're', 'm', 'l', 'c', 'v', 'y', 'Do', 'sh', 'W', 'W*']);

ensureFixtures();
const temp = mkdtempSync(join(tmpdir(), 'ocr-layer-'));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Quita los literales de cadena y devuelve los operadores del contenido como lista. */
function operatorsOf(ops: string): string[] {
  return ops
    .replace(/\((?:\\.|[^\\)])*\)/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');
}

/** Escribe `bytes` en el directorio temporal y lo valida con qpdf (código 0 = sin errores ni avisos). */
function checkWithQpdf(bytes: Uint8Array, name: string, password?: string): string {
  const path = join(temp, name);
  writeFileSync(path, bytes);
  const result = qpdfCheck(path, password);
  expect(result.code, result.output).toBe(0);
  return path;
}

/** Abre `file` y escribe la capa de texto de `pages`; devuelve el original y el resultado concatenado. */
async function writeLayer(file: string, pages: readonly OcrPage[], password?: string) {
  const bytes = fixtureBytes(file);
  const source = memorySource(bytes);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(`openForSave: ${opened.error.code}`);
  const built = await buildOcrUpdate({ source, reader: opened.value, pages, now: NOW });
  if (!built.ok) throw new Error(`buildOcrUpdate: ${built.error.code}`);
  return { bytes, built: built.value, output: concat(bytes, built.value.delta) };
}

async function withDocument<T>(bytes: Uint8Array, callback: (doc: PDFDocumentProxy) => Promise<T>, password?: string): Promise<T> {
  const task = getDocument({ data: bytes, verbosity: 0, ...(password === undefined ? {} : { password }) });
  try {
    return await callback(await task.promise);
  } finally {
    await task.destroy();
  }
}

describe('ocrOperators', () => {
  const hola: OcrPage = { pageIndex: 0, rotate: 0, words: [{ text: 'Hola', box: [100, 700, 150, 712] }] };

  it('una palabra con giro 0 usa Tr invisible, la fuente, el tamaño de la caja y la posición', () => {
    const ops = ocrOperators(hola, FONT);
    expect(ops).toContain('3 Tr');
    expect(ops).toContain('/F 12 Tf');
    expect(ops).toContain('1 0 0 1 100 700 Tm');
    expect(ops).toContain('(Hola ) Tj');
    expect(ops.startsWith('BT ')).toBe(true);
    expect(ops).toContain(' ET');
  });

  it('giro 90 usa el origen (x1, y0), la matriz rotada y el alto de la caja como tamaño', () => {
    const page: OcrPage = { pageIndex: 0, rotate: 90, words: [{ text: 'Hola', box: [100, 700, 112, 750] }] };
    const ops = ocrOperators(page, FONT);
    expect(ops).toContain('0 1 -1 0 112 700 Tm');
    expect(ops).toContain('/F 12 Tf');
  });

  it('giro 180 y 270 usan sus orígenes y matrices', () => {
    const at180 = ocrOperators({ pageIndex: 0, rotate: 180, words: [{ text: 'a', box: [100, 700, 150, 712] }] }, FONT);
    expect(at180).toContain('-1 0 0 -1 150 712 Tm');
    const at270 = ocrOperators({ pageIndex: 0, rotate: 270, words: [{ text: 'a', box: [100, 700, 112, 750] }] }, FONT);
    expect(at270).toContain('0 -1 1 0 100 750 Tm');
  });

  it('ajusta la escala horizontal al ancho de la caja y la limita a [10, 1000]', () => {
    const wide = ocrOperators({ pageIndex: 0, rotate: 0, words: [{ text: 'Hola', box: [0, 0, 500, 12] }] }, FONT);
    expect(wide).toMatch(/ \d+(\.\d+)? Tz /);
    const scale = Number(/(\S+) Tz/.exec(wide)?.[1]);
    expect(scale).toBeGreaterThan(100);
    expect(scale).toBeLessThanOrEqual(1000);
    const tiny = ocrOperators({ pageIndex: 0, rotate: 0, words: [{ text: 'Hola', box: [0, 0, 0.5, 12] }] }, FONT);
    expect(tiny).toContain('10 Tz');
    const huge = ocrOperators({ pageIndex: 0, rotate: 0, words: [{ text: 'a', box: [0, 0, 5000, 1] }] }, FONT);
    expect(huge).toContain('1000 Tz');
  });

  it('omite las palabras vacías tras quitar espacios', () => {
    const page: OcrPage = { pageIndex: 0, rotate: 0, words: [{ text: '   ', box: [0, 0, 10, 10] }, { text: 'x', box: [0, 0, 10, 10] }] };
    const ops = ocrOperators(page, FONT);
    expect(ops.match(/BT /g)).toHaveLength(1);
    expect(ocrOperators({ ...page, words: [] }, FONT)).toBe('');
  });

  it('escapa paréntesis y barras, y sustituye lo que no es WinAnsi por «?»', () => {
    const page: OcrPage = {
      pageIndex: 0,
      rotate: 0,
      words: [{ text: 'a(b)c\\d', box: [0, 0, 50, 12] }, { text: 'p😀q', box: [0, 20, 50, 32] }],
    };
    const ops = ocrOperators(page, FONT);
    expect(ops).toContain('(a\\(b\\)c\\\\d ) Tj');
    expect(ops).toContain('(p?q ) Tj');
  });

  it('escribe los caracteres WinAnsi fuera de ASCII en octal para que el flujo siga siendo ASCII', () => {
    const page: OcrPage = { pageIndex: 0, rotate: 0, words: [{ text: 'número', box: [0, 0, 50, 12] }] };
    const ops = ocrOperators(page, FONT);
    expect(ops).toContain('(n\\372mero ) Tj');
    expect([...ops].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
  });

  it('una caja mal formada es un bug de quien llama y lanza RangeError', () => {
    const inverted: OcrPage = { pageIndex: 0, rotate: 0, words: [{ text: 'a', box: [10, 0, 5, 12] }] };
    expect(() => ocrOperators(inverted, FONT)).toThrow(RangeError);
    const nan: OcrPage = { pageIndex: 0, rotate: 0, words: [{ text: 'a', box: [0, 0, Number.NaN, 12] }] };
    expect(() => ocrOperators(nan, FONT)).toThrow(RangeError);
  });
});

describe('buildOcrUpdate sobre basic-5.pdf', () => {
  const pages: OcrPage[] = [
    {
      pageIndex: 0,
      rotate: 0,
      words: [
        { text: 'Factura', box: [72, 700, 150, 712] },
        { text: 'número', box: [160, 700, 230, 712] },
      ],
    },
  ];

  it('la página 1 conserva su texto y añade «Factura» y «número» como texto extraíble', async () => {
    const { output } = await writeLayer('basic-5.pdf', pages);
    checkWithQpdf(output, 'basic-5-ocr.pdf');
    const texts = await withDocument(output, async (doc) => {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      return content.items.filter((item) => 'str' in item).map((item) => item.str).join(' ');
    });
    expect(texts).toContain('Factura');
    expect(texts).toContain('número');
    expect(texts).toContain('Página 1 de 5');
  });

  it('el contenido nuevo es solo texto invisible: sin operadores de pintura', async () => {
    const ops = ocrOperators(pages[0] as OcrPage, FONT);
    const tokens = operatorsOf(ops);
    expect(tokens).toContain('3');
    expect(tokens).toContain('Tr');
    expect(tokens.some((token) => PAINT_OPERATORS.has(token))).toBe(false);
  });

  it('la caja de cada palabra coincide con la dada (rotación 0) con un error ≤ 1 pt', async () => {
    const { output } = await writeLayer('basic-5.pdf', pages);
    const items = await withDocument(output, async (doc) => {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      return content.items.filter((item) => 'str' in item && item.str.length > 0);
    });
    const factura = items.find((item) => 'str' in item && item.str.startsWith('Factura'));
    expect(factura).toBeDefined();
    if (factura === undefined || !('transform' in factura)) throw new Error('falta «Factura»');
    expect(Math.abs(factura.transform[4] - 72)).toBeLessThanOrEqual(1);
    expect(Math.abs(factura.transform[5] - 700)).toBeLessThanOrEqual(1);
    expect(Math.abs(factura.width - 78)).toBeLessThanOrEqual(1);
  });

  it('la caja con giro 90 coincide con la dada con un error ≤ 1 pt', async () => {
    const rotated: OcrPage[] = [{ pageIndex: 0, rotate: 90, words: [{ text: 'Factura', box: [100, 700, 112, 750] }] }];
    const { output } = await writeLayer('basic-5.pdf', rotated);
    const item = await withDocument(output, async (doc) => {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      return content.items.find((i) => 'str' in i && i.str.startsWith('Factura'));
    });
    if (item === undefined || !('transform' in item)) throw new Error('falta «Factura» con giro 90');
    expect(Math.abs(item.transform[4] - 112)).toBeLessThanOrEqual(1);
    expect(Math.abs(item.transform[5] - 700)).toBeLessThanOrEqual(1);
    expect(Math.abs(item.width - 50)).toBeLessThanOrEqual(1);
  });

  it('informa de las páginas escritas y del tamaño esperado', async () => {
    const { bytes, built, output } = await writeLayer('basic-5.pdf', pages);
    expect(built.pagesWritten).toBe(1);
    expect(built.expectedSize).toBe(bytes.length + built.delta.length);
    expect(built.expectedSize).toBe(output.length);
  });

  it('sin palabras no escribe nada: delta vacío', async () => {
    const { bytes, built } = await writeLayer('basic-5.pdf', [{ pageIndex: 0, rotate: 0, words: [] }]);
    expect(built.delta.length).toBe(0);
    expect(built.pagesWritten).toBe(0);
    expect(built.expectedSize).toBe(bytes.length);
  });

  it('una lista de páginas vacía devuelve delta vacío', async () => {
    const { built } = await writeLayer('basic-5.pdf', []);
    expect(built.delta.length).toBe(0);
  });

  it('solo escribe las páginas con palabras y avisa del progreso', async () => {
    const bytes = fixtureBytes('basic-5.pdf');
    const source = memorySource(bytes);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error('openForSave');
    const progress: Array<readonly [number, number]> = [];
    const built = await buildOcrUpdate({
      source,
      reader: opened.value,
      now: NOW,
      pages: [
        { pageIndex: 2, rotate: 0, words: [{ text: 'tres', box: [72, 700, 110, 712] }] },
        { pageIndex: 0, rotate: 0, words: [{ text: '', box: [72, 700, 110, 712] }] },
        { pageIndex: 4, rotate: 0, words: [{ text: 'cinco', box: [72, 700, 130, 712] }] },
      ],
      onProgress: (done, total) => progress.push([done, total]),
    });
    if (!built.ok) throw new Error(built.error.code);
    expect(built.value.pagesWritten).toBe(2);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('índice fuera de rango o repetido → organize-invalid', async () => {
    const bytes = fixtureBytes('basic-5.pdf');
    const source = memorySource(bytes);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error('openForSave');
    const word = { text: 'x', box: [0, 0, 10, 10] as const };
    const outOfRange = await buildOcrUpdate({ source, reader: opened.value, now: NOW, pages: [{ pageIndex: 5, rotate: 0, words: [word] }] });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.error.code).toBe('organize-invalid');
    const negative = await buildOcrUpdate({ source, reader: opened.value, now: NOW, pages: [{ pageIndex: -1, rotate: 0, words: [word] }] });
    if (negative.ok) throw new Error('debía fallar');
    expect(negative.error.code).toBe('organize-invalid');
    const repeated = await buildOcrUpdate({
      source,
      reader: opened.value,
      now: NOW,
      pages: [
        { pageIndex: 0, rotate: 0, words: [word] },
        { pageIndex: 0, rotate: 0, words: [word] },
      ],
    });
    if (repeated.ok) throw new Error('debía fallar');
    expect(repeated.error.code).toBe('organize-invalid');
  });

  it('una operación cancelada devuelve cancelled', async () => {
    const bytes = fixtureBytes('basic-5.pdf');
    const source = memorySource(bytes);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error('openForSave');
    const controller = new AbortController();
    controller.abort();
    const before = await buildOcrUpdate({ source, reader: opened.value, now: NOW, pages, signal: controller.signal });
    if (before.ok) throw new Error('debía fallar');
    expect(before.error.code).toBe('cancelled');
  });

  it('cancelar a mitad de las páginas devuelve cancelled', async () => {
    const bytes = fixtureBytes('basic-5.pdf');
    const source = memorySource(bytes);
    const opened = await openForSave(source);
    if (!opened.ok) throw new Error('openForSave');
    const controller = new AbortController();
    const built = await buildOcrUpdate({
      source,
      reader: opened.value,
      now: NOW,
      pages: [
        { pageIndex: 0, rotate: 0, words: [{ text: 'a', box: [72, 700, 80, 712] }] },
        { pageIndex: 1, rotate: 0, words: [{ text: 'b', box: [72, 700, 80, 712] }] },
      ],
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 1) controller.abort();
      },
    });
    if (built.ok) throw new Error('debía fallar');
    expect(built.error.code).toBe('cancelled');
  });

  it('el incremento lo lee qpdf sin avisos y el contenido nuevo aparece en el volcado sin comprimir', async () => {
    const { output } = await writeLayer('basic-5.pdf', pages);
    const path = checkWithQpdf(output, 'basic-5-qdf-source.pdf');
    const qdfPath = join(temp, 'basic-5-qdf.pdf');
    const result = run(['--qdf', '--object-streams=disable', path, qdfPath]);
    expect(result.status).toBe(0);
    const qdf = readFileSync(qdfPath).toString('latin1');
    expect(qdf).toContain('3 Tr');
    expect(qdf).toContain('(Factura ) Tj');
    // qpdf en modo QDF escribe el byte WinAnsi tal cual (ú = 0xfa) en vez del escape octal.
    expect(qdf).toContain('(n\xfamero ) Tj');
  });
});

describe('buildOcrUpdate sobre un PDF cifrado', () => {
  it('encrypted-aes-256.pdf con la contraseña «usuario»: la capa se escribe y qpdf valida el resultado', async () => {
    const pages: OcrPage[] = [{ pageIndex: 0, rotate: 0, words: [{ text: 'Secreto', box: [72, 700, 150, 712] }] }];
    const { output, built } = await writeLayer('encrypted-aes-256.pdf', pages, 'usuario');
    expect(built.pagesWritten).toBe(1);
    checkWithQpdf(output, 'encrypted-ocr.pdf', 'usuario');
  });

  it('sin la contraseña correcta la escritura falla con un error de guardado', async () => {
    const bytes = fixtureBytes('encrypted-aes-256.pdf');
    const opened = await openForSave(memorySource(bytes), 'incorrecta');
    expect(opened.ok).toBe(false);
  });
});
