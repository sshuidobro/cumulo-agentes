import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { loadFontMetrics, type FontMetrics } from '../../../src/core/content/font-metrics';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import { ref } from '../../../src/core/pdf/objects';
import { PdfBuilder } from '../../fixtures/pdf-builder';

/** Carga las métricas de la fuente que `build` añade al constructor (devuelve su número de objeto). */
async function metricsOf(build: (b: PdfBuilder) => number): Promise<FontMetrics | null> {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const pages = b.alloc();
  const font = build(b);
  b.setObject(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  b.setObject(pages, '<< /Type /Pages /Kids [] /Count 0 >>');
  const reader = await ObjectReader.open(memorySource(b.build({ root: catalog })));
  const dict = await reader.getDict(ref(font));
  if (dict === null) throw new Error('fuente sin diccionario');
  return loadFontMetrics(reader, dict);
}

/** Fuente simple con el cuerpo `body` (sin /Type, que se añade). */
function simpleFont(body: string): (b: PdfBuilder) => number {
  return (b) => b.addObject(`<< /Type /Font ${body} >>`);
}

function metricsFor(m: FontMetrics | null): FontMetrics {
  if (m === null) throw new Error('se esperaban métricas');
  return m;
}

describe('loadFontMetrics: fuentes simples', () => {
  it('Helvetica sin /Widths usa la tabla WinAnsi y la altura mínima', async () => {
    const m = metricsFor(await metricsOf(simpleFont('/Subtype /Type1 /BaseFont /Helvetica')));
    expect(m.bytesPerCode).toBe(1);
    expect(m.width(0x61)).toBe(556); // a
    expect(m.width(0x20)).toBe(278); // espacio
    expect(m.width(0xe9)).toBe(556); // é
    expect(m.width(0x81)).toBe(1000); // sin carácter asignado en WinAnsi: se tapa de más
    expect(m.descent).toBe(-250);
    expect(m.ascent).toBe(750);
  });

  it('Arial (TrueType) con estilo y prefijo de subconjunto cuenta como Helvetica', async () => {
    const m = metricsFor(await metricsOf(simpleFont('/Subtype /TrueType /BaseFont /ABCDEF+Arial,Bold')));
    expect(m.width(0x61)).toBe(556);
    const mt = metricsFor(await metricsOf(simpleFont('/Subtype /TrueType /BaseFont /ArialMT')));
    expect(mt.width(0x61)).toBe(556);
    const bold = metricsFor(await metricsOf(simpleFont('/Subtype /Type1 /BaseFont /Helvetica-BoldOblique')));
    expect(bold.width(0x61)).toBe(556);
  });

  it('Courier sin /Widths mide 600 por código', async () => {
    const m = metricsFor(await metricsOf(simpleFont('/Subtype /Type1 /BaseFont /Courier-Bold')));
    expect(m.width(0x41)).toBe(600);
    const newCourier = metricsFor(await metricsOf(simpleFont('/Subtype /TrueType /BaseFont /CourierNewPSMT')));
    expect(newCourier.width(0x41)).toBe(600);
  });

  it('fuente estándar no soportada sin /Widths devuelve null', async () => {
    expect(await metricsOf(simpleFont('/Subtype /Type1 /BaseFont /Times-Roman'))).toBeNull();
    expect(await metricsOf(simpleFont('/Subtype /Type1 /BaseFont /Verdana'))).toBeNull();
    expect(await metricsOf(simpleFont('/Subtype /Type1'))).toBeNull();
    expect(await metricsOf(simpleFont('/Subtype /Type1 /BaseFont 5'))).toBeNull();
  });

  it('con /Widths usa FirstChar y MissingWidth fuera de rango', async () => {
    const m = metricsFor(
      await metricsOf((b) => {
        const descriptor = b.addObject('<< /Type /FontDescriptor /MissingWidth 500 /Descent -200 /Ascent 900 >>');
        return b.addObject(
          `<< /Type /Font /Subtype /TrueType /BaseFont /X /FirstChar 32 /Widths [250 333] /FontDescriptor ${String(descriptor)} 0 R >>`,
        );
      }),
    );
    expect(m.width(31)).toBe(500);
    expect(m.width(32)).toBe(250);
    expect(m.width(33)).toBe(333);
    expect(m.width(34)).toBe(500);
    expect(m.descent).toBe(-250);
    expect(m.ascent).toBe(900);
  });

  it('/Widths con referencias indirectas y sin MissingWidth usa 0 fuera de rango', async () => {
    const m = metricsFor(
      await metricsOf((b) => {
        const w = b.addObject('420');
        return b.addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /X /FirstChar 65 /Widths [${String(w)} 0 R 300] >>`);
      }),
    );
    expect(m.width(65)).toBe(420);
    expect(m.width(66)).toBe(300);
    expect(m.width(10)).toBe(0);
  });

  it('una altura del descriptor más amplia se conserva', async () => {
    const m = metricsFor(
      await metricsOf((b) => {
        const descriptor = b.addObject('<< /Type /FontDescriptor /Descent -300 /Ascent 800 >>');
        return b.addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FontDescriptor ${String(descriptor)} 0 R >>`);
      }),
    );
    expect(m.descent).toBe(-300);
    expect(m.ascent).toBe(800);
  });

  it('Subtype desconocido (Type3) o ausente devuelve null', async () => {
    expect(await metricsOf(simpleFont('/Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0] /BaseFont /X'))).toBeNull();
    expect(await metricsOf(simpleFont('/BaseFont /Helvetica'))).toBeNull();
  });
});

describe('loadFontMetrics: Type0', () => {
  /** Type0 Identity-H con descendiente CIDFontType2; `descendant` es el cuerpo de la CIDFont. */
  function type0(descendant: string, encoding = '/Identity-H'): (b: PdfBuilder) => number {
    return (b) => {
      const cid = b.addObject(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X ${descendant} >>`);
      return b.addObject(`<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding ${encoding} /DescendantFonts [${String(cid)} 0 R] >>`);
    };
  }

  it('Identity-H usa dos bytes por código y los anchos de /W', async () => {
    const m = metricsFor(await metricsOf(type0('/W [1 [300 400] 5 6 700 9 [800]] /DW 500')));
    expect(m.bytesPerCode).toBe(2);
    expect(m.width(1)).toBe(300);
    expect(m.width(2)).toBe(400);
    expect(m.width(5)).toBe(700);
    expect(m.width(6)).toBe(700);
    expect(m.width(9)).toBe(800);
    expect(m.width(42)).toBe(500);
  });

  it('sin /DW ni /W los códigos miden 1000', async () => {
    const m = metricsFor(await metricsOf(type0('')));
    expect(m.width(7)).toBe(1000);
  });

  it('/W con entradas malformadas se detiene sin fallar', async () => {
    const short = metricsFor(await metricsOf(type0('/W [1 [300] 5 6]')));
    expect(short.width(1)).toBe(300);
    expect(short.width(5)).toBe(1000);
    const notArray = metricsFor(await metricsOf(type0('/W 7')));
    expect(notArray.width(1)).toBe(1000);
    const badStart = metricsFor(await metricsOf(type0('/W [/x [1]]')));
    expect(badStart.width(0)).toBe(1000);
  });

  it('/W con rango incompleto o sin ancho se detiene sin fallar', async () => {
    const noWidth = metricsFor(await metricsOf(type0('/W [1 6]')));
    expect(noWidth.width(3)).toBe(1000);
    const badLast = metricsFor(await metricsOf(type0('/W [1 /x 300]')));
    expect(badLast.width(1)).toBe(1000);
  });

  it('/W admite referencias indirectas a números', async () => {
    const m = metricsFor(
      await metricsOf((b) => {
        const width = b.addObject('321');
        return type0(`/W [1 [${String(width)} 0 R 4 ${String(width)} 0 R]]`)(b);
      }),
    );
    expect(m.width(1)).toBe(321);
    expect(m.width(2)).toBe(4);
    expect(m.width(3)).toBe(321);
    expect(m.width(4)).toBe(1000);
  });

  it('toma descenso y ascenso del FontDescriptor del descendiente', async () => {
    const m = metricsFor(
      await metricsOf((b) => {
        const descriptor = b.addObject('<< /Type /FontDescriptor /Descent -120 /Ascent 1000 >>');
        return type0(`/FontDescriptor ${String(descriptor)} 0 R`)(b);
      }),
    );
    expect(m.descent).toBe(-250);
    expect(m.ascent).toBe(1000);
  });

  it('CMap distinta de Identity-H devuelve null', async () => {
    expect(await metricsOf(type0('', '/UniJIS-UCS2-H'))).toBeNull();
  });

  it('Type0 sin DescendantFonts devuelve null', async () => {
    expect(await metricsOf(simpleFont('/Subtype /Type0 /Encoding /Identity-H'))).toBeNull();
  });
});
