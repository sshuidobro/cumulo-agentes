import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  authorsOf,
  buildCommentRows,
  EMPTY_COMMENT_FILTER,
  EXCERPT_LENGTH,
  excerptOf,
  foldForSearch,
  ITEM_ROW_HEIGHT,
  nextItemRow,
  NO_COMMENT_TEXT,
  PAGE_ROW_HEIGHT,
  REPLY_ROW_HEIGHT,
  rectTopFraction,
  rowLayout,
  typeLabelOf,
  typeLabelsOf,
  visibleRowRange,
  type CommentFilter,
  type CommentRow,
} from '../../../src/core/annotations/comment-list';
import type { ForeignAnnotation } from '../../../src/core/annotations/import';
import {
  indexReplies,
  newReply,
  newReviewState,
  repliesOf,
  reviewStateOf,
  threadRootId,
} from '../../../src/core/annotations/replies';
import type { Annotation } from '../../../src/core/annotations/model';
import { endAnnotationSession, startAnnotationSession } from '../../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../../src/state/annotation-store';
import { createFakePlatform } from '../../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../../helpers/pdfjs-node';
import { loadPdf, type LoadedPdf } from '../../../src/engine';
import { initServices } from '../../../src/state/services';
import { createStorageStore, type Platform } from '@suite/platform';
import { newAnnotation, T0 } from './factories';

const OPEN_TIMEOUT = 30_000;

function item(id: string, pageIndex: number, rect: readonly [number, number, number, number], extra: Partial<Annotation> = {}): Annotation {
  return { ...newAnnotation(id, 'note', pageIndex), rect, ...extra } as Annotation;
}

function foreign(id: string, pageIndex: number, subtype: string, extra: Partial<ForeignAnnotation> = {}): ForeignAnnotation {
  return {
    id,
    pageIndex,
    subtype,
    rect: [10, 20, 110, 40],
    contents: '',
    author: 'Luis',
    modified: null,
    ...extra,
  };
}

function map<T extends { readonly id: string }>(list: readonly T[]): ReadonlyMap<string, T> {
  return new Map(list.map((a) => [a.id, a] as const));
}

function filter(over: Partial<CommentFilter>): CommentFilter {
  return { ...EMPTY_COMMENT_FILTER, ...over };
}

function items(rows: readonly CommentRow[]): Extract<CommentRow, { kind: 'item' }>[] {
  return rows.filter((r): r is Extract<CommentRow, { kind: 'item' }> => r.kind === 'item');
}

describe('buildCommentRows', () => {
  it('agrupa por página ascendente con cabecera y recuento, y ordena cada página de arriba abajo y de izquierda a derecha', () => {
    const effective = map([
      item('b', 0, [50, 100, 60, 110]),
      item('a', 0, [10, 100, 20, 110]),
      item('c', 0, [5, 300, 15, 310]),
      item('d', 2, [0, 0, 1, 1]),
    ]);
    const rows = buildCommentRows(effective, new Map(), EMPTY_COMMENT_FILTER);

    expect(rows.map((r) => (r.kind === 'page' ? `p${String(r.pageIndex)}:${String(r.count)}` : r.id))).toEqual([
      'p0:3',
      'c',
      'a',
      'b',
      'p2:1',
      'd',
    ]);
  });

  it('una anotación ajena aparece como solo lectura con su tipo en español', () => {
    const rows = buildCommentRows(new Map(), map([foreign('ref:9R', 0, 'Square', { contents: 'Revisar' })]), EMPTY_COMMENT_FILTER);
    const [row] = items(rows);
    expect(row).toMatchObject({ typeLabel: 'Rectángulo', readOnly: true, author: 'Luis', excerpt: 'Revisar' });
  });

  it('un subtipo ajeno sin nombre en español se muestra tal cual', () => {
    const rows = buildCommentRows(new Map(), map([foreign('ref:9R', 0, 'Watermark')]), EMPTY_COMMENT_FILTER);
    expect(items(rows)[0]?.typeLabel).toBe('Watermark');
  });

  it('filtra por tipo: con varios tipos marcados muestra cualquiera de ellos', () => {
    const effective = map([
      newAnnotation('h', 'highlight', 0),
      newAnnotation('n', 'note', 0),
      newAnnotation('i', 'ink', 0),
    ]);
    const rows = buildCommentRows(effective, new Map(), filter({ types: new Set(['Resaltado', 'Dibujo']) }));
    expect(items(rows).map((r) => r.id).sort()).toEqual(['h', 'i']);
  });

  it('filtra por autor exacto', () => {
    const effective = map([item('ana', 0, [0, 0, 1, 1], { author: 'Ana' }), item('luis', 0, [0, 0, 1, 1], { author: 'Luis' })]);
    const rows = buildCommentRows(effective, new Map(), filter({ author: 'Luis' }));
    expect(items(rows).map((r) => r.id)).toEqual(['luis']);
  });

  it('el texto se busca sin distinguir mayúsculas ni acentos', () => {
    const effective = map([
      item('nota', 0, [0, 0, 1, 1], { contents: 'Nota PREVIO del revisor' }),
      item('libre', 0, [0, 0, 1, 1], { contents: 'Texto previo' }),
      item('otro', 0, [0, 0, 1, 1], { contents: 'Otra cosa' }),
    ]);
    const rows = buildCommentRows(effective, new Map(), filter({ text: '  prévio ' }));
    expect(items(rows).map((r) => r.id).sort()).toEqual(['libre', 'nota']);
  });

  it('una página sin filas que pasan el filtro no tiene cabecera', () => {
    const effective = map([item('a', 0, [0, 0, 1, 1], { contents: 'x' }), item('b', 1, [0, 0, 1, 1], { contents: 'y' })]);
    const rows = buildCommentRows(effective, new Map(), filter({ text: 'y' }));
    expect(rows.map((r) => r.kind)).toEqual(['page', 'item']);
    expect(rows[0]).toEqual({ kind: 'page', pageIndex: 1, count: 1 });
  });

  it('el extracto tiene como mucho 160 caracteres y no tiene saltos de línea', () => {
    const long = 'a'.repeat(400);
    expect(excerptOf(long, false)).toHaveLength(EXCERPT_LENGTH);
    expect(excerptOf('uno\r\ndos\ntres', false)).toBe('uno dos tres');
  });

  it('un marcado de texto sin comentario se muestra como «sin comentario»; otro tipo, vacío', () => {
    expect(excerptOf('   ', true)).toBe(NO_COMMENT_TEXT);
    expect(excerptOf('', false)).toBe('');
    const rows = buildCommentRows(map([newAnnotation('h', 'highlight', 0)]), new Map(), EMPTY_COMMENT_FILTER);
    expect(items(rows)[0]?.excerpt).toBe(NO_COMMENT_TEXT);
  });

  it('el extracto cuenta caracteres, no unidades de código (no parte emojis)', () => {
    const text = '😀'.repeat(EXCERPT_LENGTH + 5);
    expect(Array.from(excerptOf(text, false))).toHaveLength(EXCERPT_LENGTH);
  });

  it('sin anotaciones no hay filas', () => {
    expect(buildCommentRows(new Map(), new Map(), EMPTY_COMMENT_FILTER)).toEqual([]);
  });
});

describe('authorsOf y typeLabelsOf', () => {
  it('autores distintos, sin vacíos, en orden español', () => {
    const effective = map([item('1', 0, [0, 0, 1, 1], { author: 'Zoe' }), item('2', 0, [0, 0, 1, 1], { author: 'Álvaro' }), item('3', 0, [0, 0, 1, 1], { author: '  ' })]);
    const ajena = map([foreign('ref:1R', 0, 'Square', { author: 'Bea' }), foreign('ref:2R', 0, 'Square', { author: 'Zoe' })]);
    expect(authorsOf(effective, ajena)).toEqual(['Álvaro', 'Bea', 'Zoe']);
  });

  it('etiquetas de tipo presentes, sin repetir', () => {
    const effective = map([newAnnotation('a', 'note', 0), newAnnotation('b', 'note', 1), newAnnotation('c', 'ink', 0)]);
    expect(typeLabelsOf(effective, map([foreign('ref:1R', 0, 'Square')]))).toEqual(['Dibujo', 'Nota', 'Rectángulo']);
  });
});

describe('rectTopFraction', () => {
  // Página de 612 × 792 pt sin girar; el rect es [x1, y1, x2, y2].
  const rect: readonly [number, number, number, number] = [100, 600, 200, 700];

  it('sin girar, el borde superior es y2 medido desde arriba', () => {
    expect(rectTopFraction(rect, 612, 792, 0)).toBeCloseTo((792 - 700) / 792, 10);
  });

  it('con la página girada 90° el borde superior es x1 sobre el ancho', () => {
    expect(rectTopFraction(rect, 612, 792, 90)).toBeCloseTo(100 / 612, 10);
  });

  it('girada 180° el borde superior es y1', () => {
    expect(rectTopFraction(rect, 612, 792, 180)).toBeCloseTo(600 / 792, 10);
  });

  it('girada 270° el borde superior es el ancho menos x2', () => {
    expect(rectTopFraction(rect, 612, 792, 270)).toBeCloseTo((612 - 200) / 612, 10);
  });

  it('acota a [0, 1] y acepta rotaciones fuera de rango', () => {
    expect(rectTopFraction([0, 0, 1, 2000], 612, 792, 0)).toBe(0);
    expect(rectTopFraction([0, 0, 1, 1], 612, 792, 360)).toBeCloseTo(791 / 792, 10);
  });
});

describe('visibleRowRange y rowLayout', () => {
  const rows: CommentRow[] = [
    { kind: 'page', pageIndex: 0, count: 2 },
    { kind: 'item', id: 'a', pageIndex: 0, typeLabel: 'Nota', author: '', modified: null, excerpt: '', readOnly: false, state: null, replyCount: 0 },
    { kind: 'item', id: 'b', pageIndex: 0, typeLabel: 'Nota', author: '', modified: null, excerpt: '', readOnly: false, state: null, replyCount: 0 },
    { kind: 'page', pageIndex: 1, count: 1 },
    { kind: 'item', id: 'c', pageIndex: 1, typeLabel: 'Nota', author: '', modified: null, excerpt: '', readOnly: false, state: null, replyCount: 0 },
  ];

  it('altura de cabecera 28 px y de comentario 72 px, posiciones acumuladas', () => {
    const layout = rowLayout(rows);
    expect(layout.tops).toEqual([0, PAGE_ROW_HEIGHT, PAGE_ROW_HEIGHT + ITEM_ROW_HEIGHT, PAGE_ROW_HEIGHT + 2 * ITEM_ROW_HEIGHT, 2 * PAGE_ROW_HEIGHT + 2 * ITEM_ROW_HEIGHT]);
    expect(layout.total).toBe(2 * PAGE_ROW_HEIGHT + 3 * ITEM_ROW_HEIGHT);
  });

  it('devuelve las filas que caen en la franja visible con margen', () => {
    const layout = rowLayout(rows);
    expect(visibleRowRange(layout, 0, 50, 0)).toEqual({ first: 0, last: 1 });
    // La fila b empieza en y = 100 y la página 1 en y = 172: la franja [100, 150) solo toca b.
    expect(visibleRowRange(layout, 100, 50, 0)).toEqual({ first: 2, last: 2 });
    expect(visibleRowRange(layout, 100, 50, 1)).toEqual({ first: 1, last: 3 });
  });

  it('sin filas no hay rango', () => {
    expect(visibleRowRange(rowLayout([]), 0, 100, 2)).toBeNull();
  });

  it('con 10 000 comentarios el rango visible es de unas pocas filas', () => {
    const many: CommentRow[] = Array.from({ length: 10_000 }, (_, i) => ({
      kind: 'item' as const,
      id: `n${String(i)}`,
      pageIndex: 0,
      typeLabel: 'Nota',
      author: '',
      modified: null,
      excerpt: '',
      readOnly: false,
      state: null,
      replyCount: 0,
    }));
    const layout = rowLayout(many);
    const range = visibleRowRange(layout, 720_000, 600, 4);
    expect(range).not.toBeNull();
    expect((range?.last ?? 0) - (range?.first ?? 0) + 1).toBeLessThan(40);
  });
});

describe('nextItemRow', () => {
  const rows: CommentRow[] = [
    { kind: 'page', pageIndex: 0, count: 2 },
    { kind: 'item', id: 'a', pageIndex: 0, typeLabel: 'Nota', author: '', modified: null, excerpt: '', readOnly: false, state: null, replyCount: 0 },
    { kind: 'item', id: 'b', pageIndex: 0, typeLabel: 'Nota', author: '', modified: null, excerpt: '', readOnly: false, state: null, replyCount: 0 },
    { kind: 'page', pageIndex: 1, count: 1 },
    { kind: 'item', id: 'c', pageIndex: 1, typeLabel: 'Nota', author: '', modified: null, excerpt: '', readOnly: false, state: null, replyCount: 0 },
  ];

  it('salta las cabeceras de página al avanzar y retroceder', () => {
    expect(nextItemRow(rows, 2, 'next')).toBe(4);
    expect(nextItemRow(rows, 4, 'prev')).toBe(2);
    expect(nextItemRow(rows, 1, 'prev')).toBeNull();
  });

  it('no sale de la lista y Inicio/Fin van a la primera y la última fila de comentario', () => {
    expect(nextItemRow(rows, 4, 'next')).toBeNull();
    expect(nextItemRow(rows, 4, 'first')).toBe(1);
    expect(nextItemRow(rows, 1, 'last')).toBe(4);
  });

  it('sin fila activa, abajo va a la primera y arriba a la última', () => {
    expect(nextItemRow(rows, -1, 'next')).toBe(1);
    expect(nextItemRow(rows, -1, 'prev')).toBe(4);
  });

  it('sin filas de comentario no hay destino', () => {
    expect(nextItemRow([], -1, 'first')).toBeNull();
    expect(nextItemRow([], -1, 'last')).toBeNull();
  });
});

describe('foldForSearch', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(foldForSearch('Árbol NIÑO')).toBe('arbol nino');
  });
});

describe('annotated.pdf (PDF-036)', () => {
  let pdf: LoadedPdf;

  beforeAll(async () => {
    initServices({
      platform: createFakePlatform({ prefs: createStorageStore(null, 'test.') }) as Platform,
      assetBaseUrl: '',
    });
    const result = await loadPdf(fixtureSource('annotated.pdf'), { assetBaseUrl: nodeAssetBase() });
    if (!result.ok) throw new Error(`No se pudo abrir annotated.pdf: ${result.error.code}`);
    pdf = result.value;
  }, OPEN_TIMEOUT);

  afterEach(() => {
    endAnnotationSession();
    useAnnotations.setState(initialAnnotationState());
  });

  async function scanned(): Promise<void> {
    startAnnotationSession(pdf, new AbortController().signal);
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const check = (): void => {
        if (useAnnotations.getState().scan === 'done') resolve();
        else if (Date.now() - started > OPEN_TIMEOUT) reject(new Error('el escaneo no termina'));
        else setTimeout(check, 10);
      };
      check();
    });
  }

  it('6 comentarios: cabeceras por página, el Square como «Rectángulo» de solo lectura', async () => {
    await scanned();
    const { baseline, foreign: ajenas } = useAnnotations.getState();
    const rows = buildCommentRows(new Map(baseline), ajenas, EMPTY_COMMENT_FILTER);

    expect(items(rows)).toHaveLength(6);
    expect(rows.filter((r) => r.kind === 'page')).toHaveLength(3);
    const square = items(rows).find((r) => r.typeLabel === 'Rectángulo');
    expect(square).toMatchObject({ readOnly: true });
  }, OPEN_TIMEOUT);

  it('el filtro «PREVIO» busca sin mayúsculas: deja el resaltado («Comentario previo») y el texto libre («Texto libre previo»)', async () => {
    await scanned();
    const { baseline, foreign: ajenas } = useAnnotations.getState();
    const rows = buildCommentRows(new Map(baseline), ajenas, filter({ text: 'PREVIO' }));
    expect(items(rows).map((r) => r.typeLabel).sort()).toEqual(['Resaltado', 'Texto']);
  }, OPEN_TIMEOUT);

  it('la nota «Nota previa» no contiene «previo» (solo «previa»): el filtro «previa» la deja', async () => {
    await scanned();
    const { baseline, foreign: ajenas } = useAnnotations.getState();
    const rows = buildCommentRows(new Map(baseline), ajenas, filter({ text: 'Previa' }));
    expect(items(rows).map((r) => r.excerpt)).toEqual(['Nota previa']);
  }, OPEN_TIMEOUT);

  it('la lista de autores y tipos del documento sale de la línea base', async () => {
    await scanned();
    const { baseline, foreign: ajenas } = useAnnotations.getState();
    expect(authorsOf(new Map(baseline), ajenas).length).toBeGreaterThan(0);
    expect(typeLabelsOf(new Map(baseline), ajenas)).toContain('Rectángulo');
  }, OPEN_TIMEOUT);
});

describe('etiqueta «Firma» de sellos ajenos', () => {
  it('un /Stamp /Name /SuiteFirma se muestra como «Firma» en la fila y en el filtro de tipos', () => {
    const ajena = new Map([['ref:9R', foreign('ref:9R', 0, 'Stamp', { stampName: 'SuiteFirma' })]]);
    const rows = buildCommentRows(new Map(), ajena, EMPTY_COMMENT_FILTER);

    expect(rows.flatMap((r) => (r.kind === 'item' ? [r.typeLabel] : []))).toEqual(['Firma']);
    expect(typeLabelsOf(new Map(), ajena)).toEqual(['Firma']);
  });

  it('un /Stamp sin nombre de firma, o con otro nombre, se muestra como «Sello»', () => {
    const ajenas = new Map([
      ['ref:9R', foreign('ref:9R', 0, 'Stamp')],
      ['ref:10R', foreign('ref:10R', 0, 'Stamp', { stampName: 'Approved' })],
    ]);
    const rows = buildCommentRows(new Map(), ajenas, EMPTY_COMMENT_FILTER);

    expect(rows.flatMap((r) => (r.kind === 'item' ? [r.typeLabel] : []))).toEqual(['Sello', 'Sello']);
    expect(typeLabelsOf(new Map(), ajenas)).toEqual(['Sello']);
  });
});

describe('respuestas y estados en la lista de comentarios (PDF-058)', () => {
  it('su etiqueta es Respuesta y Estado, y no son filas propias', () => {
    const parent = { ...newAnnotation('suite-nota', 'note'), rect: [10, 100, 20, 110] as const };
    const reply = newReply({ id: 'suite-r', parent, contents: 'Sí', author: 'Ana', now: T0 });
    const review = newReviewState({ id: 'suite-s', parent, state: 'Accepted', author: 'Ana', now: T0 });
    expect(typeLabelOf(reply)).toBe('Respuesta');
    expect(typeLabelOf(review)).toBe('Estado');
    const rows = buildCommentRows(map([parent, reply, review]), new Map(), EMPTY_COMMENT_FILTER);
    expect(rows.flatMap((r) => (r.kind === 'item' ? [r.id] : []))).toEqual(['suite-nota']);
  });
});

/** Clave corta de cada fila para comparar el orden: «p0» para la cabecera de la página 0, el id para el resto. */
function rowKeys(rows: readonly CommentRow[]): string[] {
  return rows.map((r) => (r.kind === 'page' ? `p${String(r.pageIndex)}` : r.id));
}

function at(hour: number): string {
  return `2026-10-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

describe('respuestas y estados en la lista (PDF-116)', () => {
  it('una nota con 2 respuestas y estado Rejected da [page, item, reply, reply]; la cabecera cuenta solo la nota', () => {
    const n = item('n', 0, [10, 100, 20, 110], { contents: 'Revisar' });
    const r1 = newReply({ id: 'r1', parent: n, contents: 'uno', author: 'Ana', now: at(10) });
    const r2 = newReply({ id: 'r2', parent: n, contents: 'dos', author: 'Luis', now: at(11) });
    const s = newReviewState({ id: 's', parent: n, state: 'Rejected', author: 'Ana', now: at(12) });
    const rows = buildCommentRows(map([n, r1, r2, s]), new Map(), EMPTY_COMMENT_FILTER);

    expect(rowKeys(rows)).toEqual(['p0', 'n', 'r1', 'r2']);
    expect(rows[0]).toEqual({ kind: 'page', pageIndex: 0, count: 1 });
    expect(rows[1]).toMatchObject({ kind: 'item', state: 'Rejected', replyCount: 2 });
    expect(rows[2]).toMatchObject({ kind: 'reply', parentId: 'n', author: 'Ana', excerpt: 'uno', modified: at(10) });
  });

  it('las respuestas de respuestas van tras su padre, en orden de hilo, sin sangría adicional', () => {
    const n = item('n', 0, [10, 100, 20, 110], { contents: 'Nota' });
    const r1 = newReply({ id: 'r1', parent: n, contents: 'uno', author: 'Ana', now: at(10) });
    const r1a = newReply({ id: 'r1a', parent: r1, contents: 'uno-a', author: 'Luis', now: at(11) });
    const r2 = newReply({ id: 'r2', parent: n, contents: 'dos', author: 'Ana', now: at(12) });
    const rows = buildCommentRows(map([n, r1, r1a, r2]), new Map(), EMPTY_COMMENT_FILTER);

    expect(rowKeys(rows)).toEqual(['p0', 'n', 'r1', 'r1a', 'r2']);
    expect(rows[1]).toMatchObject({ kind: 'item', replyCount: 3 });
    expect(rows[3]).toMatchObject({ kind: 'reply', parentId: 'r1' });
  });

  it('el estado «Ninguno» cuenta como sin estado y el comentario sin revisión tiene state null', () => {
    const n = item('n', 0, [10, 100, 20, 110]);
    const none = newReviewState({ id: 's', parent: n, state: 'None', author: 'Ana', now: at(9) });
    const rows = buildCommentRows(map([n, none]), new Map(), EMPTY_COMMENT_FILTER);
    expect(rows[1]).toMatchObject({ kind: 'item', state: null, replyCount: 0 });
  });

  it('el estado vigente es el de revisión más reciente', () => {
    const n = item('n', 0, [10, 100, 20, 110]);
    const old = newReviewState({ id: 's1', parent: n, state: 'Accepted', author: 'Ana', now: at(9) });
    const later = newReviewState({ id: 's2', parent: n, state: 'Completed', author: 'Ana', now: at(10) });
    const rows = buildCommentRows(map([n, old, later]), new Map(), EMPTY_COMMENT_FILTER);
    expect(rows[1]).toMatchObject({ kind: 'item', state: 'Completed' });
  });

  it('filtro de estado {Accepted} oculta la nota sin ese estado; {none} muestra solo las que no tienen estado', () => {
    const a = item('a', 0, [10, 100, 20, 110], { contents: 'uno' });
    const b = item('b', 0, [10, 50, 20, 60], { contents: 'dos' });
    const sa = newReviewState({ id: 'sa', parent: a, state: 'Accepted', author: 'Ana', now: at(9) });
    const all = map([a, b, sa]);

    expect(rowKeys(buildCommentRows(all, new Map(), filter({ states: new Set(['Accepted']) })))).toEqual(['p0', 'a']);
    expect(rowKeys(buildCommentRows(all, new Map(), filter({ states: new Set(['none']) })))).toEqual(['p0', 'b']);
    expect(rowKeys(buildCommentRows(all, new Map(), filter({ states: new Set(['Accepted', 'none']) })))).toEqual([
      'p0',
      'a',
      'b',
    ]);
  });

  it('el filtro de estado no afecta a las respuestas y los comentarios ajenos cuentan como sin estado', () => {
    const foreignRow = foreign('f', 0, 'Text', { contents: 'ajeno' });
    const rows = buildCommentRows(new Map(), map([foreignRow]), filter({ states: new Set(['none']) }));
    expect(rowKeys(rows)).toEqual(['p0', 'f']);
  });

  it('el texto que solo aparece en una respuesta muestra el comentario con todas sus respuestas', () => {
    const n = item('n', 0, [10, 100, 20, 110], { contents: 'Revisar la cifra' });
    const r1 = newReply({ id: 'r1', parent: n, contents: 'El presupuesto no cuadra', author: 'Ana', now: at(10) });
    const r2 = newReply({ id: 'r2', parent: n, contents: 'Corregido', author: 'Luis', now: at(11) });
    const other = item('o', 0, [10, 50, 20, 60], { contents: 'otra cosa' });
    const all = map([n, r1, r2, other]);

    expect(rowKeys(buildCommentRows(all, new Map(), filter({ text: 'PRESUPUESTO' })))).toEqual(['p0', 'n', 'r1', 'r2']);
    expect(rowKeys(buildCommentRows(all, new Map(), filter({ text: 'corregido' })))).toEqual(['p0', 'n', 'r1', 'r2']);
    expect(rowKeys(buildCommentRows(all, new Map(), filter({ text: 'nada' })))).toEqual([]);
  });

  it('nextItemRow salta también por las filas de respuesta', () => {
    const n = item('n', 0, [10, 100, 20, 110], { contents: 'Nota' });
    const r1 = newReply({ id: 'r1', parent: n, contents: 'uno', author: 'Ana', now: at(10) });
    const m = item('m', 0, [10, 50, 20, 60], { contents: 'Otra' });
    const rows = buildCommentRows(map([n, r1, m]), new Map(), EMPTY_COMMENT_FILTER);

    expect(nextItemRow(rows, 1, 'next')).toBe(2);
    expect(nextItemRow(rows, 2, 'next')).toBe(3);
    expect(nextItemRow(rows, 3, 'prev')).toBe(2);
    expect(nextItemRow(rows, -1, 'first')).toBe(1);
    expect(nextItemRow(rows, -1, 'last')).toBe(3);
  });

  it('la fila de respuesta mide REPLY_ROW_HEIGHT y se suma a la posición de las siguientes', () => {
    const n = item('n', 0, [10, 100, 20, 110], { contents: 'Nota' });
    const r1 = newReply({ id: 'r1', parent: n, contents: 'uno', author: 'Ana', now: at(10) });
    const layout = rowLayout(buildCommentRows(map([n, r1]), new Map(), EMPTY_COMMENT_FILTER));
    expect(REPLY_ROW_HEIGHT).toBe(52);
    expect(layout.heights).toEqual([PAGE_ROW_HEIGHT, ITEM_ROW_HEIGHT, REPLY_ROW_HEIGHT]);
    expect(layout.tops).toEqual([0, PAGE_ROW_HEIGHT, PAGE_ROW_HEIGHT + ITEM_ROW_HEIGHT]);
  });

  it('indexReplies da lo mismo que repliesOf y reviewStateOf, y threadRootId sube al comentario raíz', () => {
    const n = item('n', 0, [10, 100, 20, 110]);
    const r1 = newReply({ id: 'r1', parent: n, contents: 'uno', author: 'Ana', now: at(11) });
    const r0 = newReply({ id: 'r0', parent: n, contents: 'cero', author: 'Ana', now: at(10) });
    const r1a = newReply({ id: 'r1a', parent: r1, contents: 'anidada', author: 'Luis', now: at(12) });
    const s = newReviewState({ id: 's', parent: n, state: 'Cancelled', author: 'Ana', now: at(13) });
    const all = map([n, r1, r0, r1a, s]);
    const index = indexReplies(all);

    expect(index.replies.get('n')).toEqual(repliesOf(all, 'n'));
    expect(index.replies.get('r1')).toEqual(repliesOf(all, 'r1'));
    expect(index.states.get('n')).toBe(reviewStateOf(all, 'n')?.state);
    expect(threadRootId(all, 'r1a')).toBe('n');
    expect(threadRootId(all, 'n')).toBe('n');
    expect(threadRootId(all, 'desconocida')).toBe('desconocida');
  });
});
