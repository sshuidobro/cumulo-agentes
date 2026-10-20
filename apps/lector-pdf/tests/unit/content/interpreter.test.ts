import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import { interpretPage, intersects, quadBounds, type GlyphBox, type Quad } from '../../../src/core/content/interpreter';
import { PdfBuilder } from '../../fixtures/pdf-builder';
import { PdfSyntaxError } from '../../../src/core/pdf/objects';
import { bytes, fixtureBytes, helveticaResources, onePagePdf, openPage } from './helpers';

const TOLERANCE_PT = 0.5;
const NO_QUAD: Quad = [0, 0, 0, 0, 0, 0, 0, 0];
const TEXT_DECODER = new TextDecoder('windows-1252');

/** Caja envolvente de un glifo o imagen: `[xmin, ymin, xmax, ymax]`. */
function boundsOf(q: Quad | undefined): readonly [number, number, number, number] {
  return quadBounds(q ?? NO_QUAD);
}

/** Unión de las cajas de los glifos. */
function unionOf(glyphs: readonly GlyphBox[]): readonly [number, number, number, number] {
  return glyphs.reduce<readonly [number, number, number, number]>(
    (acc, g) => {
      const b = boundsOf(g.quad);
      return [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])];
    },
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

/** Glifos agrupados por operación, en el orden de aparición. */
function glyphsByOp(glyphs: readonly GlyphBox[]): readonly (readonly GlyphBox[])[] {
  const groups = new Map<number, GlyphBox[]>();
  for (const glyph of glyphs) {
    const list = groups.get(glyph.op) ?? [];
    list.push(glyph);
    groups.set(glyph.op, list);
  }
  return [...groups.values()];
}

/** Documento pdf.js del mismo PDF, cerrado al terminar. */
async function withPdfJs<T>(data: Uint8Array, callback: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const task = getDocument({ data, verbosity: 0 });
  try {
    return await callback(await task.promise);
  } finally {
    await task.destroy();
  }
}

/** Intérprete de una página de un PDF construido en el test. */
async function interpretOne(data: Uint8Array) {
  const { reader, page } = await openPage(data, 0);
  return interpretPage(reader, page);
}

describe('interpretPage: basic-5.pdf', () => {
  it('«Página 1 de 5» tiene glifos en orden, sin solapes, y su unión cubre el ítem de pdf.js con error ≤ 1 pt', async () => {
    const data = fixtureBytes('basic-5.pdf');
    const { reader, page } = await openPage(data, 0);
    const content = await interpretPage(reader, page);
    const opIndex = content.ops.findIndex((op) => {
      const [first] = op.operands;
      return op.op === 'Tj' && typeof first === 'object' && first !== null && 'bytes' in first && TEXT_DECODER.decode(first.bytes) === 'Página 1 de 5';
    });
    expect(opIndex).toBeGreaterThanOrEqual(0);
    const glyphs = content.glyphs.filter((g) => g.op === opIndex);
    expect(glyphs).toHaveLength('Página 1 de 5'.length);
    for (let i = 1; i < glyphs.length; i += 1) {
      const prev = boundsOf(glyphs[i - 1]?.quad);
      const next = boundsOf(glyphs[i]?.quad);
      expect(next[0]).toBeGreaterThanOrEqual(prev[2] - 0.01);
    }
    const union = unionOf(glyphs);

    await withPdfJs(data, async (doc) => {
      const pdfPage = await doc.getPage(1);
      const text = await pdfPage.getTextContent();
      const item = text.items.find((it) => 'str' in it && it.str === 'Página 1 de 5');
      if (item === undefined || !('transform' in item)) throw new Error('ítem de pdf.js no encontrado');
      const x = item.transform[4] ?? NaN;
      const y = item.transform[5] ?? NaN;
      expect(Math.abs(union[0] - x)).toBeLessThanOrEqual(1);
      expect(Math.abs(union[2] - (x + item.width))).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(union[1]);
      expect(y).toBeLessThanOrEqual(union[3]);
    });
  });
});

describe('interpretPage: estado de texto frente a pdf.js', () => {
  it('Tc, Tw, Tz 50, Ts y TJ con ajustes dan posiciones iguales a pdf.js (≤ 0,5 pt)', async () => {
    const data = onePagePdf(
      [
        'BT /F1 20 Tf 10 700 Td 2 Tc 3 Tw 50 Tz 4 Ts (a b c) Tj ET',
        'BT /F1 20 Tf 10 600 Td 50 Tz 2 Tc [(Hola) -500 (mundo)] TJ ET',
        'BT /F1 20 Tf 10 500 Td 50 Tz 2 Tc 3 Tw [(x) 300 (y)] TJ ET',
      ].join('\n'),
      helveticaResources,
    );
    const result = await interpretOne(data);
    const groups = glyphsByOp(result.glyphs);
    expect(groups).toHaveLength(3);
    expect(result.unmeasured).toEqual([]);

    await withPdfJs(data, async (doc) => {
      const pdfPage = await doc.getPage(1);
      const text = await pdfPage.getTextContent();
      const items = text.items.filter((it) => 'str' in it && it.str.length > 0);
      expect(items).toHaveLength(groups.length);
      items.forEach((item, index) => {
        if (!('transform' in item)) throw new Error('ítem sin transform');
        const union = unionOf(groups[index] ?? []);
        const x = item.transform[4] ?? NaN;
        const y = item.transform[5] ?? NaN;
        expect(Math.abs(union[0] - x), `inicio de «${item.str}»`).toBeLessThanOrEqual(TOLERANCE_PT);
        expect(Math.abs(union[2] - (x + item.width)), `fin de «${item.str}»`).toBeLessThanOrEqual(TOLERANCE_PT);
        expect(y).toBeGreaterThanOrEqual(union[1]);
        expect(y).toBeLessThanOrEqual(union[3]);
      });
    });
  });
});

describe('interpretPage: fuentes', () => {
  it('Identity-H con /W: los anchos de códigos de 2 bytes son los de /W (o /DW)', async () => {
    const data = onePagePdf('BT /F1 10 Tf 0 0 Td <00010002000900ff> Tj ET', (b) => {
      const cid = b.addObject('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /DW 500 /W [1 [300 400] 9 [800]] >>');
      const font = b.addObject(`<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [${String(cid)} 0 R] >>`);
      return `<< /Font << /F1 ${String(font)} 0 R >> >>`;
    });
    const result = await interpretOne(data);
    const widths = result.glyphs.map((g) => {
      const [x0, , x1] = boundsOf(g.quad);
      // Tamaño 10: la caja mide w/1000 × 10, así que se pasa a milésimas.
      return Math.round(((x1 - x0) / 10) * 1000);
    });
    expect(widths).toEqual([300, 400, 800, 500]);
    expect(result.glyphs.map((g) => g.code)).toEqual([0, 1, 2, 3]);
  });

  it('Type3, CMap no Identity y Tf a un recurso inexistente se marcan como no medidas', async () => {
    const data = onePagePdf('BT /F3 10 Tf 0 0 Td (a) Tj ET BT /F4 10 Tf (b) Tj ET BT /F9 10 Tf (c) Tj ET', (b) => {
      const type3 = b.addObject('<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << >> /Encoding << >> /FirstChar 0 /LastChar 0 /Widths [0] >>');
      const cid = b.addObject('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X >>');
      const cmap = b.addObject(`<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /UniJIS-UCS2-H /DescendantFonts [${String(cid)} 0 R] >>`);
      return `<< /Font << /F3 ${String(type3)} 0 R /F4 ${String(cmap)} 0 R >> >>`;
    });
    const result = await interpretOne(data);
    expect(result.glyphs).toEqual([]);
    expect(result.unmeasured).toEqual([3, 7, 11]);
  });

  it('texto sin Tf previo no se mide', async () => {
    const result = await interpretOne(onePagePdf('BT (sin fuente) Tj ET', helveticaResources));
    expect(result.unmeasured).toEqual([1]);
    expect(result.glyphs).toEqual([]);
  });

  it('un recurso de fuente que no es diccionario queda no medido', async () => {
    const data = onePagePdf('BT /F2 10 Tf (a) Tj ET', (b) => {
      const notDict = b.addObject('42');
      return `<< /Font << /F2 ${String(notDict)} 0 R >> >>`;
    });
    expect((await interpretOne(data)).unmeasured).toEqual([2]);
  });

  it('TJ con ajuste entre cadenas numera los códigos en orden de aparición', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 0 0 Td [(ab) 200 (c)] TJ ET', helveticaResources));
    expect(result.glyphs.map((g) => g.code)).toEqual([0, 1, 2]);
  });

  it('Tm con escala y Tz 50 dejan la caja en la escala de la matriz', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 2 0 0 2 30 40 Tm 50 Tz (a) Tj ET', helveticaResources));
    const [x0, y0, x1, y1] = boundsOf(result.glyphs[0]?.quad);
    expect(x0).toBeCloseTo(30, 6);
    expect(y0).toBeCloseTo(35, 6);
    expect(x1 - x0).toBeCloseTo(5.56, 6);
    expect(y1 - y0).toBeCloseTo(20, 6);
  });

  it('Ts eleva la caja; Tc y Tw cambian el avance', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 0 0 Td 5 Ts 2 Tc 8 Tw (a b) Tj ET', helveticaResources));
    const [, y0] = boundsOf(result.glyphs[0]?.quad);
    expect(y0).toBeCloseTo(5 - 2.5, 6);
    const [spaceX] = boundsOf(result.glyphs[1]?.quad);
    const [bX] = boundsOf(result.glyphs[2]?.quad);
    expect(spaceX).toBeCloseTo(5.56 + 2, 6);
    // El espacio (código 32) suma Tw además de Tc: 2,78 + 2 + 8.
    expect(bX - spaceX).toBeCloseTo(2.78 + 2 + 8, 6);
  });
});

describe('interpretPage: operadores de texto', () => {
  it('T* y TL: la línea siguiente baja TL', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 0 0 Td 14 TL (a) Tj T* (b) Tj ET', helveticaResources));
    const a = boundsOf(result.glyphs[0]?.quad);
    const b = boundsOf(result.glyphs[1]?.quad);
    expect(b[1]).toBeCloseTo(a[1] - 14, 6);
    expect(b[0]).toBeCloseTo(0, 6);
  });

  it('\' pasa a la línea siguiente y muestra la cadena', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 0 0 Td 14 TL (a) Tj (b) \' ET', helveticaResources));
    const b = boundsOf(result.glyphs[1]?.quad);
    expect(b[1]).toBeCloseTo(-14 - 2.5, 6);
    expect(b[0]).toBeCloseTo(0, 6);
  });

  it('" fija Tw y Tc, pasa de línea y muestra la cadena', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 0 0 Td 14 TL 1 3 (a b) " ET', helveticaResources));
    const [a, space, b] = result.glyphs.map((g) => boundsOf(g.quad));
    expect(a?.[1]).toBeCloseTo(-14 - 2.5, 6);
    // Tc = 3 y Tw = 1 entran en el avance del espacio y de la «b».
    expect((b?.[0] ?? NaN) - (space?.[0] ?? NaN)).toBeCloseTo(2.78 + 3 + 1, 6);
  });

  it('Td y TD: TD fija TL = -ty y mueve la línea', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 10 300 TD (a) Tj T* (b) Tj ET', helveticaResources));
    const [a, b] = result.glyphs.map((g) => boundsOf(g.quad));
    expect(a?.[0]).toBeCloseTo(10, 6);
    expect(a?.[1]).toBeCloseTo(300 - 2.5, 6);
    // TD fija TL = -ty = -300, y T* se mueve (0, -TL) = (0, +300): la línea siguiente queda 300 pt más arriba.
    expect(b?.[1]).toBeCloseTo(300 + 300 - 2.5, 6);
  });

  it('Td no altera la matriz de línea de otro bloque BT', async () => {
    const result = await interpretOne(onePagePdf('BT /F1 10 Tf 5 5 Td (a) Tj ET BT /F1 10 Tf (b) Tj ET', helveticaResources));
    expect(boundsOf(result.glyphs[1]?.quad)[0]).toBeCloseTo(0, 6);
  });
});

describe('interpretPage: estado gráfico e imágenes', () => {
  it('cm y q/Q: una imagen con 200 0 0 100 50 600 cm ocupa [50, 600, 250, 700] y Q restaura la CTM', async () => {
    const data = onePagePdf('q 200 0 0 100 50 600 cm /Im0 Do Q 10 0 0 10 0 0 cm /Im0 Do', (b) => {
      const image = b.addStream('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>', bytes('\x00'));
      return `<< /XObject << /Im0 ${String(image)} 0 R >> >>`;
    });
    const result = await interpretOne(data);
    expect(result.images.map((im) => im.name)).toEqual(['Im0', 'Im0']);
    expect(boundsOf(result.images[0]?.quad)).toEqual([50, 600, 250, 700]);
    expect(boundsOf(result.images[1]?.quad)).toEqual([0, 0, 10, 10]);
  });

  it('una imagen en línea (BI) da ImageBox con name null', async () => {
    const result = await interpretOne(onePagePdf('q 100 0 0 50 20 30 cm BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 EI Q'));
    expect(result.images).toEqual([{ op: 2, name: null, quad: [20, 30, 120, 30, 120, 80, 20, 80] }]);
  });

  it('una imagen en línea sin q usa la CTM actual', async () => {
    const result = await interpretOne(onePagePdf('2 0 0 2 0 0 cm BI /W 1 /H 1 ID \x00 EI'));
    expect(result.images[0]?.name).toBeNull();
    expect(boundsOf(result.images[0]?.quad)).toEqual([0, 0, 2, 2]);
  });

  it('Form XObject: FormBox con /BBox y /Matrix; no se entra en el formulario', async () => {
    const data = onePagePdf('q 1 0 0 1 100 100 cm /Fm0 Do Q /Fm1 Do', (b) => {
      const form = b.addStream('<< /Type /XObject /Subtype /Form /BBox [0 0 10 20] /Matrix [2 0 0 2 0 0] >>', bytes('BT ET'));
      const noBox = b.addStream('<< /Type /XObject /Subtype /Form >>', bytes(''));
      return `<< /XObject << /Fm0 ${String(form)} 0 R /Fm1 ${String(noBox)} 0 R >> >>`;
    });
    const result = await interpretOne(data);
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0]?.name).toBe('Fm0');
    expect(boundsOf(result.forms[0]?.quad)).toEqual([100, 100, 120, 140]);
  });

  it('Form con /BBox incompleto no genera caja y /Matrix malformada usa la identidad', async () => {
    const incomplete = await interpretOne(
      onePagePdf('/Fm Do', (b) => {
        const form = b.addStream('<< /Subtype /Form /BBox [0 0 10] >>', bytes(''));
        return `<< /XObject << /Fm ${String(form)} 0 R >> >>`;
      }),
    );
    expect(incomplete.forms).toEqual([]);

    const badMatrix = await interpretOne(
      onePagePdf('/Fm Do', (b) => {
        const form = b.addStream('<< /Subtype /Form /BBox [0 0 10 20] /Matrix [1 0 0 1 0] >>', bytes(''));
        return `<< /XObject << /Fm ${String(form)} 0 R >> >>`;
      }),
    );
    expect(boundsOf(badMatrix.forms[0]?.quad)).toEqual([0, 0, 10, 20]);
  });

  it('Do sobre nombres inexistentes, referencias a no flujos u otros subtipos no añade cajas', async () => {
    const result = await interpretOne(
      onePagePdf('/Nope Do /Dict Do /Other Do', (b) => {
        const dictRef = b.addObject('<< /Subtype /Image >>');
        const other = b.addStream('<< /Subtype /PS >>', bytes(''));
        return `<< /XObject << /Dict ${String(dictRef)} 0 R /Other ${String(other)} 0 R >> >>`;
      }),
    );
    expect(result.images).toEqual([]);
    expect(result.forms).toEqual([]);
  });

  it('contenido como array de flujos; las referencias que no existen se ignoran', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const page = b.alloc();
    const first = b.addStream('<< >>', 'BT /F1 10 Tf 0 0 Td ');
    const second = b.addStream('<< >>', '(ok) Tj ET');
    const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
    b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    b.setObject(
      page,
      `<< /Type /Page /Parent ${String(pages)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents [${String(first)} 0 R ${String(second)} 0 R 99 0 R] >>`,
    );
    const result = await interpretOne(b.build({ root: catalog }));
    expect(result.glyphs.map((g) => g.code)).toEqual([0, 1]);
  });

  it('una página con contenido vacío no tiene operaciones', async () => {
    const result = await interpretOne(onePagePdf(''));
    expect(result.ops).toEqual([]);
  });

  it('/Contents que no es un flujo se ignora', async () => {
    const b = new PdfBuilder();
    const catalog = b.alloc();
    const pages = b.alloc();
    const page = b.alloc();
    b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
    b.setObject(pages, `<< /Type /Pages /Kids [${String(page)} 0 R] /Count 1 >>`);
    b.setObject(page, `<< /Type /Page /Parent ${String(pages)} 0 R /MediaBox [0 0 612 792] /Contents 42 >>`);
    const result = await interpretOne(b.build({ root: catalog }));
    expect(result.ops).toEqual([]);
  });

  it('una operación con operandos de tipo incorrecto rechaza la página con PdfSyntaxError', async () => {
    const cases = [
      'BT /F1 10 Tf (a) 5 Tj ET',
      'BT /F1 10 Tf [(a) /x] TJ ET',
      'BT /F1 Tf (a) Tj ET',
      'BT /F1 10 Tf 0 0 1 Td ET',
    ];
    for (const content of cases) {
      await expect(interpretOne(onePagePdf(content, helveticaResources)), content).rejects.toBeInstanceOf(PdfSyntaxError);
    }
  });

  it('contenido con sintaxis rota rechaza con PdfSyntaxError', async () => {
    await expect(interpretOne(onePagePdf('BT /F1 10 Tf (abc Tj ET', helveticaResources))).rejects.toBeInstanceOf(PdfSyntaxError);
  });

  it('más de 64 niveles de q rechaza con PdfSyntaxError; 64 son válidos', async () => {
    await expect(interpretOne(onePagePdf('q '.repeat(64)))).resolves.toBeDefined();
    await expect(interpretOne(onePagePdf('q '.repeat(65)))).rejects.toBeInstanceOf(PdfSyntaxError);
  });

  it('Q sin q previo se ignora y el operador se conserva', async () => {
    const result = await interpretOne(onePagePdf('Q Q 1 0 0 1 0 0 cm'));
    expect(result.ops.map((op) => op.op)).toEqual(['Q', 'Q', 'cm']);
  });
});

describe('quadBounds e intersects', () => {
  const square: Quad = [0, 0, 10, 0, 10, 10, 0, 10];

  it('quadBounds devuelve la caja envolvente', () => {
    expect(quadBounds([5, 1, 0, 9, 3, -2, 8, 4])).toEqual([0, -2, 8, 9]);
  });

  it('intersects exige área común positiva, con independencia del orden del rectángulo', () => {
    expect(intersects(square, [5, 5, 15, 15])).toBe(true);
    expect(intersects(square, [15, 15, 5, 5])).toBe(true);
    expect(intersects(square, [10, 0, 20, 10])).toBe(false);
    expect(intersects(square, [20, 20, 30, 30])).toBe(false);
    expect(intersects(NO_QUAD, [-1, -1, 1, 1])).toBe(false);
  });

  it('un cuadrilátero inclinado se mide por su caja envolvente', () => {
    const tilted: Quad = [0, 5, 5, 0, 10, 5, 5, 10];
    expect(intersects(tilted, [4, 4, 6, 6])).toBe(true);
    expect(intersects(tilted, [11, 11, 12, 12])).toBe(false);
  });
});
