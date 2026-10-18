import type { Rotation } from './rotation';
import { MAX_ZOOM, MIN_ZOOM, type ZoomMode } from './zoom';

/**
 * Última posición de lectura de un documento. Solo datos de vista: nada que identifique el fichero
 * salvo su huella (que va como clave), y nunca nombre ni ruta.
 */
export interface ReadingPosition {
  /** Página 0-based, como `currentPage` del visor. */
  readonly page: number;
  /** Posición vertical dentro de la página, en [0, 1]. */
  readonly yFraction: number;
  readonly zoomMode: ZoomMode;
  readonly rotation: Rotation;
  /** Momento de la última escritura, en ms desde epoch. */
  readonly updatedAt: number;
}

/** Entradas por huella. La más reciente va al final. */
export interface PositionsState {
  readonly version: 1;
  readonly entries: readonly (readonly [string, ReadingPosition])[];
}

/** Número máximo de documentos recordados. */
export const MAX_POSITIONS = 500;

export function emptyPositions(): PositionsState {
  return { version: 1, entries: [] };
}

/** Valida la estructura completa de un estado leído de almacenamiento. Un valor corrupto no se usa. */
export function isPositionsState(v: unknown): v is PositionsState {
  if (!isRecord(v) || v.version !== 1 || !Array.isArray(v.entries)) return false;
  return v.entries.every(
    (entry: unknown) =>
      Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && isReadingPosition(entry[1]),
  );
}

/**
 * Recuerda la posición de un documento. Si ya existía, la entrada se mueve al final (sin duplicarse);
 * al pasar de `MAX_POSITIONS` se descartan las más antiguas. Solo se copian los campos de `ReadingPosition`.
 */
export function rememberPosition(s: PositionsState, fingerprint: string, pos: ReadingPosition): PositionsState {
  const stored: ReadingPosition = {
    page: pos.page,
    yFraction: pos.yFraction,
    zoomMode: copyZoomMode(pos.zoomMode),
    rotation: pos.rotation,
    updatedAt: pos.updatedAt,
  };
  const others = s.entries.filter(([key]) => key !== fingerprint);
  const entries = [...others, [fingerprint, stored] as const];
  return { version: 1, entries: entries.slice(Math.max(0, entries.length - MAX_POSITIONS)) };
}

/** Posición recordada de un documento, o `null` si no hay. */
export function lookupPosition(s: PositionsState, fingerprint: string): ReadingPosition | null {
  for (const [key, pos] of s.entries) {
    if (key === fingerprint) return pos;
  }
  return null;
}

function copyZoomMode(mode: ZoomMode): ZoomMode {
  return mode.kind === 'custom' ? { kind: 'custom', zoom: mode.zoom } : { kind: mode.kind };
}

function isReadingPosition(v: unknown): v is ReadingPosition {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.page) &&
    isFiniteNumber(v.yFraction) &&
    v.yFraction >= 0 &&
    v.yFraction <= 1 &&
    isZoomMode(v.zoomMode) &&
    isRotation(v.rotation) &&
    isFiniteNumber(v.updatedAt)
  );
}

function isZoomMode(v: unknown): v is ZoomMode {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'auto':
    case 'fit-width':
    case 'fit-page':
      return true;
    case 'custom':
      return isFiniteNumber(v.zoom) && v.zoom >= MIN_ZOOM && v.zoom <= MAX_ZOOM;
    default:
      return false;
  }
}

function isRotation(v: unknown): v is Rotation {
  return v === 0 || v === 90 || v === 180 || v === 270;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
