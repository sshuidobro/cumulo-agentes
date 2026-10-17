import { Buffer } from 'node:buffer';
import { PdfBuilder, buildPageTree, textPage } from './pdf-builder.ts';

/** Subir si cambia la forma de los ficheros generados: fuerza la regeneración en todos los equipos. */
export const GENERATOR_VERSION = 1;

export interface FixtureSpec {
  readonly name: string;
  readonly build: () => Uint8Array;
}

/** Una página del documento: contenido, caja, rotación e imagen RGB opcional (600×400). */
interface PageSpec {
  readonly content: string;
  readonly mediaBox?: readonly [number, number, number, number];
  readonly rotate?: number;
  readonly image?: Uint8Array;
}

const LETTER_BOX: readonly [number, number, number, number] = [0, 0, 612, 792];
const IMAGE_DICT = '<< /Type /XObject /Subtype /Image /Width 600 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>';
const IMAGE_DRAW = 'q 400 0 0 267 97 450 cm /Im1 Do Q';

/**
 * Construye un PDF de `pageCount` páginas. `pageAt` recibe el número de página (1-based).
 * Las páginas sin imagen comparten un único diccionario de recursos.
 */
function buildDocument(pageCount: number, pageAt: (page: number) => PageSpec, fanout = 32): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const sharedResources = b.addObject(`<< /Font << /F1 ${font} 0 R >> >>`);
  const tree = buildPageTree(b, pageCount, fanout);

  tree.pageRefs.forEach((pageNum, index) => {
    const spec = pageAt(index + 1);
    const content = b.addStream('<< >>', spec.content);
    let resources = sharedResources;
    if (spec.image !== undefined) {
      const image = b.addStream(IMAGE_DICT, spec.image, { compress: true });
      resources = b.addObject(`<< /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >>`);
    }
    const box = (spec.mediaBox ?? LETTER_BOX).join(' ');
    const rotate = spec.rotate === undefined ? '' : ` /Rotate ${spec.rotate}`;
    b.setObject(
      pageNum,
      `<< /Type /Page /Parent ${tree.parentOf(index)} 0 R /MediaBox [${box}]${rotate} /Contents ${content} 0 R /Resources ${resources} 0 R >>`,
    );
  });

  b.setObject(catalog, `<< /Type /Catalog /Pages ${tree.root} 0 R >>`);
  return b.build({ root: catalog });
}

const BASIC_LINE_3 = [
  'El veloz murciélago hindú comía feliz cardillo y kiwi.',
  'Texto de búsqueda en la página dos.',
  'BUSQUEDA en mayúsculas sin tilde.',
  'otra búsqueda y otra búsqueda más.',
  'rebusquedas no es la palabra completa.',
];

function buildBasic5(): Uint8Array {
  return buildDocument(5, (page) => ({
    content: textPage([`Página ${page} de 5`, `marcador-${page}`, BASIC_LINE_3[page - 1] ?? '']),
  }));
}

/** Páginas numeradas con una «aguja» en las páginas indicadas (1-based). */
function buildNumbered(total: number, needles: ReadonlySet<number>, fanout = 32): Uint8Array {
  return buildDocument(
    total,
    (page) => ({
      content: textPage([
        `Página ${page} de ${total}`,
        `marcador-${page}`,
        ...(needles.has(page) ? ['Aquí hay una aguja.'] : []),
      ]),
    }),
    fanout,
  );
}

const SIZES_PAGES: readonly PageSpec[] = [
  { content: textPage(['Página 1', 'A4 vertical']), mediaBox: [0, 0, 595, 842] },
  { content: textPage(['Página 2', 'Carta horizontal']), mediaBox: [0, 0, 792, 612] },
  { content: textPage(['Página 3', 'A3 vertical']), mediaBox: [0, 0, 842, 1191] },
  { content: textPage(['Página 4', 'A5 vertical']), mediaBox: [0, 0, 420, 595] },
  { content: textPage(['Página 5', 'A4 con /Rotate 90']), mediaBox: [0, 0, 595, 842], rotate: 90 },
  { content: textPage(['Página 6', 'A4 con MediaBox desplazada']), mediaBox: [100, 100, 695, 942] },
];

/** Degradado propio de cada página: r = (x + k) % 256, g = (y * 2) % 256, b = (k * 37) % 256. */
function gradientImage(page: number): Uint8Array {
  const width = 600;
  const height = 400;
  const pixels = new Uint8Array(width * height * 3);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[i] = (x + page) % 256;
      pixels[i + 1] = (y * 2) % 256;
      pixels[i + 2] = (page * 37) % 256;
      i += 3;
    }
  }
  return pixels;
}

function buildImages200(): Uint8Array {
  return buildDocument(200, (page) => ({
    content: `${textPage([`Página ${page} de 200`])}\n${IMAGE_DRAW}`,
    image: gradientImage(page),
  }));
}

/** Marcas de «aguja» de los documentos de 5 000 y 20 000 páginas. */
const NEEDLES_5000: ReadonlySet<number> = new Set([1234, 4999]);

/** Página `page` (1-based) de una lista de especificaciones; falla si no existe (error del generador). */
function pageSpecAt(list: readonly PageSpec[], page: number): PageSpec {
  const spec = list[page - 1];
  if (spec === undefined) {
    throw new Error(`No hay especificación para la página ${page}`);
  }
  return spec;
}

function buildBadStartxref(): Uint8Array {
  const text = Buffer.from(buildBasic5()).toString('latin1');
  const replaced = text.replace(/startxref\n\d+\n%%EOF/, 'startxref\n99999999\n%%EOF');
  if (replaced === text) {
    throw new Error('basic-5.pdf no contiene startxref');
  }
  return Buffer.from(replaced, 'latin1');
}

export const FIXTURES: readonly FixtureSpec[] = [
  { name: 'basic-5.pdf', build: buildBasic5 },
  { name: 'pages-5000.pdf', build: () => buildNumbered(5000, NEEDLES_5000) },
  { name: 'pages-100000.pdf', build: () => buildNumbered(100000, new Set([99999])) },
  // Caso degenerado: todas las páginas como hijos directos de un único /Pages.
  { name: 'pages-20000-flat.pdf', build: () => buildNumbered(20000, NEEDLES_5000, 20000) },
  {
    name: 'sizes-mixed.pdf',
    build: () => buildDocument(SIZES_PAGES.length, (page) => pageSpecAt(SIZES_PAGES, page)),
  },
  { name: 'images-200.pdf', build: buildImages200 },
  { name: 'corrupt-empty.pdf', build: () => new Uint8Array(0) },
  { name: 'corrupt-not-pdf.pdf', build: () => Buffer.from('Esto no es un PDF.\n'.repeat(20), 'latin1') },
  {
    name: 'corrupt-truncated.pdf',
    build: () => {
      const basic = buildBasic5();
      return basic.slice(0, Math.floor(0.6 * basic.byteLength));
    },
  },
  { name: 'corrupt-bad-startxref.pdf', build: buildBadStartxref },
];
