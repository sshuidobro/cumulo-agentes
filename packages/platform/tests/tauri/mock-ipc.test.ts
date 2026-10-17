import { afterEach, describe, expect, it } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { realTauriApi } from '../../src/tauri/tauri-api';

afterEach(() => {
  clearMocks();
});

describe('realTauriApi con mockIPC', () => {
  it('invoke de suite_read_range devuelve los 3 bytes del mock', async () => {
    const received: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd !== 'suite_read_range') throw new Error(`comando inesperado: ${cmd}`);
      received.push(payload);
      return new Uint8Array([10, 20, 30]).buffer;
    });

    const buffer = await realTauriApi().invoke<ArrayBuffer>('suite_read_range', { token: 't1', offset: 0, length: 3 });

    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([10, 20, 30]));
    expect(received).toEqual([expect.objectContaining({ token: 't1', offset: 0, length: 3 })]);
  });
});
