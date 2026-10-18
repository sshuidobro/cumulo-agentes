---
tipo: tarea
id: PDF-074
titulo: Comprobar tras el build el presupuesto del JavaScript de arranque (test rojo previo)
app: pdf
estado: bloqueada
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/vite.config.ts` (`manifest: true`), `apps/lector-pdf/package.json` (script `bundle:check`), nuevos `apps/lector-pdf/tests/bundle/bundle-budget.ts`, `apps/lector-pdf/tests/bundle/check-bundle.ts`, `apps/lector-pdf/tests/unit/bundle-budget.test.ts`. Esta ficha (estado y Registro).
- Qué he hecho: implementado `checkBundle` y la CLI según el algoritmo de la ficha, y 6 tests unitarios según sus casos. Dos de esos casos (1 y 2) contradicen el algoritmo de la propia ficha, así que no los he resuelto por mi cuenta (ver Dudas). `bundle:check` funciona y falla hoy como debe.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf exec vitest run tests/unit/bundle-budget.test.ts` → 4 pasan, 2 fallan (`expected 300000 to be 400000` y `expected true to be false`).
  - `pnpm --filter lector-pdf build` → OK (`index-*.js` 917.14 kB).
  - `pnpm --filter lector-pdf bundle:check` → código 1. Salida:
    ```
    Arranque: 918971 bytes en 2 ficheros JS (máximo 500000).
    El JavaScript de arranque pesa 918971 bytes (máximo 500000).
    pdf.js no está en un chunk diferido (import()).
    ```
  - `node tests/bundle/check-bundle.ts /tmp/no-existe` (desde `apps/lector-pdf`) → código 1: `Falta /tmp/no-existe/.vite/manifest.json: ejecuta antes el build.`
  - `eslint` sobre los ficheros nuevos → sin errores. `pnpm --filter lector-pdf typecheck` → OK.
  - No ejecutado: `pnpm lint`, `pnpm test` de la raíz (no se ha pasado porque la ficha no está cerrada) y la e2e, según indicación.
- Dudas o cosas que no he podido hacer:
  - **Contradicción en la ficha.** El algoritmo dice que `entryBytes` suma solo los `.js` del cierre estático desde `index.html` por `imports`, sin `dynamicImports`. Pero el caso 1 espera `entryBytes: 400000` y `staticFiles` con los dos `.js` (incluido el chunk de pdf.js, que es diferido e `isDynamicEntry`), y el caso 2 espera error `pesa 550000 bytes` con 450 000 + 100 000. Con el algoritmo, el caso 1 da 300 000 y el caso 2 da 450 000 (sin error). Para que el caso 1 y el caso 2 se cumplan, el chunk diferido de pdf.js tendría que contar en el presupuesto de arranque, y entonces el total (≈ 918 000 bytes, con pdf.js dentro) nunca bajaría de 500 000, así que PDF-075 no podría pasar a verde. Implementé el algoritmo, que es el que tiene sentido para el objetivo. Hace falta que el líder o el usuario decidan cuál de las dos cosas es la correcta.
  - Por eso no he cambiado los casos 1 y 2 para que pasen, y no he hecho commit: la rama tiene 2 tests en rojo y no quiero dejarlos en un commit como si estuvieran terminados.
  - El criterio «`pnpm lint`, `pnpm typecheck` y `pnpm test` con código 0» no se puede cumplir mientras los 2 tests de `bundle-budget.test.ts` estén en rojo.
