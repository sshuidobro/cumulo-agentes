import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memorySource, type SaveData } from '@suite/platform';
import { addAnnotation } from '../../src/state/annotation-actions';
import { useAnnotations } from '../../src/state/annotation-store';
import { save } from '../../src/state/save-actions';
import { concat, fixtureBytes, FIXTURE, openFixture, setupSaveHarness, waitForScan } from '../helpers/save-harness';
import { newAnnotation } from './annotations/factories';

const h = setupSaveHarness();

function qpdfCheck(bytes: Uint8Array): void {
  const dir = mkdtempSync(join(tmpdir(), 'save-qa dir ñ-'));
  const path = join(dir, 'doc con espacios ñ.pdf');
  writeFileSync(path, bytes);
  execFileSync('qpdf', ['--check', path], { stdio: 'pipe' });
}

function lastDelta(): Uint8Array {
  const call = h.save.mock.calls.at(-1) as unknown as [unknown, SaveData];
  if (call[1].kind !== 'append') throw new Error('append esperado');
  return call[1].delta;
}

describe('QA guardar: validez del PDF resultante', () => {
  it('original + delta pasa qpdf --check, también en un segundo guardado encadenado', async () => {
    await openFixture();
    addAnnotation(newAnnotation('qa-hl-1', 'highlight', 0));
    expect(await save()).toBe('saved');
    const first = concat(fixtureBytes(FIXTURE), lastDelta());
    qpdfCheck(first);

    // Segundo ciclo sobre el resultado del primero.
    await openFixture(memorySource(first), 'resultado ñ 😀.pdf');
    expect([...useAnnotations.getState().baseline.values()]).toHaveLength(1);
    addAnnotation(newAnnotation('qa-ul-2', 'underline', 1));
    h.save.mockImplementationOnce(async (t) => ({ ok: true, value: t }) as never);
    expect(await save()).toBe('saved');
    await waitForScan();
    const second = concat(first, lastDelta());
    qpdfCheck(second);
    expect(second.byteLength).toBeGreaterThan(first.byteLength);
    expect(Array.from(second.subarray(0, first.byteLength))).toEqual(Array.from(first));
  });
});
