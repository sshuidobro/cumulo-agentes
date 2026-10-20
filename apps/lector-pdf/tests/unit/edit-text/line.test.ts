import { describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { interpretPage } from '../../../src/core/content';
import { findEditableLine, locateLine, type EditableLine, type LineIssue } from '../../../src/core/edit-text';
import { effectiveResources } from '../../../src/core/pdf/page-content';
import { ObjectReader } from '../../../src/core/pdf/object-reader';
import type { PdfBuilder } from '../../fixtures/pdf-builder';
import { bytes, fixtureBytes, helveticaResources, onePagePdf, openPage } from '../content/helpers';

type RectPt = readonly [number, number, number, number];
const WHOLE_PAGE: RectPt = [0, 0, 612, 792];
const BLACK = [0, 0, 0];
const LINE_3_HINT: RectPt = [71, 674, 500, 687];
const SEARCH_LINE = 'Texto de búsqueda en la página dos.';

/** Recursos con F1 = Helvetica estándar y F2 = fuente con /BaseFont `baseFont` (y descriptor opcional). */
function fontsResources(baseFont: string, descriptorBody = ''): (b: PdfBuilder) => string {
  return (b) => {
    const f1 = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const descriptor =
      descriptorBody === '' ? '' : ` /FontDescriptor ${String(b.addObject(`<< /Type /FontDescriptor ${descriptorBody} >>`))} 0 R`;
    const f2 = b.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /FirstChar 72 /LastChar 73 /Widths [600 600] /Encoding /WinAnsiEncoding${descriptor} >>`,
    );
    return `<< /Font << /F1 ${String(f1)} 0 R /F2 ${String(f2)} 0 R >> >>`;
  };
}

/** Lector sobre `data` y `findEditableLine` de la página 0. */
async function editableIn(data: Uint8Array, hint: RectPt, pageIndex = 0): ReturnType<typeof findEditableLine> {
  const reader = await ObjectReader.open(memorySource(data));
  return findEditableLine(reader, pageIndex, hint);
}

async function issueOf(data: Uint8Array, hint: RectPt): Promise<LineIssue | 'ok'> {
  const result = await editableIn(data, hint);
  return result.ok ? 'ok' : result.error;
}

function expectOk(result: Awaited<ReturnType<typeof findEditableLine>>): EditableLine {
  if (!result.ok) throw new Error(`se esperaba ok y llegó ${result.error}`);
  return result.value;
}

describe('locateLine: basic-5.pdf', () => {
  it('la línea 3 de la página 2 tiene sus 35 glifos, origen [72, 676] y estilo Helvetica 18 pt negro', async () => {
    const { reader, page } = await openPage(fixtureBytes('basic-5.pdf'), 1);
    const content = await interpretPage(reader, page);
    const result = await locateLine(reader, await effectiveResources(reader, page), content, LINE_3_HINT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.value;
    expect(line.glyphs).toHaveLength(SEARCH_LINE.length);
    expect(line.origin).toEqual([72, 676]);
    expect(line.bounds[0]).toBe(72);
    expect(line.style).toEqual({ font: { family: 'Helvetica', bold: false, italic: false }, fontSize: 18, color: BLACK });
  });

  it('los glifos son ascendentes y ninguno pertenece a las líneas de 698 ni 720', async () => {
    const { reader, page } = await openPage(fixtureBytes('basic-5.pdf'), 1);
    const content = await interpretPage(reader, page);
    const result = await locateLine(reader, await effectiveResources(reader, page), content, LINE_3_HINT);
    if (!result.ok) throw new Error(result.error);
    const { glyphs } = result.value;
    expect(glyphs).toEqual([...glyphs].sort((a, b) => a - b));
    for (const index of glyphs) {
      const glyph = content.glyphs[index];
      if (glyph === undefined) throw new Error('índice de glifo fuera de rango');
      const cy = (glyph.quad[1] + glyph.quad[5]) / 2;
      expect(cy).toBeGreaterThan(LINE_3_HINT[1]);
      expect(cy).toBeLessThan(LINE_3_HINT[3]);
    }
  });

  it('findEditableLine devuelve la página, el origen y el estilo de la línea', async () => {
    const line = expectOk(await editableIn(fixtureBytes('basic-5.pdf'), LINE_3_HINT, 1));
    expect(line.pageIndex).toBe(1);
    expect(line.origin).toEqual([72, 676]);
    expect(line.style.fontSize).toBe(18);
    expect(line).not.toHaveProperty('glyphs');
  });

  it('un hint sin texto → no-text', async () => {
    expect(await issueOf(fixtureBytes('basic-5.pdf'), [300, 600, 400, 650])).toBe('no-text');
  });

  it('un hint con las coordenadas en otro orden se normaliza', async () => {
    const line = expectOk(await editableIn(fixtureBytes('basic-5.pdf'), [500, 687, 71, 674], 1));
    expect(line.origin).toEqual([72, 676]);
  });
});

describe('findEditableLine: entradas no válidas', () => {
  it('página fuera de rango, hint no finito o de área 0 → RangeError', async () => {
    const data = fixtureBytes('basic-5.pdf');
    await expect(editableIn(data, LINE_3_HINT, 5)).rejects.toBeInstanceOf(RangeError);
    await expect(editableIn(data, LINE_3_HINT, -1)).rejects.toBeInstanceOf(RangeError);
    await expect(editableIn(data, [0, Number.NaN, 10, 10])).rejects.toBeInstanceOf(RangeError);
    await expect(editableIn(data, [10, 10, 10, 50])).rejects.toBeInstanceOf(RangeError);
  });

  it('contenido con sintaxis rota → unsupported', async () => {
    expect(await issueOf(onePagePdf('BT /F1 10 Tf (abc Tj ET', helveticaResources), WHOLE_PAGE)).toBe('unsupported');
  });
});

describe('locateLine: motivos de no editar', () => {
  it('fuente Type3 → unsupported', async () => {
    const data = onePagePdf('BT /F1 10 Tf 100 500 Td (abc) Tj ET', (b) => {
      const type3 = b.addObject(
        '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << >> /Encoding << >> /FirstChar 0 /LastChar 0 /Widths [0] >>',
      );
      return `<< /Font << /F1 ${String(type3)} 0 R >> >>`;
    });
    expect(await issueOf(data, WHOLE_PAGE)).toBe('unsupported');
  });

  it('texto girado 90 grados → rotated', async () => {
    expect(await issueOf(onePagePdf('BT /F1 12 Tf 0 1 -1 0 300 300 Tm (Hola) Tj ET', helveticaResources), WHOLE_PAGE)).toBe('rotated');
  });

  it('modo de representación 3 (invisible) → invisible', async () => {
    expect(await issueOf(onePagePdf('BT /F1 12 Tf 3 Tr 100 500 Td (Hola) Tj ET', helveticaResources), WHOLE_PAGE)).toBe('invisible');
  });

  it('modo de representación 7 (solo recorte) → invisible', async () => {
    expect(await issueOf(onePagePdf('BT /F1 12 Tf 7 Tr 100 500 Td (Hola) Tj ET', helveticaResources), WHOLE_PAGE)).toBe('invisible');
  });

  it('un Form XObject que cubre el hint → unsupported', async () => {
    const data = onePagePdf('q 1 0 0 1 0 0 cm /Fm0 Do Q BT /F1 12 Tf 100 500 Td (Hola) Tj ET', (b) => {
      const form = b.addStream('<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] >>', bytes(''));
      const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
      return `<< /XObject << /Fm0 ${String(form)} 0 R >> /Font << /F1 ${String(font)} 0 R >> >>`;
    });
    expect(await issueOf(data, WHOLE_PAGE)).toBe('unsupported');
  });
});

describe('locateLine: estilo de la fuente', () => {
  it('Georgia-Bold con subconjunto, 12 pt escalado ×2 y color azul → Times negrita, 24 pt, [0, 0, 1]', async () => {
    const data = onePagePdf('0 0 1 rg 2 0 0 2 0 0 cm BT /F2 12 Tf 100 300 Td (HH) Tj ET', fontsResources('ABCDEF+Georgia-Bold'));
    const line = expectOk(await editableIn(data, WHOLE_PAGE));
    expect(line.style).toEqual({ font: { family: 'Times', bold: true, italic: false }, fontSize: 24, color: [0, 0, 1] });
  });

  it('el estilo lo marca el /FontDescriptor /Flags (FixedPitch) cuando el nombre no dice nada', async () => {
    const data = onePagePdf('BT /F2 12 Tf 100 300 Td (HH) Tj ET', fontsResources('Plain', '/Flags 1'));
    const line = expectOk(await editableIn(data, WHOLE_PAGE));
    expect(line.style.font).toEqual({ family: 'Courier', bold: false, italic: false });
  });

  it('Type0: el /FontDescriptor /Flags que cuenta es el de la fuente descendiente', async () => {
    const data = onePagePdf('BT /F2 12 Tf 100 300 Td <00480048> Tj ET', (b) => {
      const descriptor = b.addObject('<< /Type /FontDescriptor /Flags 2 >>');
      const cid = b.addObject(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Plain /DW 600 /FontDescriptor ${String(descriptor)} 0 R >>`);
      const font = b.addObject(`<< /Type /Font /Subtype /Type0 /BaseFont /Plain /Encoding /Identity-H /DescendantFonts [${String(cid)} 0 R] >>`);
      return `<< /Font << /F2 ${String(font)} 0 R >> >>`;
    });
    const line = expectOk(await editableIn(data, WHOLE_PAGE));
    expect(line.style.font).toEqual({ family: 'Times', bold: false, italic: false });
  });

  it('dos ítems en la misma línea base con fuentes distintas: se toman los glifos de ambos y el estilo del más cercano al centro', async () => {
    const data = onePagePdf('BT /F1 12 Tf 100 500 Td (Hola) Tj /F2 24 Tf (MM) Tj ET', fontsResources('Plain'));
    const line = expectOk(await editableIn(data, [100, 480, 260, 520]));
    expect(line.style.fontSize).toBe(24);
    expect(line.origin[1]).toBe(500);
  });

  it('cuando el hint cubre dos fuentes, los glifos de ambas entran en la línea', async () => {
    const data = onePagePdf('BT /F1 12 Tf 100 500 Td (Hola) Tj /F2 24 Tf (MM) Tj ET', fontsResources('Plain'));
    const reader = await ObjectReader.open(memorySource(data));
    const page = await reader.getDict(await reader.pageRef(0));
    if (page === null) throw new Error('página sin diccionario');
    const content = await interpretPage(reader, page);
    const result = await locateLine(reader, await effectiveResources(reader, page), content, [100, 480, 260, 520]);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.glyphs).toHaveLength(6);
  });
});
