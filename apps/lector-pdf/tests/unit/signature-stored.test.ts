import { inflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { SignatureArt } from '../../src/core/annotations/model';
import { fitWidth, isJpegBytes, jpegArt, keepsJpeg, MAX_SIGNATURE_IMAGE_WIDTH, rgbaArt } from '../../src/core/signature/image-art';
import {
  addStored,
  inkArtFromStrokes,
  isStoredSignatures,
  MAX_STORED_SIGNATURES,
  removeStored,
  type StoredSignature,
} from '../../src/core/signature/stored';
import { inkThumbnailUrl, signatureThumbnailUrl } from '../../src/ui/signature/thumbnail';

const INK: Extract<SignatureArt, { readonly kind: 'ink' }> = { kind: 'ink', paths: [[2, 32, 42, 2]], width: 2, box: [44, 34] };
const IMAGE: SignatureArt = { kind: 'image', format: 'jpeg', data: 'AAAA', pixelWidth: 10, pixelHeight: 5 };

function stored(id: string, art: SignatureArt = INK): StoredSignature {
  return { id, createdAt: '2026-10-18T10:00:00.000Z', art };
}

describe('inkArtFromStrokes', () => {
  it('ajusta la caja al trazo con margen de 2 px y da la vuelta al eje Y', () => {
    expect(inkArtFromStrokes([[10, 10, 50, 40]], 2)).toEqual({
      kind: 'ink',
      paths: [[2, 32, 42, 2]],
      width: 2,
      box: [44, 34],
    });
  });

  it('devuelve null sin trazos o con trazos de un solo punto', () => {
    expect(inkArtFromStrokes([], 2)).toBeNull();
    expect(inkArtFromStrokes([[5, 5]], 2)).toBeNull();
    expect(inkArtFromStrokes([[]], 2)).toBeNull();
  });

  it('ignora los trazos de un punto y conserva los demás', () => {
    const art = inkArtFromStrokes([[99, 99], [10, 10, 20, 10]], 2);
    expect(art).toEqual({ kind: 'ink', paths: [[2, 2, 12, 2]], width: 2, box: [14, 4] });
  });

  it('une varios trazos en una sola caja común', () => {
    const art = inkArtFromStrokes([[0, 0, 10, 0], [0, 20, 10, 20]], 2);
    expect(art?.kind === 'ink' ? art.box : null).toEqual([14, 24]);
  });
});

describe('lista de firmas guardadas', () => {
  it('addStored pone la firma nueva al principio', () => {
    const list = addStored([stored('a')], stored('b'));
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('addStored con 5 guardadas añade la nueva y quita la más antigua', () => {
    const full = ['1', '2', '3', '4', '5'].map((id) => stored(id));
    const list = addStored(full, stored('6'));
    expect(list).toHaveLength(MAX_STORED_SIGNATURES);
    expect(list.map((s) => s.id)).toEqual(['6', '1', '2', '3', '4']);
  });

  it('removeStored quita solo la firma indicada y no cambia la lista original', () => {
    const list = [stored('a'), stored('b')];
    expect(removeStored(list, 'a').map((s) => s.id)).toEqual(['b']);
    expect(list).toHaveLength(2);
    expect(removeStored(list, 'zz')).toHaveLength(2);
  });

  it('isStoredSignatures acepta una lista válida, también vacía', () => {
    expect(isStoredSignatures([])).toBe(true);
    expect(isStoredSignatures([stored('a'), stored('b', IMAGE)])).toBe(true);
  });

  it('isStoredSignatures rechaza un art inválido, más de 5 firmas y datos que no son lista', () => {
    expect(isStoredSignatures([{ id: 'a', createdAt: '2026-10-18T10:00:00.000Z', art: { kind: 'ink' } }])).toBe(false);
    expect(isStoredSignatures([{ id: 'a', createdAt: '2026-10-18T10:00:00.000Z', art: { ...IMAGE, format: 'png' } }])).toBe(false);
    expect(isStoredSignatures([{ id: '', createdAt: '2026-10-18T10:00:00.000Z', art: INK }])).toBe(false);
    expect(isStoredSignatures([{ id: 'a', createdAt: 'ayer', art: INK }])).toBe(false);
    expect(isStoredSignatures(['1', '2', '3', '4', '5', '6'].map((id) => stored(id)))).toBe(false);
    expect(isStoredSignatures({ list: [] })).toBe(false);
    expect(isStoredSignatures(null)).toBe(false);
  });
});

describe('imágenes de firma (core)', () => {
  it('reconoce JPEG por su cabecera', () => {
    expect(isJpegBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpegBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpegBytes(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });

  it('guarda el JPEG tal cual hasta 1 200 px de ancho', () => {
    expect(keepsJpeg(MAX_SIGNATURE_IMAGE_WIDTH)).toBe(true);
    expect(keepsJpeg(MAX_SIGNATURE_IMAGE_WIDTH + 1)).toBe(false);
    expect(jpegArt(new Uint8Array([1, 2, 3]), 10, 4)).toEqual({
      kind: 'image',
      format: 'jpeg',
      data: 'AQID',
      pixelWidth: 10,
      pixelHeight: 4,
    });
  });

  it('reduce el ancho conservando la proporción y no toca lo que ya cabe', () => {
    expect(fitWidth(2400, 800, 1200)).toEqual({ width: 1200, height: 400 });
    expect(fitWidth(1000, 300, 1200)).toEqual({ width: 1000, height: 300 });
    expect(fitWidth(5000, 1, 1200)).toEqual({ width: 1200, height: 1 });
  });

  it('comprime los píxeles RGBA en deflate y se pueden descomprimir igual', () => {
    const rgba = new Uint8Array(2 * 3 * 4).map((_, i) => (i * 37) % 256);
    const art = rgbaArt(rgba, 2, 3);
    expect(art?.kind).toBe('image');
    if (art?.kind !== 'image' || art.format !== 'rgba-deflate') throw new Error('se esperaba rgba-deflate');
    const bytes = Uint8Array.from(atob(art.data), (c) => c.charCodeAt(0));
    expect(Array.from(inflateSync(bytes))).toEqual(Array.from(rgba));
    expect([art.pixelWidth, art.pixelHeight]).toEqual([2, 3]);
  });

  it('rgbaArt rechaza un número de bytes que no cuadra con el tamaño', () => {
    expect(rgbaArt(new Uint8Array(10), 2, 3)).toBeNull();
    expect(rgbaArt(new Uint8Array(0), 0, 0)).toBeNull();
  });
});

describe('miniaturas de firma', () => {
  it('una firma dibujada da un SVG con la caja de la firma y sus trazos', () => {
    const url = inkThumbnailUrl(INK);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(svg).toContain('viewBox="0 0 44 34"');
    expect(svg).toContain('d="M2 32L42 2"');
  });

  it('una firma de imagen JPEG se muestra como data URL del propio JPEG', () => {
    expect(signatureThumbnailUrl(IMAGE)).toBe('data:image/jpeg;base64,AAAA');
  });
});
