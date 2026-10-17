import type { AppError } from '@suite/shared';
import { PLATFORM_MESSAGES } from './messages';
import type { PlatformErrorCode } from './types';

export class PlatformIoError extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, options?: { cause?: unknown }) {
    super(PLATFORM_MESSAGES[code], options);
    this.name = 'PlatformIoError';
    this.code = code;
  }
}

export function platformError(code: PlatformErrorCode, cause?: unknown): AppError {
  const message = PLATFORM_MESSAGES[code];
  return cause === undefined ? { code, message } : { code, message, cause };
}
