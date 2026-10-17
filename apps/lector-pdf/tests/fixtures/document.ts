import { PdfBuilder, buildPageTree, type BuildOptions, type PageTree } from './pdf-builder.ts';

/** Una página del documento: contenido, caja, rotación e imagen RGB opcional (600×400). */
export interface PageSpec {
  readonly content: string;
  readonly mediaBox?: readonly [number, number, number, number];
  readonly rotate?: number;
  readonly image?: Uint8Array;
}

/** Objetos de apoyo que necesita el documento; se reservan antes de escribir las páginas. */
export interface DocumentContext {
  readonly b: PdfBuilder;
  readonly tree: PageTree;
  /** Número del recurso de fuente Helvetica (WinAnsi) que usan todas las páginas como `/F1`. */
  readonly font: number;
}

export interface DocumentSetup {
  /** Entradas extra del diccionario `/Catalog`, p. ej. `/Outlines 7 0 R`. */
  readonly catalog?: string;
  /** Entrada `/Annots ...` completa de cada página (número 1-based), ya con números de objeto. */
  readonly pageAnnots?: ReadonlyMap<number, string>;
}

export interface DocumentOptions {
  readonly fanout?: number;
  /** Comprime el contenido de las páginas con FlateDecode. */
  readonly compress?: boolean;
  /** Xref, object streams y versión de cabecera del fichero. */
  readonly build?: Omit<BuildOptions, 'root'>;
  /** Reserva y escribe objetos extra (esquemas, anotaciones, formularios) y devuelve las entradas a enlazar. */
  readonly setup?: (ctx: DocumentContext) => DocumentSetup;
}

export const LETTER_BOX: readonly [number, number, number, number] = [0, 0, 612, 792];
const IMAGE_DICT = '<< /Type /XObject /Subtype /Image /Width 600 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>';

/**
 * Construye un PDF de `pageCount` páginas. `pageAt` recibe el número de página (1-based).
 * Las páginas sin imagen comparten un único diccionario de recursos.
 */
export function buildDocument(
  pageCount: number,
  pageAt: (page: number) => PageSpec,
  opts: DocumentOptions = {},
): Uint8Array {
  const b = new PdfBuilder();
  const catalog = b.alloc();
  const font = b.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const sharedResources = b.addObject(`<< /Font << /F1 ${font} 0 R >> >>`);
  const tree = buildPageTree(b, pageCount, opts.fanout);
  const setup: DocumentSetup = opts.setup?.({ b, tree, font }) ?? {};

  tree.pageRefs.forEach((pageNum, index) => {
    const spec = pageAt(index + 1);
    const content = b.addStream('<< >>', spec.content, { compress: opts.compress === true });
    let resources = sharedResources;
    if (spec.image !== undefined) {
      const image = b.addStream(IMAGE_DICT, spec.image, { compress: true });
      resources = b.addObject(`<< /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >>`);
    }
    const box = (spec.mediaBox ?? LETTER_BOX).join(' ');
    const rotate = spec.rotate === undefined ? '' : ` /Rotate ${spec.rotate}`;
    const annots = setup.pageAnnots?.get(index + 1);
    const annotsEntry = annots === undefined ? '' : ` ${annots}`;
    b.setObject(
      pageNum,
      `<< /Type /Page /Parent ${tree.parentOf(index)} 0 R /MediaBox [${box}]${rotate}${annotsEntry} ` +
        `/Contents ${content} 0 R /Resources ${resources} 0 R >>`,
    );
  });

  const catalogEntries = setup.catalog === undefined ? '' : ` ${setup.catalog}`;
  b.setObject(catalog, `<< /Type /Catalog /Pages ${tree.root} 0 R${catalogEntries} >>`);
  return b.build({ root: catalog, ...opts.build });
}
