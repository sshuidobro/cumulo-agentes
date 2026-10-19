import { Buffer } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOcrEngineNode } from '../helpers/ocr-node.ts';
import type { OcrEngine, OcrWordPx } from '../../src/engine/ocr.ts';
import { buildScannedDocument, scannedPageJpeg, SCANNED_HEIGHT, SCANNED_WIDTH } from '../fixtures/scanned.ts';

const OCR_TIMEOUT_MS = 60_000;

describe('motor OCR (tesseract.js, Node)', () => {
  let engine: OcrEngine;

  beforeAll(async () => {
    engine = await createOcrEngineNode('spa');
  }, OCR_TIMEOUT_MS);

  afterAll(async () => {
    await engine.terminate();
  });

  it('reconoce las palabras de la página 1 del escaneado con cajas dentro de la imagen', async () => {
    const jpeg = scannedPageJpeg(1);
    // El PDF escaneado embebe exactamente esta imagen de página.
    expect(Buffer.from(buildScannedDocument()).includes(Buffer.from(jpeg))).toBe(true);
    const image = new Blob([jpeg], { type: 'image/jpeg' });

    const result = await engine.recognize(image, new AbortController().signal);

    expect(result).not.toBe('cancelled');
    const words = result as readonly OcrWordPx[];
    const texts = words.map((w) => w.text.toLowerCase());
    for (const expected of ['factura', '2026-0042', 'panadería', 'muñoz']) {
      expect(texts).toContain(expected);
    }
    for (const word of words) {
      expect(word.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(word.bbox.y0).toBeGreaterThanOrEqual(0);
      expect(word.bbox.x1).toBeLessThanOrEqual(SCANNED_WIDTH);
      expect(word.bbox.y1).toBeLessThanOrEqual(SCANNED_HEIGHT);
      expect(word.bbox.x1).toBeGreaterThan(word.bbox.x0);
      expect(word.bbox.y1).toBeGreaterThan(word.bbox.y0);
    }
  }, OCR_TIMEOUT_MS);

  it('devuelve cancelled si la señal ya está abortada, sin reconocer', async () => {
    const controller = new AbortController();
    controller.abort();
    const image = new Blob([scannedPageJpeg(2)], { type: 'image/jpeg' });

    await expect(engine.recognize(image, controller.signal)).resolves.toBe('cancelled');
  }, OCR_TIMEOUT_MS);

  it('tras una cancelación recrea el worker y vuelve a reconocer', async () => {
    const image = new Blob([scannedPageJpeg(3)], { type: 'image/jpeg' });
    const controller = new AbortController();
    const pending = engine.recognize(image, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe('cancelled');

    const result = await engine.recognize(image, new AbortController().signal);
    expect(result).not.toBe('cancelled');
    const texts = (result as readonly OcrWordPx[]).map((w) => w.text.toLowerCase());
    expect(texts).toContain('conclusión:');
  }, OCR_TIMEOUT_MS);
});
