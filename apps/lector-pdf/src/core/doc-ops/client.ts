import { err, type AppError, type Result } from '@suite/shared';
import type { ByteSource } from '@suite/platform';
import { PDF_ERROR_MESSAGES, pdfError } from '../errors';
import { isValidRange, transferableBuffers } from './bytes';
import type { FromWorker, PortLike, SourceSpec, ToWorker } from './protocol';

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

/** Un `ByteSource` (fichero abierto, se lee por rangos) o bytes ya en memoria (se copian y se transfieren). */
export type SourceInput = ByteSource | Uint8Array;

export interface DocOpsClient {
  run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>>;
  dispose(): void;
}

interface ActiveRun {
  readonly sources: readonly SourceInput[];
  readonly onProgress: RunOptions['onProgress'];
  readonly settle: (result: Result<unknown, AppError>) => void;
  readonly detach: () => void;
}

/** Lado del hilo principal: envía operaciones por `port` y responde a las lecturas de sus fuentes. */
export function createDocOpsClient(port: PortLike): DocOpsClient {
  const runs = new Map<number, ActiveRun>();
  let nextId = 1;
  let disposed = false;

  const post = (message: ToWorker, transfer: Transferable[] = []): void => {
    port.postMessage(message, transfer);
  };

  const answerRead = (msg: Extract<FromWorker, { type: 'read' }>): void => {
    const run = runs.get(msg.id);
    // Si la operación ya no existe, la petición está obsoleta: no hay nada que responder.
    if (run === undefined) return;
    const source = run.sources[msg.source];
    if (source === undefined || source instanceof Uint8Array) {
      post({ type: 'read-error', req: msg.req, message: PDF_ERROR_MESSAGES.io });
      return;
    }
    if (!isValidRange(msg.begin, msg.end, source.size)) {
      post({ type: 'read-error', req: msg.req, message: PDF_ERROR_MESSAGES.io });
      return;
    }
    source.read(msg.begin, msg.end).then(
      (bytes) => post({ type: 'read-result', req: msg.req, bytes }, transferableBuffers([bytes])),
      (error: unknown) => {
        const message = error instanceof Error && error.message !== '' ? error.message : PDF_ERROR_MESSAGES.io;
        post({ type: 'read-error', req: msg.req, message });
      },
    );
  };

  const onMessage = (event: { readonly data: unknown }): void => {
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const msg = data as FromWorker;
    switch (msg.type) {
      case 'read':
        answerRead(msg);
        break;
      case 'progress':
        runs.get(msg.id)?.onProgress?.(msg.done, msg.total);
        break;
      case 'done': {
        const run = runs.get(msg.id);
        if (run === undefined) break;
        runs.delete(msg.id);
        run.detach();
        run.settle(msg.result);
        break;
      }
    }
  };

  port.addEventListener('message', onMessage);

  return {
    run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts: RunOptions = {}): Promise<Result<T, AppError>> {
      const signal = opts.signal;
      if (disposed || signal?.aborted === true) {
        return Promise.resolve(err(pdfError('cancelled')));
      }
      const id = nextId++;
      const transfer: Transferable[] = [];
      const specs: SourceSpec[] = sources.map((source): SourceSpec => {
        if (source instanceof Uint8Array) {
          const bytes = source.slice();
          transfer.push(...transferableBuffers([bytes]));
          return { kind: 'bytes', bytes };
        }
        return { kind: 'remote', size: source.size };
      });

      return new Promise<Result<T, AppError>>((resolve) => {
        const onAbort = (): void => post({ type: 'cancel', id });
        signal?.addEventListener('abort', onAbort, { once: true });
        runs.set(id, {
          sources,
          onProgress: opts.onProgress,
          settle: (result) => resolve(result as Result<T, AppError>),
          detach: () => signal?.removeEventListener('abort', onAbort),
        });
        post({ type: 'run', id, op, args, sources: specs }, transfer);
      });
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      port.removeEventListener('message', onMessage);
      for (const run of runs.values()) {
        run.detach();
        run.settle(err(pdfError('cancelled')));
      }
      runs.clear();
    },
  };
}
