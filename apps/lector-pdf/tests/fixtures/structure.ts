import { Buffer } from 'node:buffer';
import { buildDocument } from './document.ts';
import { appendIncrementalUpdate, readTrailer, textPage, winAnsi, type PageTree, type PdfBuilder } from './pdf-builder.ts';

/**
 * Documentos de estructura para probar navegación (índice, enlaces, etiquetas de página),
 * el lector de xref (object streams) y el escritor incremental (ADR-0009, ADR-0011).
 */

/** Número de objeto de la página `page` (1-based). Falla si no existe (error del generador). */
function pageNum(tree: PageTree, page: number): number {
  const num = tree.pageRefs[page - 1];
  if (num === undefined) {
    throw new Error(`Página ${page} fuera de rango`);
  }
  return num;
}

/** Destino explícito a la página `page` con el ajuste indicado (p. ej. `/Fit`). */
function destOf(tree: PageTree, page: number, fit: string): string {
  return `/Dest [${pageNum(tree, page)} 0 R ${fit}]`;
}

function uriAction(uri: string): string {
  return `/A << /S /URI /URI ${winAnsi(uri)} >>`;
}

function refList(nums: readonly number[]): string {
  return `[${nums.map((num) => `${num} 0 R`).join(' ')}]`;
}

// ---------------------------------------------------------------- Índice

/** Elemento del índice. `closed` marca el ítem cerrado (su /Count es negativo). */
export interface OutlineNode {
  readonly title: string;
  /** Entrada `/Dest ...` o `/A << ... >>` ya escrita. */
  readonly action: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly closed?: boolean;
  readonly children?: readonly OutlineNode[];
}

/** Número de elementos visibles bajo `nodes` (ISO 32000-1, §12.3.3: /Count). */
function visibleCount(nodes: readonly OutlineNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + (node.closed === true ? 0 : visibleCount(node.children ?? [])), 0);
}

function emitSiblings(b: PdfBuilder, nodes: readonly OutlineNode[], parent: number): { first: number; last: number } {
  const items = nodes.map((node) => ({ node, num: b.alloc() }));
  items.forEach(({ node, num }, index) => {
    const prev = index > 0 ? items[index - 1] : undefined;
    const next = items[index + 1];
    const kids = node.children ?? [];
    let childEntries = '';
    if (kids.length > 0) {
      const sub = emitSiblings(b, kids, num);
      const count = visibleCount(kids);
      childEntries = ` /First ${sub.first} 0 R /Last ${sub.last} 0 R /Count ${node.closed === true ? -count : count}`;
    }
    const flags = (node.italic === true ? 1 : 0) + (node.bold === true ? 2 : 0);
    const style = flags > 0 ? ` /F ${flags}` : '';
    const prevEntry = prev === undefined ? '' : ` /Prev ${prev.num} 0 R`;
    const nextEntry = next === undefined ? '' : ` /Next ${next.num} 0 R`;
    b.setObject(
      num,
      `<< /Title ${winAnsi(node.title)} /Parent ${parent} 0 R${prevEntry}${nextEntry}${childEntries}${style} ${node.action} >>`,
    );
  });
  const first = items[0]?.num ?? parent;
  const last = items.at(-1)?.num ?? parent;
  return { first, last };
}

/** Escribe `/Outlines` con sus elementos y devuelve el número del objeto raíz. */
export function emitOutline(b: PdfBuilder, items: readonly OutlineNode[]): number {
  const root = b.alloc();
  const sub = emitSiblings(b, items, root);
  b.setObject(root, `<< /Type /Outlines /First ${sub.first} 0 R /Last ${sub.last} 0 R /Count ${visibleCount(items)} >>`);
  return root;
}

function outlineItems(tree: PageTree): readonly OutlineNode[] {
  return [
    {
      title: 'Capítulo 1',
      bold: true,
      action: destOf(tree, 1, '/Fit'),
      children: [
        {
          title: 'Sección 1.1',
          action: destOf(tree, 3, '/XYZ 72 500 0'),
          children: [{ title: 'Apartado 1.1.1', action: destOf(tree, 4, '/XYZ 0 792 0') }],
        },
        { title: 'Sección 1.2', action: destOf(tree, 6, '/Fit') },
      ],
    },
    {
      title: 'Capítulo 2',
      action: destOf(tree, 11, '/FitH 792'),
      children: [{ title: 'Sección 2.1', italic: true, action: destOf(tree, 12, '/Fit') }],
    },
    {
      title: 'Capítulo 3',
      closed: true,
      action: destOf(tree, 21, '/Fit'),
      children: [
        { title: 'Sección 3.1', action: destOf(tree, 22, '/Fit') },
        { title: 'Sección 3.2', action: destOf(tree, 25, '/Fit') },
      ],
    },
    { title: 'Anexo', action: `/Dest ${winAnsi('anexo')}` },
    { title: 'Sitio web', action: uriAction('https://example.org/') },
  ];
}

/** 30 páginas con índice de tres niveles, un destino nombrado (`anexo`) y un enlace web. */
export function buildOutline(): Uint8Array {
  return buildDocument(30, (page) => ({ content: textPage([`Página ${page} de 30`]) }), {
    setup: ({ b, tree }) => {
      const outlines = emitOutline(b, outlineItems(tree));
      return {
        catalog: `/Outlines ${outlines} 0 R /Names << /Dests << /Names [${winAnsi('anexo')} [${pageNum(tree, 30)} 0 R /Fit]] >> >>`,
      };
    },
  });
}

// ---------------------------------------------------------------- Enlaces

interface LinkRow {
  readonly label: string;
  readonly action: (tree: PageTree) => string;
}

const LINK_ROWS: readonly LinkRow[] = [
  { label: '(a) Destino explícito a la página 3', action: (tree) => `/Dest [${pageNum(tree, 3)} 0 R /XYZ 0 400 0]` },
  { label: '(b) Destino con nombre «destino-final»', action: () => `/Dest ${winAnsi('destino-final')}` },
  { label: '(c) Acción GoTo a la página 2', action: (tree) => `/A << /S /GoTo /D [${pageNum(tree, 2)} 0 R /Fit] >>` },
  { label: '(d) URI https con ruta y consulta', action: () => uriAction('https://example.org/ruta?x=1') },
  { label: '(e) URI mailto', action: () => uriAction('mailto:alguien@example.org') },
  { label: '(f) JavaScript (no se ejecuta)', action: () => `/A << /S /JavaScript /JS ${winAnsi('app.alert(1)')} >>` },
  { label: '(g) Lanzar aplicación (no se ejecuta)', action: () => `/A << /S /Launch /F ${winAnsi('calc.exe')} >>` },
  { label: '(h) URI javascript: (no se ejecuta)', action: () => uriAction('javascript:alert(1)') },
];

/** Altura inferior del rectángulo de enlace i (de arriba abajo, cada 30 pt). */
function linkY(index: number): number {
  return 700 - 30 * index;
}

function linksPageContent(): string {
  const title = `BT /F1 14 Tf 72 740 Td ${winAnsi('Enlaces de prueba (rectángulos a la izquierda)')} Tj ET`;
  const labels = LINK_ROWS.map((row, index) => `BT /F1 12 Tf 310 ${linkY(index) + 6} Td ${winAnsi(row.label)} Tj ET`);
  return [title, ...labels].join('\n');
}

/** 5 páginas; la página 1 tiene ocho enlaces, cada uno junto a una línea que lo describe. */
export function buildLinks(): Uint8Array {
  return buildDocument(5, (page) => ({
    content: page === 1 ? linksPageContent() : textPage([`Página ${page} de 5`]),
  }), {
    setup: ({ b, tree }) => {
      const annots = LINK_ROWS.map((row, index) =>
        b.addObject(
          `<< /Type /Annot /Subtype /Link /Rect [72 ${linkY(index)} 300 ${linkY(index) + 20}] /Border [0 0 0] ${row.action(tree)} >>`,
        ),
      );
      return {
        catalog: `/Names << /Dests << /Names [${winAnsi('destino-final')} [${pageNum(tree, 5)} 0 R /Fit]] >> >>`,
        pageAnnots: new Map([[1, `/Annots ${refList(annots)}`]]),
      };
    },
  });
}

// ---------------------------------------------------------------- Etiquetas de página

/** 12 páginas: i, ii, iii, iv, 1 … 7 y A-1 (ISO 32000-1, §12.4.2). */
export function buildPageLabels(): Uint8Array {
  return buildDocument(12, (page) => ({ content: textPage([`Página ${page} de 12`]) }), {
    setup: () => ({
      catalog: `/PageLabels << /Nums [0 << /S /r >> 4 << /S /D >> 11 << /S /D /P ${winAnsi('A-')} >>] >>`,
    }),
  });
}

// ---------------------------------------------------------------- Comprimido

/** 50 páginas con contenido comprimido, xref en stream, object streams y versión 1.5. */
export function buildCompressed(): Uint8Array {
  return buildDocument(50, (page) => ({ content: textPage([`Página ${page} de 50`]) }), {
    compress: true,
    build: { xref: 'stream', objectStreams: true, version: '1.5' },
    setup: ({ b, tree }) => ({
      catalog: `/Outlines ${emitOutline(b, [
        { title: 'Capítulo 1', bold: true, action: destOf(tree, 1, '/Fit') },
        { title: 'Capítulo 2', action: destOf(tree, 11, '/FitH 792') },
        { title: 'Capítulo 3', action: destOf(tree, 21, '/Fit') },
      ])} 0 R`,
    }),
  });
}

// ---------------------------------------------------------------- Actualizaciones incrementales

/**
 * Sobre `base` (basic-5.pdf): la actualización 1 sustituye el contenido de la página 1 por
 * «Página 1 modificada»; la 2 añade un /Info con título. Resultado: tres `%%EOF`.
 */
export function buildIncrementalUpdates(base: Uint8Array): Uint8Array {
  const text = Buffer.from(base).toString('latin1');
  const page = /(\d+) 0 obj\n(<< \/Type \/Page \/Parent [^\n]*>>)\nendobj/.exec(text);
  const pageNumText = page?.[1];
  const pageBody = page?.[2];
  if (pageNumText === undefined || pageBody === undefined) {
    throw new Error('No se encuentra la página 1 en el PDF base');
  }
  const contentNum = readTrailer(text).size;
  const content = textPage(['Página 1 modificada']);
  const firstUpdate = appendIncrementalUpdate(
    base,
    new Map<number, string>([
      [Number.parseInt(pageNumText, 10), pageBody.replace(/\/Contents \d+ 0 R/, `/Contents ${contentNum} 0 R`)],
      [contentNum, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    ]),
  );
  const infoNum = readTrailer(Buffer.from(firstUpdate).toString('latin1')).size;
  return appendIncrementalUpdate(
    firstUpdate,
    new Map<number, string>([[infoNum, '<< /Title (Actualizado dos veces) >>']]),
    `/Info ${infoNum} 0 R`,
  );
}

// ---------------------------------------------------------------- Anotaciones de otro programa

/**
 * 3 páginas con anotaciones escritas por «otra persona»: resaltado con apariencia y popup,
 * subrayado sin apariencia, nota, texto libre, trazo a mano, cuadrado (tipo no soportado) y enlace.
 */
export function buildAnnotated(): Uint8Array {
  return buildDocument(3, (page) => ({ content: textPage([`Página ${page} de 3`]) }), {
    setup: ({ b, font }) => {
      const author = '(Otra persona)';

      // Página 1: resaltado con /AP y /Popup, subrayado azul sin /AP.
      const highlightAp = b.addStream(
        '<< /Type /XObject /Subtype /Form /BBox [0 0 228 20] >>',
        '1 1 0 rg 0 0 228 20 re f',
      );
      const highlight = b.alloc();
      const highlightPopup = b.alloc();
      b.setObject(
        highlight,
        `<< /Type /Annot /Subtype /Highlight /Rect [72 700 300 720] /QuadPoints [72 720 300 720 72 700 300 700] ` +
          `/C [1 1 0] /T ${author} /Contents (Comentario previo) /M (D:20261017120000Z) ` +
          `/AP << /N ${highlightAp} 0 R >> /Popup ${highlightPopup} 0 R >>`,
      );
      b.setObject(highlightPopup, `<< /Type /Annot /Subtype /Popup /Rect [320 600 520 700] /Open false /Parent ${highlight} 0 R >>`);
      const underline = b.addObject(
        `<< /Type /Annot /Subtype /Underline /Rect [72 640 300 660] /QuadPoints [72 660 300 660 72 640 300 640] ` +
          `/C [0 0 1] /T ${author} >>`,
      );

      // Página 2: nota con su popup, texto libre y trazo a mano; /Annots es un array indirecto.
      const note = b.alloc();
      const notePopup = b.alloc();
      b.setObject(
        note,
        `<< /Type /Annot /Subtype /Text /Rect [400 700 420 720] /Name /Comment /Open false ` +
          `/Contents (Nota previa) /T ${author} /C [1 1 0] /Popup ${notePopup} 0 R >>`,
      );
      b.setObject(notePopup, `<< /Type /Annot /Subtype /Popup /Rect [320 560 520 680] /Open false /Parent ${note} 0 R >>`);
      const freeText = b.addObject(
        `<< /Type /Annot /Subtype /FreeText /Rect [72 500 300 530] /DA (/Helv 12 Tf 0 0 0 rg) ` +
          `/Contents (Texto libre previo) /T ${author} >>`,
      );
      const ink = b.addObject(
        `<< /Type /Annot /Subtype /Ink /Rect [72 300 200 400] /InkList [[72 310 120 390 160 320] [150 350 200 400]] ` +
          `/C [1 0 0] /BS << /W 2 >> /T ${author} >>`,
      );
      const pageTwoAnnots = b.addObject(refList([note, notePopup, freeText, ink]));

      // Página 3: cuadrado verde (tipo no soportado: debe conservarse) y enlace URI.
      const square = b.addObject(
        `<< /Type /Annot /Subtype /Square /Rect [72 600 200 700] /C [0 0.6 0] /BS << /W 2 >> /T ${author} >>`,
      );
      const link = b.addObject(
        `<< /Type /Annot /Subtype /Link /Rect [72 400 300 420] /Border [0 0 0] ${uriAction('https://example.org/')} >>`,
      );

      return {
        catalog: `/AcroForm << /Fields [] /DR << /Font << /Helv ${font} 0 R >> >> /DA (/Helv 0 Tf 0 g) >>`,
        pageAnnots: new Map<number, string>([
          [1, `/Annots ${refList([highlight, highlightPopup, underline])}`],
          [2, `/Annots ${pageTwoAnnots} 0 R`],
          [3, `/Annots ${refList([square, link])}`],
        ]),
      };
    },
  });
}

// ---------------------------------------------------------------- Formulario

/** Una página con un campo de texto `nombre` y una casilla `acepto`, ambos con /AP. */
export function buildForm(): Uint8Array {
  return buildDocument(1, (page) => ({ content: textPage([`Formulario de prueba ${page}`]) }), {
    setup: ({ b, tree, font }) => {
      const page = pageNum(tree, 1);
      const textAp = b.addStream('<< /Type /XObject /Subtype /Form /BBox [0 0 228 20] >>', '0.8 g 0 0 228 20 re f');
      const checkedAp = b.addStream(
        '<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] >>',
        '0 g 1 w 1 1 12 12 re S 3 6 m 6 3 l 11 10 l S',
      );
      const uncheckedAp = b.addStream('<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] >>', '0 g 1 w 1 1 12 12 re S');
      const nombre = b.addObject(
        `<< /Type /Annot /Subtype /Widget /FT /Tx /T (nombre) /Rect [72 650 300 670] /F 4 ` +
          `/DA (/Helv 12 Tf 0 g) /P ${page} 0 R /AP << /N ${textAp} 0 R >> >>`,
      );
      const acepto = b.addObject(
        `<< /Type /Annot /Subtype /Widget /FT /Btn /T (acepto) /Rect [72 600 86 614] /F 4 /AS /Off /V /Off ` +
          `/DA (/Helv 0 Tf 0 g) /P ${page} 0 R /AP << /N << /Yes ${checkedAp} 0 R /Off ${uncheckedAp} 0 R >> >> >>`,
      );
      return {
        catalog: `/AcroForm << /Fields ${refList([nombre, acepto])} /NeedAppearances false ` +
          `/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv ${font} 0 R >> >> >>`,
        pageAnnots: new Map([[1, `/Annots ${refList([nombre, acepto])}`]]),
      };
    },
  });
}
