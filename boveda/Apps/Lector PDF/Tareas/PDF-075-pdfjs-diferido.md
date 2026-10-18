---
tipo: tarea
id: PDF-075
titulo: Cargar pdf.js con import() diferido para partir la tarea de arranque
app: pdf
estado: en-test
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/engine/pdfjs.ts`, `src/engine/worker.ts`, `src/engine/load.ts`, `src/engine/render.ts`, `src/engine/text.ts`, `src/engine/night-ops.ts`, `src/engine/range-transport.ts`, `src/main.tsx`, `package.json` (script `build`), `tests/setup/setup.ts`, `tests/unit/engine-render.test.ts`, `tests/unit/engine-load.test.ts`, `tests/unit/engine-night-ops.test.ts`, `tests/unit/annotations/appearance.test.ts`; nuevos `tests/unit/engine-pdfjs.test.ts` y `tests/unit/engine-load-no-pdfjs.test.ts`. Ficha PDF-075 (estado).
- Qué he hecho: `pdfjs.ts` exporta solo tipos, `loadPdfjs()` (import() cacheado con reintento) y `pdfjs()`; el resto del motor usa `pdfjs().X` dentro de funciones y `loadPdf` espera a `loadPdfjs()`. `main.tsx` precarga pdf.js en `requestIdleCallback`. `build` ejecuta `bundle:check`. Tests de carga diferida, de error claro si pdf.js no carga y de adaptación de los tests que importaban valores.
- Rojo previo (paso 1): `pnpm --filter lector-pdf build` código 0; `bundle:check` código 1:
  ```
  Arranque: 919635 bytes en 2 ficheros JS (máximo 500000).
  El JavaScript de arranque pesa 919635 bytes (máximo 500000).
  pdf.js no está en un chunk diferido (import()).
  ```
- Después: `build` código 0, `Arranque: 433662 bytes en 3 ficheros JS (máximo 500000)`; chunk de pdf.js `pdf-*.js` 487 617 bytes (diferido).
- Comandos y resultado:
  - `pnpm --filter lector-pdf exec vitest run tests/unit/engine-pdfjs.test.ts tests/unit/engine-render.test.ts tests/unit/engine-load.test.ts tests/unit/engine-load-no-pdfjs.test.ts tests/unit/engine-night-ops.test.ts tests/unit/annotations/appearance.test.ts`: 6 ficheros, 64 tests, verde.
  - `pnpm lint`: 0 · `pnpm typecheck`: 0 · `pnpm test`: 147 ficheros, 1724 tests, verde · `pnpm coverage`: 0 (All files 97,05 % líneas).
  - `pnpm perf`: 0 (25 tests, 16 ficheros).
  - Rendimiento `images-200`, máquina en reposo (`uptime` 10:45: carga 1 min 0,03; `pgrep` de playwright/vitest/vite sin procesos reales): `--repeat-each=10`, 10 pasan. Tareas largas máximas (ms): `0 0 0 0 55 55 58 58 0 0 0 0 0 0 0 0 0 0 0 0 max 58` (antes 67-101). Cumple ≤ 85. Salida JSON en el scratchpad de la sesión, no en `/tmp`.
  - `pnpm --filter lector-pdf e2e --project=chromium`: 151 pasan, código 0 (última ejecución, 10:48, carga 3,5). Dos ejecuciones previas fallaron por carga: (a) «abrir basic-5 hasta la página 1» 1 126 ms con carga 6,9 del tester, y (b) timeout de `viewer-stress` 100 000 páginas con carga alta. Ambas pasan aisladas (dos repeticiones de `basic-5` y `viewer-stress` completo) y en la última ejecución completa.
  - `git diff`: sin cambios de umbrales ni de pruebas e2e; sin `retries`, `test.skip`, `.only` ni `waitForTimeout`.
- Dudas o cosas que no he podido hacer:
  - Desvío menor 1: `export type PdfjsModule = typeof import(...)` lo prohíbe el lint (`consistent-type-imports`); usado `import type * as PdfjsNamespace` y `typeof PdfjsNamespace`. Mismo tipo.
  - Desvío menor 2: `'requestIdleCallback' in window` deja `window` en `never` y no compila; usado `typeof window.requestIdleCallback === 'function'`. Misma lógica.
  - La ficha solo nombraba `engine-render.test.ts`, pero el paso 10 exige que ningún test importe valores de pdf.js. Adapté también `engine-night-ops.test.ts` y `annotations/appearance.test.ts` (leen `OPS`/`AnnotationMode` de `pdfjs()` a nivel de módulo; el setup ya lo carga) y `engine-load.test.ts`, cuyo espía `getDocument` ahora va dentro del objeto que devuelve `loadPdfjs()`. No cambié ninguna expectativa.
  - Riesgo a vigilar: si el usuario abre un PDF antes de que termine la precarga en reposo (timeout 2000 ms), `loadPdf` espera a la carga del chunk de pdf.js. No medido en frío; el presupuesto de «abrir < 1 s» se verifica en el E2E `performance.spec.ts` bajo carga normal.
  - No he tocado la ficha ni los cambios sin commitear de PDF-076 (son del tester). Commit solo de mis ficheros.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Comprobado: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 147 ficheros / 1724 tests en verde, `build` 0 con `Arranque: 433662 bytes` (máx. 500 000). Diff coherente con la ficha: ningún valor de pdf.js se importa fuera de `pdfjs.ts` (salvo `worker.ts` con `?url` y tests de integración previos); sin cambios de umbrales ni de e2e; test de `io` con mock y tests de carga presentes. Los dos desvíos (type import, `typeof requestIdleCallback`) son equivalentes y están justificados.
1. (opcional) `src/main.tsx` — la precarga puede competir con una apertura inmediata; el tester debe verificar «abrir < 1 s» en frío con e2e y `images-200` con la máquina en reposo (el revisor no re-ejecutó e2e ni perf).
