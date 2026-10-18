import { clampZoom, type ZoomMode } from './zoom';

/** Ajustes de un destino explícito del PDF (ISO 32000, 12.3.2.2). */
export type DestKind = 'XYZ' | 'Fit' | 'FitH' | 'FitV' | 'FitR' | 'FitB' | 'FitBH' | 'FitBV';

const DEST_KINDS: ReadonlySet<string> = new Set<string>(['XYZ', 'Fit', 'FitH', 'FitV', 'FitR', 'FitB', 'FitBH', 'FitBV']);

export interface ParsedDest {
  /** Referencia a la página tal como viene en el array (objeto `{ num, gen }` o entero). */
  readonly pageRef: unknown;
  readonly kind: DestKind;
  /** Coordenada horizontal en puntos PDF, o null si el destino no la fija. */
  readonly left: number | null;
  /** Coordenada vertical en puntos PDF, o null si el destino no la fija. */
  readonly top: number | null;
  /** Zoom del destino `XYZ` (0 o null: sin cambio), o null en los demás. */
  readonly zoom: number | null;
}

/**
 * Lee un destino explícito `[página, /Tipo, ...]`. Los campos numéricos que faltan o son `null` quedan en null;
 * cualquier otro valor no numérico, o un tipo desconocido, da `null` (destino no válido).
 *  - XYZ: `[ref, XYZ, left, top, zoom]`
 *  - FitH / FitBH: `[ref, k, top]`; FitV / FitBV: `[ref, k, left]`
 *  - FitR: `[ref, FitR, left, bottom, right, top]`
 */
export function parseExplicitDest(dest: readonly unknown[]): ParsedDest | null {
  const pageRef = dest[0];
  const kindName = dest[1];
  if (typeof kindName !== 'object' || kindName === null || !('name' in kindName)) return null;
  const name = kindName.name;
  if (typeof name !== 'string' || !DEST_KINDS.has(name)) return null;
  const kind = name as DestKind;

  const at = (index: number): number | null | undefined => {
    const value = dest[index];
    if (value === undefined || value === null) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  let left: number | null = null;
  let top: number | null = null;
  let zoom: number | null = null;
  switch (kind) {
    case 'XYZ': {
      const l = at(2);
      const t = at(3);
      const z = at(4);
      if (l === undefined || t === undefined || z === undefined) return null;
      left = l;
      top = t;
      zoom = z;
      break;
    }
    case 'FitH':
    case 'FitBH': {
      const t = at(2);
      if (t === undefined) return null;
      top = t;
      break;
    }
    case 'FitV':
    case 'FitBV': {
      const l = at(2);
      if (l === undefined) return null;
      left = l;
      break;
    }
    case 'FitR': {
      const l = at(2);
      const t = at(5);
      if (l === undefined || t === undefined) return null;
      left = l;
      top = t;
      break;
    }
    case 'Fit':
    case 'FitB':
      break;
  }
  return { pageRef, kind, left, top, zoom };
}

/**
 * Modo de zoom que pide un destino: `XYZ` con zoom positivo → zoom personalizado; `Fit`/`FitB` → ajustar página;
 * `FitH`/`FitBH` → ajustar ancho. El resto no cambia el zoom (null).
 */
export function destZoomMode(d: ParsedDest): ZoomMode | null {
  switch (d.kind) {
    case 'XYZ':
      return d.zoom !== null && d.zoom > 0 ? { kind: 'custom', zoom: clampZoom(d.zoom) } : null;
    case 'Fit':
    case 'FitB':
      return { kind: 'fit-page' };
    case 'FitH':
    case 'FitBH':
      return { kind: 'fit-width' };
    default:
      return null;
  }
}
