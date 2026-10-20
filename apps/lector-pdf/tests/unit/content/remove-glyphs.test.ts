import { describe, expect, it } from 'vitest';
import { interpretPage, type ContentOp } from '../../../src/core/content';
import { removeGlyphs } from '../../../src/core/content/remove-glyphs';
import type { PdfString, PdfValue } from '../../../src/core/pdf/objects';
import { helveticaResources, onePagePdf, openPage } from './helpers';

const DECODER = new TextDecoder('windows-1252');

/** Interpreta la página 0 de `content` (texto de la página) con Helvetica como /F1. */
async function contentOf(content: string) {
  const { reader, page } = await openPage(onePagePdf(content, helveticaResources), 0);
  return interpretPage(reader, page);
}

function isStringValue(v: PdfValue | undefined): v is PdfString {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v && v.kind === 'string';
}

/** Elementos de la operación `TJ` como cadenas (decodificadas) y números. */
function tjItems(op: ContentOp | undefined): readonly (string | number)[] {
  const [list] = op?.operands ?? [];
  if (op?.op !== 'TJ' || !Array.isArray(list)) throw new Error('la operación no es un TJ');
  return list.map((v: PdfValue | undefined): string | number => {
    if (typeof v === 'number') return v;
    if (isStringValue(v)) return DECODER.decode(v.bytes);
    throw new Error('elemento de TJ inesperado');
  });
}

function opsNamed(ops: readonly ContentOp[]): readonly string[] {
  return ops.map((op) => op.op);
}

describe('removeGlyphs', () => {
  it('quitar el glifo 1 de (abc) Tj lo sustituye por un ajuste de su ancho (b = 556)', async () => {
    const content = await contentOf('BT /F1 10 Tf 0 0 Td (abc) Tj ET');
    const ops = removeGlyphs(content, (_glyph, index) => index === 1);
    expect(opsNamed(ops)).toEqual(['BT', 'Tf', 'Td', 'TJ', 'ET']);
    expect(tjItems(ops[3])).toEqual(['a', -556, 'c']);
  });

  it('quitar todos los glifos deja un único ajuste con la suma de sus anchos', async () => {
    const content = await contentOf('BT /F1 10 Tf 0 0 Td (abc) Tj ET');
    const ops = removeGlyphs(content, () => true);
    expect(tjItems(ops[3])).toEqual([-(556 + 556 + 500)]);
  });

  it('sin glifos que quitar, las operaciones se devuelven tal cual', async () => {
    const content = await contentOf('BT /F1 10 Tf 0 0 Td (abc) Tj ET');
    expect(removeGlyphs(content, () => false)).toEqual(content.ops);
  });

  it('skip omite la operación indicada (no la sustituye)', async () => {
    const content = await contentOf('BT /F1 10 Tf 0 0 Td (ab) Tj (cd) Tj ET');
    const firstTj = content.ops.findIndex((op) => op.op === 'Tj');
    const ops = removeGlyphs(content, (_glyph, index) => index === 0, new Set([firstTj]));
    expect(opsNamed(ops)).toEqual(['BT', 'Tf', 'Td', 'Tj', 'ET']);
    expect(ops[3]?.op).toBe('Tj');
  });

  it("con ' conserva el T* delante del TJ equivalente", async () => {
    const content = await contentOf("BT /F1 10 Tf 14 TL (ab) ' ET");
    const ops = removeGlyphs(content, (_glyph, index) => index === 0);
    expect(opsNamed(ops)).toEqual(['BT', 'Tf', 'TL', 'T*', 'TJ', 'ET']);
    expect(tjItems(ops[4])).toEqual([-556, 'b']);
  });

  it('con " conserva Tw, Tc y T* delante del TJ, y el avance del glifo incluye Tc', async () => {
    const content = await contentOf('BT /F1 10 Tf 2 1 (ab) " ET');
    const ops = removeGlyphs(content, (_glyph, index) => index === 0);
    expect(opsNamed(ops)).toEqual(['BT', 'Tf', 'Tw', 'Tc', 'T*', 'TJ', 'ET']);
    expect(tjItems(ops[5])).toEqual([-(556 + 100), 'b']);
  });

  it('un glifo sin avance expresable (Tfs 0) quita el texto de la operación', async () => {
    const content = await contentOf('BT /F1 0 Tf 0 0 Td (ab) Tj ET');
    const ops = removeGlyphs(content, (_glyph, index) => index === 0);
    expect(opsNamed(ops)).toEqual(['BT', 'Tf', 'Td', 'ET']);
  });

  it('una cadena que no cuadra con sus glifos lanza un error (bug interno)', async () => {
    const content = await contentOf('BT /F1 10 Tf 0 0 Td (ab) Tj ET');
    const broken = { ...content, glyphs: content.glyphs.slice(0, 1) };
    expect(() => removeGlyphs(broken, () => true)).toThrow(RangeError);
  });
});
