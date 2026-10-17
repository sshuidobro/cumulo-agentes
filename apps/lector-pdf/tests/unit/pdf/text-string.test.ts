import { describe, expect, it } from 'vitest';
import { bytesString, type PdfString } from '../../../src/core/pdf/objects';
import { decodeTextString, encodeTextString, pdfDate } from '../../../src/core/pdf/text-string';
import { raw } from './helpers';

const PDFDOC_UNDEFINED = new Set([0x7f, 0x9f, 0xad]);

function bytesOf(p: PdfString): number[] {
  return Array.from(p.bytes);
}

describe('encodeTextString', () => {
  it('usa PDFDocEncoding sin BOM cuando todos los caracteres están en la tabla', () => {
    const p = encodeTextString('Comentario é €');
    expect(bytesOf(p)).toEqual([...Array.from('Comentario '.split('').map((c) => c.charCodeAt(0))), 0xe9, 0x20, 0xa0]);
    expect(p.hex).toBe(false);
  });

  it('usa UTF-16BE con BOM FE FF si hay caracteres fuera de PDFDocEncoding', () => {
    const p = encodeTextString('Привет');
    expect(bytesOf(p).slice(0, 2)).toEqual([0xfe, 0xff]);
    expect(p.bytes.length).toBe(2 + 6 * 2);
  });

  it('codifica el punto medio como 0x80', () => {
    expect(bytesOf(encodeTextString('•'))).toEqual([0x80]);
  });

  it('codifica caracteres astrales (emoji) en UTF-16BE con pares sustitutos', () => {
    expect(bytesOf(encodeTextString('😀'))).toEqual([0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00]);
  });

  it('la cadena vacía no tiene bytes', () => {
    expect(bytesOf(encodeTextString(''))).toEqual([]);
  });
});

describe('decodeTextString', () => {
  it('invierte encodeTextString para PDFDocEncoding y UTF-16BE', () => {
    for (const s of ['Comentario é €', 'Привет', '•', 'a\tb', '']) {
      expect(decodeTextString(encodeTextString(s))).toBe(s);
    }
  });

  it('lee UTF-16BE con BOM', () => {
    expect(decodeTextString(bytesString(raw([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69])))).toBe('Hi');
  });

  it('lee UTF-8 con BOM (PDF 2.0)', () => {
    expect(decodeTextString(bytesString(raw([0xef, 0xbb, 0xbf, 0xc3, 0xa9])))).toBe('é');
  });

  it('muestra U+FFFD para bytes no definidos en PDFDocEncoding', () => {
    expect(decodeTextString(bytesString(raw([0x41, 0x7f])))).toBe('A�');
  });

  it('una cadena UTF-16BE con un byte sobrante ignora ese byte', () => {
    expect(decodeTextString(bytesString(raw([0xfe, 0xff, 0x00, 0x41, 0x00])))).toBe('A');
  });
});

describe('tabla PDFDocEncoding (Anexo D)', () => {
  it('es biyectiva: cada byte definido decodifica a un carácter que vuelve a codificarse igual', () => {
    for (let b = 0; b < 256; b++) {
      if (PDFDOC_UNDEFINED.has(b)) continue;
      const s = decodeTextString(bytesString(raw([b])));
      expect(s).not.toBe('�');
      expect(bytesOf(encodeTextString(s))).toEqual([b]);
    }
  });

  it('conoce los caracteres de 0x18-0x1F y 0x80-0x9E', () => {
    expect(decodeTextString(bytesString(raw([0x18])))).toBe('˘');
    expect(decodeTextString(bytesString(raw([0x9e])))).toBe('ž');
    expect(decodeTextString(bytesString(raw([0x93])))).toBe('ﬁ');
    expect(decodeTextString(bytesString(raw([0xa0])))).toBe('€');
  });
});

describe('pdfDate', () => {
  it('convierte ISO 8601 a fecha PDF en UTC', () => {
    const p = pdfDate('2026-10-17T10:20:30.000Z');
    expect(Array.from(p.bytes, (b) => String.fromCharCode(b)).join('')).toBe('D:20261017102030Z');
  });

  it('lanza RangeError con una fecha no válida', () => {
    expect(() => pdfDate('no es una fecha')).toThrow(RangeError);
  });
});
