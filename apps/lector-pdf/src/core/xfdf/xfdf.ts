/**
 * XFDF 3.0 (ADR-0030): exportar las anotaciones editables a XFDF que Acrobat importa, e importar un XFDF
 * (nuestro o de Acrobat) como anotaciones nuevas. Sin dependencias: el XML lo lee `xml.ts`.
 */
import { err, ok, type Result } from '@suite/shared';
import { isAnnotation, type Annotation, type ReplyAnnotation, type ReviewStateAnnotation, type Rgb } from '../annotations/model';
import { stampColor } from '../annotations/shapes';
import { pdfError } from '../errors';
import { parsePdfDate, toPdfDate } from '../pdf-date';
import { child, escapeXml, parseXml, textOf, type XmlElement } from './xml';

export interface XfdfExportOptions {
  readonly fileName: string;
  /** Ids hex de pdf.js `doc.fingerprints`. */
  readonly ids: readonly [string, string] | null;
}

type ReplyLike = ReplyAnnotation | ReviewStateAnnotation;

function isReplyLike(a: Annotation): a is ReplyLike {
  return a.type === 'reply' || a.type === 'review';
}

/**
 * Exporta las anotaciones editables (sin firmas `signature`). Orden: el de `all`, con cada `reply`/`review`
 * después de su padre. Una respuesta cuyo padre no se exporta conserva su orden original.
 */
export function exportXfdf(all: ReadonlyMap<string, Annotation>, o: XfdfExportOptions): string {
  const items = [...all.values()].filter((a) => a.type !== 'signature');
  const exportedIds = new Set(items.map((a) => a.id));
  const repliesByParent = new Map<string, Annotation[]>();
  const roots: Annotation[] = [];
  for (const a of items) {
    if (isReplyLike(a) && exportedIds.has(a.parentId)) {
      const siblings = repliesByParent.get(a.parentId) ?? [];
      siblings.push(a);
      repliesByParent.set(a.parentId, siblings);
    } else {
      roots.push(a);
    }
  }

  // Recorrido en profundidad con pila explícita; `seen` evita bucles de respuestas (A responde a B y B a A).
  const ordered: Annotation[] = [];
  const seen = new Set<string>();
  const emit = (start: Annotation): void => {
    const stack: Annotation[] = [start];
    for (let a = stack.pop(); a !== undefined; a = stack.pop()) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      ordered.push(a);
      const replies = repliesByParent.get(a.id) ?? [];
      for (let i = replies.length - 1; i >= 0; i -= 1) {
        const r = replies[i];
        if (r !== undefined) stack.push(r);
      }
    }
  };
  for (const a of roots) emit(a);
  for (const a of items) emit(a);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">',
    '<annots>',
    ...ordered.map(exportAnnotation),
    '</annots>',
    `<f href="${escapeXml(o.fileName)}"/>`,
  ];
  if (o.ids !== null) {
    lines.push(`<ids original="${escapeXml(o.ids[0])}" modified="${escapeXml(o.ids[1])}"/>`);
  }
  lines.push('</xfdf>');
  return `${lines.join('\n')}\n`;
}

interface ExportParts {
  readonly tag: string;
  readonly attrs: readonly (readonly [string, string])[];
  readonly children: readonly string[];
}

function exportAnnotation(a: Annotation): string {
  const parts = exportParts(a);
  const common: (readonly [string, string])[] = [
    ['name', a.id],
    ['page', String(a.pageIndex)],
    ['rect', a.rect.map(num).join(',')],
    ['color', hexColor(a.color)],
    ['opacity', num(a.opacity)],
    ['title', a.author],
    ['date', toPdfDate(a.modified)],
  ];
  if (a.created !== null) common.push(['creationdate', toPdfDate(a.created)]);
  common.push(['flags', 'print']);
  const attrs = [...common, ...parts.attrs].map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ');
  const children = [`<contents>${escapeXml(a.contents)}</contents>`, ...parts.children];
  return `<${parts.tag} ${attrs}>${children.join('')}</${parts.tag}>`;
}

function exportParts(a: Annotation): ExportParts {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { tag: a.type, attrs: [['coords', a.quads.flat().map(num).join(',')]], children: [] };
    case 'note':
      // Solo se escribe popup si la nota está abierta: así `open` sobrevive a la ida y vuelta.
      return { tag: 'text', attrs: [['icon', a.icon]], children: a.open ? ['<popup open="yes"/>'] : [] };
    case 'reply':
      return {
        tag: 'text',
        attrs: [
          ['inreplyto', a.parentId],
          ['replyType', 'reply'],
          ['icon', 'Comment'],
        ],
        children: [],
      };
    case 'review':
      return {
        tag: 'text',
        attrs: [
          ['inreplyto', a.parentId],
          ['state', a.state],
          ['statemodel', 'Review'],
          ['icon', 'Comment'],
        ],
        children: [],
      };
    case 'freetext':
      return {
        tag: 'freetext',
        attrs: [],
        children: [
          `<defaultappearance>/Helv ${num(a.fontSize)} Tf ${a.textColor.map(num).join(' ')} rg</defaultappearance>`,
        ],
      };
    case 'ink':
      return {
        tag: 'ink',
        attrs: [['width', num(a.width)]],
        children: [`<inklist>${a.paths.map((p) => `<gesture>${pairs(p)}</gesture>`).join('')}</inklist>`],
      };
    case 'square':
    case 'circle':
      return { tag: a.type, attrs: [['width', num(a.width)], ...interiorAttr(a.interior)], children: [] };
    case 'line':
      return {
        tag: 'line',
        attrs: [
          ['start', `${num(a.points[0])},${num(a.points[1])}`],
          ['end', `${num(a.points[2])},${num(a.points[3])}`],
          ['head', a.endings[0]],
          ['tail', a.endings[1]],
          ['width', num(a.width)],
          ...interiorAttr(a.interior),
        ],
        children: [],
      };
    case 'polygon':
      return {
        tag: 'polygon',
        attrs: [['width', num(a.width)], ...interiorAttr(a.interior)],
        children: [`<vertices>${pairs(a.vertices)}</vertices>`],
      };
    case 'stamp':
      return { tag: 'stamp', attrs: [['icon', a.name]], children: [] };
    case 'signature':
      // Las firmas se filtran antes de llegar aquí (ADR-0030): que llegue una es un bug.
      throw new RangeError('las firmas no se exportan a XFDF');
  }
}

function interiorAttr(c: Rgb | null): readonly (readonly [string, string])[] {
  return c === null ? [] : [['interior-color', hexColor(c)]];
}

/** Hasta 4 decimales, sin ceros sobrantes. */
function num(x: number): string {
  return String(Number(x.toFixed(4)));
}

function hexColor(c: Rgb): string {
  return `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Lista `x,y;x,y;…` desde `[x0, y0, x1, y1, …]`. */
function pairs(flat: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push(`${num(flat[i] ?? 0)},${num(flat[i + 1] ?? 0)}`);
  }
  return out.join(';');
}

export interface XfdfImportOptions {
  /** Ids del documento (efectivas + borradas): un `name` igual se cuenta como duplicado. */
  readonly existingIds: ReadonlySet<string>;
  readonly pageCount: number;
  /** Devuelve `suite-<uuid>`. */
  readonly newId: () => string;
  /** ISO 8601; se usa como `modified` si falta `date`. */
  readonly now: string;
  /** Se usa como `author` si falta `title`. */
  readonly author: string;
}

export interface XfdfImportResult {
  readonly annotations: readonly Annotation[];
  readonly skipped: number;
  readonly duplicates: number;
}

const ID_PATTERN = /^suite-[A-Za-z0-9-]{1,80}$/;
const IMPORTABLE_ELEMENTS: ReadonlySet<string> = new Set([
  'highlight',
  'underline',
  'strikeout',
  'text',
  'freetext',
  'ink',
  'square',
  'circle',
  'line',
  'polygon',
  'stamp',
]);

/** Elemento leído y validado; `name` es el `name` del XFDF (o `null`). */
interface Candidate {
  readonly name: string | null;
  readonly annotation: Annotation;
}

/** Importa un XFDF como anotaciones nuevas. Error `xfdf-invalid` si la estructura no sirve, `xfdf-empty` si no hay nada importable. */
export function importXfdf(xml: string, o: XfdfImportOptions): Result<XfdfImportResult> {
  const parsed = parseXml(xml);
  if (!parsed.ok) return parsed;
  const root = parsed.value;
  const annots = root.name === 'xfdf' ? child(root, 'annots') : undefined;
  if (annots === undefined) return err(pdfError('xfdf-invalid'));

  const usedIds = new Set<string>();
  const chooseId = (name: string | null): string => {
    if (name !== null && ID_PATTERN.test(name) && !o.existingIds.has(name) && !usedIds.has(name)) return name;
    return o.newId();
  };

  const candidates: Candidate[] = [];
  let skipped = 0;
  let duplicates = 0;
  let importable = 0;
  for (const node of annots.children) {
    if (node.kind !== 'element') continue;
    const read = readElement(node, o, chooseId);
    if (read === null) {
      skipped += 1;
      continue;
    }
    importable += 1;
    if (read.name !== null && o.existingIds.has(read.name)) {
      duplicates += 1;
      continue;
    }
    usedIds.add(read.annotation.id);
    candidates.push(read);
  }
  if (importable === 0) return err(pdfError('xfdf-empty'));

  // Respuestas: el padre se busca entre los `name` del propio XFDF (sin importar el orden) y entre los ids
  // del documento. Se repite hasta que no avance; lo que quede sin padre se omite.
  const keptIds = new Map<string, string>();
  const accepted = new Map<Candidate, Annotation>();
  let waiting: Candidate[] = [];
  for (const c of candidates) {
    if (isReplyLike(c.annotation)) {
      waiting.push(c);
    } else {
      accepted.set(c, c.annotation);
      if (c.name !== null && !keptIds.has(c.name)) keptIds.set(c.name, c.annotation.id);
    }
  }
  const resolve = (name: string): string | undefined => keptIds.get(name) ?? (o.existingIds.has(name) ? name : undefined);
  let progress = true;
  while (progress && waiting.length > 0) {
    progress = false;
    const still: Candidate[] = [];
    for (const c of waiting) {
      const a = c.annotation;
      if (!isReplyLike(a)) continue;
      const parentId = resolve(a.parentId);
      if (parentId === undefined) {
        still.push(c);
        continue;
      }
      accepted.set(c, { ...a, parentId });
      if (c.name !== null && !keptIds.has(c.name)) keptIds.set(c.name, a.id);
      progress = true;
    }
    waiting = still;
  }
  skipped += waiting.length;

  const annotations: Annotation[] = [];
  for (const c of candidates) {
    const a = accepted.get(c);
    if (a !== undefined) annotations.push(a);
  }
  return ok({ annotations, skipped, duplicates });
}

/** Lee un elemento del XFDF. `null` si no es importable (tipo desconocido, datos no válidos o página fuera de rango). */
function readElement(el: XmlElement, o: XfdfImportOptions, chooseId: (name: string | null) => string): Candidate | null {
  if (!IMPORTABLE_ELEMENTS.has(el.name)) return null;
  const attr = (k: string): string | undefined => el.attrs.get(k);
  const page = parseInteger(attr('page'));
  if (page === null || page >= o.pageCount) return null;

  const name = attr('name') ?? null;
  const draft: Record<string, unknown> = {
    id: chooseId(name),
    pageIndex: page,
    rect: parseNumbers(attr('rect')),
    color: parseHexColor(attr('color') ?? ''),
    opacity: attr('opacity') === undefined ? 1 : parseNumber(attr('opacity')),
    contents: contentsOf(el),
    author: attr('title') ?? o.author,
    modified: parsePdfDate(attr('date')) ?? o.now,
    created: parsePdfDate(attr('creationdate')),
    origin: { kind: 'new' },
  };

  switch (el.name) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      draft.type = el.name;
      draft.quads = parseCoords(attr('coords'));
      break;
    case 'text': {
      const inReplyTo = attr('inreplyto');
      if (inReplyTo !== undefined) {
        draft.type = attr('statemodel') === 'Review' ? 'review' : 'reply';
        draft.parentId = inReplyTo;
        if (draft.type === 'review') draft.state = attr('state');
      } else {
        draft.type = 'note';
        draft.icon = attr('icon') ?? 'Note';
        draft.open = child(el, 'popup')?.attrs.get('open') === 'yes';
      }
      break;
    }
    case 'freetext': {
      const appearance = parseDefaultAppearance(child(el, 'defaultappearance'));
      draft.type = 'freetext';
      draft.fontSize = appearance?.fontSize ?? null;
      draft.textColor = appearance?.textColor ?? null;
      break;
    }
    case 'ink':
      draft.type = 'ink';
      draft.paths = parseInkList(child(el, 'inklist'));
      draft.width = parseNumber(attr('width'));
      break;
    case 'square':
    case 'circle':
      draft.type = el.name;
      draft.width = parseNumber(attr('width'));
      draft.interior = parseInterior(attr('interior-color'));
      break;
    case 'line':
      draft.type = 'line';
      draft.points = parseLinePoints(attr('start'), attr('end'));
      draft.endings = [attr('head') ?? 'None', attr('tail') ?? 'None'];
      draft.width = parseNumber(attr('width'));
      draft.interior = parseInterior(attr('interior-color'));
      break;
    case 'polygon':
      draft.type = 'polygon';
      draft.vertices = parsePairs(textOfChild(el, 'vertices'));
      draft.width = parseNumber(attr('width'));
      draft.interior = parseInterior(attr('interior-color'));
      break;
    case 'stamp':
      draft.type = 'stamp';
      draft.name = attr('icon') ?? null;
      break;
  }

  // `isAnnotation` valida todo: tipos, rangos, colores, nombres de sello y estados de revisión.
  if (!isAnnotation(draft)) return null;
  // El color de un sello lo fija su nombre (`stampColor`), como al crearlo en la app.
  const annotation: Annotation = draft.type === 'stamp' ? { ...draft, color: stampColor(draft.name) } : draft;
  return { name, annotation };
}

/** `<contents>` o, si falta, `<contents-richtext>` en texto plano. */
function contentsOf(el: XmlElement): string {
  const plain = child(el, 'contents');
  if (plain !== undefined) return textOf(plain);
  const rich = child(el, 'contents-richtext');
  return rich === undefined ? '' : textOf(rich);
}

function textOfChild(el: XmlElement, name: string): string | undefined {
  const c = child(el, name);
  return c === undefined ? undefined : textOf(c);
}

/** `#RRGGBB` → `[r, g, b]` en [0, 1]; `null` si no tiene ese formato. */
function parseHexColor(s: string): number[] | null {
  if (!/^#[0-9A-Fa-f]{6}$/.test(s)) return null;
  return [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16) / 255);
}

/** Color de relleno: sin atributo → `null`; con atributo inválido → `undefined` (la validación lo rechaza). */
function parseInterior(s: string | undefined): number[] | null | undefined {
  if (s === undefined) return null;
  return parseHexColor(s) ?? undefined;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function parseNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  return NUMBER.test(t) ? Number(t) : null;
}

function parseInteger(s: string | undefined): number | null {
  if (s === undefined || !/^\d+$/.test(s.trim())) return null;
  return Number(s.trim());
}

/** Lista `a,b,c…` de números; `null` si alguno no lo es. */
function parseNumbers(s: string | undefined): number[] | null {
  if (s === undefined) return null;
  const out: number[] = [];
  for (const part of s.split(',')) {
    const v = parseNumber(part);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/** `coords`: 8 números por quad, en el orden de `Quad`. */
function parseCoords(s: string | undefined): number[][] | null {
  const flat = parseNumbers(s);
  if (flat === null || flat.length === 0 || flat.length % 8 !== 0) return null;
  const quads: number[][] = [];
  for (let i = 0; i < flat.length; i += 8) quads.push(flat.slice(i, i + 8));
  return quads;
}

/** Lista `x,y;x,y;…` → `[x0, y0, x1, y1, …]`; `null` si está vacía o mal formada. */
function parsePairs(s: string | undefined): number[] | null {
  if (s === undefined) return null;
  const out: number[] = [];
  for (const part of s.split(';')) {
    if (part.trim() === '') continue;
    const xy = parseNumbers(part);
    if (xy === null || xy.length !== 2) return null;
    out.push(...xy);
  }
  return out.length === 0 ? null : out;
}

function parseInkList(list: XmlElement | undefined): number[][] | null {
  if (list === undefined) return null;
  const paths: number[][] = [];
  for (const g of list.children) {
    if (g.kind !== 'element' || g.name !== 'gesture') continue;
    const path = parsePairs(textOf(g));
    if (path === null) return null;
    paths.push(path);
  }
  return paths;
}

function parseLinePoints(start: string | undefined, end: string | undefined): number[] | null {
  const a = parseNumbers(start);
  const b = parseNumbers(end);
  if (a === null || b === null || a.length !== 2 || b.length !== 2) return null;
  return [...a, ...b];
}

/** `/Helv <tamaño> Tf <r> <g> <b> rg` (tamaño y color del texto libre). */
const DEFAULT_APPEARANCE = /^\/Helv\s+(\S+)\s+Tf\s+(\S+)\s+(\S+)\s+(\S+)\s+rg$/;

function parseDefaultAppearance(el: XmlElement | undefined): { fontSize: number; textColor: number[] } | null {
  if (el === undefined) return null;
  const m = DEFAULT_APPEARANCE.exec(textOf(el).trim());
  if (m === null) return null;
  const fontSize = parseNumber(m[1]);
  const r = parseNumber(m[2]);
  const g = parseNumber(m[3]);
  const b = parseNumber(m[4]);
  if (fontSize === null || r === null || g === null || b === null) return null;
  return { fontSize, textColor: [r, g, b] };
}
