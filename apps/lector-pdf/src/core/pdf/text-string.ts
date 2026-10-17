/**
 * Cadenas de texto PDF (ISO 32000-1 §7.9.2): PDFDocEncoding o UTF-16BE con BOM `FE FF`
 * (y UTF-8 con BOM `EF BB BF`, PDF 2.0). Fechas (§7.9.4) con `pdf-date.ts`.
 */
import { toPdfDate } from '../pdf-date';
import { bytesString, type PdfString } from './objects';

const UNDEFINED = -1;

/**
 * PDFDocEncoding (ISO 32000-1 Anexo D, tabla D.2): código de byte → carácter Unicode.
 * 0x00-0x17, 0x20-0x7E y 0xA1-0xFF (salvo 0xA0 y 0xAD) siguen Latin-1; `-1` = no definido.
 */
const PDF_DOC_CHARS: readonly number[] = buildPdfDocTable();

function buildPdfDocTable(): number[] {
  const table: number[] = [];
  for (let b = 0; b < 256; b++) table.push(b);
  table[0x7f] = UNDEFINED;
  table[0x9f] = UNDEFINED;
  table[0xad] = UNDEFINED;
  const upper = [
    0x02d8, 0x02c7, 0x02c6, 0x02d9, 0x02dd, 0x02db, 0x02da, 0x02dc, // 0x18-0x1F
  ];
  upper.forEach((cp, i) => (table[0x18 + i] = cp));
  const middle = [
    0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x0192, 0x2044, // 0x80-0x87
    0x2039, 0x203a, 0x2212, 0x2030, 0x201e, 0x201c, 0x201d, 0x2018, // 0x88-0x8F
    0x2019, 0x201a, 0x2122, 0xfb01, 0xfb02, 0x0141, 0x0152, 0x0160, // 0x90-0x97
    0x0178, 0x017d, 0x0131, 0x0142, 0x0153, 0x0161, 0x017e, // 0x98-0x9E
  ];
  middle.forEach((cp, i) => (table[0x80 + i] = cp));
  table[0xa0] = 0x20ac;
  return table;
}

/** Carácter Unicode → byte de PDFDocEncoding. */
const PDF_DOC_BYTES: ReadonlyMap<number, number> = (() => {
  const map = new Map<number, number>();
  PDF_DOC_CHARS.forEach((cp, byte) => {
    if (cp !== UNDEFINED) map.set(cp, byte);
  });
  return map;
})();

const BOM_UTF16BE = [0xfe, 0xff];
const BOM_UTF8 = [0xef, 0xbb, 0xbf];

function hasBom(bytes: Uint8Array, bom: readonly number[]): boolean {
  return bom.every((b, i) => bytes[i] === b);
}

/** Texto → cadena PDF: PDFDocEncoding si cabe entero; si no, `FE FF` + UTF-16BE. */
export function encodeTextString(s: string): PdfString {
  const codes: number[] = [];
  let fits = true;
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i);
    const byte = PDF_DOC_BYTES.get(cp);
    if (byte === undefined) {
      fits = false;
      break;
    }
    codes.push(byte);
  }
  if (fits) return bytesString(Uint8Array.from(codes));

  const out = new Uint8Array(2 + s.length * 2);
  out.set(BOM_UTF16BE, 0);
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    out[2 + i * 2] = unit >> 8;
    out[3 + i * 2] = unit & 0xff;
  }
  return bytesString(out);
}

/** Cadena PDF → texto. Los bytes no definidos en PDFDocEncoding se muestran como U+FFFD. */
export function decodeTextString(p: PdfString): string {
  const { bytes } = p;
  if (hasBom(bytes, BOM_UTF16BE)) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    }
    return out;
  }
  if (hasBom(bytes, BOM_UTF8)) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  let out = '';
  for (const b of bytes) {
    const cp = PDF_DOC_CHARS[b] ?? UNDEFINED;
    out += String.fromCharCode(cp === UNDEFINED ? 0xfffd : cp);
  }
  return out;
}

/** ISO 8601 → cadena de fecha PDF `D:AAAAMMDDHHmmSSZ` (UTC). Lanza `RangeError` si la fecha no es válida. */
export function pdfDate(iso: string): PdfString {
  return bytesString(new TextEncoder().encode(toPdfDate(iso)));
}
