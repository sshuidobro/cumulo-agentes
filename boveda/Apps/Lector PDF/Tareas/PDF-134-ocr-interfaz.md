---
tipo: tarea
id: PDF-134
titulo: OCR - diálogo «Reconocer texto», progreso y guardado
app: pdf
estado: pendiente
depende_de: [PDF-061, PDF-133, PDF-132]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, ocr, ui]
---

# PDF-134 · OCR: diálogo «Reconocer texto», progreso y guardado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0038-ocr-local-tesseract]] · Antes: [[PDF-061-ocr]], [[PDF-133-ocr-motor]]

## Objetivo
«Más acciones → Reconocer texto (OCR)…» reconoce las páginas escaneadas (todas, la actual o un rango; en español, inglés o ambos), con progreso por página y cancelar, y guarda la capa de texto invisible en el PDF, que pasa a ser buscable y copiable. Nada sale del equipo.

## Contexto
- `src/engine/ocr.ts` → `createOcrEngine`, `OcrWordPx` (PDF-133); op `'ocr-layer'` y tipos `OcrPage`, `OcrWord` (PDF-061).
- `src/engine/print-render.ts` → `renderPageImage` (PNG a un ppp dado, sin comentarios); `src/state/print-source.ts` → `openPrintSource` (documento con los cambios sin guardar).
- `src/engine/search-source.ts` → `createPageTextSource` (saber si una página ya tiene texto).
- `src/state/save-actions.ts` → `buildCurrentDelta`, `writeDocument({ kind: 'append' })`; `src/state/doc-ops.ts`; `src/state/extract-actions.ts` → `useDocOpJob`; `src/ui/kit/DocOpProgress.tsx`.
- **Patrón de diálogo**: `src/ui/export/ExportDialog.tsx` (PDF-113), `src/core/print/range.ts` → `parsePageRange`.

## Qué hay que hacer
1. `src/engine/ocr-page.ts`:
```ts
/** Reconoce la página `index` de `doc` a 300 ppp. Convierte cada caja de píxeles a espacio de usuario con el viewport usado (`convertToPdfPoint` de las dos esquinas, min/max). */
export async function recognizePage(doc: PDFDocumentProxy, index: number, engine: OcrEngine, signal: AbortSignal): Promise<OcrPage | 'cancelled'>;
/** `true` si la página tiene algún carácter no blanco en su capa de texto. */
export async function pageHasText(doc: PDFDocumentProxy, index: number): Promise<boolean>;
```
2. `src/state/ocr-actions.ts`:
```ts
export interface OcrForm { readonly pages: 'all' | 'current' | 'range'; readonly range: string; readonly lang: OcrLanguage; readonly skipText: boolean }
export const OCR_OPTIONS_PREF = 'ocr-options';
export const useOcrDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly form: OcrForm }>>;
export async function runOcr(form: OcrForm): Promise<SaveResult | 'cancelled'>;
export function cancelOcr(): void;
```
   - Páginas a reconocer según el formulario; con `skipText`, se omiten las que ya tienen texto. Ninguna → aviso «Todas las páginas elegidas ya tienen texto.» y nada más.
   - Documento para dibujar: `openPrintSource()` (incluye cambios sin guardar; `dispose` al terminar). Motor: `createOcrEngine(lang, assetBaseUrl)`, uno para toda la tarea, `terminate()` al terminar o cancelar.
   - Progreso «Reconociendo página X de Y…» (`useDocOpJob`); entre páginas se cede el hilo.
   - Al terminar: `prefix` de `buildCurrentDelta` → op `'ocr-layer'` sobre `concatSource(file.source, prefix)` → `writeDocument({ kind: 'append', delta: prefix + delta })` → aviso «Texto reconocido en N páginas.». Ninguna palabra reconocida → aviso «No se ha reconocido texto.» y nada escrito.
   - Más de 50 páginas → confirmación previa con `askChoice` («Reconocer N páginas puede tardar varios minutos.»).
   - Preferencias recordadas (idioma, omitir con texto).
3. `src/ui/ocr/OcrDialog.tsx` (+ CSS, `lazy`): páginas (como exportar), «Idioma del documento» (`select`: Español / Inglés / Español e inglés), casilla «Omitir páginas que ya tienen texto», nota «El reconocimiento se hace en este equipo; el documento no se envía a ningún sitio.», botón «Reconocer».
4. `DocumentMenu.tsx`: «Reconocer texto (OCR)…».
5. `src/ui/messages-ocr.ts` (`ocrMsg`) con todos los textos citados y `menuItem`, `title` «Reconocer texto», `language`, `spa`, `eng`, `both`, `skipText`, `privacy`, `run` «Reconocer», `progress(done, total)`, `done(n)`, `nothing`, `allHaveText`, `many(n)`.
6. Tests: `tests/unit/ocr-actions.test.ts` (motor falso), `tests/ui/ocr-dialog.test.tsx`, `tests/e2e/ocr.spec.ts`.

## Criterios de aceptación
- [ ] **Criterio original** (E2E): abrir `scanned-es-3.pdf` → la búsqueda de «Panadería» no encuentra nada → Reconocer texto (todas, Español) → al terminar, la búsqueda encuentra «Panadería» en la página 1, «arrendatario» en la 2 y «eléctrica» en la 3; seleccionar y copiar la línea del importe da un texto que contiene «1.234,56».
- [ ] **Sin red** (E2E): durante toda la prueba, ninguna petición (`page.on('request')`) va a un origen distinto del de la app.
- [ ] E2E: «Cancelar» a mitad → no se guarda nada y el documento sigue igual.
- [ ] E2E con `basic-5.pdf` (ya tiene texto) y «Omitir páginas que ya tienen texto» → aviso «Todas las páginas elegidas ya tienen texto.».
- [ ] E2E `@perf`: durante el OCR de una página no hay *long tasks* > 100 ms (dibujo y reconocimiento van en Workers).
- [ ] Unit: conversión de cajas píxel → PDF correcta con giro 0 y 90 (viewport falso); motor que falla → aviso en español y nada escrito.
- [ ] Teclado y accesibilidad: diálogo operable con teclado; axe sin violaciones; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- OCR automático al abrir. Enderezar páginas torcidas. Sustituir la imagen por texto («ClearScan»).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
