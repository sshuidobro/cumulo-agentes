import { describe, expect, it } from 'vitest';
import { NOTE_SIZE_PT, keyboardNoteRect, newNoteAnnotation, noteRectAt } from '../../../src/core/annotations/note';
import { isAnnotation } from '../../../src/core/annotations/model';
import {
  isBoxOnPage,
  pageBox,
  popupPlacement,
  POPUP_GAP_PX,
  POPUP_MAX_HEIGHT_PX,
  POPUP_WIDTH_PX,
} from '../../../src/ui/viewer/popup-placement';

const PAGE: [number, number, number, number] = [0, 0, 612, 792];

describe('noteRectAt (PDF-033)', () => {
  it('la esquina superior izquierda de la nota es el punto dado y mide 20 × 20 pt', () => {
    expect(NOTE_SIZE_PT).toBe(20);
    expect(noteRectAt(100, 692, PAGE)).toEqual([100, 672, 120, 692]);
  });

  it('se desplaza hacia dentro si el punto está cerca del borde derecho, inferior o superior de la página', () => {
    expect(noteRectAt(610, 400, PAGE)).toEqual([592, 380, 612, 400]);
    expect(noteRectAt(300, 5, PAGE)).toEqual([300, 0, 320, 20]);
    expect(noteRectAt(300, 900, PAGE)).toEqual([300, 772, 320, 792]);
  });

  it('en una página más estrecha que la nota, se pega al borde izquierdo', () => {
    expect(noteRectAt(50, 50, [0, 0, 10, 100])).toEqual([0, 30, 20, 50]);
  });
});

describe('newNoteAnnotation (PDF-033)', () => {
  it('crea una nota nueva sin texto, cerrada, con el icono Comentario y válida según el modelo', () => {
    const note = newNoteAnnotation({
      id: 'suite-x',
      pageIndex: 2,
      rect: [100, 672, 120, 692],
      color: [1, 0.9, 0],
      author: 'Ana',
      now: '2026-10-18T10:00:00.000Z',
    });
    expect(note).toEqual({
      id: 'suite-x',
      type: 'note',
      pageIndex: 2,
      rect: [100, 672, 120, 692],
      icon: 'Comment',
      open: false,
      color: [1, 0.9, 0],
      opacity: 1,
      contents: '',
      author: 'Ana',
      modified: '2026-10-18T10:00:00.000Z',
      created: '2026-10-18T10:00:00.000Z',
      origin: { kind: 'new' },
    });
    expect(isAnnotation(note)).toBe(true);
  });
});

describe('popupPlacement (PDF-033)', () => {
  const page = { width: 612, height: 792 };

  it('se coloca a la derecha de la anotación si cabe', () => {
    const box = { left: 100, top: 300, right: 120, bottom: 320 };
    expect(popupPlacement(box, page)).toEqual({ left: 120 + POPUP_GAP_PX, top: 300, width: POPUP_WIDTH_PX });
  });

  it('se coloca a la izquierda si a la derecha no cabe', () => {
    const box = { left: 500, top: 300, right: 520, bottom: 320 };
    expect(popupPlacement(box, page)).toEqual({ left: 500 - POPUP_GAP_PX - POPUP_WIDTH_PX, top: 300, width: POPUP_WIDTH_PX });
  });

  it('nunca sale de la página: se pega al borde y limita la parte superior', () => {
    const narrow = popupPlacement({ left: 10, top: 0, right: 30, bottom: 20 }, { width: 200, height: 792 });
    expect(narrow.left).toBeGreaterThanOrEqual(0);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(200);

    const low = popupPlacement({ left: 100, top: 780, right: 120, bottom: 790 }, page);
    expect(low.top).toBe(792 - POPUP_MAX_HEIGHT_PX);
  });

  it('una página más estrecha que la ventana le da su ancho', () => {
    expect(popupPlacement({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 150, height: 300 }).width).toBe(150);
  });
});

describe('pageBox e isBoxOnPage (PDF-033)', () => {
  it('convierte un rect en puntos a una caja en píxeles con la matriz de pdf.js (escala 2, rotación 0)', () => {
    const transform = [2, 0, 0, -2, 0, 1584];
    expect(pageBox(transform, [100, 700, 120, 720])).toEqual({ left: 200, top: 144, right: 240, bottom: 184 });
  });

  it('una caja fuera de la página no está en ella', () => {
    expect(isBoxOnPage({ left: 700, top: 0, right: 720, bottom: 10 }, { width: 612, height: 792 })).toBe(false);
    expect(isBoxOnPage({ left: 600, top: 780, right: 620, bottom: 800 }, { width: 612, height: 792 })).toBe(true);
  });
});

describe('keyboardNoteRect (PDF-072)', () => {
  const W = 612;
  const H = 792;

  it.each([
    [0, 0, [24, 748, 44, 768]],
    [90, 0, [24, 24, 44, 44]],
    [180, 0, [568, 24, 588, 44]],
    [270, 0, [568, 748, 588, 768]],
    [0, 0.5, [24, 352, 44, 372]],
    [0, 1, [24, 0, 44, 20]],
    [-90, 0, [568, 748, 588, 768]],
  ])('rotación %i y fracción %f → %j', (rotation, yFraction, expected) => {
    expect(keyboardNoteRect(W, H, rotation, yFraction)).toEqual(expected);
  });

  it('con rotación 90 el alto visible es el ancho de la página: la fracción se mide sobre él', () => {
    expect(keyboardNoteRect(W, H, 90, 0.5)).toEqual([330, 24, 350, 44]);
  });
});
