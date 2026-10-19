import { describe, expect, it } from 'vitest';
import {
  checkBundle,
  ENTRY_JS_BUDGET_BYTES,
  PDFJS_SRC_SUFFIX,
  type Manifest,
} from '../bundle/bundle-budget.ts';

const PDF_KEY = `node_modules/${PDFJS_SRC_SUFFIX}`;

function sizes(table: Record<string, number>): (file: string) => number {
  return (file) => {
    const size = table[file];
    if (size === undefined) throw new Error(`Tamaño desconocido: ${file}`);
    return size;
  };
}

describe('checkBundle', () => {
  it('acepta un arranque dentro del presupuesto con pdf.js diferido', () => {
    const manifest: Manifest = {
      'index.html': {
        file: 'assets/index.js',
        src: 'index.html',
        isEntry: true,
        imports: ['_vendor.js'],
        dynamicImports: [PDF_KEY],
      },
      '_vendor.js': { file: 'assets/vendor.js' },
      [PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true },
    };
    const report = checkBundle(
      manifest,
      sizes({ 'assets/index.js': 300_000, 'assets/vendor.js': 100_000, 'assets/pdf.js': 400_000 }),
    );
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.entryBytes).toBe(400_000);
    expect(report.staticFiles).toEqual(['assets/index.js', 'assets/vendor.js']);
  });

  it('falla si el arranque supera el presupuesto', () => {
    const manifest: Manifest = {
      'index.html': {
        file: 'assets/index.js',
        src: 'index.html',
        isEntry: true,
        imports: ['_vendor.js'],
        dynamicImports: [PDF_KEY],
      },
      '_vendor.js': { file: 'assets/vendor.js' },
      [PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true },
    };
    const report = checkBundle(
      manifest,
      sizes({ 'assets/index.js': 450_000, 'assets/vendor.js': 200_000, 'assets/pdf.js': 400_000 }),
    );
    expect(report.ok).toBe(false);
    expect(report.entryBytes).toBe(650_000);
    expect(report.errors).toEqual([
      'El JavaScript de arranque pesa 650000 bytes (máximo 600000).',
    ]);
    expect(ENTRY_JS_BUDGET_BYTES).toBe(600_000);
  });

  it('informa de un error si pdf.js está en la entrada y no tiene clave propia', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/index.js', src: 'index.html', isEntry: true },
    };
    const report = checkBundle(manifest, sizes({ 'assets/index.js': 100_000 }));
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(['pdf.js no está en un chunk diferido (import()).']);
  });

  it('informa de un error si pdf.js es diferido pero también se importa de forma estática', () => {
    const manifest: Manifest = {
      'index.html': {
        file: 'assets/index.js',
        src: 'index.html',
        isEntry: true,
        imports: [PDF_KEY],
      },
      [PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true },
    };
    const report = checkBundle(
      manifest,
      sizes({ 'assets/index.js': 10_000, 'assets/pdf.js': 100_000 }),
    );
    expect(report.ok).toBe(false);
    expect(report.entryBytes).toBe(110_000);
    expect(report.errors).toEqual(['pdf.js se carga de forma estática al arrancar.']);
  });

  it('termina con ciclos en imports y cuenta cada fichero una vez', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/index.js', isEntry: true, imports: ['a.js'] },
      'a.js': { file: 'assets/a.js', imports: ['b.js'] },
      'b.js': { file: 'assets/b.js', imports: ['a.js'] },
      [PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true },
    };
    const report = checkBundle(
      manifest,
      sizes({ 'assets/index.js': 1, 'assets/a.js': 10, 'assets/b.js': 20, 'assets/pdf.js': 30 }),
    );
    expect(report.ok).toBe(true);
    expect(report.staticFiles).toEqual(['assets/index.js', 'assets/a.js', 'assets/b.js']);
    expect(report.entryBytes).toBe(31);
  });

  it('devuelve error de entrada si no hay index.html', () => {
    const manifest: Manifest = {
      [PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true },
    };
    const report = checkBundle(manifest, sizes({}));
    expect(report).toEqual({
      ok: false,
      entryBytes: 0,
      staticFiles: [],
      errors: ['No hay entrada index.html en el manifiesto.'],
    });
  });
});
