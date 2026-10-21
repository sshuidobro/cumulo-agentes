/**
 * Geometría y validez para la firma digital visible (PDF-139). Funciones puras: sin DOM, sin Worker, sin reloj
 * implícito (la hora se pasa como argumento).
 */
import type { RectPt } from '../../annotations/model';
import type { CertificateInfo } from './p12';

/** Tamaño mínimo, en puntos, de un recuadro de firma visible dibujado con el ratón. */
export const MIN_SIGNATURE_BOX_PT = { width: 60, height: 20 } as const;

/** Tamaño del recuadro que coloca la tecla Intro, centrado en la página actual. */
export const KEYBOARD_SIGNATURE_BOX_PT = { width: 200, height: 60 } as const;

/** Estado de validez de un certificado respecto a una hora dada. */
export type CertificateValidity = 'valid' | 'not-yet-valid' | 'expired' | 'unreadable';

/** Un recuadro sirve si cabe el tamaño mínimo (en ambos sentidos). */
export function isLargeEnoughBox(rect: RectPt): boolean {
  const width = Math.abs(rect[2] - rect[0]);
  const height = Math.abs(rect[3] - rect[1]);
  return width >= MIN_SIGNATURE_BOX_PT.width && height >= MIN_SIGNATURE_BOX_PT.height;
}

/**
 * Recuadro de `KEYBOARD_SIGNATURE_BOX_PT` centrado en una página de `pageWidth` × `pageHeight` puntos, en el espacio
 * del PDF (origen abajo a la izquierda).
 */
export function centeredSignatureBox(pageWidth: number, pageHeight: number): RectPt {
  const cx = pageWidth / 2;
  const cy = pageHeight / 2;
  const halfWidth = KEYBOARD_SIGNATURE_BOX_PT.width / 2;
  const halfHeight = KEYBOARD_SIGNATURE_BOX_PT.height / 2;
  return [cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight];
}

/**
 * Si el certificado vale en el instante `nowMs` (milisegundos desde la época). Las fechas son ISO 8601; si alguna no
 * se lee, `unreadable`. Los límites se incluyen: en `validFrom` y `validTo` exactos el certificado vale.
 */
export function certificateValidity(info: CertificateInfo, nowMs: number): CertificateValidity {
  const from = Date.parse(info.validFrom);
  const to = Date.parse(info.validTo);
  if (Number.isNaN(from) || Number.isNaN(to)) return 'unreadable';
  if (nowMs < from) return 'not-yet-valid';
  if (nowMs > to) return 'expired';
  return 'valid';
}
