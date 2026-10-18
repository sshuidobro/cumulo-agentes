import { describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { textWidth } from '../../src/core/annotations/helvetica-widths';
import type { Rgb } from '../../src/core/annotations/model';
import {
  buildFieldAppearance,
  type ChoiceOption,
  type FieldType,
  type FieldValue,
  type FormField,
  type FormWidget,
} from '../../src/core/forms';
import { decodeStreamData } from '../../src/core/pdf/filters';
import { dict, type PdfStream, type PdfValue } from '../../src/core/pdf/objects';
import { serializeValue } from '../../src/core/pdf/serialize';
import { pdfjs } from '../../src/engine/pdfjs';
import { loadPdf } from '../../src/engine';
import { buildDocument } from '../fixtures/document.ts';
import { textPage, type PdfBuilder } from '../fixtures/pdf-builder.ts';
import { nodeAssetBase } from '../helpers/pdfjs-node';

const { AnnotationMode, OPS } = pdfjs();
const DECODER = new TextDecoder();
const BLACK: Rgb = [0, 0, 0];

function fieldOf(over: Partial<FormField> = {}): FormField {
  return {
    name: 'campo',
    type: 'text',
    readOnly: false,
    required: false,
    multiline: false,
    password: false,
    comb: false,
    maxLen: 0,
    multiSelect: false,
    editable: false,
    options: [],
    align: 0,
    fontSize: 0,
    textColor: BLACK,
    tooltip: '',
    initial: { kind: 'text', text: '' },
    widgets: [],
    ...over,
  };
}

function widgetOf(over: Partial<FormWidget> = {}): FormWidget {
  return {
    id: '9R',
    ref: { num: 9, gen: 0 },
    pageIndex: 0,
    rect: [0, 0, 228, 20],
    onState: null,
    rotation: 0,
    background: null,
    border: null,
    ...over,
  };
}

const text = (t: string): FieldValue => ({ kind: 'text', text: t });
const choice = (...selected: string[]): FieldValue => ({ kind: 'choice', selected });
const OPTIONS_PAIS: readonly ChoiceOption[] = [
  { exportValue: 'es', displayValue: 'España' },
  { exportValue: 'pt', displayValue: 'Portugal' },
];
const OPTIONS_IDIOMAS: readonly ChoiceOption[] = [
  { exportValue: 'Español', displayValue: 'Español' },
  { exportValue: 'Francés', displayValue: 'Francés' },
  { exportValue: 'Inglés', displayValue: 'Inglés' },
];

/** Contenido del Form XObject descomprimido, como texto. */
function contentOf(s: PdfStream): string {
  return DECODER.decode(decodeStreamData(s));
}

/** Valor de una clave del diccionario del Form XObject, serializado. */
function entryOf(s: PdfStream, key: string): string {
  return DECODER.decode(serializeValue(s.dict.entries.get(key) ?? null));
}

function linesEnding(content: string, op: string): string[] {
  return content.split('\n').filter((line) => line.endsWith(` ${op}`));
}

/** Lo que pone cada `Tf`: tamaño de fuente de la línea. */
function fontSizeOf(content: string): number {
  const match = /\/Helv (\S+) Tf/.exec(content);
  if (match?.[1] === undefined) throw new Error('Sin operador Tf');
  return Number(match[1]);
}

/** Primer `x y Td` del contenido. */
function tdOf(content: string): [number, number] {
  const match = /(\S+) (\S+) Td/.exec(content);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('Sin operador Td');
  return [Number(match[1]), Number(match[2])];
}

/** Todas las posiciones `1 0 0 1 x y Tm`. */
function tmOf(content: string): [number, number][] {
  return [...content.matchAll(/1 0 0 1 (\S+) (\S+) Tm/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe('buildFieldAppearance · texto de una línea', () => {
  it('nombre con «María José»: Helv 12, negro, WinAnsi, BBox del widget y sin Matrix', () => {
    const field = fieldOf({ name: 'nombre', fontSize: 12 });
    const ap = buildFieldAppearance(field, widgetOf(), text('María José'));
    expect(ap).not.toBeNull();
    if (ap === null) return;
    const content = contentOf(ap);
    expect(content).toContain('/Helv 12 Tf');
    expect(content).toContain('0 0 0 rg');
    expect(content).toContain('(Mar\\355a Jos\\351) Tj');
    expect(entryOf(ap, 'BBox')).toBe('[0 0 228 20]');
    expect(ap.dict.entries.has('Matrix')).toBe(false);
    expect(entryOf(ap, 'Filter')).toBe('/FlateDecode');
    expect(entryOf(ap, 'Resources')).toContain('/Helv');
  });

  it('envuelve el contenido en /Tx BMC … EMC con q/Q y el recorte al interior', () => {
    const content = contentOf(buildFieldAppearance(fieldOf(), widgetOf(), text('a')) as PdfStream);
    expect(content.startsWith('/Tx BMC\nq\n')).toBe(true);
    expect(content).toContain('1 1 226 18 re W n');
    expect(content.trimEnd().endsWith('Q\nEMC')).toBe(true);
  });

  it('importe con tamaño automático: encaja en el ancho y va alineado a la derecha', () => {
    // Caja de 80 pt (76 útiles). A 12 pt el texto mide ~83,4 pt, así que el tamaño baja.
    const text12 = '1234567890,12';
    const field = fieldOf({ name: 'importe', align: 2, textColor: [0, 0, 1] });
    const widget = widgetOf({ rect: [0, 0, 80, 20] });
    const content = contentOf(buildFieldAppearance(field, widget, text(text12)) as PdfStream);
    const size = fontSizeOf(content);
    expect(size).toBeLessThan(12);
    expect(textWidth(text12, size)).toBeLessThanOrEqual(76 + 1e-9);
    expect(content).toContain('0 0 1 rg');
    const [x] = tdOf(content);
    expect(Math.abs(x - (80 - 2 - textWidth(text12, size)))).toBeLessThanOrEqual(0.01);
  });

  it('tamaño automático de 12 pt como máximo aunque la caja sea alta', () => {
    const content = contentOf(
      buildFieldAppearance(fieldOf(), widgetOf({ rect: [0, 0, 228, 60] }), text('hola')) as PdfStream,
    );
    expect(fontSizeOf(content)).toBe(12);
  });

  it('la línea base centra verticalmente el texto: (bh − 0,925·tam)/2 + 0,207·tam', () => {
    const content = contentOf(
      buildFieldAppearance(fieldOf({ fontSize: 10 }), widgetOf(), text('x')) as PdfStream,
    );
    const [, y] = tdOf(content);
    expect(y).toBeCloseTo((20 - 0.925 * 10) / 2 + 0.207 * 10, 4);
  });

  it('alineación centrada', () => {
    const content = contentOf(
      buildFieldAppearance(fieldOf({ fontSize: 12, align: 1 }), widgetOf(), text('abc')) as PdfStream,
    );
    const [x] = tdOf(content);
    expect(x).toBeCloseTo((228 - textWidth('abc', 12)) / 2, 4);
  });

  it('contraseña: un asterisco por carácter, nunca el texto real', () => {
    const content = contentOf(
      buildFieldAppearance(fieldOf({ password: true, fontSize: 12 }), widgetOf(), text('secreto')) as PdfStream,
    );
    expect(content).toContain('(*******) Tj');
    expect(content).not.toContain('secreto');
  });
});

describe('buildFieldAppearance · texto: codificación', () => {
  it('€ y ñ se codifican en WinAnsi (0x80 y 0xF1)', () => {
    const content = contentOf(buildFieldAppearance(fieldOf({ fontSize: 12 }), widgetOf(), text('€ñ')) as PdfStream);
    expect(content).toContain('(\\200\\361) Tj');
  });

  it('un carácter sin WinAnsi (你) se escribe como ?', () => {
    const content = contentOf(buildFieldAppearance(fieldOf({ fontSize: 12 }), widgetOf(), text('你')) as PdfStream);
    expect(content).toContain('(?) Tj');
  });
});

describe('buildFieldAppearance · geometría', () => {
  it('rotación 90: BBox con ancho y alto intercambiados y Matrix [0 1 -1 0 w 0]', () => {
    // Rect de 20 × 160 con rotación 90: la caja de la apariencia es 160 × 20.
    const widget = widgetOf({ rect: [0, 0, 20, 160], rotation: 90 });
    const ap = buildFieldAppearance(fieldOf(), widget, text('x')) as PdfStream;
    expect(entryOf(ap, 'BBox')).toBe('[0 0 160 20]');
    expect(entryOf(ap, 'Matrix')).toBe('[0 1 -1 0 20 0]');
  });

  it('rotación 180 y 270: Matrix de pdf.js', () => {
    const r180 = buildFieldAppearance(fieldOf(), widgetOf({ rotation: 180 }), text('x')) as PdfStream;
    expect(entryOf(r180, 'BBox')).toBe('[0 0 228 20]');
    expect(entryOf(r180, 'Matrix')).toBe('[-1 0 0 -1 228 20]');
    const r270 = buildFieldAppearance(fieldOf(), widgetOf({ rect: [0, 0, 20, 160], rotation: 270 }), text('x')) as PdfStream;
    expect(entryOf(r270, 'Matrix')).toBe('[0 -1 1 0 0 160]');
  });

  it('fondo y borde del widget antes del recorte', () => {
    const widget = widgetOf({ background: [1, 1, 0.5], border: [0, 0, 1] });
    const content = contentOf(buildFieldAppearance(fieldOf({ fontSize: 12 }), widget, text('x')) as PdfStream);
    expect(content).toContain('1 1 0.5 rg 0 0 228 20 re f');
    expect(content).toContain('0 0 1 RG 1 w 0.5 0.5 227 19 re S');
    expect(content.indexOf('re f')).toBeLessThan(content.indexOf('re W n'));
    expect(content.indexOf('re S')).toBeLessThan(content.indexOf('re W n'));
  });

  it('valor vacío: solo fondo y borde, sin texto', () => {
    const widget = widgetOf({ background: [1, 1, 1], border: [0, 0, 0] });
    const content = contentOf(buildFieldAppearance(fieldOf(), widget, text('')) as PdfStream);
    expect(content).toContain('re f');
    expect(content).not.toContain('BT');
    expect(content).not.toContain('Tj');
  });
});

describe('buildFieldAppearance · multilínea', () => {
  it('reparte el texto en líneas de la caja, con la primera línea arriba y el interlineado 1,15·tam', () => {
    const field = fieldOf({ multiline: true, fontSize: 10 });
    const widget = widgetOf({ rect: [0, 0, 60, 80] });
    const content = contentOf(buildFieldAppearance(field, widget, text('uno dos tres cuatro')) as PdfStream);
    const positions = tmOf(content);
    expect(positions.length).toBeGreaterThan(1);
    expect(positions[0]?.[1]).toBeCloseTo(80 - 2 - 10, 4);
    for (let i = 1; i < positions.length; i++) {
      expect((positions[i - 1]?.[1] ?? 0) - (positions[i]?.[1] ?? 0)).toBeCloseTo(1.15 * 10, 4);
    }
  });
});

describe('buildFieldAppearance · peine', () => {
  it('codigo (6 celdas) con «ABC»: tres Tj y la primera letra centrada en su celda', () => {
    const field = fieldOf({ name: 'codigo', comb: true, maxLen: 6 });
    const widget = widgetOf({ rect: [0, 0, 150, 20] });
    const content = contentOf(buildFieldAppearance(field, widget, text('ABC')) as PdfStream);
    expect(content.match(/ Tj/g)).toHaveLength(3);
    const size = fontSizeOf(content);
    const [first] = tmOf(content);
    expect(first?.[0]).toBeCloseTo((25 - textWidth('A', size)) / 2, 2);
  });

  it('no dibuja más caracteres que maxLen', () => {
    const field = fieldOf({ comb: true, maxLen: 2 });
    const content = contentOf(buildFieldAppearance(field, widgetOf({ rect: [0, 0, 100, 20] }), text('ABCD')) as PdfStream);
    expect(content.match(/ Tj/g)).toHaveLength(2);
  });
});

describe('buildFieldAppearance · combo', () => {
  const pais = fieldOf({ name: 'pais', type: 'combo', options: OPTIONS_PAIS, fontSize: 12 });

  it('muestra el displayValue de la opción seleccionada', () => {
    const content = contentOf(buildFieldAppearance(pais, widgetOf(), choice('pt')) as PdfStream);
    expect(content).toContain('(Portugal) Tj');
    expect(content).not.toContain('España');
  });

  it('sin opción que coincida muestra el propio valor exportado', () => {
    const content = contentOf(buildFieldAppearance(pais, widgetOf(), choice('fr')) as PdfStream);
    expect(content).toContain('(fr) Tj');
  });

  it('sin selección no dibuja texto', () => {
    const content = contentOf(buildFieldAppearance(pais, widgetOf(), choice()) as PdfStream);
    expect(content).not.toContain('BT');
  });
});

describe('buildFieldAppearance · lista', () => {
  const idiomas = fieldOf({ name: 'idiomas', type: 'list', options: OPTIONS_IDIOMAS, fontSize: 12 });

  it('una sola opción seleccionada: exactamente un fondo de selección azul', () => {
    const content = contentOf(buildFieldAppearance(idiomas, widgetOf({ rect: [0, 0, 228, 60] }), choice('Francés')) as PdfStream);
    expect(linesEnding(content, 're f')).toHaveLength(1);
    expect(content).toContain('0.6 0.75 0.87 rg');
    expect(content).toContain('(Franc\\351s) Tj');
    expect(content).toContain('(Espa\\361ol) Tj');
  });

  it('las filas se apilan de arriba abajo con alto 1,15·tam y la selección ocupa toda la fila', () => {
    const content = contentOf(buildFieldAppearance(idiomas, widgetOf({ rect: [0, 0, 228, 60] }), choice('Francés')) as PdfStream);
    const lh = 1.15 * 12;
    // Segunda opción: y_inf = bh − 1 − 2·lh.
    expect(content).toContain(`1 ${Number((60 - 1 - 2 * lh).toFixed(4))} 226 ${Number(lh.toFixed(4))} re f`);
  });

  it('no dibuja las opciones que no caben', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ exportValue: `o${i}`, displayValue: `Opcion ${i}` }));
    const field = fieldOf({ type: 'list', options: many, fontSize: 12 });
    const content = contentOf(buildFieldAppearance(field, widgetOf({ rect: [0, 0, 228, 40] }), choice()) as PdfStream);
    // Alto 40: caben 2 filas de 13,8 pt (la tercera tendría y_inf < 0).
    expect(content).toContain('(Opcion 0) Tj');
    expect(content).toContain('(Opcion 1) Tj');
    expect(content).not.toContain('(Opcion 2) Tj');
  });
});

describe('buildFieldAppearance · tipos sin regeneración', () => {
  it.each<FieldType>(['checkbox', 'radio', 'signature', 'button'])('%s devuelve null', (type) => {
    expect(buildFieldAppearance(fieldOf({ type }), widgetOf(), { kind: 'checkbox', checked: true })).toBeNull();
  });

  it('acepto, color y firma (casilla, opción y firma) → null', () => {
    const acepto = fieldOf({ name: 'acepto', type: 'checkbox' });
    const color = fieldOf({ name: 'color', type: 'radio' });
    const firma = fieldOf({ name: 'firma', type: 'signature' });
    expect(buildFieldAppearance(acepto, widgetOf(), { kind: 'checkbox', checked: true })).toBeNull();
    expect(buildFieldAppearance(color, widgetOf(), { kind: 'radio', selected: 'rojo' })).toBeNull();
    expect(buildFieldAppearance(firma, widgetOf(), { kind: 'checkbox', checked: false })).toBeNull();
  });
});

describe('buildFieldAppearance · determinismo', () => {
  it('mismo field, widget y value producen los mismos bytes', () => {
    const field = fieldOf({ name: 'nombre', fontSize: 12 });
    const widget = widgetOf({ background: [1, 1, 1], border: [0, 0, 0] });
    const a = buildFieldAppearance(field, widget, text('María José')) as PdfStream;
    const b = buildFieldAppearance(field, widget, text('María José')) as PdfStream;
    expect(b.data).toEqual(a.data);
    expect(contentOf(a)).toBe(contentOf(b));
  });
});

/** Documento de 1 página con un widget de texto/combo/lista cuya apariencia es `ap`. */
function pdfWithWidget(ap: PdfStream, rect: readonly number[], rotation: number): Uint8Array {
  const apEntries = new Map<string, PdfValue>(ap.dict.entries);
  apEntries.delete('Length');
  const apDict = DECODER.decode(serializeValue(dict(apEntries)));
  return buildDocument(1, () => ({ content: textPage(['base']) }), {
    setup: ({ b }: { readonly b: PdfBuilder }) => {
      const apNum = b.addStream(apDict, ap.data);
      const widget = b.addObject(
        `<< /Type /Annot /Subtype /Widget /FT /Tx /T (campo) /Rect [${rect.join(' ')}] /MK << /R ${rotation} >> ` +
          `/AP << /N ${apNum} 0 R >> >>`,
      );
      return { pageAnnots: new Map([[1, `/Annots [${widget} 0 R]`]]) };
    },
  });
}

describe('buildFieldAppearance · pdf.js la lee y la dibuja', () => {
  const cases: readonly { readonly label: string; readonly field: FormField; readonly widget: FormWidget; readonly value: FieldValue }[] = [
    { label: 'texto', field: fieldOf({ fontSize: 12 }), widget: widgetOf(), value: text('María José') },
    {
      label: 'texto multilínea',
      field: fieldOf({ multiline: true }),
      widget: widgetOf({ rect: [0, 0, 120, 80] }),
      value: text('uno dos tres cuatro cinco seis siete ocho nueve diez'),
    },
    {
      label: 'peine',
      field: fieldOf({ comb: true, maxLen: 6 }),
      widget: widgetOf({ rect: [0, 0, 150, 20] }),
      value: text('ABC'),
    },
    {
      label: 'combo',
      field: fieldOf({ type: 'combo', options: OPTIONS_PAIS, fontSize: 12 }),
      widget: widgetOf(),
      value: choice('pt'),
    },
    {
      label: 'lista',
      field: fieldOf({ type: 'list', options: OPTIONS_IDIOMAS, fontSize: 12 }),
      widget: widgetOf({ rect: [0, 0, 228, 60] }),
      value: choice('Inglés'),
    },
    {
      label: 'texto rotado 90',
      field: fieldOf({ fontSize: 12 }),
      widget: widgetOf({ rect: [0, 0, 20, 160], rotation: 90 }),
      value: text('rotado'),
    },
  ];

  it.each(cases.map((c) => [c.label, c] as const))('%s: la apariencia se abre y se opera sin error', async (_label, c) => {
    const ap = buildFieldAppearance(c.field, c.widget, c.value);
    expect(ap).not.toBeNull();
    if (ap === null) return;
    const rotation = c.widget.rotation;
    const bytes = pdfWithWidget(ap, c.widget.rect, rotation);
    const result = await loadPdf(memorySource(bytes), { assetBaseUrl: nodeAssetBase() });
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
  });
});
