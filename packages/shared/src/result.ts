export interface AppError {
  /** Código estable en inglés, p. ej. 'not-pdf'. */
  readonly code: string;
  /** Mensaje para el usuario, en español. */
  readonly message: string;
  readonly cause?: unknown;
}
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export function ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
export function err<E>(error: E): Result<never, E> { return { ok: false, error }; }
