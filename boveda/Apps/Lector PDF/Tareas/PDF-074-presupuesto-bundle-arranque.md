---
tipo: tarea
id: PDF-074
titulo: Comprobar tras el build el presupuesto del JavaScript de arranque (test rojo previo)
app: pdf
estado: cambios-pedidos
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
5. Nuevo `apps/lector-pdf/tests/unit/bundle-budget.test.ts` con manifiestos sintéticos (sin build). **Corregido en la replanificación del 2026-10-18** (ver Registro): los manifiestos y tamaños son exactamente estos. Como en un manifiesto real de Vite, la entrada `index.html` tiene su propio `.js` en `file` (`assets/index.js`), que **sí** cuenta; el chunk de pdf.js es dinámico y **no** cuenta. `PDF_KEY = \`node_modules/${PDFJS_SRC_SUFFIX}\``; `sizeOf` lee de una tabla y lanza si el fichero no está.
   1. **Dentro del presupuesto.** `index.html: { file: 'assets/index.js', src: 'index.html', isEntry: true, imports: ['_vendor.js'], dynamicImports: [PDF_KEY] }`, `_vendor.js: { file: 'assets/vendor.js' }`, `[PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true }`. Tamaños: index 300 000, vendor 100 000, pdf 400 000. → `ok: true`, `errors: []`, `entryBytes: 400000`, `staticFiles: ['assets/index.js', 'assets/vendor.js']`.
   2. **Fuera del presupuesto.** Mismo manifiesto; tamaños: index 450 000, vendor 100 000, pdf 400 000. → `ok: false`, `entryBytes: 550000`, `errors` = exactamente `['El JavaScript de arranque pesa 550000 bytes (máximo 500000).']`.
   3. **pdf.js metido en la entrada.** Solo `index.html: { file: 'assets/index.js', src: 'index.html', isEntry: true }`, tamaño 100 000. → `ok: false`, `errors` = exactamente `['pdf.js no está en un chunk diferido (import()).']`.
   4. **pdf.js diferido pero también estático.** `index.html: { file: 'assets/index.js', src: 'index.html', isEntry: true, imports: [PDF_KEY] }`, `[PDF_KEY]: { file: 'assets/pdf.js', src: PDF_KEY, isDynamicEntry: true }`; tamaños 10 000 y 100 000. → `ok: false`, `entryBytes: 110000`, `errors` = exactamente `['pdf.js se carga de forma estática al arrancar.']`.
   5. **Ciclo.** `index.html: { file: 'assets/index.js', isEntry: true, imports: ['a.js'] }`, `a.js: { file: 'assets/a.js', imports: ['b.js'] }`, `b.js: { file: 'assets/b.js', imports: ['a.js'] }`, `[PDF_KEY]` dinámico con `file: 'assets/pdf.js'`; tamaños 1, 10, 20, 30. → `ok: true`, `staticFiles: ['assets/index.js', 'assets/a.js', 'assets/b.js']`, `entryBytes: 31`.
   6. **Sin entrada.** Solo `[PDF_KEY]` dinámico. → `toEqual({ ok: false, entryBytes: 0, staticFiles: [], errors: ['No hay entrada index.html en el manifiesto.'] })`.

   El código de `bundle-budget.ts` y de `check-bundle.ts` de la ronda 1 ya cumple el algoritmo: **no lo cambies**; solo reescribe los casos del test para que coincidan con esta lista.

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

### [lider] replanificación — 2026-10-18
- **Tiene razón el programador: la ficha se contradecía.** Lo correcto es el algoritmo (el arranque cuenta la entrada y sus `imports` estáticos, y el chunk diferido de pdf.js no cuenta). Si pdf.js contara, PDF-075 no podría ponerse nunca en verde.
- El error estaba en los casos 1 y 2: «300 000 + 100 000» se refería a la **entrada + `_vendor.js`**, pero no se decía que el `file` de `index.html` es un `.js` (como en un manifiesto real de Vite: `assets/index-*.js`). En la ronda 1 se usó `file: 'index.html'` y el segundo tamaño se le dio a pdf.js.
- Decisión: el algoritmo y el código de `bundle-budget.ts` y `check-bundle.ts` no cambian. Reescrito el paso 5 con los seis manifiestos exactos, sus tamaños y lo que debe salir (casos 1 y 2: `entryBytes` 400 000 y 550 000; pdf.js pesa 400 000 y no suma).
- El código de la ronda 1 que está en el árbol sin commitear (`vite.config.ts`, `package.json`, `tests/bundle/*`, `tests/unit/bundle-budget.test.ts`) **se conserva**. Ronda 2: solo hay que reescribir `tests/unit/bundle-budget.test.ts` según el paso 5, repetir los criterios (el rojo de `bundle:check` ya está pegado arriba y vale) y pasar `pnpm lint`, `pnpm typecheck` y `pnpm test` de la raíz.
- Estado → `cambios-pedidos`, `intentos: 0`. [[PDF-075-pdfjs-diferido]] no cambia: su criterio «n ≤ 500 000» usa este mismo algoritmo (pdf.js no cuenta).
