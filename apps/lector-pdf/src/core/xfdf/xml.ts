/**
 * Parser XML propio y acotado para XFDF (ADR-0030). Sin recursión (pila explícita), sin entidades externas
 * ni DOCTYPE, con límites de tamaño. Nunca lanza: los errores se devuelven como `Result`.
 */
import { err, ok, type Result } from '@suite/shared';
import { pdfError } from '../errors';

export interface XmlText {
  readonly kind: 'text';
  readonly text: string;
}

export interface XmlElement {
  readonly kind: 'element';
  /** Nombre local, sin prefijo de espacio de nombres (`xfdf:annots` → `annots`). */
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: readonly (XmlElement | XmlText)[];
}

export const MAX_XML_CHARS = 20_000_000;
export const MAX_XML_ELEMENTS = 200_000;

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const ATTR_EQ = /\s*=\s*/y;
const WS = /\s/;
const ENTITY_OK = /&(?!(?:#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);)/;
const ENTITY_ANY = /&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const PREDEFINED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

interface OpenFrame {
  readonly rawName: string;
  readonly name: string;
  readonly attrs: Map<string, string>;
  readonly children: (XmlElement | XmlText)[];
}

const INVALID = err(pdfError('xfdf-invalid'));

/** Raíz del documento. Errores → `xfdf-invalid`. Nunca lanza. */
export function parseXml(text: string): Result<XmlElement> {
  if (text.length > MAX_XML_CHARS) return INVALID;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: OpenFrame[] = [];
  let root: XmlElement | null = null;
  let elementCount = 0;

  while (pos < n) {
    const lt = text.indexOf('<', pos);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > pos) {
      const raw = text.slice(pos, textEnd);
      const top = stack[stack.length - 1];
      if (top === undefined) {
        if (raw.trim() !== '') return INVALID;
      } else {
        const decoded = decode(raw);
        if (decoded === null) return INVALID;
        top.children.push({ kind: 'text', text: decoded });
      }
    }
    if (lt === -1) break;
    pos = lt;

    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4);
      if (end === -1) return INVALID;
      pos = end + 3;
    } else if (text.startsWith('<![CDATA[', pos)) {
      const top = stack[stack.length - 1];
      const end = text.indexOf(']]>', pos + 9);
      if (top === undefined || end === -1) return INVALID;
      top.children.push({ kind: 'text', text: text.slice(pos + 9, end) });
      pos = end + 3;
    } else if (text.startsWith('<?', pos)) {
      const end = text.indexOf('?>', pos + 2);
      if (end === -1) return INVALID;
      pos = end + 2;
    } else if (text.startsWith('</', pos)) {
      const end = text.indexOf('>', pos);
      const top = stack.pop();
      if (end === -1 || top === undefined) return INVALID;
      if (text.slice(pos + 2, end).trimEnd() !== top.rawName) return INVALID;
      const el: XmlElement = { kind: 'element', name: top.name, attrs: top.attrs, children: top.children };
      const parent = stack[stack.length - 1];
      if (parent !== undefined) parent.children.push(el);
      else if (root === null) root = el;
      else return INVALID;
      pos = end + 1;
    } else if (text.charCodeAt(pos + 1) === 0x21 || text.charCodeAt(pos + 1) === 0x3f) {
      // `<!DOCTYPE`, `<!ENTITY` u otra declaración: no se admiten.
      return INVALID;
    } else {
      const opened = readOpenTag(text, pos);
      if (opened === null) return INVALID;
      elementCount += 1;
      if (elementCount > MAX_XML_ELEMENTS) return INVALID;
      pos = opened.next;
      if (opened.selfClosing) {
        const el: XmlElement = { kind: 'element', name: opened.name, attrs: opened.attrs, children: [] };
        const parent = stack[stack.length - 1];
        if (parent !== undefined) parent.children.push(el);
        else if (root === null) root = el;
        else return INVALID;
      } else {
        stack.push({ rawName: opened.rawName, name: opened.name, attrs: opened.attrs, children: [] });
      }
    }
  }

  if (stack.length !== 0 || root === null) return INVALID;
  return ok(root);
}

interface OpenTag {
  readonly rawName: string;
  readonly name: string;
  readonly attrs: Map<string, string>;
  readonly selfClosing: boolean;
  readonly next: number;
}

/** Lee `<nombre attr="v" ...>` o `/>` desde `start` (que apunta a `<`). Devuelve `null` si está mal formada. */
function readOpenTag(text: string, start: number): OpenTag | null {
  NAME.lastIndex = start + 1;
  const nameMatch = NAME.exec(text);
  if (nameMatch === null || nameMatch.index !== start + 1) return null;
  const rawName = nameMatch[0];
  const attrs = new Map<string, string>();
  let i = start + 1 + rawName.length;
  for (;;) {
    while (i < text.length && WS.test(text.charAt(i))) i += 1;
    const c = text.charAt(i);
    if (c === '>') return { rawName, name: localName(rawName), attrs, selfClosing: false, next: i + 1 };
    if (c === '/') {
      if (text.charAt(i + 1) !== '>') return null;
      return { rawName, name: localName(rawName), attrs, selfClosing: true, next: i + 2 };
    }
    NAME.lastIndex = i;
    const attr = NAME.exec(text);
    if (attr === null || attr.index !== i) return null;
    const attrName = attr[0];
    ATTR_EQ.lastIndex = i + attrName.length;
    const eq = ATTR_EQ.exec(text);
    if (eq === null || eq.index !== i + attrName.length) return null;
    const quote = text.charAt(ATTR_EQ.lastIndex);
    if (quote !== '"' && quote !== "'") return null;
    const valueStart = ATTR_EQ.lastIndex + 1;
    const valueEnd = text.indexOf(quote, valueStart);
    if (valueEnd === -1) return null;
    const raw = text.slice(valueStart, valueEnd);
    if (raw.includes('<') || attrs.has(attrName)) return null;
    const value = decode(raw);
    if (value === null) return null;
    attrs.set(attrName, value);
    i = valueEnd + 1;
    const after = text.charAt(i);
    if (after !== '>' && after !== '/' && !WS.test(after)) return null;
  }
}

function localName(rawName: string): string {
  return rawName.slice(rawName.indexOf(':') + 1);
}

/** Decodifica entidades predefinidas y referencias numéricas. `null` si hay una entidad desconocida o inválida. */
function decode(raw: string): string | null {
  if (!raw.includes('&')) return raw;
  if (ENTITY_OK.test(raw)) return null;
  let valid = true;
  const out = raw.replace(ENTITY_ANY, (_match, body: string) => {
    const predefined = PREDEFINED[body];
    if (predefined !== undefined) return predefined;
    const hex = body.startsWith('#x');
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!isXmlCodePoint(code)) {
      valid = false;
      return '';
    }
    return String.fromCodePoint(code);
  });
  return valid ? out : null;
}

function isXmlCodePoint(code: number): boolean {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return false;
  return code < 0xd800 || code > 0xdfff;
}

/** Escapa `& < > " '` para usarlo en texto y en valores de atributo. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Concatena el texto de todos los descendientes, en orden de documento. Sin recursión. */
export function textOf(e: XmlElement): string {
  const parts: string[] = [];
  const pending: (XmlElement | XmlText)[] = [e];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.kind === 'text') {
      parts.push(node.text);
    } else {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const c = node.children[i];
        if (c !== undefined) pending.push(c);
      }
    }
  }
  return parts.join('');
}

/** Primer hijo element con ese nombre local. */
export function child(e: XmlElement, name: string): XmlElement | undefined {
  for (const c of e.children) {
    if (c.kind === 'element' && c.name === name) return c;
  }
  return undefined;
}
