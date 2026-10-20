import { MessageChannel, type MessagePort, type TransferListItem } from 'node:worker_threads';
import type { ByteSource } from '@suite/platform';
import type { AppError, Result } from '@suite/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocOpsClient, type DocOpsClient } from '../../../src/core/doc-ops/client';
import type { DocOpRegistry, OpContext, PortLike } from '../../../src/core/doc-ops/protocol';
import { serveDocOps } from '../../../src/core/doc-ops/server';
import { PDF_ERROR_MESSAGES, pdfError } from '../../../src/core/errors';

/** Adapta un `MessagePort` de Node al `PortLike` que usan cliente y servidor. Registra lo enviado en `sent`. */
function adapt(port: MessagePort, sent: unknown[]): PortLike {
  const handlers = new Map<(event: { readonly data: unknown }) => void, (data: unknown) => void>();
  return {
    postMessage(message, transfer) {
      sent.push(message);
      // Los tipos de Transferable de DOM y de Node difieren; la lista es la misma en ambos.
      port.postMessage(message, transfer as TransferListItem[] | undefined);
    },
    addEventListener(_type, listener) {
      const handler = (data: unknown): void => listener({ data });
      handlers.set(listener, handler);
      port.on('message', handler);
    },
    removeEventListener(_type, listener) {
      const handler = handlers.get(listener);
      if (handler !== undefined) port.off('message', handler);
    },
  };
}

/** Fuente remota sobre `bytes` que anota cada lectura y puede fallar a partir de cierta lectura. */
function remoteSource(bytes: Uint8Array, reads: { begin: number; end: number }[] = [], failAt = -1): ByteSource {
  let count = 0;
  return {
    size: bytes.byteLength,
    read(begin, end) {
      reads.push({ begin, end });
      const index = count++;
      if (index === failAt) return Promise.reject(new Error('Fallo interno del disco.'));
      return Promise.resolve(bytes.slice(begin, end));
    },
  };
}

interface Harness {
  readonly client: DocOpsClient;
  readonly sent: unknown[];
  close(): void;
}

const openHarnesses: Harness[] = [];

function connect(registry: DocOpRegistry): Harness {
  const channel = new MessageChannel();
  const sent: unknown[] = [];
  const stop = serveDocOps(adapt(channel.port1, []), registry);
  const client = createDocOpsClient(adapt(channel.port2, sent));
  const harness: Harness = {
    client,
    sent,
    close() {
      client.dispose();
      stop();
      channel.port1.close();
      channel.port2.close();
    },
  };
  openHarnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of openHarnesses.splice(0)) harness.close();
});

/** Operaciones de prueba: leen la fuente 0 de principio a fin en trozos de 4 bytes y suman sus bytes. */
const sumRegistry: DocOpRegistry = {
  sum: async (_args, ctx: OpContext): Promise<Result<unknown, AppError>> => {
    const source = ctx.sources[0];
    if (source === undefined) throw new Error('sin fuente');
    let total = 0;
    for (let begin = 0; begin < source.size; begin += 4) {
      const chunk = await source.read(begin, Math.min(begin + 4, source.size));
      for (const byte of chunk) total += byte;
    }
    return { ok: true, value: { total } };
  },
};

describe('protocolo de operaciones de documento', () => {
  it('ejecuta una operación que lee una fuente remota por rangos y devuelve su resultado', async () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, i) => i + 1);
    const reads: { begin: number; end: number }[] = [];
    const harness = connect(sumRegistry);

    const result = await harness.client.run<{ total: number }>('sum', null, [remoteSource(bytes, reads)]);

    expect(result).toEqual({ ok: true, value: { total: 55 } });
    expect(reads).toEqual([
      { begin: 0, end: 4 },
      { begin: 4, end: 8 },
      { begin: 8, end: 10 },
    ]);
  });

  it('nunca pide lecturas fuera de [0, size) aunque la operación lo intente', async () => {
    const bytes = new Uint8Array(8);
    const reads: { begin: number; end: number }[] = [];
    const registry: DocOpRegistry = {
      overread: async (_args, ctx) => {
        const source = ctx.sources[0];
        if (source === undefined) throw new Error('sin fuente');
        await source.read(4, 9).catch(() => undefined);
        await source.read(-1, 2).catch(() => undefined);
        return { ok: true, value: null };
      },
    };
    const harness = connect(registry);

    const result = await harness.client.run('overread', null, [remoteSource(bytes, reads)]);

    expect(result.ok).toBe(true);
    expect(reads).toEqual([]);
  });

  it('pasa un Uint8Array como fuente de bytes y lo devuelve en el resultado', async () => {
    const registry: DocOpRegistry = {
      echo: async (_args, ctx) => {
        const source = ctx.sources[0];
        if (source === undefined) throw new Error('sin fuente');
        const bytes = await source.read(0, source.size);
        return { ok: true, value: { bytes } };
      },
    };
    const harness = connect(registry);
    const input = Uint8Array.from([9, 8, 7]);

    const result = await harness.client.run<{ bytes: Uint8Array }>('echo', null, [input]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(result.value.bytes)).toEqual([9, 8, 7]);
  });

  it('informa del progreso y el último aviso es done === total', async () => {
    const registry: DocOpRegistry = {
      loop: async (_args, ctx) => {
        for (let i = 1; i <= 5000; i++) ctx.progress(i, 5000);
        return { ok: true, value: 'listo' };
      },
    };
    const harness = connect(registry);
    const calls: [number, number][] = [];

    const result = await harness.client.run<string>('loop', null, [], { onProgress: (done, total) => calls.push([done, total]) });

    expect(result).toEqual({ ok: true, value: 'listo' });
    expect(calls.at(-1)).toEqual([5000, 5000]);
    // Como mucho un aviso cada 100 ms: un bucle síncrono de 5000 pasos no puede generar 5000 avisos.
    expect(calls.length).toBeLessThan(10);
  });

  it('cancelar a mitad aborta la operación, que devuelve cancelled', async () => {
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const registry: DocOpRegistry = {
      wait: async (_args, ctx) => {
        started();
        await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
        return { ok: false, error: pdfError('cancelled') };
      },
    };
    const harness = connect(registry);
    const controller = new AbortController();

    const pending = harness.client.run('wait', null, [], { signal: controller.signal });
    await startedPromise;
    controller.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cancelled');
  });

  it('una operación ya cancelada no envía nada y devuelve cancelled', async () => {
    let calls = 0;
    const registry: DocOpRegistry = {
      count: async () => {
        calls++;
        return { ok: true, value: null };
      },
    };
    const harness = connect(registry);
    const sentBefore = harness.sent.length;
    const controller = new AbortController();
    controller.abort();

    const result = await harness.client.run('count', null, [], { signal: controller.signal });

    expect(result).toEqual({ ok: false, error: pdfError('cancelled') });
    expect(harness.sent.length).toBe(sentBefore);
    expect(calls).toBe(0);
  });

  it('una operación desconocida devuelve un error de E/S con mensaje en español', async () => {
    const harness = connect(sumRegistry);

    const result = await harness.client.run('no-existe', null, []);

    expect(result).toEqual({ ok: false, error: { code: 'io', message: 'Operación desconocida.' } });
  });

  it('una operación que lanza devuelve io con el mensaje genérico, sin cause', async () => {
    const registry: DocOpRegistry = {
      boom: async () => {
        throw new Error('detalle interno');
      },
    };
    const harness = connect(registry);

    const result = await harness.client.run('boom', null, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: 'io', message: PDF_ERROR_MESSAGES.io });
    expect('cause' in result.error).toBe(false);
  });

  it('un resultado de error no envía cause al hilo principal', async () => {
    const registry: DocOpRegistry = {
      fail: async () => ({ ok: false, error: { code: 'corrupt', message: 'El PDF está dañado y no se puede abrir.', cause: new Error('x') } }),
    };
    const harness = connect(registry);

    const result = await harness.client.run('fail', null, []);

    expect(result).toEqual({ ok: false, error: { code: 'corrupt', message: 'El PDF está dañado y no se puede abrir.' } });
  });

  it('una fuente que falla en read hace que la operación falle con error sin cause', async () => {
    const bytes = new Uint8Array(10);
    const harness = connect(sumRegistry);

    const result = await harness.client.run('sum', null, [remoteSource(bytes, [], 1)]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
    expect(result.error.message).toBe(PDF_ERROR_MESSAGES.io);
    expect('cause' in result.error).toBe(false);
  });
});
