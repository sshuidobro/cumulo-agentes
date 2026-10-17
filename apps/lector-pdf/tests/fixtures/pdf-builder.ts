import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

/**
 * Constructor mínimo de PDF 1.7 para generar fixtures deterministas.
 * Solo sintaxis borrable (sin enum, namespace ni parámetros con propiedades): se ejecuta con `node`.
 *
 * Los objetos se guardan como trozos de bytes para no concatenar cadenas gigantes
 * (100 000 páginas). Las posiciones de la xref se calculan al final, en `build`.
 */

const HEADER_BYTES = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1');

/** Caracteres WinAnsi fuera de ASCII que usan los textos de prueba. */
const WIN_ANSI_CODES: ReadonlyMap<string, number> = new Map([
  ['á', 0xe1], ['é', 0xe9], ['í', 0xed], ['ó', 0xf3], ['ú', 0xfa],
  ['Á', 0xc1], ['É', 0xc9], ['Í', 0xcd], ['Ó', 0xd3], ['Ú', 0xda],
  ['ñ', 0xf1], ['Ñ', 0xd1], ['ü', 0xfc], ['Ü', 0xdc],
  ['¿', 0xbf], ['¡', 0xa1], ['«', 0xab], ['»', 0xbb], ['€', 0x80],
]);

function latin1(text: string): Uint8Array {
  return Buffer.from(text, 'latin1');
}

/** Inserta entradas antes del `>>` final de un diccionario `<< ... >>`. */
function withDictEntries(dict: string, entries: string): string {
  const trimmed = dict.trim();
  if (!trimmed.startsWith('<<') || !trimmed.endsWith('>>')) {
    throw new Error(`Diccionario mal formado: ${dict}`);
  }
  const inner = trimmed.slice(2, -2).trim();
  return inner.length > 0 ? `<< ${inner} ${entries} >>` : `<< ${entries} >>`;
}

export class PdfBuilder {
  private allocated = 0;
  /** Trozos de bytes de cada objeto, indexados por número (índice 0 sin uso). */
  private readonly chunks: (Uint8Array[] | undefined)[] = [];

  /** Reserva el siguiente número de objeto (empieza en 1). */
  alloc(): number {
    this.allocated += 1;
    return this.allocated;
  }

  /** Define el contenido de un objeto reservado. `body` es el texto entre `N 0 obj` y `endobj`. */
  setObject(num: number, body: string): void {
    if (!Number.isInteger(num) || num < 1 || num > this.allocated) {
      throw new Error(`Objeto ${num} no reservado`);
    }
    this.chunks[num] = [latin1(`${num} 0 obj\n${body}\nendobj\n`)];
  }

  /** Reserva un número y define su contenido. */
  addObject(body: string): number {
    const num = this.alloc();
    this.setObject(num, body);
    return num;
  }

  /**
   * Añade un stream. `dict` es un diccionario completo (`<< ... >>`) sin `/Length` ni `/Filter`;
   * ambos se añaden aquí. Con `compress`, el contenido se comprime con FlateDecode.
   */
  addStream(dict: string, data: Uint8Array | string, opts: { readonly compress?: boolean } = {}): number {
    const num = this.alloc();
    const raw = typeof data === 'string' ? latin1(data) : data;
    const payload = opts.compress === true ? deflateSync(raw) : raw;
    const filter = opts.compress === true ? ' /Filter /FlateDecode' : '';
    const entries = `/Length ${payload.byteLength}${filter}`;
    const head = `${num} 0 obj\n${withDictEntries(dict, entries)}\nstream\n`;
    this.chunks[num] = [latin1(head), payload, latin1('\nendstream\nendobj\n')];
    return num;
  }

  /**
   * Serializa el PDF con xref clásica. Falla si hay números reservados sin contenido
   * (es un error del generador, no del usuario).
   */
  build(opts: { readonly root: number; readonly info?: number }): Uint8Array {
    if (opts.root < 1 || opts.root > this.allocated) {
      throw new Error(`Raíz ${opts.root} no reservada`);
    }
    const size = this.allocated + 1;
    const parts: Uint8Array[] = [HEADER_BYTES];
    const offsets: number[] = new Array<number>(size).fill(0);
    let offset = HEADER_BYTES.byteLength;

    for (let num = 1; num < size; num++) {
      const objectParts = this.chunks[num];
      if (objectParts === undefined) {
        throw new Error(`El objeto ${num} está reservado pero no tiene contenido`);
      }
      offsets[num] = offset;
      for (const part of objectParts) {
        parts.push(part);
        offset += part.byteLength;
      }
    }

    const xrefOffset = offset;
    const xrefLines: string[] = [`xref\n0 ${size}\n0000000000 65535 f\r\n`];
    for (let num = 1; num < size; num++) {
      xrefLines.push(`${String(offsets[num]).padStart(10, '0')} 00000 n\r\n`);
    }
    const infoEntry = opts.info === undefined ? '' : ` /Info ${opts.info} 0 R`;
    xrefLines.push(
      `trailer\n<< /Size ${size} /Root ${opts.root} 0 R${infoEntry} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );
    parts.push(latin1(xrefLines.join('')));

    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
      out.set(part, pos);
      pos += part.byteLength;
    }
    return out;
  }
}

/**
 * Literal PDF en WinAnsi: `(texto)`. Escapa `( ) \`, codifica los acentos habituales en octal
 * (€ = `\200`) y sustituye cualquier otro carácter no ASCII por `?`.
 */
export function winAnsi(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const mapped = WIN_ANSI_CODES.get(ch);
    if (mapped !== undefined) {
      out += `\\${mapped.toString(8).padStart(3, '0')}`;
    } else if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
    } else if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else {
      out += '?';
    }
  }
  return `${out})`;
}

/** Contenido de una página con varias líneas de texto Helvetica 18 pt, desde (72, 720). */
export function textPage(lines: readonly string[]): string {
  const shown = lines.map((line, index) => {
    const op = `${winAnsi(line)} Tj`;
    return index === 0 ? op : `T* ${op}`;
  });
  return ['BT /F1 18 Tf 72 720 Td 22 TL', ...shown, 'ET'].join(' ');
}

export interface PageTree {
  readonly root: number;
  readonly pageRefs: readonly number[];
  readonly parentOf: (pageIndex: number) => number;
}

/**
 * Árbol de páginas equilibrado: cada nodo `/Pages` tiene como mucho `fanout` hijos.
 * Reserva los números de las páginas y de los nodos, escribe los nodos y devuelve
 * la raíz. Quien llama escribe cada `/Page` con `/Parent parentOf(i)`.
 */
export function buildPageTree(b: PdfBuilder, pageCount: number, fanout = 32): PageTree {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`Número de páginas no válido: ${pageCount}`);
  }
  if (!Number.isInteger(fanout) || fanout < 2) {
    throw new Error(`Fanout no válido: ${fanout}`);
  }

  const pageRefs: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageRefs.push(b.alloc());
  }

  const parentByChild = new Map<number, number>();
  const nodes: { readonly num: number; readonly kids: readonly number[]; readonly count: number }[] = [];

  // Escribe los nodos (ya se conocen todos sus padres) y devuelve el árbol con la raíz dada.
  const finish = (root: number): PageTree => {
    for (const node of nodes) {
      const kids = node.kids.map((kid) => `${kid} 0 R`).join(' ');
      const parent = parentByChild.get(node.num);
      const parentEntry = parent === undefined ? '' : ` /Parent ${parent} 0 R`;
      b.setObject(node.num, `<< /Type /Pages /Kids [${kids}] /Count ${node.count}${parentEntry} >>`);
    }
    return {
      root,
      pageRefs,
      parentOf: (pageIndex: number): number => {
        const pageNum = pageRefs[pageIndex];
        const parent = pageNum === undefined ? undefined : parentByChild.get(pageNum);
        if (parent === undefined) {
          throw new Error(`Página sin padre: índice ${pageIndex}`);
        }
        return parent;
      },
    };
  };

  let level: { readonly num: number; readonly count: number }[] = pageRefs.map((num) => ({ num, count: 1 }));
  for (;;) {
    const next: { readonly num: number; readonly count: number }[] = [];
    for (let start = 0; start < level.length; start += fanout) {
      const group = level.slice(start, start + fanout);
      const num = b.alloc();
      const count = group.reduce((sum, child) => sum + child.count, 0);
      for (const child of group) {
        parentByChild.set(child.num, num);
      }
      nodes.push({ num, kids: group.map((child) => child.num), count });
      next.push({ num, count });
    }
    const only = next.length === 1 ? next[0] : undefined;
    if (only !== undefined) {
      return finish(only.num);
    }
    level = next;
  }
}
