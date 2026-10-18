import { describe, expect, it } from 'vitest';
import { PageDimsTable } from '../../src/core/page-dims';
import {
  isSidebarState,
  nextThumbnailPage,
  sidebarForPageMode,
  sidebarOnOpen,
  thumbnailScale,
  THUMB_GAP,
  THUMB_PADDING,
  THUMB_WIDTH,
} from '../../src/core/sidebar';
import { computeLayout, visibleRange } from '../../src/core/layout';

describe('isSidebarState (guarda de la preferencia)', () => {
  it('acepta solo los cuatro estados del panel', () => {
    for (const value of ['none', 'thumbnails', 'outline', 'comments']) {
      expect(isSidebarState(value)).toBe(true);
    }
    for (const value of ['', 'Thumbnails', 'tabs', null, undefined, 3, { sidebar: 'none' }]) {
      expect(isSidebarState(value)).toBe(false);
    }
  });
});

describe('sidebarForPageMode y sidebarOnOpen', () => {
  it('UseThumbs abre miniaturas y UseOutlines abre el índice; otros modos no piden pestaña', () => {
    expect(sidebarForPageMode('UseThumbs')).toBe('thumbnails');
    expect(sidebarForPageMode('UseOutlines')).toBe('outline');
    expect(sidebarForPageMode('UseNone')).toBeNull();
    expect(sidebarForPageMode('FullScreen')).toBeNull();
    expect(sidebarForPageMode(null)).toBeNull();
  });

  it('el PageMode del documento manda sobre lo guardado; sin PageMode vale lo guardado; por defecto cerrado', () => {
    expect(sidebarOnOpen('UseOutlines', 'thumbnails')).toBe('outline');
    expect(sidebarOnOpen('UseThumbs', 'none')).toBe('thumbnails');
    expect(sidebarOnOpen('UseNone', 'comments')).toBe('comments');
    expect(sidebarOnOpen(null, 'thumbnails')).toBe('thumbnails');
    expect(sidebarOnOpen(null, null)).toBe('none');
  });
});

describe('thumbnailScale', () => {
  it('la primera página, ya girada, ocupa THUMB_WIDTH píxeles', () => {
    const portrait = PageDimsTable.uniform(3, 612, 792, 0);
    expect(thumbnailScale(portrait, 0) * 612).toBeCloseTo(THUMB_WIDTH, 9);
    // Girada 90° la anchura es el alto de la página.
    expect(thumbnailScale(portrait, 90) * 792).toBeCloseTo(THUMB_WIDTH, 9);
  });

  it('tiene en cuenta la rotación propia de la página además de la de la vista', () => {
    const rotated = PageDimsTable.uniform(2, 612, 792, 90);
    // Con /Rotate 90 la anchura visible es 792; con rotación de vista 90 vuelve a ser 612.
    expect(thumbnailScale(rotated, 0) * 792).toBeCloseTo(THUMB_WIDTH, 9);
    expect(thumbnailScale(rotated, 90) * 612).toBeCloseTo(THUMB_WIDTH, 9);
  });

  it('no produce una escala infinita con una página de tamaño cero', () => {
    const empty = PageDimsTable.uniform(1, 0, 0, 0);
    expect(Number.isFinite(thumbnailScale(empty, 0))).toBe(true);
  });

  it('con 100 000 páginas el layout de miniaturas se calcula sin perder la escala', () => {
    const dims = PageDimsTable.uniform(100_000, 612, 792, 0);
    const layout = computeLayout(dims, {
      scale: thumbnailScale(dims, 0),
      rotation: 0,
      gap: THUMB_GAP,
      padding: THUMB_PADDING,
    });
    expect(layout.count).toBe(100_000);
    expect(layout.widths[0]).toBeCloseTo(THUMB_WIDTH, 9);
    // Una franja de 600 px muestra pocas miniaturas, aunque el documento sea enorme.
    const range = visibleRange(layout, 0, 600, 0);
    expect(range.last - range.first + 1).toBeLessThanOrEqual(4);
  });
});

describe('nextThumbnailPage (teclado de la lista)', () => {
  it('flechas, Inicio y Fin mueven de una en una o al principio y final', () => {
    expect(nextThumbnailPage('ArrowDown', 4, 10, 3)).toBe(5);
    expect(nextThumbnailPage('ArrowUp', 4, 10, 3)).toBe(3);
    expect(nextThumbnailPage('Home', 4, 10, 3)).toBe(0);
    expect(nextThumbnailPage('End', 4, 10, 3)).toBe(9);
  });

  it('Re Pág y Av Pág avanzan o retroceden una pantalla de miniaturas', () => {
    expect(nextThumbnailPage('PageDown', 2, 100, 5)).toBe(7);
    expect(nextThumbnailPage('PageUp', 8, 100, 5)).toBe(3);
    // Sin miniaturas visibles calculadas, avanza al menos una.
    expect(nextThumbnailPage('PageDown', 2, 100, 0)).toBe(3);
  });

  it('no sale del rango de páginas', () => {
    expect(nextThumbnailPage('ArrowUp', 0, 10, 3)).toBe(0);
    expect(nextThumbnailPage('ArrowDown', 9, 10, 3)).toBe(9);
    expect(nextThumbnailPage('PageDown', 8, 10, 5)).toBe(9);
    expect(nextThumbnailPage('PageUp', 1, 10, 5)).toBe(0);
  });

  it('las teclas que no son de navegación y los documentos sin páginas devuelven null', () => {
    expect(nextThumbnailPage('a', 0, 10, 3)).toBeNull();
    expect(nextThumbnailPage('Enter', 0, 10, 3)).toBeNull();
    expect(nextThumbnailPage('ArrowDown', 0, 0, 3)).toBeNull();
  });
});
