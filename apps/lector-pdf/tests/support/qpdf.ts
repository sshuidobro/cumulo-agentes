/**
 * Envoltorio de `qpdf` (herramienta de desarrollo, PDF-029) para validar los PDF que escribe la app con un
 * lector independiente. Si `qpdf` no está en el PATH, las funciones lanzan un error con la instrucción de
 * instalación: los tests que las usan fallan, nunca se saltan.
 */
import { spawnSync } from 'node:child_process';

const INSTALL_HINT = 'Instala qpdf: apt-get install -y qpdf';
/** El JSON de un documento grande puede superar el búfer por defecto de `spawnSync` (1 MB). */
const MAX_BUFFER = 512 * 1024 * 1024;

export interface QpdfCheckResult {
  /** 0 sin errores ni avisos, 3 con avisos, 2 con errores. */
  readonly code: number;
  readonly output: string;
}

export interface QpdfAnnotation {
  /** Referencia del objeto, `"<num> <gen> R"`. */
  readonly ref: string;
  /** Subtipo sin barra (`Highlight`, `Text`...). */
  readonly subtype: string;
  /** Claves del diccionario con barra (`/Type`, `/Rect`...). */
  readonly keys: string[];
}

type QpdfJsonValue = unknown;
export type QpdfObjects = Readonly<Record<string, { readonly value?: QpdfJsonValue; readonly stream?: { dict?: unknown } }>>;

/** Ejecuta `qpdf` con `args`; lanza con la instrucción de instalación si no está en el PATH. */
export function run(args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync('qpdf', [...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(INSTALL_HINT);
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Versión de qpdf instalada, p. ej. `11.9.0`, para anotarla en el Registro. */
export function qpdfVersion(): string {
  const { stdout } = run(['--version']);
  const match = /version (\S+)/.exec(stdout);
  return match?.[1] ?? stdout.trim();
}

/** `qpdf --check`: código de salida y salida combinada. `password` abre un PDF con contraseña de usuario (PDF-047). */
export function qpdfCheck(path: string, password?: string): { code: number; output: string } {
  const args = password === undefined ? [] : [`--password=${password}`];
  const { status, stdout, stderr } = run(['--check', ...args, path]);
  return { code: status ?? -1, output: `${stdout}${stderr}` };
}

/** Objetos del fichero según `qpdf --json=2` (`qpdf[1]`): `"obj:N G R"` → `{ value }`. */
export function qpdfObjects(path: string): QpdfObjects {
  const { status, stdout, stderr } = run(['--json=2', path]);
  if (status !== 0) throw new Error(`qpdf --json=2 falló con código ${String(status)}: ${stderr}`);
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== 'object' || parsed === null || !('qpdf' in parsed) || !Array.isArray(parsed.qpdf)) {
    throw new Error('Salida de qpdf --json=2 inesperada');
  }
  const objects = parsed.qpdf[1];
  if (typeof objects !== 'object' || objects === null) throw new Error('Salida de qpdf --json=2 sin objetos');
  return objects as QpdfObjects;
}

/** Diccionarios `/Type /Annot` del fichero: referencia, subtipo y claves. */
export function qpdfAnnotations(path: string): QpdfAnnotation[] {
  const out: QpdfAnnotation[] = [];
  for (const [key, object] of Object.entries(qpdfObjects(path))) {
    const value = object.value;
    if (!isDict(value) || value['/Type'] !== '/Annot') continue;
    const subtype = typeof value['/Subtype'] === 'string' ? value['/Subtype'].replace(/^\//, '') : '';
    out.push({ ref: key.replace(/^obj:/, ''), subtype, keys: Object.keys(value) });
  }
  return out;
}

/**
 * `/BaseFont` (sin prefijo «XXXXXX+», sin repetir, orden `localeCompare('es')`) de las fuentes de `/Resources /Font`
 * de todas las páginas (con herencia desde `/Pages`) y de los Form XObject de primer nivel de esas `/Resources`.
 * Es el oráculo independiente de `scanFonts`: no incluye `/AcroForm /DR`, que no es un recurso de las páginas.
 */
export function qpdfPageFontNames(path: string): string[] {
  const objs = qpdfObjects(path);
  const trailer = objs['trailer']?.value;
  if (!isDict(trailer)) throw new Error('qpdf --json=2 sin trailer: no se pueden leer las fuentes de las páginas');
  const names = new Set<string>();
  const visited = new Set<unknown>();

  const addFonts = (res: Dict | undefined): void => {
    for (const f of itemsOf(dictOf(deref(objs, res?.['/Font'])))) {
      const base = dictOf(deref(objs, f))?.['/BaseFont'];
      if (typeof base === 'string') names.add(base.replace(/^\//, '').replace(/^[A-Z]{6}\+/, ''));
    }
  };

  const visit = (node: Dict | undefined, inherited: Dict | undefined): void => {
    if (node === undefined || visited.has(node)) return;
    visited.add(node);
    const res = dictOf(deref(objs, node['/Resources'])) ?? inherited;
    if (node['/Type'] === '/Pages') {
      for (const kid of itemsOf(deref(objs, node['/Kids']))) visit(dictOf(deref(objs, kid)), res);
      return;
    }
    addFonts(res);
    for (const xo of itemsOf(dictOf(deref(objs, res?.['/XObject'])))) {
      const x = dictOf(deref(objs, xo));
      if (x?.['/Subtype'] === '/Form') addFonts(dictOf(deref(objs, x['/Resources'])));
    }
  };

  const root = dictOf(deref(objs, trailer['/Root']));
  visit(dictOf(deref(objs, root?.['/Pages'])), undefined);
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
}

type Dict = Readonly<Record<string, unknown>>;

/** Resuelve una referencia `"N G R"` al cuerpo del objeto (diccionario de un stream incluido). */
function deref(objs: QpdfObjects, v: unknown): unknown {
  if (typeof v !== 'string' || !/^\d+ \d+ R$/.test(v)) return v;
  const object = objs[`obj:${v}`];
  return object?.value ?? object?.stream?.dict;
}

function dictOf(v: unknown): Dict | undefined {
  return isDict(v) ? v : undefined;
}

function itemsOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return isDict(v) ? Object.values(v) : [];
}

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
