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
export type QpdfObjects = Readonly<Record<string, { readonly value?: QpdfJsonValue }>>;

function run(args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
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

/** `qpdf --check`: código de salida y salida combinada. */
export function qpdfCheck(path: string): { code: number; output: string } {
  const { status, stdout, stderr } = run(['--check', path]);
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

function isDict(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
