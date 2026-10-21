import type { ByteSource } from '@suite/platform';
import { createLogger, err, type AppError, type Result } from '@suite/shared';
import { pdfError } from '../core/errors';
import { createRangeTransport } from './range-transport';
import {
  loadPdfjs,
  pdfjs,
  type PdfjsModule,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from './pdfjs';

const log = createLogger('engine');

/** Bytes iniciales que se leen para comprobar la cabecera `%PDF-`. */
const HEAD_BYTES = 1024;
/** Bytes de la cabecera que forman la huella de respaldo si el PDF no tiene `fingerprints`. */
const FINGERPRINT_BYTES = 64;
/** Tamaño de los rangos que pide pdf.js al transporte. */
const RANGE_CHUNK_SIZE = 65536;

export interface LoadOptions {
  /** Carpeta de recursos de pdf.js (cmaps/, standard_fonts/, wasm/, iccs/). Termina en '/'. */
  readonly assetBaseUrl: string;
  readonly password?: string;
  /** Si existe, pdf.js pide la contraseña sobre la misma carga (ADR-0043). `null` = el usuario cancela. */
  readonly requestPassword?: (incorrect: boolean) => Promise<string | null>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (loaded: number, total: number) => void;
}

export interface LoadedPdf {
  readonly doc: PDFDocumentProxy;
  readonly numPages: number;
  /** Huella estable del documento: `doc.fingerprints[0]` o, si no existe, `size-<n>-<hex de la cabecera>`. */
  readonly fingerprint: string;
  /** Contraseña con la que se abrió: la última entregada a pdf.js, la de `opts.password` o `null`. Solo en memoria. */
  readonly password: string | null;
  /** Registra un aviso para errores de lectura posteriores a la apertura. Devuelve la función para darse de baja. */
  onIoError(cb: (e: AppError) => void): () => void;
  /** Libera el documento. Idempotente: llamarla varias veces no lanza. */
  destroy(): Promise<void>;
}

type OpenOutcome =
  | { readonly kind: 'opened'; readonly doc: PDFDocumentProxy }
  | { readonly kind: 'failed'; readonly cause: unknown }
  | { readonly kind: 'transport'; readonly cause: unknown }
  | { readonly kind: 'aborted' };

/**
 * Abre un PDF leyendo solo los rangos que pide pdf.js desde `source`. Nunca lanza:
 * todo fallo esperable (fichero vacío, no es PDF, dañado, contraseña, E/S, cancelación) vuelve como `err`.
 */
export async function loadPdf(source: ByteSource, opts: LoadOptions): Promise<Result<LoadedPdf>> {
  if (source.size === 0) return err(pdfError('empty'));

  let lib: PdfjsModule;
  try {
    lib = await loadPdfjs();
  } catch (cause) {
    return err(pdfError('io', cause));
  }

  let head: Uint8Array;
  try {
    head = await source.read(0, Math.min(HEAD_BYTES, source.size));
  } catch (cause) {
    return err(pdfError('io', cause));
  }
  if (!latin1(head).includes('%PDF-')) return err(pdfError('not-pdf'));
  if (opts.signal?.aborted) return err(pdfError('cancelled'));

  return openDocument(lib, source, head, opts);
}

async function openDocument(
  lib: PdfjsModule,
  source: ByteSource,
  head: Uint8Array,
  opts: LoadOptions,
): Promise<Result<LoadedPdf>> {
  const ioListeners = new Set<(e: AppError) => void>();
  let phase: 'opening' | 'open' = 'opening';

  // Un fallo del transporte antes de abrir cancela la apertura; después se notifica a los oyentes.
  let failOpening: (cause: unknown) => void = () => undefined;
  const transportFailed = new Promise<OpenOutcome>((resolve) => {
    failOpening = (cause) => { resolve({ kind: 'transport', cause }); };
  });
  const range = createRangeTransport(source, (cause) => {
    if (phase === 'opening') {
      failOpening(cause);
      return;
    }
    for (const listener of ioListeners) listener(pdfError('io', cause));
  });

  let usedPassword: string | null = opts.password ?? null;
  let cancelByUser: () => void = () => undefined;
  const passwordCancelled = new Promise<OpenOutcome>((resolve) => {
    cancelByUser = () => { resolve({ kind: 'aborted' }); };
  });

  let loadingTask: PDFDocumentLoadingTask;
  try {
    loadingTask = lib.getDocument({
      range,
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      cMapUrl: `${opts.assetBaseUrl}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${opts.assetBaseUrl}standard_fonts/`,
      wasmUrl: `${opts.assetBaseUrl}wasm/`,
      iccUrl: `${opts.assetBaseUrl}iccs/`,
      verbosity: 0,
      ...(opts.password === undefined ? {} : { password: opts.password }),
    });
  } catch (cause) {
    return err(mapOpenError(cause));
  }

  if (opts.requestPassword) {
    const requestPassword = opts.requestPassword;
    // La contraseña no se registra en ningún log ni se incluye en errores: solo viaja a pdf.js y a `usedPassword`.
    loadingTask.onPassword = (update: (password: string) => void, reason: number) => {
      requestPassword(reason === lib.PasswordResponses.INCORRECT_PASSWORD).then(
        (password) => {
          if (password === null) cancelByUser();
          else {
            usedPassword = password;
            update(password);
          }
        },
        () => { cancelByUser(); },
      );
    };
  }

  if (opts.onProgress) {
    const onProgress = opts.onProgress;
    loadingTask.onProgress = ({ loaded, total }: { readonly loaded: number; readonly total: number }) => {
      onProgress(loaded, total);
    };
  }

  const signal = opts.signal;
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<OpenOutcome>((resolve) => {
    onAbort = () => { resolve({ kind: 'aborted' }); };
  });
  signal?.addEventListener('abort', onAbort, { once: true });

  const opening = loadingTask.promise.then(
    (doc): OpenOutcome => ({ kind: 'opened', doc }),
    (cause: unknown): OpenOutcome => ({ kind: 'failed', cause }),
  );
  const outcome = await Promise.race([opening, transportFailed, aborted, passwordCancelled]);
  signal?.removeEventListener('abort', onAbort);

  if (outcome.kind !== 'opened') {
    await destroyTask(loadingTask);
    switch (outcome.kind) {
      case 'aborted':
        return err(pdfError('cancelled'));
      case 'transport':
        return err(pdfError('io', outcome.cause));
      case 'failed':
        return err(mapOpenError(outcome.cause));
    }
  }

  phase = 'open';
  const doc = outcome.doc;
  let destroying: Promise<void> | null = null;
  const loaded: LoadedPdf = {
    doc,
    numPages: doc.numPages,
    fingerprint: doc.fingerprints[0] || sizeFingerprint(source.size, head),
    password: usedPassword,
    onIoError(cb) {
      ioListeners.add(cb);
      return () => { ioListeners.delete(cb); };
    },
    destroy() {
      destroying ??= destroyTask(loadingTask);
      return destroying;
    },
  };
  return { ok: true, value: loaded };
}

/** Traduce el error de pdf.js a un `AppError`. Lo inesperado se registra y se trata como dañado. */
function mapOpenError(cause: unknown): AppError {
  const { PasswordException, PasswordResponses, InvalidPDFException } = pdfjs();
  if (cause instanceof PasswordException) {
    const code = cause.code === PasswordResponses.INCORRECT_PASSWORD ? 'password-incorrect' : 'password-required';
    return pdfError(code, cause);
  }
  if (!(cause instanceof InvalidPDFException)) {
    log.warn('loadPdf', cause);
  }
  return pdfError('corrupt', cause);
}

async function destroyTask(task: PDFDocumentLoadingTask): Promise<void> {
  try {
    await task.destroy();
  } catch (cause) {
    log.warn('destroy', cause);
  }
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function sizeFingerprint(size: number, head: Uint8Array): string {
  const hex = Array.from(head.subarray(0, FINGERPRINT_BYTES), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `size-${String(size)}-${hex}`;
}
