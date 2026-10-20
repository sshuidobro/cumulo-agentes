import { describe, expect, it } from 'vitest';
import { loadPdf } from '../../../src/engine/load';
import { createPageTextSource } from '../../../src/engine/search-source';
import { buildPageText, type TextItemLike, type TextPos } from '../../../src/core/search/page-text';
import { MAX_CHUNK_CHARS, pageChunks } from '../../../src/core/read-aloud/chunks';
import { fixtureSource, nodeAssetBase } from '../../helpers/pdfjs-node';

/** Texto que hay entre dos posiciones de los ítems (sin los `\n` añadidos entre ítems). */
function textBetween(items: readonly TextItemLike[], start: TextPos, end: TextPos): string {
  const pt = buildPageText(items);
  const from = (pt.itemStarts[start.item] ?? 0) + start.offset;
  const to = (pt.itemStarts[end.item] ?? 0) + end.offset;
  return pt.raw.slice(from, to);
}

function item(str: string, hasEOL = false): TextItemLike {
  return { str, hasEOL };
}

describe('pageChunks con basic-5.pdf (documento real)', () => {
  it('la página 1 es un único fragmento con su texto y posiciones exactas', async () => {
    const result = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl: nodeAssetBase() });
    if (!result.ok) throw new Error(`No se pudo abrir basic-5.pdf: ${result.error.code}`);
    try {
      const items = await createPageTextSource(result.value.doc).getPageItems(0, new AbortController().signal);
      const chunks = pageChunks(0, items);
      expect(chunks.map((c) => c.text)).toEqual([
        'Página 1 de 5 marcador-1 El veloz murciélago hindú comía feliz cardillo y kiwi.',
      ]);
      const [chunk] = chunks;
      expect(chunk?.pageIndex).toBe(0);
      expect(chunk?.start).toEqual({ item: 0, offset: 0 });
      expect(chunk?.end).toEqual({ item: 2, offset: 54 });
      if (chunk !== undefined) expect(textBetween(items, chunk.start, chunk.end)).toBe('Página 1 de 5\nmarcador-1\nEl veloz murciélago hindú comía feliz cardillo y kiwi.');
    } finally {
      await result.value.destroy();
    }
  });
});

describe('pageChunks (ítems sintéticos)', () => {
  it('sin ítems o solo con espacios no hay fragmentos', () => {
    expect(pageChunks(0, [])).toEqual([]);
    expect(pageChunks(0, [item('   '), item('\n', true)])).toEqual([]);
  });

  it('cada frase es un fragmento y sus posiciones señalan su texto en los ítems', () => {
    const items = [item('Hola mundo. ', true), item('Adiós mundo.', false)];
    const chunks = pageChunks(2, items);
    expect(chunks.map((c) => c.text)).toEqual(['Hola mundo.', 'Adiós mundo.']);
    expect(chunks.every((c) => c.pageIndex === 2)).toBe(true);
    for (const c of chunks) expect(textBetween(items, c.start, c.end)).toBe(c.text);
  });

  it('un límite exacto entre ítems se expresa como el final del ítem anterior', () => {
    const items = [item('Hola.'), item(' Adiós.')];
    const chunks = pageChunks(0, items);
    expect(chunks.map((c) => c.text)).toEqual(['Hola.', 'Adiós.']);
    expect(chunks[0]?.end).toEqual({ item: 0, offset: 5 });
    expect(chunks[1]?.start).toEqual({ item: 1, offset: 1 });
  });

  it('una frase de 450 caracteres se parte en 3 fragmentos de como mucho 200, en espacios', () => {
    const words = Array.from({ length: 45 }, () => 'aaaaaaaaa');
    const sentence = `${words.join(' ')}.`;
    expect(sentence.length).toBe(450);
    const items = [item(sentence)];
    const chunks = pageChunks(0, items);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(c.text).toMatch(/^a{9}( a{9})*\.?$/);
      expect(textBetween(items, c.start, c.end)).toBe(c.text);
    }
    expect(chunks.map((c) => c.text).join(' ')).toBe(sentence);
  });

  it('sin espacios donde cortar, el corte es a 200 caracteres', () => {
    const chunks = pageChunks(0, [item(`${'x'.repeat(250)}.`)]);
    expect(chunks.map((c) => c.text.length)).toEqual([200, 51]);
  });

  it('no parte un par de sustitutos (emoji) en el corte duro', () => {
    const text = `${'x'.repeat(199)}😀${'x'.repeat(50)}`;
    const chunks = pageChunks(0, [item(text)]);
    expect(chunks.map((c) => c.text)).toEqual(['x'.repeat(199), `😀${'x'.repeat(50)}`]);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it('«docu-» y «mento» en líneas distintas se leen «documento»', () => {
    const chunks = pageChunks(0, [item('docu-', true), item('mento.', false)]);
    expect(chunks.map((c) => c.text)).toEqual(['documento.']);
  });

  it('un guion seguido de salto de línea entre no letras se conserva', () => {
    const chunks = pageChunks(0, [item('2024-', true), item('05.', false)]);
    expect(chunks.map((c) => c.text)).toEqual(['2024- 05.']);
  });

  it('los saltos de línea dentro de una frase se leen como espacios', () => {
    const chunks = pageChunks(0, [item('Primera línea', true), item('segunda línea.', false)]);
    expect(chunks.map((c) => c.text)).toEqual(['Primera línea segunda línea.']);
  });

  it('sin Intl.Segmenter se corta tras [.!?…] seguido de espacio', () => {
    const original = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true });
    try {
      const items = [item('Uno dos. Tres cuatro? Cinco… seis')];
      const chunks = pageChunks(0, items);
      expect(chunks.map((c) => c.text)).toEqual(['Uno dos.', 'Tres cuatro?', 'Cinco…', 'seis']);
    } finally {
      if (original !== undefined) Object.defineProperty(Intl, 'Segmenter', original);
    }
  });
});
