import type { ByteSource } from '@suite/platform';
import { pdfjs, type PDFDataRangeTransport } from './pdfjs';

/**
 * Transporte de pdf.js que pide cada rango al `ByteSource`, de modo que solo se leen los bytes
 * que el motor necesita (ADR-0007). Si una lectura falla, se notifica con `onError` y no se
 * entrega ningún trozo.
 */
export function createRangeTransport(source: ByteSource, onError: (e: unknown) => void): PDFDataRangeTransport {
  class SourceRangeTransport extends pdfjs().PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      source.read(begin, Math.min(end, source.size)).then(
        (chunk) => { this.onDataRange(begin, chunk); },
        (error: unknown) => { onError(error); },
      );
    }
  }
  return new SourceRangeTransport(source.size, new Uint8Array(0));
}
