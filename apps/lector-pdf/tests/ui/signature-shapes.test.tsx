// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { deflateSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SignatureAnnotation, SignatureArt } from '../../src/core/annotations/model';
import { toBase64 } from '../../src/core/base64';
import { AnnotationShape } from '../../src/ui/viewer/annotation-shapes';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';

function signature(art: SignatureArt): SignatureAnnotation {
  return {
    id: 'suite-firma-1',
    type: 'signature',
    pageIndex: 0,
    rect: [100, 100, 300, 200],
    color: [0, 0, 0.6],
    opacity: 1,
    contents: '',
    author: 'Ana',
    modified: '2026-10-18T10:00:00.000Z',
    created: '2026-10-18T10:00:00.000Z',
    origin: { kind: 'new' },
    art,
  };
}

/** Sustituye el canvas de jsdom (que no pinta) por uno que acepta `createImageData` y `toDataURL`. */
function stubCanvas(): void {
  const ctx = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG_URL);
}

function renderShape(a: SignatureAnnotation): HTMLElement {
  const { container } = render(<svg>{<AnnotationShape a={a} />}</svg>);
  return container;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AnnotationShape · firma', () => {
  it('firma image rgba-deflate: un <image> con href PNG, volteado para que se lea derecho', () => {
    stubCanvas();
    const pixels = new Uint8Array(4 * 2 * 4).fill(255);
    const art: SignatureArt = {
      kind: 'image',
      format: 'rgba-deflate',
      data: toBase64(deflateSync(pixels)),
      pixelWidth: 4,
      pixelHeight: 2,
    };
    const container = renderShape(signature(art));
    const image = container.querySelector('image');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('href')?.startsWith('data:image/png;base64,')).toBe(true);
    expect(image?.getAttribute('width')).toBe('200');
    expect(image?.getAttribute('height')).toBe('100');
    expect(image?.getAttribute('preserveAspectRatio')).toBe('none');
    expect(container.querySelector('g')?.getAttribute('transform')).toBe('translate(100 200) scale(1 -1)');
  });

  it('firma image jpeg: el href es el JPEG tal cual', () => {
    const art: SignatureArt = { kind: 'image', format: 'jpeg', data: 'AAAA', pixelWidth: 4, pixelHeight: 2 };
    const container = renderShape(signature(art));
    expect(container.querySelector('image')?.getAttribute('href')).toBe('data:image/jpeg;base64,AAAA');
  });

  it('firma ink: un polyline por trazo, escalado de su caja al rect', () => {
    const art: SignatureArt = {
      kind: 'ink',
      paths: [
        [0, 0, 25, 40],
        [60, 20, 100, 20],
        [10, 10, 20, 20, 30, 10],
      ],
      width: 2,
      box: [100, 50],
    };
    const container = renderShape(signature(art));
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
    expect(container.querySelector('g')?.getAttribute('transform')).toBe('translate(100 100) scale(2 2)');
    expect(container.querySelector('g')?.getAttribute('stroke-width')).toBe('2');
  });
});
