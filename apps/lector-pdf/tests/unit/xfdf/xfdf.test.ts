import { describe, expect, it } from 'vitest';
import {
  annotationEquals,
  stampColor,
  type Annotation,
  type ReplyAnnotation,
} from '../../../src/core/annotations';
import { exportXfdf, importXfdf, type XfdfImportOptions } from '../../../src/core/xfdf/xfdf';

const T0 = '2026-10-17T12:00:00.000Z';
const YELLOW = [1, 1, 0] as const;
const RED = [1, 0, 0] as const;
const BLUE = [0, 0, 1] as const;
/** Colores k/255 exactos: así sobreviven al paso por `#RRGGBB`. */
const TEAL = [0x33 / 255, 0x66 / 255, 0x99 / 255] as const;
const QUAD = [[10, 40, 110, 40, 10, 20, 110, 20]] as const;

function base(id: string, type: Annotation['type'], rect: readonly number[] = [10, 20, 110, 40]) {
  return {
    id,
    pageIndex: 0,
    rect: [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0] as const,
    color: YELLOW,
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: T0,
    created: T0,
    origin: { kind: 'new' } as const,
    type,
  };
}

/** Una anotación de cada tipo editable, con respuesta y estado. Las respuestas van antes que su padre a propósito. */
function allTypes(): Map<string, Annotation> {
  const list: Annotation[] = [
    { ...base('suite-reply1', 'reply'), type: 'reply', parentId: 'suite-note1', contents: 'Respuesta & más <ok>' },
    { ...base('suite-hl1', 'highlight'), type: 'highlight', quads: QUAD, contents: 'Subrayado "ñ" é' },
    { ...base('suite-ul1', 'underline'), type: 'underline', quads: QUAD },
    { ...base('suite-st1', 'strikeout'), type: 'strikeout', quads: QUAD },
    { ...base('suite-note1', 'note', [100, 100, 120, 120]), type: 'note', icon: 'Key', open: true, color: RED, contents: 'Nota' },
    { ...base('suite-ft1', 'freetext', [200, 200, 400, 230]), type: 'freetext', fontSize: 12, textColor: RED, contents: 'Texto libre' },
    { ...base('suite-ink1', 'ink', [10, 10, 30, 25]), type: 'ink', paths: [[10, 10, 20, 15, 30, 25]], width: 2, color: BLUE },
    { ...base('suite-sq1', 'square', [300, 300, 400, 350]), type: 'square', width: 1.5, interior: TEAL, color: TEAL },
    { ...base('suite-ci1', 'circle', [300, 400, 400, 450]), type: 'circle', width: 1, interior: null },
    { ...base('suite-ln1', 'line', [10, 10, 200, 200]), type: 'line', points: [10, 10, 200, 200], width: 2, endings: ['None', 'OpenArrow'], interior: null },
    { ...base('suite-pg1', 'polygon', [0, 0, 50, 40]), type: 'polygon', vertices: [0, 0, 50, 0, 25, 40], width: 1, interior: [1, 1, 1] },
    { ...base('suite-sp1', 'stamp', [50, 50, 150, 86]), type: 'stamp', name: 'Approved', color: stampColor('Approved') },
    { ...base('suite-rv1', 'review', [100, 100, 120, 120]), type: 'review', parentId: 'suite-hl1', state: 'Accepted' },
  ];
  return new Map(list.map((a) => [a.id, a]));
}

function importOpts(o: Partial<XfdfImportOptions> = {}): XfdfImportOptions {
  let n = 0;
  return {
    existingIds: new Set(),
    pageCount: 5,
    newId: () => `suite-nuevo-${++n}`,
    now: T0,
    author: 'Importado',
    ...o,
  };
}

function expectOk<T>(r: ReturnType<typeof importXfdf>): T {
  if (!r.ok) throw new Error(`debería importar: ${r.error.code}`);
  return r.value as T;
}

function codeOf(r: ReturnType<typeof importXfdf>): string {
  return r.ok ? 'ok' : r.error.code;
}

const EXPORT_OPTS = { fileName: 'contrato.pdf', ids: ['0123abcd', 'ffee9900'] as const };

describe('exportXfdf', () => {
  it('escribe cabecera, raíz XFDF, annots, f e ids', () => {
    const xml = exportXfdf(allTypes(), { fileName: 'a&b.pdf', ids: ['11', '22'] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">');
    expect(xml).toContain('<f href="a&amp;b.pdf"/>');
    expect(xml).toContain('<ids original="11" modified="22"/>');
  });

  it('omite <ids> cuando no hay identificadores', () => {
    const xml = exportXfdf(allTypes(), { fileName: 'a.pdf', ids: null });
    expect(xml).not.toContain('<ids');
  });

  it('usa el formato de la tabla para cada tipo', () => {
    const xml = exportXfdf(allTypes(), EXPORT_OPTS);
    expect(xml).toContain('<highlight name="suite-hl1" page="0" rect="10,20,110,40" color="#FFFF00"');
    expect(xml).toContain('coords="10,40,110,40,10,20,110,20"');
    expect(xml).toContain('<text name="suite-note1"');
    expect(xml).toContain('<text name="suite-note1"');
    expect(xml).toContain('<popup open="yes"/></text>');
    expect(xml).toContain('<freetext name="suite-ft1"');
    expect(xml).toContain('<defaultappearance>/Helv 12 Tf 1 0 0 rg</defaultappearance>');
    expect(xml).toContain('<inklist><gesture>10,10;20,15;30,25</gesture></inklist>');
    expect(xml).toContain('interior-color="#336699"');
    expect(xml).toContain('<line name="suite-ln1"');
    expect(xml).toContain('head="None" tail="OpenArrow"');
    expect(xml).toContain('<vertices>0,0;50,0;25,40</vertices>');
    expect(xml).toContain('<stamp name="suite-sp1"');
    expect(xml).toContain('icon="Approved"');
  });

  it('escribe la respuesta y el estado con inreplyto, replyType, state y statemodel', () => {
    const xml = exportXfdf(allTypes(), EXPORT_OPTS);
    expect(xml).toContain('inreplyto="suite-note1" replyType="reply" icon="Comment"');
    expect(xml).toContain('inreplyto="suite-hl1" state="Accepted" statemodel="Review" icon="Comment"');
  });

  it('escapa el texto y los atributos', () => {
    const xml = exportXfdf(allTypes(), EXPORT_OPTS);
    expect(xml).toContain('<contents>Respuesta &amp; más &lt;ok&gt;</contents>');
    expect(xml).toContain('<contents>Subrayado &quot;ñ&quot; é</contents>');
  });

  it('coloca cada respuesta después de su padre', () => {
    const xml = exportXfdf(allTypes(), EXPORT_OPTS);
    const pos = (name: string) => xml.indexOf(`name="${name}"`);
    expect(pos('suite-note1')).toBeLessThan(pos('suite-reply1'));
    expect(pos('suite-hl1')).toBeLessThan(pos('suite-rv1'));
  });

  it('no exporta firmas', () => {
    const m = allTypes();
    m.set('suite-firma', {
      ...base('suite-firma', 'signature'),
      type: 'signature',
      art: { kind: 'ink', paths: [[0, 0, 10, 10]], width: 1, box: [10, 10] },
    });
    const xml = exportXfdf(m, EXPORT_OPTS);
    expect(xml).not.toContain('suite-firma');
    expect(xml).not.toContain('signature');
  });

  it('exporta números con 4 decimales como mucho', () => {
    const m = new Map<string, Annotation>([
      ['suite-x', { ...base('suite-x', 'square', [1.123456, 2, 3.5, 4]), type: 'square', width: 1, interior: null }],
    ]);
    expect(exportXfdf(m, EXPORT_OPTS)).toContain('rect="1.1235,2,3.5,4"');
  });

  it('las fechas van en formato PDF', () => {
    const xml = exportXfdf(allTypes(), EXPORT_OPTS);
    expect(xml).toContain('date="D:20261017120000Z"');
    expect(xml).toContain('creationdate="D:20261017120000Z"');
  });
});

describe('ida y vuelta XFDF', () => {
  it('exportar e importar en un documento vacío devuelve las mismas anotaciones y ids', () => {
    const original = allTypes();
    const xml = exportXfdf(original, EXPORT_OPTS);
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number; duplicates: number }>(
      importXfdf(xml, importOpts()),
    );
    expect(res.skipped).toBe(0);
    expect(res.duplicates).toBe(0);
    expect(res.annotations).toHaveLength(13);
    for (const a of res.annotations) {
      const want = original.get(a.id);
      expect(want).toBeDefined();
      if (want !== undefined) expect(annotationEquals(a, want)).toBe(true);
    }
    const reply = res.annotations.find((a): a is ReplyAnnotation => a.type === 'reply');
    expect(reply?.parentId).toBe('suite-note1');
  });

  it('importar el mismo XFDF con sus ids ya presentes no añade nada', () => {
    const xml = exportXfdf(allTypes(), EXPORT_OPTS);
    const existing = new Set(allTypes().keys());
    const res = expectOk<{ annotations: readonly Annotation[]; duplicates: number }>(
      importXfdf(xml, importOpts({ existingIds: existing })),
    );
    expect(res.annotations).toHaveLength(0);
    expect(res.duplicates).toBe(13);
  });

  it('las coordenadas se conservan con error ≤ 0,0001', () => {
    const m = new Map<string, Annotation>([
      [
        'suite-p',
        {
          ...base('suite-p', 'line', [10.123456, 20.987654, 200.5, 201.25]),
          type: 'line',
          points: [10.123456, 20.987654, 200.5, 201.25],
          width: 1.3333,
          endings: ['None', 'None'],
          interior: null,
        },
      ],
    ]);
    const res = expectOk<{ annotations: readonly Annotation[] }>(importXfdf(exportXfdf(m, EXPORT_OPTS), importOpts()));
    const a = res.annotations[0];
    expect(a?.type).toBe('line');
    if (a?.type !== 'line') return;
    expect(Math.abs(a.points[0] - 10.123456)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(a.points[1] - 20.987654)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(a.points[2] - 200.5)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(a.points[3] - 201.25)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(a.rect[0] - 10.123456)).toBeLessThanOrEqual(0.0001);
  });
});

/** Muestra escrita a mano siguiendo la tabla de formato, con el estilo de Acrobat. */
const ACROBAT_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">
  <annots>
    <highlight page="0" rect="72,700.5,200,712" color="#FFFF00" opacity="1" title="Ana"
      date="D:20261017100000Z" creationdate="D:20261017095900Z" name="A1" flags="print"
      coords="72,712,200,712,72,700.5,200,700.5">
      <contents>Subrayado importante</contents>
    </highlight>
    <text page="0" rect="100,600,120,620" color="#FFCC00" opacity="1" title="Ana"
      date="D:20261017100500Z" name="N1" icon="Note" flags="print">
      <popup open="yes" rect="150,500,300,560"/>
      <contents>Revisar esta cifra</contents>
    </text>
    <text page="0" rect="100,600,120,620" color="#FFCC00" opacity="1" title="Luis"
      date="D:20261017101000Z" name="R1" inreplyto="N1" replyType="R" icon="Comment" flags="print">
      <contents>Hecho</contents>
    </text>
    <square page="0" rect="300,300,400,350" color="#FF0000" opacity="1" width="2"
      interior-color="#00FF00" title="Ana" name="S1" date="D:20261017102000Z" flags="print">
      <contents>Zona</contents>
    </square>
  </annots>
  <f href="contrato.pdf"/>
  <ids original="0123abcd" modified="ffee9900"/>
</xfdf>`;

describe('importXfdf · muestra de Acrobat', () => {
  it('importa 3 anotaciones y 1 respuesta enlazada a su nota', () => {
    let n = 0;
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(
      importXfdf(ACROBAT_SAMPLE, importOpts({ newId: () => `suite-a-${++n}` })),
    );
    expect(res.skipped).toBe(0);
    expect(res.annotations.map((a) => a.type)).toEqual(['highlight', 'note', 'reply', 'square']);
    const note = res.annotations.find((a) => a.type === 'note');
    const reply = res.annotations.find((a) => a.type === 'reply');
    expect(note?.id).toMatch(/^suite-a-/);
    expect(reply?.type === 'reply' && reply.parentId).toBe(note?.id);
  });

  it('lee open de la nota según el popup y los datos de cada elemento', () => {
    const res = expectOk<{ annotations: readonly Annotation[] }>(importXfdf(ACROBAT_SAMPLE, importOpts()));
    const [hl, note, reply, sq] = res.annotations;
    expect(note?.type === 'note' && note.open).toBe(true);
    expect(hl).toMatchObject({
      type: 'highlight',
      contents: 'Subrayado importante',
      author: 'Ana',
      modified: '2026-10-17T10:00:00.000Z',
      created: '2026-10-17T09:59:00.000Z',
      color: [1, 1, 0],
      origin: { kind: 'new' },
    });
    expect(hl?.type === 'highlight' && hl.quads).toEqual([[72, 712, 200, 712, 72, 700.5, 200, 700.5]]);
    expect(reply).toMatchObject({ author: 'Luis', contents: 'Hecho' });
    expect(sq).toMatchObject({ type: 'square', width: 2, interior: [0, 1, 0], color: [1, 0, 0] });
  });

  it('una nota sin popup o con open="no" queda cerrada', () => {
    const xml = ACROBAT_SAMPLE.replace('<popup open="yes" rect="150,500,300,560"/>', '');
    const res = expectOk<{ annotations: readonly Annotation[] }>(importXfdf(xml, importOpts()));
    const note = res.annotations.find((a) => a.type === 'note');
    expect(note?.type === 'note' && note.open).toBe(false);
  });
});

/** XFDF mínimo con `body` dentro de `<annots>`. */
function xfdfWith(body: string, root = 'xfdf'): string {
  return `<?xml version="1.0"?><${root} xmlns="http://ns.adobe.com/xfdf/"><annots>${body}</annots><f href="a.pdf"/></${root}>`;
}

const NOTE = (name: string, page = 0) =>
  `<text page="${page}" rect="1,1,5,5" color="#FFFF00" name="${name}" icon="Note" title="Ana" date="D:20261017120000Z"><contents>n</contents></text>`;

describe('importXfdf · omisiones y errores', () => {
  it('caret y squiggly se omiten y cuentan', () => {
    const xml = xfdfWith(
      `<caret page="0" rect="1,1,5,5" color="#000000"/><squiggly page="0" rect="1,1,5,5" color="#000000" coords="1,5,5,5,1,1,5,1"/>${NOTE('keep')}`,
    );
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(importXfdf(xml, importOpts()));
    expect(res.skipped).toBe(2);
    expect(res.annotations).toHaveLength(1);
  });

  it('página fuera de rango se omite', () => {
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(
      importXfdf(xfdfWith(NOTE('lejos', 99) + NOTE('ok', 4)), importOpts({ pageCount: 5 })),
    );
    expect(res.skipped).toBe(1);
    expect(res.annotations.map((a) => a.pageIndex)).toEqual([4]);
  });

  it('un XFDF sin nada importable es xfdf-empty', () => {
    expect(codeOf(importXfdf(xfdfWith('<caret page="0" rect="1,1,5,5" color="#000000"/>'), importOpts()))).toBe(
      'xfdf-empty',
    );
    expect(codeOf(importXfdf(xfdfWith(''), importOpts()))).toBe('xfdf-empty');
  });

  it('raíz distinta de xfdf o sin annots es xfdf-invalid', () => {
    expect(codeOf(importXfdf(xfdfWith(NOTE('a'), 'fdf'), importOpts()))).toBe('xfdf-invalid');
    expect(codeOf(importXfdf('<xfdf><f href="a.pdf"/></xfdf>', importOpts()))).toBe('xfdf-invalid');
    expect(codeOf(importXfdf('no es xml <', importOpts()))).toBe('xfdf-invalid');
  });

  it('una respuesta sin padre resoluble se omite', () => {
    const xml = xfdfWith(
      `${NOTE('a')}<text page="0" rect="1,1,5,5" color="#FFFF00" name="r" inreplyto="no-existe" title="Luis" date="D:20261017120000Z"><contents>x</contents></text>`,
    );
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(importXfdf(xml, importOpts()));
    expect(res.annotations).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  it('una respuesta se resuelve contra un id del documento', () => {
    const xml = xfdfWith(
      `<text page="0" rect="1,1,5,5" color="#FFFF00" name="r" inreplyto="ref:12R" title="Luis" date="D:20261017120000Z"><contents>x</contents></text>`,
    );
    const res = expectOk<{ annotations: readonly Annotation[] }>(
      importXfdf(xml, importOpts({ existingIds: new Set(['ref:12R']) })),
    );
    expect(res.annotations[0]).toMatchObject({ type: 'reply', parentId: 'ref:12R' });
  });

  it('una respuesta se importa aunque su padre aparezca después en el fichero', () => {
    const reply = `<text page="0" rect="1,1,5,5" color="#FFFF00" name="r1" inreplyto="p1" title="Luis" date="D:20261017120000Z"><contents>x</contents></text>`;
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(
      importXfdf(xfdfWith(`${reply}${NOTE('p1')}`), importOpts()),
    );
    expect(res.skipped).toBe(0);
    const [r, p] = res.annotations;
    expect(r?.type === 'reply' && r.parentId).toBe(p?.id);
  });

  it('respuestas que se citan en círculo se omiten', () => {
    const r1 = `<text page="0" rect="1,1,5,5" color="#FFFF00" name="r1" inreplyto="r2" title="A" date="D:20261017120000Z"><contents>x</contents></text>`;
    const r2 = `<text page="0" rect="1,1,5,5" color="#FFFF00" name="r2" inreplyto="r1" title="B" date="D:20261017120000Z"><contents>y</contents></text>`;
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(
      importXfdf(xfdfWith(r1 + r2), importOpts()),
    );
    expect(res.annotations).toHaveLength(0);
    expect(res.skipped).toBe(2);
  });

  it('una respuesta con estado desconocido se omite', () => {
    const xml = xfdfWith(
      `${NOTE('a')}<text page="0" rect="1,1,5,5" color="#FFFF00" name="v" inreplyto="a" statemodel="Review" state="Quizá" title="Luis" date="D:20261017120000Z"><contents>x</contents></text>`,
    );
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(importXfdf(xml, importOpts()));
    expect(res.skipped).toBe(1);
    expect(res.annotations).toHaveLength(1);
  });

  it('un freetext sin apariencia por defecto válida o un interior inválido se omiten', () => {
    const ft = `<freetext page="0" rect="1,1,50,50" color="#FFFFFF" name="f" title="Ana"><contents>x</contents></freetext>`;
    const sq = `<square page="0" rect="1,1,50,50" color="#FFFFFF" width="1" interior-color="rojo" name="s" title="Ana"><contents>x</contents></square>`;
    expect(codeOf(importXfdf(xfdfWith(ft + sq), importOpts()))).toBe('xfdf-empty');
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(
      importXfdf(xfdfWith(ft + sq + NOTE('ok')), importOpts()),
    );
    expect(res.annotations).toHaveLength(1);
    expect(res.skipped).toBe(2);
  });

  it('un icono de nota desconocido se omite', () => {
    const xml = xfdfWith(
      `<text page="0" rect="1,1,5,5" color="#FFFF00" name="x" icon="Corazon" title="Ana" date="D:20261017120000Z"><contents>n</contents></text>${NOTE('ok')}`,
    );
    const res = expectOk<{ annotations: readonly Annotation[]; skipped: number }>(importXfdf(xml, importOpts()));
    expect(res.skipped).toBe(1);
    expect(res.annotations).toHaveLength(1);
  });

  it('una anotación inválida (color mal formado) se omite', () => {
    const bad = `<text page="0" rect="1,1,5,5" color="amarillo" name="x" icon="Note" title="Ana" date="D:20261017120000Z"><contents>n</contents></text>`;
    const res = expectOk<{ skipped: number; annotations: readonly Annotation[] }>(
      importXfdf(xfdfWith(bad + NOTE('ok')), importOpts()),
    );
    expect(res.skipped).toBe(1);
    expect(res.annotations).toHaveLength(1);
  });
});

describe('importXfdf · valores por defecto e identificadores', () => {
  it('sin title usa el autor; sin date usa now; sin creationdate, created es null', () => {
    const xml = xfdfWith(
      `<text page="0" rect="1,1,5,5" color="#FFFF00" name="x" icon="Note"><contents-richtext>Texto <b>rico</b></contents-richtext></text>`,
    );
    const res = expectOk<{ annotations: readonly Annotation[] }>(
      importXfdf(xml, importOpts({ author: 'Yo', now: T0 })),
    );
    expect(res.annotations[0]).toMatchObject({
      author: 'Yo',
      modified: T0,
      created: null,
      contents: 'Texto rico',
    });
  });

  it('un name con formato suite- válido y libre se conserva; si no, se genera uno nuevo', () => {
    const xml = xfdfWith(`${NOTE('suite-mio-1')}${NOTE('A1')}${NOTE('suite-mio-1')}`);
    const res = expectOk<{ annotations: readonly Annotation[]; duplicates: number }>(
      importXfdf(xml, importOpts({ newId: () => 'suite-nuevo' })),
    );
    expect(res.annotations.map((a) => a.id)).toEqual(['suite-mio-1', 'suite-nuevo', 'suite-nuevo']);
    expect(res.duplicates).toBe(0);
  });

  it('un name que ya existe en el documento cuenta como duplicado', () => {
    const xml = xfdfWith(`${NOTE('suite-x')}${NOTE('suite-y')}`);
    const res = expectOk<{ annotations: readonly Annotation[]; duplicates: number }>(
      importXfdf(xml, importOpts({ existingIds: new Set(['suite-x']) })),
    );
    expect(res.duplicates).toBe(1);
    expect(res.annotations.map((a) => a.id)).toEqual(['suite-y']);
  });

  it('acepta prefijos de espacio de nombres en los elementos', () => {
    const xml = `<xfdf:xfdf xmlns:xfdf="http://ns.adobe.com/xfdf/"><xfdf:annots><xfdf:text page="0" rect="1,1,5,5" color="#FFFF00" name="x" icon="Note" title="Ana"><xfdf:contents>n</xfdf:contents></xfdf:text></xfdf:annots></xfdf:xfdf>`;
    const res = expectOk<{ annotations: readonly Annotation[] }>(importXfdf(xml, importOpts()));
    expect(res.annotations[0]).toMatchObject({ type: 'note', contents: 'n' });
  });
});
