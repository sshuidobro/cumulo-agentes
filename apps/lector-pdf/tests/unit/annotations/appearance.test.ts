import { describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { buildAppearance, type Appearance } from '../../../src/core/annotations/appearance';
import type { Annotation, AnnotationType, Quad } from '../../../src/core/annotations';
import { decodeStreamData } from '../../../src/core/pdf/filters';
import { dict, name, type PdfValue } from '../../../src/core/pdf/objects';
import { serializeValue } from '../../../src/core/pdf/serialize';
import { pdfjs } from '../../../src/engine/pdfjs';
import { loadPdf } from '../../../src/engine';
import { buildDocument } from '../../fixtures/document.ts';
import { textPage, type PdfBuilder } from '../../fixtures/pdf-builder.ts';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { newAnnotation } from './factories';

/** pdf.js ya está cargado: lo carga `tests/setup/setup.ts` (ADR-0017). */
const { AnnotationMode, OPS } = pdfjs();

const DECODER = new TextDecoder();

/** Anotación de prueba del tipo `T`: la base de `newAnnotation` con los campos `over`. */
type Of<T extends AnnotationType> = Annotation & { readonly type: T };
function annot<T extends AnnotationType>(type: T, over: Partial<Of<T>> = {}): Of<T> {
  // Los genéricos no estrechan la unión en el spread: la forma final se garantiza por construcción.
  return { ...newAnnotation('a', type), ...over, type } as Of<T>;
}

/** Contenido del Form XObject, descomprimido y como texto. */
function contentOf(ap: Appearance): string {
  return DECODER.decode(decodeStreamData(ap.stream));
}

function resourcesOf(ap: Appearance): string {
  return DECODER.decode(serializeValue(ap.resources));
}

/** Líneas del contenido que terminan en el operador dado. */
function linesEnding(content: string, op: string): string[] {
  return content.split('\n').filter((line) => line.endsWith(` ${op}`) || line === op);
}

const QUAD_20_40: Quad = [10, 40, 110, 40, 10, 20, 110, 20];
const QUAD_50_60: Quad = [10, 60, 110, 60, 10, 50, 110, 50];

describe('buildAppearance · highlight', () => {
  const a = annot('highlight', { quads: [QUAD_20_40, QUAD_50_60], rect: [10, 20, 110, 60], color: [1, 1, 0] });

  it('pone GS0 con modo Multiply y un polígono relleno por quad', () => {
    const ap = buildAppearance(a);
    const content = contentOf(ap);
    expect(content).toContain('/GS0 gs');
    expect(linesEnding(content, 'f')).toHaveLength(2);
    expect(content).toContain('1 1 0 rg');
    expect(resourcesOf(ap)).toContain('/BM /Multiply');
    expect(resourcesOf(ap)).toContain('/CA 1 /ca 1');
  });

  it('recorre los puntos en orden Z: 1 y 2 arriba, 4 y 3 abajo', () => {
    const one = annot('highlight', { quads: [QUAD_20_40] });
    expect(contentOf(buildAppearance(one))).toContain('10 40 m 110 40 l 110 20 l 10 20 l f');
  });

  it('usa el rect como BBox y no añade /Matrix', () => {
    const ap = buildAppearance(a);
    expect(ap.stream.dict.entries.get('BBox')).toEqual([10, 20, 110, 60]);
    expect(ap.stream.dict.entries.has('Matrix')).toBe(false);
    expect(ap.stream.dict.entries.get('Type')).toEqual(name('XObject'));
    expect(ap.stream.dict.entries.get('Subtype')).toEqual(name('Form'));
  });

  it('comprime el contenido con FlateDecode y el Length coincide', () => {
    const ap = buildAppearance(a);
    expect(ap.stream.dict.entries.get('Filter')).toEqual(name('FlateDecode'));
    expect(ap.stream.dict.entries.get('Length')).toBe(ap.stream.data.length);
  });

  it('aplica la opacidad a CA y ca', () => {
    const ap = buildAppearance({ ...a, opacity: 0.5 });
    expect(resourcesOf(ap)).toContain('/CA 0.5 /ca 0.5');
  });
});

describe('buildAppearance · underline y strikeout', () => {
  const quad12: Quad = [10, 32, 110, 32, 10, 20, 110, 20];
  const rect: [number, number, number, number] = [10, 20, 110, 70];

  it('subrayado de 12 pt: grosor 1 cerca de la base', () => {
    const content = contentOf(buildAppearance(annot('underline', { quads: [quad12], rect, color: [1, 1, 0] })));
    expect(content).toContain('1 1 0 RG');
    expect(content).toMatch(/^1 w 10 21 m 110 21 l S$/m);
  });

  it('tachado a media altura (±1 pt)', () => {
    const content = contentOf(buildAppearance(annot('strikeout', { quads: [quad12], rect })));
    const match = /^(\S+) w (\S+) (\S+) m (\S+) (\S+) l S$/m.exec(content);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(1);
    expect(Math.abs(Number(match?.[3]) - 26)).toBeLessThanOrEqual(1);
  });

  it('el grosor crece con la altura del quad', () => {
    // Altura 50: grosor 50/14 y línea a yInf + grosor.
    const tall: Quad = [10, 70, 110, 70, 10, 20, 110, 20];
    const content = contentOf(buildAppearance(annot('underline', { quads: [tall], rect })));
    expect(content).toMatch(/^3\.5714 w 10 23\.5714 m 110 23\.5714 l S$/m);
  });

  it('aplica GS0 si la opacidad es menor que 1', () => {
    const ap = buildAppearance(annot('underline', { quads: [quad12], rect, opacity: 0.25 }));
    expect(contentOf(ap).startsWith('/GS0 gs')).toBe(true);
    expect(resourcesOf(ap)).toContain('/CA 0.25 /ca 0.25');
  });
});

describe('buildAppearance · note', () => {
  it('dibuja un bocadillo relleno con borde negro y tres líneas, anclado arriba a la izquierda', () => {
    const a = annot('note', { rect: [100, 200, 120, 220], color: [1, 1, 0] });
    const content = contentOf(buildAppearance(a));
    expect(content).toContain('1 w');
    expect(content).toContain('0 0 0 RG');
    expect(content).toContain('101 219 m 119 219 l 119 208 l 109 208 l 104 202 l 104 208 l 101 208 l h b');
    expect(content).toContain('104 216 m 116 216 l S');
    expect(linesEnding(content, 'S')).toHaveLength(3);
  });

  it('el mismo dibujo para todos los iconos', () => {
    const rect: [number, number, number, number] = [0, 0, 20, 20];
    const note = contentOf(buildAppearance(annot('note', { rect, icon: 'Note', open: false })));
    const key = contentOf(buildAppearance(annot('note', { rect, icon: 'Key', open: true })));
    expect(key).toBe(note);
  });

  it('sin opacidad completa no añade ExtGState', () => {
    expect(resourcesOf(buildAppearance(annot('note')))).toBe('<< >>');
  });

  it('con opacidad parcial añade GS0 con CA y ca', () => {
    const ap = buildAppearance(annot('note', { opacity: 0.5 }));
    expect(contentOf(ap).startsWith('/GS0 gs')).toBe(true);
    expect(resourcesOf(ap)).toContain('/CA 0.5 /ca 0.5');
  });
});

describe('buildAppearance · freetext', () => {
  const rect: [number, number, number, number] = [10, 100, 210, 160];

  it('escribe Hola mundo a 12 pt con Helvetica WinAnsi', () => {
    const ap = buildAppearance(
      annot('freetext', { rect, contents: 'Hola mundo', fontSize: 12, textColor: [0, 0, 0], color: [1, 0, 0] }),
    );
    const content = contentOf(ap);
    expect(content).toContain('/Helv 12 Tf');
    expect(content).toContain('(Hola mundo) Tj');
    expect(content).toContain('re W n');
    expect(content).toContain('1 0 0 RG');
    expect(resourcesOf(ap)).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(ap.resources.entries.get('Font')).toBeDefined();
  });

  it('genera una línea Tj por línea del texto', () => {
    const content = contentOf(
      buildAppearance(annot('freetext', { rect, contents: 'uno\ndos\ntres', fontSize: 12, textColor: [0, 0, 0] })),
    );
    expect(content.match(/ Tj ET/g)).toHaveLength(3);
    expect(content.match(/ Tf /g)).toHaveLength(3);
  });

  it('no emite texto para las líneas vacías pero conserva su altura', () => {
    const content = contentOf(
      buildAppearance(annot('freetext', { rect, contents: 'a\n\nb', fontSize: 10, textColor: [0, 0, 0] })),
    );
    expect(content.match(/ Tj ET/g)).toHaveLength(2);
    const baselines = [...content.matchAll(/ (\S+) Td /g)].map((m) => Number(m[1]));
    expect(baselines[0]).toBeCloseTo(160 - 2 - 10, 6);
    expect(baselines[1]).toBeCloseTo(160 - 2 - 10 - 11.5 * 2, 6);
  });

  it('ajusta el texto al ancho del rect menos 4 pt de márgenes', () => {
    const content = contentOf(
      buildAppearance(
        annot('freetext', { rect: [0, 0, 60, 40], contents: 'mmmmmmmmmm', fontSize: 10, textColor: [0, 0, 0] }),
      ),
    );
    expect(content.match(/ Tj ET/g)?.length).toBeGreaterThan(1);
  });

  it('escapa los paréntesis y convierte a WinAnsi', () => {
    const content = contentOf(
      buildAppearance(annot('freetext', { rect, contents: 'a(b)€', fontSize: 12, textColor: [0, 0, 0] })),
    );
    expect(content).toContain('(a\\(b\\)\\200) Tj');
  });

  it('aplica GS0 cuando la opacidad es menor que 1', () => {
    const ap = buildAppearance(
      annot('freetext', { rect, contents: 'x', fontSize: 12, textColor: [0, 0, 0], opacity: 0.5 }),
    );
    expect(contentOf(ap).startsWith('/GS0 gs')).toBe(true);
    expect(resourcesOf(ap)).toContain('/ExtGState');
  });
});

describe('buildAppearance · ink', () => {
  it('dibuja dos trazos con 1 J 1 j y dos S', () => {
    const a = annot('ink', {
      paths: [
        [0, 0, 10, 10],
        [20, 20, 30, 25, 40, 20],
      ],
      width: 2,
      color: [0, 0, 1],
    });
    const content = contentOf(buildAppearance(a));
    expect(content).toContain('1 J 1 j 2 w');
    expect(content).toContain('0 0 1 RG');
    expect(content).toContain('0 0 m\n10 10 l\nS');
    expect(linesEnding(content, 'S')).toHaveLength(2);
  });

  it('un trazo de un punto es un segmento de longitud 0', () => {
    const content = contentOf(buildAppearance(annot('ink', { paths: [[5, 6]], width: 3 })));
    expect(content).toContain('5 6 m\n5 6 l\nS');
  });

  it('aplica GS0 cuando la opacidad es menor que 1', () => {
    const ap = buildAppearance(annot('ink', { opacity: 0.4 }));
    expect(contentOf(ap).startsWith('/GS0 gs')).toBe(true);
  });
});

describe('buildAppearance · tipos', () => {
  it('genera apariencia para todos los tipos', () => {
    const types: AnnotationType[] = ['highlight', 'underline', 'strikeout', 'note', 'freetext', 'ink'];
    for (const type of types) {
      const ap = buildAppearance(newAnnotation('x', type));
      expect(decodeStreamData(ap.stream).length).toBeGreaterThan(0);
    }
  });
});

/** Subtipo de anotación PDF para cada tipo del modelo. */
const SUBTYPE: Readonly<Record<AnnotationType, string>> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  note: 'Text',
  freetext: 'FreeText',
  ink: 'Ink',
};

/** Extras de la anotación que pdf.js lee además de `/AP` (QuadPoints para marcados, InkList para trazos). */
function extrasOf(a: Annotation): string {
  if (a.type === 'ink') {
    const lists = a.paths.map((p) => `[${p.join(' ')}]`).join(' ');
    return `/InkList [${lists}]`;
  }
  if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout') {
    return `/QuadPoints [${a.quads.flat().join(' ')}]`;
  }
  return '';
}

function serializeText(v: PdfValue): string {
  return DECODER.decode(serializeValue(v));
}

/** Documento de 1 página con la anotación `a` y su apariencia `/AP /N` escrita tal cual. */
function pdfWithAnnotation(a: Annotation): Uint8Array {
  const ap = buildAppearance(a);
  const apEntries = new Map<string, PdfValue>(ap.stream.dict.entries);
  apEntries.delete('Length');
  return buildDocument(1, () => ({ content: textPage(['base']) }), {
    setup: ({ b }: { readonly b: PdfBuilder }) => {
      const apNum = b.addStream(serializeText(dict(apEntries)), ap.stream.data);
      const annot = b.addObject(
        `<< /Type /Annot /Subtype /${SUBTYPE[a.type]} /Rect [${a.rect.join(' ')}] ` +
          `/AP << /N ${apNum} 0 R >> ${extrasOf(a)} >>`,
      );
      return { pageAnnots: new Map([[1, `/Annots [${annot} 0 R]`]]) };
    },
  });
}

describe('apariencias leídas por pdf.js', () => {
  const samples: readonly Annotation[] = [
    annot('highlight', { quads: [QUAD_20_40] }),
    annot('underline', { quads: [QUAD_50_60], rect: [10, 20, 110, 60] }),
    annot('strikeout', { quads: [QUAD_50_60], rect: [10, 20, 110, 60] }),
    annot('note', { rect: [50, 600, 70, 620] }),
    annot('freetext', { rect: [50, 400, 300, 450], contents: 'Hola mundo', fontSize: 12, textColor: [0, 0, 0] }),
    annot('ink', {
      rect: [20, 20, 200, 200],
      paths: [
        [30, 30, 60, 90],
        [100, 100, 150, 120],
      ],
      width: 3,
    }),
  ];

  it.each(samples.map((a) => [a.type, a] as const))(
    'pdf.js lee la anotación %s con apariencia y la dibuja (beginAnnotation)',
    async (_type, a) => {
      const result = await loadPdf(memorySource(pdfWithAnnotation(a)), { assetBaseUrl: nodeAssetBase() });
      if (!result.ok) throw new Error(`pdf.js no abre el documento de prueba: ${result.error.code}`);
      try {
        const page = await result.value.doc.getPage(1);
        const annots = await page.getAnnotations({ intent: 'display' });
        expect(annots).toHaveLength(1);
        expect(annots[0]?.hasAppearance).toBe(true);

        const ops = await page.getOperatorList({ annotationMode: AnnotationMode.ENABLE });
        expect(ops.fnArray).toContain(OPS.beginAnnotation);
      } finally {
        await result.value.destroy();
      }
    },
  );
});
