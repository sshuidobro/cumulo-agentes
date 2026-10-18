import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isAnnotation, type SignatureAnnotation } from '../../src/core/annotations';
import { toBase64 } from '../../src/core/base64';
import { loadPdf } from '../../src/engine';
import { FIXTURES_DIR } from '../fixtures/paths';
import { nodeAssetBase } from '../helpers/pdfjs-node';
import { additionsDiff, saveAnnotations } from '../support/save-annotations';

const T0 = '2026-10-18T10:00:00.000Z';
function sig(id: string, art: unknown, rect = [50, 50, 150, 100]): unknown {
  return {
    id, type: 'signature', pageIndex: 0, rect, color: [0, 0, 0], opacity: 1, contents: '',
    author: 'Ñandú 🖋️', modified: T0, created: T0, origin: { kind: 'new' }, art,
  };
}
const ink = { kind: 'ink', paths: [[0, 0, 10, 10]], width: 1, box: [10, 10] };

describe('QA firma · validación hostil', () => {
  it.each([
    ['art null', null],
    ['art ausente', undefined],
    ['ink sin width', { ...ink, width: undefined }],
    ['ink width negativo', { ...ink, width: -1 }],
    ['ink NaN', { ...ink, paths: [[0, NaN, 1, 1]] }],
    ['ink Infinity en box', { ...ink, box: [Infinity, 10] }],
    ['ink box negativo', { ...ink, box: [10, -5] }],
    ['ink path impar', { ...ink, paths: [[0, 0, 1]] }],
    ['image width fraccional', { kind: 'image', format: 'jpeg', data: 'AA==', pixelWidth: 1.5, pixelHeight: 1 }],
    ['image height negativo', { kind: 'image', format: 'jpeg', data: 'AA==', pixelWidth: 1, pixelHeight: -1 }],
    ['image data número', { kind: 'image', format: 'jpeg', data: 5, pixelWidth: 1, pixelHeight: 1 }],
    ['image formato png', { kind: 'image', format: 'png', data: 'AA==', pixelWidth: 1, pixelHeight: 1 }],
  ])('rechaza %s', (_n, art) => {
    expect(isAnnotation(sig('x', art))).toBe(false);
  });
});

describe('QA firma · escritura', () => {
  it('muchas firmas (30) con autor Unicode: pdf.js las ve todas y re-guardar sobre el resultado sigue bien', async () => {
    const original = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'basic-5.pdf')));
    const px = new Uint8Array(8 * 8 * 4).fill(255);
    px[3] = 10;
    const art = { kind: 'image', format: 'rgba-deflate', data: toBase64(deflateSync(px)), pixelWidth: 8, pixelHeight: 8 };
    const list = Array.from({ length: 30 }, (_, i) =>
      sig(`s${i}`, i % 2 ? art : ink, [10 + i, 10 + i, 60 + i, 40 + i]),
    ) as SignatureAnnotation[];
    for (const s of list) expect(isAnnotation(s)).toBe(true);
    const first = await saveAnnotations(original, additionsDiff(list.slice(0, 15)));
    const second = await saveAnnotations(first.data, additionsDiff(list.slice(15)));
    const loaded = await loadPdf(memorySource(second.data), { assetBaseUrl: nodeAssetBase() });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const anns = await (await loaded.value.doc.getPage(1)).getAnnotations();
      expect(anns.filter((a: { subtype: string }) => a.subtype === 'Stamp')).toHaveLength(30);
    } finally {
      await loaded.value.destroy();
    }
  }, 60_000);
});
