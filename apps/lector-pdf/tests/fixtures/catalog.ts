import { Buffer } from 'node:buffer';
import { buildDocument, type PageSpec } from './document.ts';
import {
  buildAnnotated,
  buildCompressed,
  buildForm,
  buildFormFull,
  buildIncrementalUpdates,
  buildLinks,
  buildOutline,
  buildPageLabels,
} from './structure.ts';
import { textPage } from './pdf-builder.ts';
import { qpdfEncrypt } from './encrypted.ts';
import { buildScannedDocument } from './scanned.ts';

/** Subir si cambia la forma de los ficheros generados: fuerza la regeneración en todos los equipos. */
export const GENERATOR_VERSION = 5;

export interface FixtureSpec {
  readonly name: string;
  readonly build: () => Uint8Array;
}

const IMAGE_DRAW = 'q 400 0 0 267 97 450 cm /Im1 Do Q';

const BASIC_LINE_3 = [
  'El veloz murciélago hindú comía feliz cardillo y kiwi.',
  'Texto de búsqueda en la página dos.',
  'BUSQUEDA en mayúsculas sin tilde.',
  'otra búsqueda y otra búsqueda más.',
  'rebusquedas no es la palabra completa.',
];

/** Cinco páginas con la línea 3 de cada una tomada de `lineFor` (1-based). */
function buildBasic5With(lineFor: (page: number) => string): Uint8Array {
  return buildDocument(5, (page) => ({
    content: textPage([`Página ${page} de 5`, `marcador-${page}`, lineFor(page)]),
  }));
}

function buildBasic5(): Uint8Array {
  return buildBasic5With((page) => BASIC_LINE_3[page - 1] ?? '');
}

/** Igual que `basic-5.pdf` salvo la línea 3 de la página 2: «página» pasa a «hoja» (comparar, PDF-063). */
function buildBasic5Changed(): Uint8Array {
  return buildBasic5With((page) => (page === 2 ? 'Texto de búsqueda en la hoja dos.' : (BASIC_LINE_3[page - 1] ?? '')));
}

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
  const pageAt = (page: number): PageSpec => ({
    content: `${textPage([`Página ${page} de 200`])}\n${IMAGE_DRAW}`,
    image: gradientImage(page),
  });
  return buildDocument(200, pageAt);
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
    { fanout },
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
  { name: 'basic-5-changed.pdf', build: buildBasic5Changed },
  { name: 'pages-5000.pdf', build: () => buildNumbered(5000, NEEDLES_5000) },
  // Pestañas (PDF-095): documento de 1 000 páginas para medir el cambio de pestaña con un documento grande.
  { name: 'pages-1000.pdf', build: () => buildNumbered(1000, new Set<number>()) },
  { name: 'pages-100000.pdf', build: () => buildNumbered(100000, new Set([99999])) },
  // Presupuesto de los modos de página (PDF-050): doble página continua con 10 000 páginas.
  { name: 'pages-10000.pdf', build: () => buildNumbered(10000, NEEDLES_5000) },
  // Caso degenerado: todas las páginas como hijos directos de un único /Pages.
  { name: 'pages-20000-flat.pdf', build: () => buildNumbered(20000, NEEDLES_5000, 20000) },
  {
    name: 'sizes-mixed.pdf',
    build: () => buildDocument(SIZES_PAGES.length, (page) => pageSpecAt(SIZES_PAGES, page)),
  },
  { name: 'images-200.pdf', build: buildImages200 },
  { name: 'scanned-es-3.pdf', build: buildScannedDocument },
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
  { name: 'outline.pdf', build: buildOutline },
  { name: 'links.pdf', build: buildLinks },
  { name: 'page-labels.pdf', build: buildPageLabels },
  { name: 'compressed.pdf', build: buildCompressed },
  { name: 'incremental-updates.pdf', build: () => buildIncrementalUpdates(buildBasic5()) },
  { name: 'annotated.pdf', build: buildAnnotated },
  { name: 'form.pdf', build: buildForm },
  { name: 'form-full.pdf', build: buildFormFull },
  // Cifrados con qpdf (contraseñas: usuario = `usuario`, propietario = `propietario`; ver fixtures/FUENTES.md).
  {
    name: 'encrypted-rc4-40.pdf',
    build: () => qpdfEncrypt(buildBasic5(), ['--allow-weak-crypto', '--encrypt', 'usuario', 'propietario', '40', '--']),
  },
  {
    name: 'encrypted-rc4-128.pdf',
    build: () =>
      qpdfEncrypt(buildBasic5(), [
        '--allow-weak-crypto',
        '--encrypt',
        'usuario',
        'propietario',
        '128',
        '--use-aes=n',
        '--',
      ]),
  },
  {
    name: 'encrypted-aes-128.pdf',
    build: () => qpdfEncrypt(buildBasic5(), ['--encrypt', 'usuario', 'propietario', '128', '--use-aes=y', '--']),
  },
  {
    name: 'encrypted-aes-256.pdf',
    build: () => qpdfEncrypt(buildBasic5(), ['--encrypt', 'usuario', 'propietario', '256', '--']),
  },
  {
    name: 'encrypted-aes-256-objstm.pdf',
    build: () =>
      qpdfEncrypt(buildCompressed(), [
        '--object-streams=generate',
        '--encrypt',
        'usuario',
        'propietario',
        '256',
        '--',
      ]),
  },
  {
    name: 'encrypted-owner-only.pdf',
    build: () =>
      qpdfEncrypt(buildBasic5(), [
        '--encrypt',
        '',
        'propietario',
        '256',
        '--print=none',
        '--extract=n',
        '--modify=none',
        '--annotate=n',
        '--',
      ]),
  },
  {
    name: 'encrypted-annotated-aes-128.pdf',
    build: () =>
      qpdfEncrypt(buildAnnotated(), ['--encrypt', 'usuario', 'propietario', '128', '--use-aes=y', '--']),
  },
];
