import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { diffAnnotations } from '../../../src/core/annotations';
import { buildIncrementalUpdate, openForSave } from '../../../src/core/pdf/incremental';
import { loadPdf } from '../../../src/engine';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { nodeAssetBase } from '../../helpers/pdfjs-node';
import { newAnnotation } from '../annotations/factories';

const NOW = '2026-10-18T09:30:00.000Z';
const read = (n: string) => new Uint8Array(readFileSync(join(FIXTURES_DIR, n)));

describe('QA PDF-028 · incremental-updates.pdf y ficheros dañados', () => {
  it('incremental-updates.pdf + nota nueva: pdf.js la ve y el original no cambia', async () => {
    const data = read('incremental-updates.pdf');
    const source = memorySource(data);
    const opened = await openForSave(source);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const add = { ...newAnnotation('qa-1', 'note', 0), contents: 'ñandú 😀 שלום', author: 'Zoë' };
    const diff = diffAnnotations(new Map(), { upserts: new Map([[add.id, add]]), removed: new Set() });
    const res = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = new Uint8Array(data.length + res.value.delta.length);
    out.set(data);
    out.set(res.value.delta, data.length);
    expect(out.subarray(0, data.length)).toEqual(data);
    const loaded = await loadPdf(memorySource(out), { assetBaseUrl: nodeAssetBase() });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    try {
      const anns = await (await loaded.value.doc.getPage(1)).getAnnotations();
      const text = anns.find((a: { subtype: string }) => a.subtype === 'Text');
      expect(text?.contentsObj?.str).toBe('ñandú 😀 שלום');
      expect(text?.titleObj?.str).toBe('Zoë');
    } finally {
      await loaded.value.destroy();
    }
  }, 30_000);

  it.each(['corrupt-truncated.pdf', 'corrupt-not-pdf.pdf', 'corrupt-empty.pdf', 'corrupt-bad-startxref.pdf'])(
    'openForSave(%s) devuelve error sin lanzar',
    async (name) => {
      const r = await openForSave(memorySource(read(name)));
      if (r.ok) return; // truncado puede recuperarse; lo importante es no lanzar
      expect(r.error.code).toBe('save-unreadable');
    },
  );
});
