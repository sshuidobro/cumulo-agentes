import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildTxt,
  buildZip,
  DEFAULT_EXPORT_DPI,
  EXPORT_DPIS,
  estimateImagesBytes,
  exportBaseName,
  imageFileName,
  imagePixelSize,
  MAX_ZIP_BYTES,
  pageTextForExport,
  txtFileName,
  zipFileName,
} from '../../src/core/export/plan';
import { MAX_CANVAS_PIXELS } from '../../src/core/canvas-size';
import { ensureFixtures } from '../fixtures/ensure.ts';
import { FIXTURES_DIR } from '../fixtures/paths.ts';

const decoder = new TextDecoder('utf-8');

describe('constantes de exportación', () => {
  it('ofrece 72, 150, 300 y 600 ppp, con 150 por defecto, y un tope de ZIP de 1 GB', () => {
    expect([...EXPORT_DPIS]).toEqual([72, 150, 300, 600]);
    expect(DEFAULT_EXPORT_DPI).toBe(150);
    expect(MAX_ZIP_BYTES).toBe(1_000_000_000);
  });
});

describe('exportBaseName', () => {
  it('quita la extensión', () => {
    expect(exportBaseName('Informe final.PDF')).toBe('Informe final');
  });

  it('sustituye los caracteres no válidos en Windows y los de control por «_»', () => {
    expect(exportBaseName('a:b?.PDF')).toBe('a_b_');
    expect(exportBaseName('x<y>z"w/v\\u|t*s.pdf')).toBe('x_y_z_w_v_u_t_s');
    expect(exportBaseName('con\u0007control.pdf')).toBe('con_control');
  });

  it('quita puntos y espacios al final', () => {
    expect(exportBaseName('nombre . .pdf')).toBe('nombre');
    expect(exportBaseName('nombre.')).toBe('nombre');
    expect(exportBaseName('nombre   ')).toBe('nombre');
  });

  it('usa «documento» cuando no queda nada', () => {
    expect(exportBaseName('...pdf')).toBe('documento');
    expect(exportBaseName('.pdf')).toBe('documento');
    expect(exportBaseName('')).toBe('documento');
    expect(exportBaseName('   ')).toBe('documento');
  });

  it('conserva tildes, ñ y espacios interiores', () => {
    expect(exportBaseName('Año 2026 – Resumen.pdf')).toBe('Año 2026 – Resumen');
  });

  it('un nombre sin extensión se conserva entero', () => {
    expect(exportBaseName('apuntes')).toBe('apuntes');
  });
});

describe('imageFileName', () => {
  it('una página no lleva relleno: «<base>-p<N>.<ext>»', () => {
    expect(imageFileName('x', 7, 1, 'png', false)).toBe('x-p7.png');
    expect(imageFileName('x', 7, 1, 'jpeg', false)).toBe('x-p7.jpg');
  });

  it('en ZIP rellena con ceros hasta al menos 4 cifras', () => {
    expect(imageFileName('x', 7, 120, 'png', true)).toBe('x-p0007.png');
    expect(imageFileName('x', 1, 9999, 'jpeg', true)).toBe('x-p0001.jpg');
  });

  it('en ZIP el relleno sigue las cifras del total', () => {
    expect(imageFileName('x', 7, 12_000, 'png', true)).toBe('x-p00007.png');
    expect(imageFileName('x', 12_000, 12_000, 'png', true)).toBe('x-p12000.png');
  });
});

describe('nombres de ZIP y TXT', () => {
  it('zipFileName y txtFileName añaden su sufijo a la base', () => {
    expect(zipFileName('Informe')).toBe('Informe-imagenes.zip');
    expect(txtFileName('Informe')).toBe('Informe.txt');
  });
});

describe('imagePixelSize', () => {
  it('a 150 ppp una página Carta mide 1275×1650 sin recortar', () => {
    expect(imagePixelSize(612, 792, 150)).toEqual({ width: 1275, height: 1650, reduced: false });
  });

  it('sin recortar cuando cabe en MAX_CANVAS_PIXELS (300×300 pt a 600 ppp = 2500×2500)', () => {
    expect(imagePixelSize(300, 300, 600)).toEqual({ width: 2500, height: 2500, reduced: false });
  });

  it('612×792 pt a 600 ppp no cabe (5100×6600 > tope) y se recorta, con producto ≤ MAX_CANVAS_PIXELS', () => {
    expect(5100 * 6600).toBeGreaterThan(MAX_CANVAS_PIXELS);
    const size = imagePixelSize(612, 792, 600);
    expect(size.reduced).toBe(true);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(size.width).toBeLessThan(5100);
  });

  it('una página muy grande respeta el tope por lado', () => {
    const size = imagePixelSize(5000, 100, 600);
    expect(size.reduced).toBe(true);
    expect(size.width).toBeLessThanOrEqual(32_767);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  it('rechaza tamaños de página no válidos', () => {
    expect(() => imagePixelSize(0, 792, 150)).toThrow(RangeError);
  });
});

describe('estimateImagesBytes', () => {
  it('suma ancho × alto × 4 / 3 de cada página', () => {
    const sizes = [
      { widthPt: 612, heightPt: 792 },
      { widthPt: 300, heightPt: 300 },
    ];
    // 612×792 a 72 ppp = 612×792 px; 300×300 a 72 ppp = 300×300 px.
    const expected = ((612 * 792 + 300 * 300) * 4) / 3;
    expect(estimateImagesBytes(sizes, 72)).toBe(Math.ceil(expected));
  });

  it('crece con la resolución y es 0 sin páginas', () => {
    const sizes = [{ widthPt: 612, heightPt: 792 }];
    expect(estimateImagesBytes(sizes, 300)).toBeGreaterThan(estimateImagesBytes(sizes, 150));
    expect(estimateImagesBytes([], 150)).toBe(0);
  });
});

describe('pageTextForExport', () => {
  it('concatena los ítems como la búsqueda y quita los espacios finales de cada línea', () => {
    const items = [
      { str: 'Hola  \nmundo  ', hasEOL: false },
      { str: 'uno ', hasEOL: true },
      { str: 'fin\t', hasEOL: false },
    ];
    expect(pageTextForExport(items)).toBe('Hola\nmundo  uno fin');
  });

  it('una página sin texto da cadena vacía', () => {
    expect(pageTextForExport([])).toBe('');
  });
});

describe('buildTxt', () => {
  it('UTF-8 con BOM, saltos \\r\\n, páginas separadas por \\r\\n\\f\\r\\n y termina en \\r\\n', () => {
    const bytes = buildTxt(['Hola\nmundo', 'Adiós']);

    const expected = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Hola\r\nmundo\r\n\f\r\nAdiós\r\n')]);
    expect(bytes).toEqual(expected);
    expect(decoder.decode(bytes.subarray(3))).toBe('Hola\r\nmundo\r\n\f\r\nAdiós\r\n');
  });

  it('normaliza \\r y \\r\\n sueltos a \\r\\n', () => {
    expect(decoder.decode(buildTxt(['a\rb\r\nc\nd']).subarray(3))).toBe('a\r\nb\r\nc\r\nd\r\n');
  });

  it('conserva tildes, ñ y emojis en UTF-8', () => {
    expect(decoder.decode(buildTxt(['Niño 😀']).subarray(3))).toBe('Niño 😀\r\n');
  });
});

describe('buildZip', () => {
  it('las entradas se descomprimen con los mismos nombres, bytes y orden', () => {
    const entries = [
      { name: 'x-p0001.png', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'x-p0002.png', bytes: new Uint8Array([4, 5]) },
      { name: 'x-p0003.png', bytes: new Uint8Array([]) },
    ];

    const unzipped = unzipSync(buildZip(entries));

    expect(Object.keys(unzipped)).toEqual(['x-p0001.png', 'x-p0002.png', 'x-p0003.png']);
    for (const entry of entries) {
      expect(unzipped[entry.name]).toEqual(entry.bytes);
    }
  });

  it('no recomprime: las entradas se guardan sin compresión', () => {
    const big = new Uint8Array(10_000).fill(7);
    const zip = buildZip([{ name: 'a.bin', bytes: big }]);
    // El ZIP guardado sin comprimir ocupa al menos el contenido.
    expect(zip.byteLength).toBeGreaterThan(big.byteLength);
    expect(unzipSync(zip)['a.bin']).toEqual(big);
  });

  it('rechaza nombres repetidos en vez de perder una entrada', () => {
    expect(() => buildZip([
      { name: 'a.png', bytes: new Uint8Array([1]) },
      { name: 'a.png', bytes: new Uint8Array([2]) },
    ])).toThrow(RangeError);
  });
});

describe('texto de basic-5.pdf con pdf.js', () => {
  async function withDocument<T>(name: string, callback: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
    const task = getDocument({ data: new Uint8Array(readFileSync(join(FIXTURES_DIR, name))), verbosity: 0 });
    try {
      return await callback(await task.promise);
    } finally {
      await task.destroy();
    }
  }

  it('el TXT contiene las cinco líneas «Página N de 5» en orden', async () => {
    ensureFixtures();
    const pages = await withDocument('basic-5.pdf', async (doc) => {
      const texts: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
        texts.push(pageTextForExport(content.items.filter((item) => 'str' in item)));
      }
      return texts;
    });

    const txt = decoder.decode(buildTxt(pages).subarray(3));
    const positions = [1, 2, 3, 4, 5].map((n) => txt.indexOf(`Página ${n} de 5`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(txt.startsWith('Página 1 de 5')).toBe(true);
  });
});
