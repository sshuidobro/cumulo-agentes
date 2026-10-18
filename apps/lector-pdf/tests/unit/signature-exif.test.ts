import { describe, expect, it } from 'vitest';
import { jpegExifOrientation } from '../../src/core/signature/image-art';

/** Segmento APP1 «Exif» con una única etiqueta de orientación, en orden Intel (II) o Motorola (MM). */
function jpegWithOrientation(value: number, bigEndian: boolean): Uint8Array {
  const u16 = (v: number): number[] => (bigEndian ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8]);
  const u32 = (v: number): number[] =>
    bigEndian ? [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff] : [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
  const tiff = [
    ...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]),
    ...u16(0x2a),
    ...u32(8), // IFD0 justo tras la cabecera TIFF
    ...u16(1), // una entrada
    ...u16(0x0112), // etiqueta Orientation
    ...u16(3), // tipo SHORT
    ...u32(1), // un valor
    ...u16(value),
    ...u16(0), // relleno del valor de 4 bytes
    ...u32(0), // sin siguiente IFD
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = 2 + exif.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...exif, 0xff, 0xd9]);
}

/** JPEG sin EXIF: solo SOI, un APP0 y el marcador de fin. */
function jpegWithoutExif(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
}

describe('jpegExifOrientation', () => {
  it('lee la orientación de una cabecera en orden Intel', () => {
    expect(jpegExifOrientation(jpegWithOrientation(6, false))).toBe(6);
  });

  it('lee la orientación de una cabecera en orden Motorola', () => {
    expect(jpegExifOrientation(jpegWithOrientation(8, true))).toBe(8);
  });

  it('una orientación normal (1) o fuera de rango vale 1', () => {
    expect(jpegExifOrientation(jpegWithOrientation(1, false))).toBe(1);
    expect(jpegExifOrientation(jpegWithOrientation(9, true))).toBe(1);
  });

  it('un JPEG sin bloque EXIF vale 1', () => {
    expect(jpegExifOrientation(jpegWithoutExif())).toBe(1);
  });

  it('un fichero que no es JPEG vale 1', () => {
    expect(jpegExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
  });

  it('un bloque EXIF truncado no lanza y vale 1', () => {
    const full = jpegWithOrientation(6, false);
    for (let cut = 4; cut < full.length; cut++) {
      expect(() => jpegExifOrientation(full.slice(0, cut))).not.toThrow();
    }
    expect(jpegExifOrientation(full.slice(0, 20))).toBe(1);
  });
});
