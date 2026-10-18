import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * Constructor mínimo de PDF para generar fixtures deterministas.
 * Solo sintaxis borrable (sin enum, namespace ni parámetros con propiedades): se ejecuta con `node`.
 *
 * Los objetos se guardan como texto o como trozos de bytes para no concatenar cadenas gigantes
 * (100 000 páginas). Las posiciones de la xref se calculan al final, en `build`.
 */

export type PdfVersion = '1.5' | '1.7';
export type XrefKind = 'table' | 'stream';

/** Objetos que no son streams por cada object stream (la ficha fija el tope en 100). */
const OBJECT_STREAM_CAPACITY = 100;
/** Bytes por entrada de la xref en stream con `/W [1 4 2]`. */
const XREF_ENTRY_BYTES = 7;

/** Caracteres WinAnsi fuera de ASCII que usan los textos de prueba. */
const WIN_ANSI_CODES: ReadonlyMap<string, number> = new Map([
  ['á', 0xe1], ['é', 0xe9], ['í', 0xed], ['ó', 0xf3], ['ú', 0xfa],
  ['Á', 0xc1], ['É', 0xc9], ['Í', 0xcd], ['Ó', 0xd3], ['Ú', 0xda],
  ['ñ', 0xf1], ['Ñ', 0xd1], ['ü', 0xfc], ['Ü', 0xdc],
  ['¿', 0xbf], ['¡', 0xa1], ['«', 0xab], ['»', 0xbb], ['€', 0x80], ['·', 0xb7],
]);

function latin1(text: string): Uint8Array {
  return Buffer.from(text, 'latin1');
}

function headerBytes(version: PdfVersion): Uint8Array {
  return latin1(`%PDF-${version}\n%\xE2\xE3\xCF\xD3\n`);
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

type Entry =
  | { readonly kind: 'object'; readonly body: string }
  | { readonly kind: 'stream'; readonly dict: string; readonly payload: Uint8Array };

export interface BuildOptions {
  readonly root: number;
  readonly info?: number;
  /** `table`: xref clásica y trailer (por defecto). `stream`: objeto `/Type /XRef`, sin comprimir. */
  readonly xref?: XrefKind;
  /** Mete los objetos que no son streams en object streams comprimidos. Requiere `xref: 'stream'`. */
  readonly objectStreams?: boolean;
  /** Versión de la cabecera; por defecto 1.7. */
  readonly version?: PdfVersion;
}

export class PdfBuilder {
  private allocated = 0;
  /** Contenido de cada objeto reservado, por número. */
  private readonly entries = new Map<number, Entry>();

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
    this.entries.set(num, { kind: 'object', body });
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
    this.entries.set(num, { kind: 'stream', dict: withDictEntries(dict, entries), payload });
    return num;
  }

  /**
   * Serializa el PDF. Falla si hay números reservados sin contenido
   * (es un error del generador, no del usuario).
   */
  build(opts: BuildOptions): Uint8Array {
    const count = this.allocated;
    if (opts.root < 1 || opts.root > count) {
      throw new Error(`Raíz ${opts.root} no reservada`);
    }
    if (opts.info !== undefined && (opts.info < 1 || opts.info > count)) {
      throw new Error(`Info ${opts.info} no reservado`);
    }
    const xref = opts.xref ?? 'table';
    const objectStreams = opts.objectStreams === true;
    if (objectStreams && xref !== 'stream') {
      throw new Error('Los object streams requieren xref en stream');
    }

    const entryOf = (num: number): Entry => {
      const entry = this.entries.get(num);
      if (entry === undefined) {
        throw new Error(`El objeto ${num} está reservado pero no tiene contenido`);
      }
      return entry;
    };
    for (let num = 1; num <= count; num++) {
      entryOf(num);
    }

    // Agrupación en object streams: solo los objetos que no son streams, en bloques de 100.
    const groups: { readonly stream: number; readonly members: readonly number[] }[] = [];
    const memberOf = new Map<number, { readonly stream: number; readonly index: number }>();
    let nextNumber = count + 1;
    if (objectStreams) {
      let members: number[] = [];
      const flush = (): void => {
        if (members.length === 0) {
          return;
        }
        const stream = nextNumber;
        nextNumber += 1;
        members.forEach((num, index) => memberOf.set(num, { stream, index }));
        groups.push({ stream, members });
        members = [];
      };
      for (let num = 1; num <= count; num++) {
        if (entryOf(num).kind === 'object') {
          members.push(num);
          if (members.length === OBJECT_STREAM_CAPACITY) {
            flush();
          }
        }
      }
      flush();
    }

    const head = headerBytes(opts.version ?? '1.7');
    const parts: Uint8Array[] = [head];
    let offset = head.byteLength;
    const write = (bytes: Uint8Array): void => {
      parts.push(bytes);
      offset += bytes.byteLength;
    };
    const offsets = new Map<number, number>();

    for (let num = 1; num <= count; num++) {
      if (memberOf.has(num)) {
        continue;
      }
      offsets.set(num, offset);
      const entry = entryOf(num);
      if (entry.kind === 'object') {
        write(latin1(`${num} 0 obj\n${entry.body}\nendobj\n`));
      } else {
        write(latin1(`${num} 0 obj\n${entry.dict}\nstream\n`));
        write(entry.payload);
        write(latin1('\nendstream\nendobj\n'));
      }
    }

    for (const group of groups) {
      offsets.set(group.stream, offset);
      const bodies: string[] = [];
      const pairs: string[] = [];
      let relative = 0;
      for (const num of group.members) {
        const entry = entryOf(num);
        if (entry.kind !== 'object') {
          throw new Error(`El objeto ${num} es un stream y no puede ir en un object stream`);
        }
        pairs.push(`${num} ${relative}`);
        bodies.push(entry.body);
        relative += entry.body.length + 1;
      }
      const header = `${pairs.join(' ')}\n`;
      const data = deflateSync(latin1(header + bodies.join('\n')));
      write(latin1(
        `${group.stream} 0 obj\n<< /Type /ObjStm /N ${group.members.length} /First ${header.length} ` +
          `/Filter /FlateDecode /Length ${data.byteLength} >>\nstream\n`,
      ));
      write(data);
      write(latin1('\nendstream\nendobj\n'));
    }

    const offsetOf = (num: number): number => {
      const at = offsets.get(num);
      if (at === undefined) {
        throw new Error(`Objeto ${num} sin posición`);
      }
      return at;
    };

    // /ID determinista: MD5 (16 bytes) de todo lo escrito hasta aquí, repetido en las dos mitades.
    const digest = createHash('md5');
    for (const part of parts) {
      digest.update(part);
    }
    const hex = digest.digest('hex');
    const infoEntry = opts.info === undefined ? '' : ` /Info ${opts.info} 0 R`;
    const trailerEntries = `/Root ${opts.root} 0 R${infoEntry} /ID [<${hex}> <${hex}>]`;

    if (xref === 'table') {
      const xrefOffset = offset;
      const size = count + 1;
      const lines: string[] = [`xref\n0 ${size}\n0000000000 65535 f\r\n`];
      for (let num = 1; num < size; num++) {
        lines.push(`${String(offsetOf(num)).padStart(10, '0')} 00000 n\r\n`);
      }
      lines.push(`trailer\n<< /Size ${size} ${trailerEntries} >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
      write(latin1(lines.join('')));
    } else {
      const xrefNum = nextNumber;
      const size = xrefNum + 1;
      const xrefOffset = offset;
      const data = new Uint8Array(size * XREF_ENTRY_BYTES);
      const view = new DataView(data.buffer);
      const setEntry = (num: number, type: number, field2: number, field3: number): void => {
        const at = num * XREF_ENTRY_BYTES;
        view.setUint8(at, type);
        view.setUint32(at + 1, field2);
        view.setUint16(at + 5, field3);
      };
      for (let num = 0; num < size; num++) {
        const member = memberOf.get(num);
        if (num === 0) {
          setEntry(0, 0, 0, 65535);
        } else if (num === xrefNum) {
          setEntry(num, 1, xrefOffset, 0);
        } else if (member !== undefined) {
          setEntry(num, 2, member.stream, member.index);
        } else {
          setEntry(num, 1, offsetOf(num), 0);
        }
      }
      const dict = `<< /Type /XRef /Size ${size} /Index [0 ${size}] /W [1 4 2] ${trailerEntries} /Length ${data.byteLength} >>`;
      write(latin1(`${xrefNum} 0 obj\n${dict}\nstream\n`));
      write(data);
      write(latin1(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`));
    }

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

export interface TrailerInfo {
  readonly size: number;
  readonly root: number;
  /** Desplazamiento de la última xref (valor del último `startxref`). */
  readonly startxref: number;
}

/**
 * Lee `/Size`, `/Root` y el último `startxref` del PDF. Sirve para xref clásica y para xref en stream
 * siempre que el diccionario de trailer/xref contenga esas claves (es el caso de nuestro generador).
 */
export function readTrailer(text: string): TrailerInfo {
  const starts = [...text.matchAll(/startxref\s+(\d+)/g)];
  const last = starts.at(-1);
  if (last === undefined || last[1] === undefined) {
    throw new Error('El PDF no tiene startxref');
  }
  const startxref = Number.parseInt(last[1], 10);
  const section = text.slice(startxref, last.index);
  const size = /\/Size (\d+)/.exec(section)?.[1];
  const root = /\/Root (\d+) 0 R/.exec(section)?.[1];
  if (size === undefined || root === undefined) {
    throw new Error('No se encuentran /Size o /Root en el último trailer');
  }
  return { size: Number.parseInt(size, 10), root: Number.parseInt(root, 10), startxref };
}

/**
 * Anexa una actualización incremental (ISO 32000-1, §7.5.6): los objetos `N 0 obj ... endobj`,
 * una xref con subsecciones contiguas y un trailer con `/Size`, `/Root`, `/Prev` y `trailerExtra`
 * (p. ej. `/Info 16 0 R`). `/Size` es el máximo entre el del trailer anterior y el mayor número + 1,
 * para no reducir la tabla al añadir objetos.
 */
export function appendIncrementalUpdate(
  base: Uint8Array,
  objects: ReadonlyMap<number, string>,
  trailerExtra?: string,
): Uint8Array {
  const sorted = [...objects.entries()].sort(([a], [b]) => a - b);
  if (sorted.length === 0) {
    throw new Error('La actualización no tiene objetos');
  }
  for (const [num] of sorted) {
    if (!Number.isInteger(num) || num < 1) {
      throw new Error(`Número de objeto no válido: ${num}`);
    }
  }

  const text = Buffer.from(base).toString('latin1');
  const previous = readTrailer(text);
  const largest = sorted.at(-1)?.[0] ?? 0;
  const size = Math.max(previous.size, largest + 1);

  let out = /\n$/.test(text) ? '' : '\n';
  const offsets = new Map<number, number>();
  for (const [num, body] of sorted) {
    offsets.set(num, base.byteLength + out.length);
    out += `${num} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = base.byteLength + out.length;
  out += 'xref\n';
  const runs: { start: number; count: number; nums: number[] }[] = [];
  for (const [num] of sorted) {
    const run = runs.at(-1);
    if (run !== undefined && run.start + run.count === num) {
      run.count += 1;
      run.nums.push(num);
    } else {
      runs.push({ start: num, count: 1, nums: [num] });
    }
  }
  for (const run of runs) {
    out += `${run.start} ${run.count}\n`;
    for (const num of run.nums) {
      out += `${String(offsets.get(num)).padStart(10, '0')} 00000 n\r\n`;
    }
  }

  const extra = trailerExtra === undefined ? '' : ` ${trailerExtra}`;
  out += `trailer\n<< /Size ${size} /Root ${previous.root} 0 R /Prev ${previous.startxref}${extra} >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;

  const tail = latin1(out);
  const result = new Uint8Array(base.byteLength + tail.byteLength);
  result.set(base, 0);
  result.set(tail, base.byteLength);
  return result;
}
