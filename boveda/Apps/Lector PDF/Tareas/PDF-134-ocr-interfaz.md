---
tipo: tarea
id: PDF-134
titulo: OCR - diálogo «Reconocer texto», progreso y guardado
app: pdf
estado: en-test
depende_de: [PDF-061, PDF-133, PDF-132]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
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

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/engine/ocr-page.ts` (nuevo: `recognizePage`, `pageHasText`), `apps/lector-pdf/src/state/ocr-actions.ts` (nuevo: `runOcr`, `cancelOcr`, `useOcrDialog`, `OCR_OPTIONS_PREF`), `apps/lector-pdf/src/ui/messages-ocr.ts` (nuevo), `apps/lector-pdf/src/ui/ocr/OcrDialog.tsx` y `OcrDialog.module.css` (nuevos, `lazy` en `App.tsx`), `apps/lector-pdf/src/ui/App.tsx` (+8 líneas), `apps/lector-pdf/src/ui/toolbar/DocumentMenu.tsx` (+8 líneas), tests `tests/unit/ocr-page.test.ts`, `tests/unit/ocr-actions.test.ts`, `tests/ui/ocr-dialog.test.tsx`, `tests/e2e/ocr.spec.ts`.
- Qué he hecho: diálogo «Reconocer texto (OCR)…» (páginas, idioma, omitir con texto, aviso de privacidad) que reconoce a 300 ppp con el motor local, muestra progreso «Reconociendo página X de Y…» con Cancelar y escribe la capa como incremento (`ocr-layer` + `writeDocument` append). Avisos de «ya tiene texto», «no se ha reconocido texto», error del motor (nada escrito) y confirmación a partir de 50 páginas.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` exit 0 (314 ficheros, 4059 tests); `pnpm --filter lector-pdf e2e` exit 0 (371 passed, incluidas las 4 pruebas de OCR y el `@perf` en `chromium-perf`); `pnpm --filter lector-pdf build` + `bundle:check`: arranque 572 209 B (máximo de la ficha 575 000; antes 544 998, el aumento no es solo de esta ficha: el módulo propio pesa ~5 kB en el chunk `ocr-actions`).
- Dudas o cosas que no he podido hacer:
  1. Corregido en esta ronda: `createOcrEngine` recibía `assetBaseUrl` (carpeta `pdfjs/`) y los recursos OCR están en `ocr/` de la raíz; ahora se pasa `new URL('./', document.baseURI)`. Lo detectó el E2E (SyntaxError al cargar el worker).
  2. Decisiones de defecto que tomo sin preguntar (revisar): «Omitir páginas que ya tienen texto» marcado por defecto; idioma por defecto Español; OCR no comprueba el permiso de copia (la ficha no lo pide).
  3. En la web el resultado se descarga y el documento abierto sigue siendo el original (comportamiento de Guardar en web). El E2E reabre la copia descargada para comprobar la búsqueda.
  4. El escaneo previo de «omitir con texto» se hace antes de mostrar el progreso (no hay barra durante ese paso).
  5. No verificado: tema oscuro en E2E (solo variables CSS del tema) y escalado 125-150 %.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- lint y typecheck OK; los 23 tests de OCR (unit, UI) pasan. Cada criterio tiene su test (conversión giro 0/90, motor que falla, cancelar, omitir con texto, sin red, axe, @perf). Motor terminado siempre (`finally`), fuente liberada, nada escrito si falla o se cancela.
- (opcional) Tema oscuro y escalado 125-150 % sin verificar en E2E (lo admite el programador); el tester debe comprobarlo.
- (opcional) El escaneo previo de «omitir con texto» no muestra progreso en documentos largos.
