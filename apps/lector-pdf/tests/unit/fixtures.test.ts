import { Buffer } from 'node:buffer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, OPS, type PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { FIXTURES, type FixtureSpec } from '../fixtures/catalog.ts';
import { ensureFixtures } from '../fixtures/ensure.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';
import { PdfBuilder, buildPageTree, textPage, winAnsi } from '../fixtures/pdf-builder.ts';

const MB = 1024 * 1024;
const HEAVY_TEST_MS = 120_000;

function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

function loadBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)));
}

function specOf(name: string): FixtureSpec {
  const spec = FIXTURES.find((fixture) => fixture.name === name);
  if (spec === undefined) {
    throw new Error(`Fixture desconocido: ${name}`);
  }
  return spec;
}

/** Abre un fixture generado con pdf.js y lo cierra al terminar `use`. */
async function withDocument<T>(name: string, callback: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const task = getDocument({ data: loadBytes(name), verbosity: 0 });
  try {
    return await callback(await task.promise);
  } finally {
    await task.destroy();
  }
}

async function textOfPage(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

describe('winAnsi y textPage', () => {
  it('escapa paréntesis y barra invertida y codifica acentos en octal WinAnsi', () => {
    expect(winAnsi('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(winAnsi('é€')).toBe('(\\351\\200)');
    expect(winAnsi('ñ¿¡')).toBe('(\\361\\277\\241)');
  });

  it('sustituye por ? los caracteres fuera de WinAnsi (un ? por punto de código)', () => {
    expect(winAnsi('😀ö')).toBe('(??)');
  });

  it('textPage usa T* entre líneas y cierra con ET', () => {
    expect(textPage(['uno', 'dos'])).toBe('BT /F1 18 Tf 72 720 Td 22 TL (uno) Tj T* (dos) Tj ET');
  });
});

describe('PdfBuilder y buildPageTree', () => {
  it('árbol de 100 000 páginas con fanout 32: ningún nodo tiene más de 32 hijos y /Count de la raíz es 100000', () => {
    const b = new PdfBuilder();
    const tree = buildPageTree(b, 100000, 32);
    tree.pageRefs.forEach((num, index) => {
      b.setObject(num, `<< /Type /Page /Parent ${tree.parentOf(index)} 0 R >>`);
    });
    const bytes = b.build({ root: tree.root });
    const text = Buffer.from(bytes).toString('latin1');

    const nodes = new Map<number, { readonly kids: readonly number[]; readonly count: number }>();
    for (const match of text.matchAll(/(\d+) 0 obj\n<< \/Type \/Pages \/Kids \[([^\]]*)\] \/Count (\d+)/g)) {
      const kids = (match[2] ?? '').match(/\d+ 0 R/g)?.map((ref) => Number.parseInt(ref, 10)) ?? [];
      nodes.set(Number.parseInt(match[1] ?? '', 10), { kids, count: Number.parseInt(match[3] ?? '', 10) });
    }

    expect(nodes.size).toBeGreaterThan(1);
    for (const node of nodes.values()) {
      expect(node.kids.length).toBeLessThanOrEqual(32);
    }
    expect(nodes.get(tree.root)?.count).toBe(100000);
    tree.pageRefs.forEach((pageRef, index) => {
      expect(nodes.get(tree.parentOf(index))?.kids).toContain(pageRef);
    });
  }, HEAVY_TEST_MS);

  it('con fanout igual al número de páginas, todas son hijos directos de la raíz', () => {
    const b = new PdfBuilder();
    const tree = buildPageTree(b, 20000, 20000);
    tree.pageRefs.forEach((num, index) => {
      b.setObject(num, `<< /Type /Page /Parent ${tree.parentOf(index)} 0 R >>`);
    });
    const text = Buffer.from(b.build({ root: tree.root })).toString('latin1');
    const kids = text.match(/\/Kids \[([^\]]*)\]/)?.[1]?.match(/\d+ 0 R/g) ?? [];
    expect(kids).toHaveLength(20000);
  });

  it('la xref tiene entradas de 20 bytes que apuntan al "N 0 obj" correcto', () => {
    const bytes = specOf('basic-5.pdf').build();
    const text = Buffer.from(bytes).toString('latin1');
    const startxref = Number.parseInt(text.match(/startxref\n(\d+)\n%%EOF/)?.[1] ?? '', 10);
    expect(text.startsWith('xref\n', startxref)).toBe(true);

    const header = /xref\n0 (\d+)\n0000000000 65535 f\r\n/.exec(text.slice(startxref));
    const size = Number.parseInt(header?.[1] ?? '', 10);
    const entriesStart = startxref + (header?.[0].length ?? 0);
    expect(size).toBeGreaterThan(1);
    for (let num = 1; num < size; num++) {
      const entry = text.slice(entriesStart + (num - 1) * 20, entriesStart + num * 20);
      expect(entry).toMatch(/^\d{10} 00000 n\r\n$/);
      expect(text.startsWith(`${num} 0 obj`, Number.parseInt(entry.slice(0, 10), 10))).toBe(true);
    }
  });
});

describe('fixtures generados', () => {
  it('se generan los 26 ficheros y una segunda ejecución no toca ninguno', () => {
    expect(FIXTURES).toHaveLength(27);
    for (const fixture of FIXTURES) {
      expect(existsSync(fixturePath(fixture.name))).toBe(true);
    }
    const before = FIXTURES.map((fixture) => statSync(fixturePath(fixture.name)).mtimeMs);

    const { generated } = ensureFixtures();

    expect(generated).toEqual([]);
    const after = FIXTURES.map((fixture) => statSync(fixturePath(fixture.name)).mtimeMs);
    expect(after).toEqual(before);
  });

  it('basic-5.pdf: 5 páginas con texto y marcadores; la página 3 contiene BUSQUEDA', async () => {
    await withDocument('basic-5.pdf', async (doc) => {
      expect(doc.numPages).toBe(5);
      const first = await textOfPage(doc, 1);
      expect(first).toContain('Página 1 de 5');
      expect(first).toContain('marcador-1');
      expect(await textOfPage(doc, 3)).toContain('BUSQUEDA');
    });
  });

  it('basic-5.pdf: los acentos se extraen bien (WinAnsi)', async () => {
    await withDocument('basic-5.pdf', async (doc) => {
      const first = await textOfPage(doc, 1);
      expect(first).toContain('murciélago');
      expect(first).toContain('hindú');
    });
  });

  // Los presupuestos de tiempo de generación (< 1 s y < 10 s) están en tests/perf/fixtures.perf.test.ts (ADR-0012).
  it('pages-5000.pdf: 5 000 páginas, tamaño < 3 MB y «aguja» en la página 4999', async () => {
    expect(specOf('pages-5000.pdf').build().byteLength).toBeLessThan(3 * MB);

    await withDocument('pages-5000.pdf', async (doc) => {
      expect(doc.numPages).toBe(5000);
      expect(await textOfPage(doc, 4999)).toContain('aguja');
    });
  }, HEAVY_TEST_MS);

  it('pages-100000.pdf: 100 000 páginas, tamaño < 40 MB y «aguja» en la 99 999', async () => {
    expect(specOf('pages-100000.pdf').build().byteLength).toBeLessThan(40 * MB);

    await withDocument('pages-100000.pdf', async (doc) => {
      expect(doc.numPages).toBe(100000);
      expect(await textOfPage(doc, 99999)).toContain('aguja');
    });
  }, HEAVY_TEST_MS);

  it('pages-20000-flat.pdf tiene 20 000 páginas como hijos de un único /Pages', async () => {
    await withDocument('pages-20000-flat.pdf', async (doc) => {
      expect(doc.numPages).toBe(20000);
    });
  }, HEAVY_TEST_MS);

  it('sizes-mixed.pdf: tamaños de vista, rotación de la 5.ª página y caja desplazada', async () => {
    await withDocument('sizes-mixed.pdf', async (doc) => {
      expect(doc.numPages).toBe(6);
      const expected: readonly [number, number][] = [
        [595, 842],
        [792, 612],
        [842, 1191],
        [420, 595],
        [842, 595],
        [595, 842],
      ];
      for (const [index, [width, height]] of expected.entries()) {
        const page = await doc.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        expect([viewport.width, viewport.height]).toEqual([width, height]);
      }
      expect((await doc.getPage(5)).rotate).toBe(90);
    });
  });

  it('images-200.pdf: 200 páginas y la página 1 dibuja una imagen', async () => {
    await withDocument('images-200.pdf', async (doc) => {
      expect(doc.numPages).toBe(200);
      const page = await doc.getPage(1);
      const operators = await page.getOperatorList();
      expect(operators.fnArray).toContain(OPS.paintImageXObject);
    });
  }, HEAVY_TEST_MS);

  it('corrupt-empty.pdf y corrupt-not-pdf.pdf hacen rechazar getDocument sin colgarse', async () => {
    for (const name of ['corrupt-empty.pdf', 'corrupt-not-pdf.pdf']) {
      await expect(withDocument(name, async () => undefined)).rejects.toThrow();
    }
  }, 10_000);

  it('corrupt-truncated.pdf es el 60 % de basic-5.pdf (prefijo exacto)', () => {
    const basic = loadBytes('basic-5.pdf');
    const truncated = loadBytes('corrupt-truncated.pdf');
    expect(truncated.byteLength).toBe(Math.floor(0.6 * basic.byteLength));
    expect(truncated).toEqual(basic.slice(0, truncated.byteLength));
  });

  it('corrupt-bad-startxref.pdf apunta startxref a 99999999', () => {
    const text = Buffer.from(loadBytes('corrupt-bad-startxref.pdf')).toString('latin1');
    expect(text).toContain('startxref\n99999999\n%%EOF');
  });
});
