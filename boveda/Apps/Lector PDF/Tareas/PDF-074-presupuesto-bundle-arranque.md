---
tipo: tarea
id: PDF-074
titulo: Comprobar tras el build el presupuesto del JavaScript de arranque (test rojo previo)
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, rendimiento, arranque]
---

# PDF-074 · Presupuesto del bundle de arranque

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0017-carga-diferida-de-pdfjs]] · Origen: [[PDF-073-e2e-long-tasks-en-serie]] (ronda 1, `images-200` 101 ms)

## Objetivo
Un comando `pnpm --filter lector-pdf bundle:check` que, tras el build, falle si pdf.js no está en un chunk diferido o si el JavaScript estático del arranque pesa más de 500 000 bytes. **Hoy debe fallar** (chunk de entrada de 917 KB con pdf.js dentro): es el test rojo de [[PDF-075-pdfjs-diferido]]. Esta ficha no arregla el bundle.

## Contexto
- Leer: [[ADR-0017-carga-diferida-de-pdfjs]], `apps/lector-pdf/vite.config.ts`, `apps/lector-pdf/package.json`, `apps/lector-pdf/tests/fixtures/cli.ts` (ejemplo de script `.ts` que Node 22 ejecuta directamente).
- Vite escribe el manifiesto en `dist/.vite/manifest.json` con `build.manifest: true`. Cada entrada: `{ file, src?, isEntry?, isDynamicEntry?, imports?, dynamicImports? }`; `imports` y `dynamicImports` son **claves** del propio manifiesto.

## Qué hay que hacer
1. `apps/lector-pdf/vite.config.ts`: `build: { target: 'es2023', sourcemap: true, manifest: true }`. Nada más.
2. Nuevo `apps/lector-pdf/tests/bundle/bundle-budget.ts` (lógica pura, sin `fs`):
   ```ts
   export interface ManifestChunk {
     readonly file: string;
     readonly src?: string;
     readonly isEntry?: boolean;
     readonly isDynamicEntry?: boolean;
     readonly imports?: readonly string[];
     readonly dynamicImports?: readonly string[];
   }
   export type Manifest = Readonly<Record<string, ManifestChunk>>;
   export const ENTRY_JS_BUDGET_BYTES = 500_000;
   export const PDFJS_SRC_SUFFIX = 'pdfjs-dist/legacy/build/pdf.mjs';
   export interface BundleReport {
     readonly ok: boolean;
     readonly entryBytes: number;
     /** Ficheros `.js` que se cargan de forma estática al arrancar (entrada + `imports` recursivos), sin repetir. */
     readonly staticFiles: readonly string[];
     readonly errors: readonly string[];
   }
   export function checkBundle(manifest: Manifest, sizeOf: (file: string) => number): BundleReport;
   ```
   Algoritmo:
   - Entrada = la clave `index.html` con `isEntry: true`. Si no existe → `errors = ['No hay entrada index.html en el manifiesto.']`, `ok: false`, `entryBytes: 0`, `staticFiles: []`.
   - Cierre estático: recorrido desde `index.html` siguiendo solo `imports` (no `dynamicImports`), con un `Set` de claves visitadas. `staticFiles` = los `file` que terminan en `.js`, en orden de visita. `entryBytes` = suma de `sizeOf(file)`.
   - `pdfKey` = la primera clave que termina en `PDFJS_SRC_SUFFIX`.
   - Errores, en este orden y con este texto exacto:
     - `entryBytes > ENTRY_JS_BUDGET_BYTES` → `` `El JavaScript de arranque pesa ${entryBytes} bytes (máximo ${ENTRY_JS_BUDGET_BYTES}).` ``
     - `pdfKey` no existe o su chunk no tiene `isDynamicEntry: true` → `'pdf.js no está en un chunk diferido (import()).'`
     - `pdfKey` está en el cierre estático → `'pdf.js se carga de forma estática al arrancar.'`
   - `ok = errors.length === 0`.
3. Nuevo `apps/lector-pdf/tests/bundle/check-bundle.ts` (CLI): directorio = `process.argv[2] ?? 'dist'` (relativo al cwd); lee `<dir>/.vite/manifest.json` con `readFileSync` + `JSON.parse` (si no existe: imprime `Falta <ruta>: ejecuta antes el build.` por `console.error` y `process.exitCode = 1`); `sizeOf = (f) => statSync(join(dir, f)).size`; imprime `` `Arranque: ${entryBytes} bytes en ${staticFiles.length} ficheros JS (máximo ${ENTRY_JS_BUDGET_BYTES}).` `` y cada error con `console.error`; `process.exitCode = report.ok ? 0 : 1`. Es un script de herramienta: `console` está permitido aquí (si ESLint lo marca, añade `/* eslint-disable no-console -- salida de un script de línea de comandos */` al principio del fichero, solo en este).
4. `apps/lector-pdf/package.json`, en `scripts`: `"bundle:check": "node tests/bundle/check-bundle.ts dist"`. **No** lo encadenes a `build` (lo hará PDF-075 cuando pase a verde).
5. Nuevo `apps/lector-pdf/tests/unit/bundle-budget.test.ts` con manifiestos sintéticos (sin build):
   - entrada con `imports: ['_vendor.js']` y chunk dinámico `node_modules/pdfjs-dist/legacy/build/pdf.mjs` (`isDynamicEntry: true`), tamaños 300 000 + 100 000 → `ok: true`, `entryBytes: 400000`, `staticFiles` = los dos `.js`.
   - igual pero tamaños 450 000 + 100 000 → `ok: false`, un error que empieza por `El JavaScript de arranque pesa 550000 bytes`.
   - sin clave de pdf.js (pdf.js metido en la entrada) → error `pdf.js no está en un chunk diferido (import()).`
   - pdf.js con `isDynamicEntry: true` pero también en `imports` de la entrada → error `pdf.js se carga de forma estática al arrancar.`
   - ciclo `a.js` ↔ `b.js` en `imports`: termina y cuenta cada fichero una vez.
   - sin `index.html` → `ok: false` con el error de entrada.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf exec vitest run tests/unit/bundle-budget.test.ts` → 6 tests en verde.
- [ ] `pnpm --filter lector-pdf build && pnpm --filter lector-pdf bundle:check` → **código 1** hoy, con `Arranque: <n> bytes …` (n ≈ 917 000) y el error `pdf.js no está en un chunk diferido (import()).` Pegar la salida en el Registro (es el rojo de PDF-075).
- [ ] `pnpm --filter lector-pdf bundle:check` sin build previo en un directorio vacío (`node tests/bundle/check-bundle.ts /tmp/no-existe`) → código 1 con `Falta …`.
- [ ] `git diff` no toca código de `src/` ni ninguna prueba existente.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` con código 0.

## Fuera de alcance
- Partir el bundle o cambiar cómo se importa pdf.js ([[PDF-075-pdfjs-diferido]]).
- Encadenar `bundle:check` a `build` o a la e2e.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
