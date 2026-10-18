/**
 * Firmas guardadas para reutilizar (PDF-086) y conversión del trazo dibujado a `SignatureArt` (ADR-0020).
 * Puro: sin React, sin DOM. Las coordenadas del trazo llegan en píxeles del lienzo (origen arriba-izquierda).
 */
import { isSignatureArt, type SignatureArt } from '../annotations/model';

export interface StoredSignature {
  readonly id: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly art: SignatureArt;
}

/** Número máximo de firmas guardadas; al añadir una más se descarta la más antigua. */
export const MAX_STORED_SIGNATURES = 5;

/** Margen de la caja de un trazo, en píxeles, a cada lado. */
const INK_MARGIN = 2;

/** Validación de una lista de firmas guardadas (datos de la preferencia `signatures`). */
export function isStoredSignatures(v: unknown): v is readonly StoredSignature[] {
  return Array.isArray(v) && v.length <= MAX_STORED_SIGNATURES && v.every(isStoredSignature);
}

function isStoredSignature(v: unknown): v is StoredSignature {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const record: Record<string, unknown> = { ...v };
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.createdAt === 'string' &&
    !Number.isNaN(Date.parse(record.createdAt)) &&
    isSignatureArt(record.art)
  );
}

/** Añade `s` al principio de la lista; si pasa de `MAX_STORED_SIGNATURES`, quita la más antigua (la última). */
export function addStored(list: readonly StoredSignature[], s: StoredSignature): readonly StoredSignature[] {
  return [s, ...list].slice(0, MAX_STORED_SIGNATURES);
}

export function removeStored(list: readonly StoredSignature[], id: string): readonly StoredSignature[] {
  return list.filter((s) => s.id !== id);
}

/**
 * Normaliza trazos dibujados (px del lienzo, origen arriba-izquierda, `[x0, y0, ...]`) a `ink` con la caja ajustada
 * al trazo, un margen de 2 px y el eje Y hacia arriba. Solo cuentan los trazos de al menos 2 puntos.
 * `null` si no queda ninguno.
 */
export function inkArtFromStrokes(strokes: readonly (readonly number[])[], width: number): SignatureArt | null {
  const usable = strokes
    .map((s) => s.slice(0, Math.floor(s.length / 2) * 2))
    .filter((s) => s.length >= 4);
  if (usable.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of usable) {
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i] ?? 0;
      const y = s[i + 1] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const boxWidth = maxX - minX + 2 * INK_MARGIN;
  const boxHeight = maxY - minY + 2 * INK_MARGIN;

  const paths = usable.map((s) => {
    const out: number[] = [];
    for (let i = 0; i < s.length; i += 2) {
      out.push((s[i] ?? 0) - minX + INK_MARGIN, boxHeight - ((s[i + 1] ?? 0) - minY + INK_MARGIN));
    }
    return out;
  });
  return { kind: 'ink', paths, width, box: [boxWidth, boxHeight] };
}
