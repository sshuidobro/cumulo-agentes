export interface ManifestChunk {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly isDynamicEntry?: boolean;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
}

export type Manifest = Readonly<Record<string, ManifestChunk>>;

export const ENTRY_JS_BUDGET_BYTES = 500_000;
export const PDFJS_SRC_SUFFIX = 'pdfjs-dist/legacy/build/pdf.mjs';

export interface BundleReport {
  readonly ok: boolean;
  readonly entryBytes: number;
  /** Ficheros `.js` que se cargan de forma estática al arrancar (entrada + `imports` recursivos), sin repetir. */
  readonly staticFiles: readonly string[];
  readonly errors: readonly string[];
}

const ENTRY_KEY = 'index.html';

export function checkBundle(manifest: Manifest, sizeOf: (file: string) => number): BundleReport {
  const entry = manifest[ENTRY_KEY];
  if (entry?.isEntry !== true) {
    return {
      ok: false,
      entryBytes: 0,
      staticFiles: [],
      errors: [`No hay entrada ${ENTRY_KEY} en el manifiesto.`],
    };
  }

  // Cierre estático: solo `imports`, nunca `dynamicImports`.
  const visited = new Set<string>();
  const staticKeys: string[] = [];
  const stack: string[] = [ENTRY_KEY];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key === undefined || visited.has(key)) continue;
    visited.add(key);
    staticKeys.push(key);
    const chunk = manifest[key];
    if (chunk === undefined) continue;
    const imports = chunk.imports ?? [];
    // Se apilan en orden inverso para visitarlos en el orden en que aparecen.
    for (let i = imports.length - 1; i >= 0; i--) {
      const next = imports[i];
      if (next !== undefined && !visited.has(next)) stack.push(next);
    }
  }

  const staticFiles: string[] = [];
  let entryBytes = 0;
  for (const key of staticKeys) {
    const file = manifest[key]?.file;
    if (file === undefined || !file.endsWith('.js')) continue;
    staticFiles.push(file);
    entryBytes += sizeOf(file);
  }

  const errors: string[] = [];
  if (entryBytes > ENTRY_JS_BUDGET_BYTES) {
    errors.push(
      `El JavaScript de arranque pesa ${entryBytes} bytes (máximo ${ENTRY_JS_BUDGET_BYTES}).`,
    );
  }

  const pdfKey = Object.keys(manifest).find((key) => key.endsWith(PDFJS_SRC_SUFFIX));
  if (pdfKey === undefined || manifest[pdfKey]?.isDynamicEntry !== true) {
    errors.push('pdf.js no está en un chunk diferido (import()).');
  }
  if (pdfKey !== undefined && visited.has(pdfKey)) {
    errors.push('pdf.js se carga de forma estática al arrancar.');
  }

  return { ok: errors.length === 0, entryBytes, staticFiles, errors };
}
