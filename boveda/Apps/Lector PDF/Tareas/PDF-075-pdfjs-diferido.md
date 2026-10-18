---
tipo: tarea
id: PDF-075
titulo: Cargar pdf.js con import() diferido para partir la tarea de arranque
app: pdf
estado: pendiente
depende_de: [PDF-074]
intentos: 0
skills: [pruebas-calidad, calidad-profesional, formatos-ofimatica]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, rendimiento, arranque]
---

# PDF-075 · pdf.js diferido

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0017-carga-diferida-de-pdfjs]], [[ADR-0007-motor-y-visor-pdf]], [[ADR-0013-pdfjs-build-legacy]] · Origen: [[PDF-073-e2e-long-tasks-en-serie]] (ronda 1) · Rojo previo: [[PDF-074-presupuesto-bundle-arranque]]

## Objetivo
Que el arranque no evalúe pdf.js: hoy todo el JavaScript (917 KB) se evalúa en **una** tarea de 67-101 ms al cargar la página (medido por el líder con traza: `v8.evaluateModule`). Al terminar, `bundle:check` pasa a verde y la prueba `@perf` «images-200…» queda con margen, **sin tocar su umbral**.

## Contexto
- Leer: [[ADR-0017-carga-diferida-de-pdfjs]] y estos ficheros, que son los únicos que usan **valores** de pdf.js en ejecución: `src/engine/pdfjs.ts`, `src/engine/worker.ts`, `src/engine/load.ts` (`getDocument`, `InvalidPDFException`, `PasswordException`, `PasswordResponses`), `src/engine/render.ts` (`AnnotationMode`, `RenderingCancelledException`), `src/engine/text.ts` (`TextLayer`, `normalizeUnicode`), `src/engine/night-ops.ts` (`OPS`), `src/engine/range-transport.ts` (`PDFDataRangeTransport`). El resto solo importa **tipos** de `./pdfjs` y no cambia.
- `src/main.tsx` (arranque), `tests/setup/setup.ts` (setup de Vitest), `tests/unit/engine-render.test.ts` (importa `AnnotationMode` y `RenderingCancelledException` como valores).
- Todas las rutas son relativas a `apps/lector-pdf/`.

## Qué hay que hacer
1. **Rojo primero**: `pnpm --filter lector-pdf build && pnpm --filter lector-pdf bundle:check` → código 1 (pegar la salida en el Registro).
2. `src/engine/pdfjs.ts` queda exactamente con esta API (mantén las dos líneas de comentario de cabecera y los `export type` actuales):
   ```ts
   export type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
   let loaded: PdfjsModule | null = null;
   let pending: Promise<PdfjsModule> | null = null;
   let workerSrc: string | null = null;

   /** URL del worker de pdf.js (solo en el navegador, desde `worker.ts`). Se aplica al cargar o al momento si ya está cargado. */
   export function setPdfjsWorkerSrc(url: string): void {
     workerSrc = url;
     if (loaded !== null) loaded.GlobalWorkerOptions.workerSrc = url;
   }

   /** Carga pdf.js una sola vez (chunk diferido). Si la carga falla, la siguiente llamada lo reintenta. */
   export function loadPdfjs(): Promise<PdfjsModule> {
     pending ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
       (mod) => {
         if (workerSrc !== null) mod.GlobalWorkerOptions.workerSrc = workerSrc;
         loaded = mod;
         return mod;
       },
       (cause: unknown) => {
         pending = null;
         throw cause;
       },
     );
     return pending;
   }

   /** pdf.js ya cargado. Solo se llama con un documento abierto (tras `loadPdf`); antes es un bug y lanza. */
   export function pdfjs(): PdfjsModule {
     if (loaded === null) throw new Error('pdf.js no está cargado: llama antes a loadPdfjs()');
     return loaded;
   }
   ```
   Se elimina la línea `export { getDocument, … } from 'pdfjs-dist/legacy/build/pdf.mjs';`. Añade a los `export type` los que necesiten los demás ficheros: `PDFDataRangeTransport` (como tipo).
3. `src/engine/worker.ts`:
   ```ts
   import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
   import { setPdfjsWorkerSrc } from './pdfjs';

   setPdfjsWorkerSrc(workerUrl);
   ```
4. Sustituye cada uso de valor por `pdfjs().X` **dentro de las funciones** (nunca en el nivel superior del módulo):
   - `render.ts`: `pdfjs().AnnotationMode.ENABLE_STORAGE` (2 sitios) y `error instanceof pdfjs().RenderingCancelledException`.
   - `text.ts`: `new (pdfjs().TextLayer)({ … })`; cambia `export { normalizeUnicode } from './pdfjs';` por
     `export function normalizeUnicode(text: string): string { return pdfjs().normalizeUnicode(text); }` (solo lo usan la copia y la selección, con documento abierto).
   - `night-ops.ts`: al principio de `toPaintSteps`, `const OPS = pdfjs().OPS;` y deja el `switch` igual.
   - `range-transport.ts`: dentro de `createRangeTransport`, `class SourceRangeTransport extends pdfjs().PDFDataRangeTransport { … }`; el tipo de retorno sigue siendo `PDFDataRangeTransport` (importado como tipo).
   - `load.ts`: justo después de la comprobación `source.size === 0`:
     ```ts
     let lib: PdfjsModule;
     try {
       lib = await loadPdfjs();
     } catch (cause) {
       return err(pdfError('io', cause));
     }
     ```
     y usa `lib.getDocument(…)`. En `mapOpenError`: `const { PasswordException, PasswordResponses, InvalidPDFException } = pdfjs();` al principio. `createRangeTransport` se llama después de `loadPdfjs()` (si hoy se llama antes, muévelo detrás).
5. `tests/setup/setup.ts`: añade `import { loadPdfjs } from '../../src/engine/pdfjs';` y `await loadPdfjs();` (top-level await) para que los tests que usan el motor sin `loadPdf` sigan funcionando.
6. `tests/unit/engine-render.test.ts`: quita el import de valores y usa `const { AnnotationMode, RenderingCancelledException } = pdfjs();` dentro de cada test que los necesite (import de `pdfjs` desde `../../src/engine/pdfjs`). No cambies ninguna expectativa.
7. Nuevo `tests/unit/engine-pdfjs.test.ts`:
   - `loadPdfjs()` dos veces devuelve la misma promesa (`toBe`) y el módulo tiene `getDocument` de tipo función.
   - Con `vi.resetModules()` y `const fresh = await import('../../src/engine/pdfjs')`: `fresh.pdfjs()` lanza `/no está cargado/`; tras `await fresh.loadPdfjs()`, no lanza.
   - `setPdfjsWorkerSrc('x.js')` tras cargar → `pdfjs().GlobalWorkerOptions.workerSrc === 'x.js'` (restaura el valor anterior al final del test).
8. `src/main.tsx`: tras `createRoot(container).render(…)`, precarga en reposo:
   ```ts
   // ADR-0017: pdf.js se evalúa en otra tarea, después de pintar la ventana. Si falla, loadPdf lo reintenta y muestra el error.
   const preloadPdfjs = (): void => {
     loadPdfjs().catch(() => undefined);
   };
   if ('requestIdleCallback' in window) window.requestIdleCallback(preloadPdfjs, { timeout: 2000 });
   else window.setTimeout(preloadPdfjs, 0);
   ```
   (`import { loadPdfjs } from './engine/pdfjs';`). Si el lint pide `void`, usa `void loadPdfjs().catch(() => undefined);`.
9. `package.json`: `"build": "pnpm assets && vite build && node tests/bundle/check-bundle.ts dist"` (desde ahora el build falla si se rompe el presupuesto).
10. Comprueba con `grep -rn "from './pdfjs'\|engine/pdfjs'" src tests` que ningún fichero importa ya un **valor** de pdf.js salvo `loadPdfjs`, `pdfjs` y `setPdfjsWorkerSrc`.

## Criterios de aceptación
- [ ] Rojo previo en el Registro (paso 1). Después: `pnpm --filter lector-pdf build` con código 0 e imprime `Arranque: <n> bytes …` con n ≤ 500 000 (anotar n y el tamaño del chunk de pdf.js).
- [ ] `pnpm --filter lector-pdf exec vitest run tests/unit/engine-pdfjs.test.ts tests/unit/engine-render.test.ts tests/unit/engine-load.test.ts` en verde.
- [ ] Rendimiento, con la máquina en reposo (antes: `uptime` con carga de 1 min < 1,0 y `pgrep -fa "playwright|vitest|vite build"` vacío; pegar ambos): `pnpm --filter lector-pdf exec playwright test --project=chromium-perf --no-deps --repeat-each=10 -g "images-200" --reporter=json > /tmp/pdf075.json` → 10 pasan. Extraer los valores con
  `node -e "const r=require('/tmp/pdf075.json');const v=[];const w=s=>{(s.suites??[]).forEach(w);(s.specs??[]).forEach(p=>p.tests.forEach(t=>t.results.forEach(x=>[...(t.annotations??[]),...(x.annotations??[])].filter(a=>a.type==='tarea-larga-maxima-ms').forEach(a=>v.push(+a.description)))));};r.suites.forEach(w);console.log(v.join(' '),'max',Math.max(...v))"`
  y pegarlos: el máximo de las 10 es **≤ 85 ms** (antes: 67-101 ms).
- [ ] Sin regresión funcional: `pnpm --filter lector-pdf e2e --project=chromium` con código 0 (incluye abrir < 1 s, contraseñas, ficheros dañados, modo noche, capa de texto y copia).
- [ ] Error claro si no se puede cargar pdf.js: test nuevo en un fichero aparte, `tests/unit/engine-load-no-pdfjs.test.ts`, con `vi.mock('../../src/engine/pdfjs', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/engine/pdfjs')>()), loadPdfjs: () => Promise.reject(new Error('red')) }))`: `loadPdf(memorySource(<bytes de basic-5.pdf>), { assetBaseUrl: nodeAssetBase() })` devuelve `ok: false` con código `io`. Si Vitest no aplica el mock porque el setup ya cargó el módulo, prueba `vi.resetModules()` + `await import('../../src/engine/load')` dentro del test; si aun así no es posible, devuelve la ficha al líder con lo intentado (no la des por buena sin este test).
- [ ] `git diff` no cambia ningún umbral ni prueba e2e, ni añade `retries`, `test.skip`, `.only` o `waitForTimeout`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm perf` con código 0.

## Fuera de alcance
- Diferir otras dependencias (`fflate`, diálogos, guardado): solo si n > 500 000 tras este cambio, y entonces se devuelve la ficha al líder con el reparto del chunk (no decidir aquí).
- Mover pdf.js al worker / OffscreenCanvas.
- `src/engine/styles.ts` (CSS de pdf.js) no cambia.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
