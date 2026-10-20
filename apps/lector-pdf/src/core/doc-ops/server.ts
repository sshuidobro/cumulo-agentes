import { createLogger, err, type AppError, type Result } from '@suite/shared';
import type { ByteSource } from '@suite/platform';
import { PDF_ERROR_MESSAGES, pdfError } from '../errors';
import { bytesSource, isValidRange, resultBuffers } from './bytes';
import type { DocOpRegistry, FromWorker, PortLike, SourceSpec, ToWorker } from './protocol';

const log = createLogger('doc-ops');

/** Intervalo mínimo entre dos mensajes `progress` de la misma operación (el último, con done === total, siempre sale). */
const PROGRESS_INTERVAL_MS = 100;

type ReadReply = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string };

/** Quita `cause` (no es serializable ni debe salir del Worker) y deja solo código y mensaje. */
function toTransferableError(error: AppError): AppError {
  return { code: error.code, message: error.message };
}

function unknownOpError(): AppError {
  return { code: 'io', message: 'Operación desconocida.' };
}

/**
 * Lado del Worker (o del `MessagePort` que haga de Worker en el mismo hilo): atiende los `run` y sirve las
 * lecturas de las fuentes remotas pidiéndolas al cliente. Devuelve la función que da de baja el servicio.
 */
export function serveDocOps(port: PortLike, registry: DocOpRegistry): () => void {
  const running = new Map<number, AbortController>();
  const pendingReads = new Map<number, (reply: ReadReply) => void>();
  let nextReq = 1;

  const post = (message: FromWorker, transfer: Transferable[] = []): void => {
    port.postMessage(message, transfer);
  };

  const remoteSource = (runId: number, index: number, size: number, signal: AbortSignal): ByteSource => ({
    size,
    read(begin, end) {
      if (!isValidRange(begin, end, size)) {
        return Promise.reject(new RangeError('Lectura fuera del fichero.'));
      }
      if (signal.aborted) return Promise.reject(new Error('cancelled'));
      const req = nextReq++;
      return new Promise<Uint8Array>((resolve, reject) => {
        const onAbort = (): void => {
          pendingReads.delete(req);
          reject(new Error('cancelled'));
        };
        pendingReads.set(req, (reply) => {
          signal.removeEventListener('abort', onAbort);
          if (reply.ok) resolve(reply.bytes);
          else reject(new Error(reply.message));
        });
        signal.addEventListener('abort', onAbort, { once: true });
        post({ type: 'read', req, id: runId, source: index, begin, end });
      });
    },
  });

  const startRun = (msg: Extract<ToWorker, { type: 'run' }>): void => {
    const { id, op: opName, args, sources: specs } = msg;
    const controller = new AbortController();
    running.set(id, controller);

    const finish = (result: Result<unknown, AppError>): void => {
      const safe: Result<unknown, AppError> = result.ok ? result : err(toTransferableError(result.error));
      post({ type: 'done', id, result: safe }, result.ok ? resultBuffers(result.value) : []);
    };

    let lastSent: number | null = null;
    const progress = (done: number, total: number): void => {
      const now = Date.now();
      if (done < total && lastSent !== null && now - lastSent < PROGRESS_INTERVAL_MS) return;
      lastSent = now;
      post({ type: 'progress', id, done, total });
    };

    const sources: ByteSource[] = specs.map((spec: SourceSpec, index) =>
      spec.kind === 'bytes' ? bytesSource(spec.bytes) : remoteSource(id, index, spec.size, controller.signal),
    );

    const op = Object.hasOwn(registry, opName) ? registry[opName] : undefined;
    const execute = async (): Promise<void> => {
      if (op === undefined) {
        finish(err(unknownOpError()));
        return;
      }
      try {
        finish(await op(args, { sources, signal: controller.signal, progress }));
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          finish(err(pdfError('cancelled')));
          return;
        }
        log.error('La operación ha fallado', { op: opName, error });
        finish(err({ code: 'io', message: PDF_ERROR_MESSAGES.io }));
      } finally {
        running.delete(id);
      }
    };
    void execute();
  };

  const onMessage = (event: { readonly data: unknown }): void => {
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const msg = data as ToWorker;
    switch (msg.type) {
      case 'run':
        startRun(msg);
        break;
      case 'cancel':
        running.get(msg.id)?.abort();
        break;
      case 'read-result': {
        const settle = pendingReads.get(msg.req);
        pendingReads.delete(msg.req);
        settle?.({ ok: true, bytes: msg.bytes });
        break;
      }
      case 'read-error': {
        const settle = pendingReads.get(msg.req);
        pendingReads.delete(msg.req);
        settle?.({ ok: false, message: msg.message });
        break;
      }
    }
  };

  port.addEventListener('message', onMessage);
  return () => {
    port.removeEventListener('message', onMessage);
    for (const controller of running.values()) controller.abort();
    running.clear();
    pendingReads.clear();
  };
}
