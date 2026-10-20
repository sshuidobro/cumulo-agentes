import type { AppError, Result } from '@suite/shared';
import { createDocOpsClient, type DocOpsClient, type RunOptions, type SourceInput } from '../core/doc-ops/client';
import type { PortLike } from '../core/doc-ops/protocol';
import { serveDocOps } from '../core/doc-ops/server';

/** Ejecutor fijado por los tests. `null` vuelve al Worker real. */
let override: DocOpsClient | null = null;
let workerClient: DocOpsClient | null = null;
let sameThreadClient: DocOpsClient | null = null;

/** Ejecuta las operaciones en el mismo hilo, con un `MessageChannel` en lugar de un Worker. */
export function inProcessDocOps(): DocOpsClient {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.start();
  // Catálogo de operaciones en diferido (PDF-140): no entra en el arranque. El cliente espera a que esté servido.
  const ready = import('../core/doc-ops/ops').then(({ DOC_OPS }) => {
    serveDocOps(channel.port2 as PortLike, DOC_OPS);
  });
  const inner = createDocOpsClient(channel.port1 as PortLike);
  return {
    async run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>> {
      await ready;
      return inner.run<T>(op, args, sources, opts);
    },
    dispose: () => inner.dispose(),
  };
}

function defaultClient(): DocOpsClient {
  if (typeof Worker === 'undefined') {
    sameThreadClient ??= inProcessDocOps();
    return sameThreadClient;
  }
  workerClient ??= createDocOpsClient(
    new Worker(new URL('../workers/doc-ops.worker.ts', import.meta.url), { type: 'module' }) as unknown as PortLike,
  );
  return workerClient;
}

/** Ejecuta una operación del núcleo fuera del hilo principal (ADR-0034). */
export function runDocOp<T>(
  op: string,
  args: unknown,
  sources: readonly SourceInput[],
  opts?: RunOptions,
): Promise<Result<T, AppError>> {
  return (override ?? defaultClient()).run<T>(op, args, sources, opts);
}

/** Tests: ejecuta en el mismo hilo con un MessageChannel (sin Worker). `null` vuelve al Worker real. */
export function setDocOpsRunner(runner: DocOpsClient | null): void {
  override = runner;
}
