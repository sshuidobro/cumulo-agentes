import type { AppError, Result } from '@suite/shared';
import type { ByteSource } from '@suite/platform';

/** Fuente que viaja al Worker: un rango remoto (el Worker pide `read`) o bytes ya en memoria (se transfieren). */
export type SourceSpec = { readonly kind: 'remote'; readonly size: number } | { readonly kind: 'bytes'; readonly bytes: Uint8Array };

/** Mensajes del hilo principal al Worker (o del cliente al servidor). */
export type ToWorker =
  | { readonly type: 'run'; readonly id: number; readonly op: string; readonly args: unknown; readonly sources: readonly SourceSpec[] }
  | { readonly type: 'cancel'; readonly id: number }
  | { readonly type: 'read-result'; readonly req: number; readonly bytes: Uint8Array }
  | { readonly type: 'read-error'; readonly req: number; readonly message: string };

/** Mensajes del Worker al hilo principal (o del servidor al cliente). */
export type FromWorker =
  | { readonly type: 'read'; readonly req: number; readonly id: number; readonly source: number; readonly begin: number; readonly end: number }
  | { readonly type: 'progress'; readonly id: number; readonly done: number; readonly total: number }
  | { readonly type: 'done'; readonly id: number; readonly result: Result<unknown, AppError> };

/** Lo mínimo de `MessagePort`/`Worker`/`self` que usan cliente y servidor. */
export interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

export interface OpContext {
  readonly sources: readonly ByteSource[];
  readonly signal: AbortSignal;
  progress(done: number, total: number): void;
}

export type DocOp = (args: unknown, ctx: OpContext) => Promise<Result<unknown, AppError>>;
export type DocOpRegistry = Readonly<Record<string, DocOp>>;
