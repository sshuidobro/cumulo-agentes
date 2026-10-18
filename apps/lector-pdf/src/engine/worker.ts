import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { setPdfjsWorkerSrc } from './pdfjs';

setPdfjsWorkerSrc(workerUrl);
