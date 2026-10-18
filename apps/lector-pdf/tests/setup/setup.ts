import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { loadPdfjs } from '../../src/engine/pdfjs';
import { installResizeObserver } from './resize-observer';

installResizeObserver();
// pdf.js se carga en diferido (ADR-0017): los tests que usan el motor sin `loadPdf` necesitan que ya esté cargado.
await loadPdfjs();

afterEach(cleanup);
