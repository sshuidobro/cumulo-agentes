import type { AppError, Result } from '@suite/shared';
import { createDocOpsClient, type DocOpsClient, type RunOptions, type SourceInput } from '../core/doc-ops/client';
import type { PortLike } from '../core/doc-ops/protocol';
import { serveDocOps } from '../core/doc-ops/server';
import { DOC_OPS } from '../core/doc-ops/ops';

/** Ejecutor fijado por los tests. `null` vuelve al Worker real. */
let override: DocOpsClient | null = null;
let workerClient: DocOpsClient | null = null;
let sameThreadClient: DocOpsClient | null = null;

/** Ejecuta las operaciones en el mismo hilo, con un `MessageChannel` en lugar de un Worker. */
export function inProcessDocOps(): DocOpsClient {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.start();
  serveDocOps(channel.port2 as PortLike, DOC_OPS);
  return createDocOpsClient(channel.port1 as PortLike);
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
