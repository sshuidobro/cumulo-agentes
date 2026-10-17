import type { FileFilter } from '../types';
import type { FilePickerAcceptType } from './fs-access';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  csv: 'text/csv',
};

const FALLBACK_MIME = 'application/octet-stream';

function bareExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase();
}

function mimeFor(extension: string): string {
  return MIME_BY_EXTENSION[bareExtension(extension)] ?? FALLBACK_MIME;
}

/** Convierte filtros de la app en tipos de `showOpenFilePicker`: uno por filtro. */
export function toAcceptTypes(filters: readonly FileFilter[]): FilePickerAcceptType[] {
  return filters
    .filter((filter) => filter.extensions.length > 0)
    .map((filter) => {
      const accept: Record<string, string[]> = {};
      for (const extension of filter.extensions) {
        const mime = mimeFor(extension);
        const dotted = `.${bareExtension(extension)}`;
        accept[mime] = [...(accept[mime] ?? []), dotted];
      }
      return { description: filter.name, accept };
    });
}

/** Valor del atributo `accept` de un `<input type=file>`, p. ej. `.pdf,application/pdf`. */
export function toAcceptAttribute(filters: readonly FileFilter[]): string {
  const tokens = new Set<string>();
  for (const filter of filters) {
    for (const extension of filter.extensions) {
      tokens.add(`.${bareExtension(extension)}`);
      const mime = MIME_BY_EXTENSION[bareExtension(extension)];
      if (mime !== undefined) tokens.add(mime);
    }
  }
  return [...tokens].join(',');
}
