import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memorySource } from '@suite/platform';
import { describe, expect, it } from 'vitest';
import { diffAnnotations, type Annotation } from '../../../src/core/annotations';
import { buildIncrementalUpdate, openForSave } from '../../../src/core/pdf/incremental';
import { FIXTURES_DIR } from '../../fixtures/paths';
import { newAnnotation } from '../annotations/factories';

const NOW = '2026-10-19T10:00:00.000Z';
const HASHES = {
  basic: 'b9cf43075660499746023395b46eff0b853e016b041e35006b256184cf6dc36c',
  compressed: 'd172123be1dc0fb5b7a1ca6100927db2e813cbf153af77b2468a8ccd62f9f735',
  encrypted: '2d94c786b782d951a56278f7e3c36296bba5661fa48351cb5981b0bcd54264d5',
};

async function deltaHash(file: string, a: Annotation, password?: string, random?: (n: number) => Uint8Array): Promise<string> {
  const data = new Uint8Array(readFileSync(join(FIXTURES_DIR, file)));
  const source = memorySource(data);
  const opened = await openForSave(source, password);
  if (!opened.ok) throw new Error(opened.error.code);
  const diff = diffAnnotations(new Map(), { upserts: new Map([[a.id, a]]), removed: new Set(), fields: new Map() });
  const r = await buildIncrementalUpdate({ source, reader: opened.value, diff, now: NOW, ...(random ? { random } : {}) });
  if (!r.ok) throw new Error(r.error.code);
  return createHash('sha256').update(r.value.delta).digest('hex');
}

describe('delta-writer golden (contrato de PDF-106)', () => {
  it('tabla xref: basic-5 + resaltado', async () => {
    expect(await deltaHash('basic-5.pdf', newAnnotation('n1', 'highlight'))).toBe(HASHES.basic);
  });
  it('flujo xref: compressed + nota', async () => {
    expect(await deltaHash('compressed.pdf', newAnnotation('n1', 'note'))).toBe(HASHES.compressed);
  });
  it('cifrado AES-128: dibujo', async () => {
    const random = (n: number): Uint8Array => new Uint8Array(n).fill(7);
    expect(await deltaHash('encrypted-aes-128.pdf', newAnnotation('n1', 'ink'), 'usuario', random)).toBe(HASHES.encrypted);
  });
});
