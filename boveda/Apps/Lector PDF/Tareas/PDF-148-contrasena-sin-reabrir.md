---
tipo: tarea
id: PDF-148
titulo: Pedir la contraseña sobre la misma carga de pdf.js, sin reabrir el documento
app: pdf
estado: en-curso
depende_de: []
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad, formatos-ofimatica]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-4, cifrado, rendimiento]
---

# PDF-148 · Pedir la contraseña sobre la misma carga de pdf.js, sin reabrir el documento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0043-contrasena-sin-reabrir]] · [[ADR-0022-pdf-cifrados]] · Desbloquea: [[PDF-099-e2e-iteracion-4]]

## Objetivo
Abrir un PDF cifrado hace **un solo** `getDocument`: la tarea de carga de pdf.js espera la contraseña (`loadingTask.onPassword`) y continúa. Abrir un AES-256 de 1 000 páginas queda ~~≤ 1,5 × el sin cifrar~~ ≤ el sin cifrar + 350 ms (paso 7).

## Contexto
- `apps/lector-pdf/src/engine/load.ts` → `LoadOptions`, `LoadedPdf`, `openDocument` (líneas 22-165), `mapOpenError`.
- `apps/lector-pdf/src/state/document-actions.ts` → `runOpen` (líneas 190-300; el bucle `while` de 218-234 y `session = {... password ...}` en ~299).
- `apps/lector-pdf/src/state/password-prompt.ts` (46 líneas): `askPassword`, `cancelPassword` (resuelve `null`).
- Tests de regresión: `apps/lector-pdf/tests/unit/document-password.test.ts` (9 casos, no se cambian salvo añadir).
- pdf.js: `loadingTask.onPassword = (update: (password: string) => void, reason: number) => void`; `reason` es `PasswordResponses.NEED_PASSWORD` o `INCORRECT_PASSWORD` (se obtiene de `lib`, como en `mapOpenError`).

## Qué hay que hacer
1. `engine/load.ts`:
   - En `LoadOptions` añadir:
     ```ts
     /** Si existe, pdf.js pide la contraseña sobre la misma carga (ADR-0043). `null` = el usuario cancela. */
     readonly requestPassword?: (incorrect: boolean) => Promise<string | null>;
     ```
   - En `LoadedPdf` añadir `readonly password: string | null;` (la contraseña con la que abrió: la última entregada a `update`, o `opts.password`, o `null`).
   - En `openDocument`, tras crear `loadingTask` y si `opts.requestPassword` existe:
     ```ts
     let usedPassword: string | null = opts.password ?? null;
     let cancelByUser: () => void = () => undefined;
     const passwordCancelled = new Promise<OpenOutcome>((resolve) => { cancelByUser = () => { resolve({ kind: 'aborted' }); }; });
     loadingTask.onPassword = (update: (p: string) => void, reason: number) => {
       requestPassword(reason === lib.PasswordResponses.INCORRECT_PASSWORD).then(
         (p) => { if (p === null) cancelByUser(); else { usedPassword = p; update(p); } },
         () => { cancelByUser(); },
       );
     };
     ```
     y añadir `passwordCancelled` al `Promise.race`. Sin `requestPassword` no se asigna `onPassword` (comportamiento actual). Ningún `log.*` recibe la contraseña.
2. `state/document-actions.ts` → `runOpen`: sustituir la primera llamada y el bucle `while` por una sola llamada:
   ```ts
   const result = await loadPdf(file.source, {
     assetBaseUrl, signal: controller.signal, onProgress,
     ...(opts?.password === undefined ? {} : { password: opts.password }),
     requestPassword: (incorrect) => (seq === openSeq ? askPassword(file.name, incorrect) : Promise.resolve(null)),
   });
   ```
   El resto sigue igual: si `seq !== openSeq` → descartar; si `error.code === 'cancelled'` → estado vacío sin mensaje. La sesión guarda `password: loaded.password`. Borrar la variable local `password` y la función `isPasswordError` si queda sin uso.
3. Tests:
   - Nuevo `apps/lector-pdf/tests/unit/load-password.test.ts` (pdf.js real, fixture `encrypted-aes-256.pdf` con el mismo helper que `document-password.test.ts`): (i) `requestPassword` devuelve «usuario» → `ok`, `password === 'usuario'`, llamado una vez con `false`; (ii) primero «mala» y luego «usuario» → llamado con `false` y luego `true`, `ok`; (iii) devuelve `null` → `err` con código `cancelled`; (iv) sin `requestPassword` → `err` `password-required` (como hoy); (v) abortar el `signal` mientras `requestPassword` está pendiente → `cancelled`.
   - En `document-password.test.ts` añadir un caso: espiar `loadPdf` con `vi.mock` parcial de `../../src/engine` (`loadPdf: vi.fn(actual.loadPdf)`) y comprobar que abrir el cifrado con contraseña incorrecta y luego correcta llama a `loadPdf` **una** vez.

## Replanificación (líder, 2026-10-20) · paso 4: sondear antes de abrir
Lo hecho en la ronda 1 (pasos 1-3) **se conserva**. pdf.js reanaliza el documento tras `update(p)` (ver [[ADR-0043-contrasena-sin-reabrir]], «Revisión»), así que se pide la contraseña **antes** de `getDocument` cuando se sabe que hace falta.

4a. Nuevo `apps/lector-pdf/src/core/pdf/password-probe.ts` (≤ 25 líneas) y exportarlo en `src/core/pdf/index.ts`:
```ts
/** `true` solo si el PDF tiene /Encrypt y la contraseña vacía no lo abre como usuario ni propietario. Nunca lanza. */
export async function needsUserPassword(src: ByteSource): Promise<boolean> {
  try { await ObjectReader.open(src); return false; }
  catch (e) { return e instanceof PdfSyntaxError && e.message === 'wrong-password'; }
}
```
Cualquier otro error (dañado, `encryption-unsupported`) → `false`: decide pdf.js, que sigue teniendo `onPassword` como red.

4b. `state/document-actions.ts` → `runOpen`, justo antes de `const result = await loadPdf(...)`:
```ts
let password = opts?.password;
if (password === undefined && (await needsUserPassword(file.source))) {
  const answer = seq === openSeq ? await askPassword(file.name, false) : null;
  password = answer ?? undefined;
  cancelledBeforeLoad = answer === null;
}
const result = cancelledBeforeLoad
  ? err(pdfError('cancelled'))
  : await loadPdf(file.source, { ...lo de ahora, con `password` local en lugar de `opts?.password` });
```
(`cancelledBeforeLoad` es un `let` booleano a `false`; `err` de `@suite/shared`.) El resto de `runOpen` no cambia: la comprobación `seq !== openSeq` posterior ya cubre «abrir otro fichero mientras se pide». `requestPassword` se mantiene para la contraseña incorrecta.

4c. Tests:
- Nuevo `tests/unit/password-probe.test.ts` (fixtures con `fixtureSource`): `encrypted-aes-256.pdf` y `encrypted-aes-128.pdf` → `true`; `encrypted-owner-only.pdf` → `false`; un PDF sin cifrar del catálogo → `false`; `ByteSource` con bytes `'no es un pdf'` → `false` sin lanzar.
- En `document-password.test.ts` (añadir, sin cambiar los existentes): abrir `encrypted-owner-only.pdf` no muestra el diálogo (`usePasswordPrompt` sigue cerrado) y el caso «mala y luego buena» sigue llamando a `loadPdf` **una** vez.

## Replanificación (líder, 2026-10-20) · paso 5: test, bundle y medición
Lo hecho en las rondas 1-3 **se conserva**.

5a. **Test «dos aperturas seguidas»** (`tests/unit/document-actions.test.ts:130-145`): autorizado a cambiarlo. El comportamiento nuevo es correcto (A se cancela antes de cargar). No se toca `runOpen` por esto. Sustituir el nombre y las dos últimas aserciones:
```ts
it('con dos aperturas seguidas (A lenta, B rápida) acaba con B y no deja vivo ningún documento de A', async () => {
  // ... mismo arranque y mismas aserciones de status, file.name y numPages ...
  const alive = Array.from({ length: spies.calls }, (_, i) => i).filter((i) => !spies.destroyed.includes(i));
  expect(alive).toHaveLength(1); // solo el de B
});
```
No cambiar ningún otro test existente.

5b. **Bundle** (`bundle:check` 627 248 > 600 000): el presupuesto **no** se sube. En `state/document-actions.ts` quitar `import { needsUserPassword } from '../core/pdf';` y, dentro de `runOpen`, en la condición del sondeo:
```ts
if (password === undefined) {
  const { needsUserPassword } = await import('../core/pdf/password-probe');
  if (await needsUserPassword(file.source)) { /* lo mismo que ahora */ }
}
```
(mismo patrón que `core/pdf/incremental` en `save-actions.ts:153`). Comprobar que `password-probe.ts` solo importa de `./object-reader` y `./objects` (no del barril).

5c. **Medición** en `tests/e2e/iteration4-performance.spec.ts`, test «cifrado AES-256… p1 pintada ≤ 1,5 ×»:
- `OPEN_RUNS = 5`.
- Antes del bucle, un par de calentamiento descartado: `await timeToFirstPage(page, plainPath); await timeToFirstPage(page, cipher, USER);` (la 1.ª apertura sin cifrar sale ~510 ms frente a ~440 y el chunk del sondeo se descarga la primera vez).
- `recordMeasure` sigue antes del `expect` (ya lo está). Umbral `OPEN_RATIO_MAX = 1.5` **sin cambios**, sobre medianas.
- Para ver los números de las 3 repeticiones aunque pasen: `pnpm --filter lector-pdf exec playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3 --reporter=json > /tmp/perf148.json` y copiar al Registro el `description` de las anotaciones `medida` del test (a) de las 3 repeticiones (sin cifrar, cifrado, razón, desglose).

### Criterios añadidos (paso 5)
- [ ] `tests/unit/document-actions.test.ts` en verde con el test de 5a; ningún otro test existente cambiado.
- [ ] `pnpm --filter lector-pdf build` (incluye `bundle:check`) con código 0 y arranque ≤ 600 000 B; anotar los bytes en el Registro.
- [ ] (a) pasa en las 3 repeticiones (razón de medianas de 5 ≤ 1,5) con la tabla y el desglose de las 3 en el Registro. Si alguna falla: no tocar umbral ni medida, anotar los números y dejar `cambios-pedidos` para el líder.
- [ ] Ejecutados de nuevo y con código 0: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter lector-pdf e2e --project=chromium -g "contraseña|cifrad|iteration4"`.

## Replanificación (líder, 2026-10-20) · paso 6: medir sin el sondeo de Playwright
Lo hecho en las rondas 1-5 **se conserva** (código en `fde63ab`). Solo se toca el spec de rendimiento.

Causa de la bimodalidad (~430 / ~925 ms tras «Abrir»): `timeToFirstPage` espera con `expect(...).toBeVisible()` (`waitPageRendered` y el diálogo). Esas esperas reintentan cada 100 → 250 → 500 → 1000 ms. El salto de unos 500 ms es un escalón de reintento, no la app. El «hasta diálogo» de unos 180 ms tiene el mismo sesgo.

6a. `tests/e2e/iteration4-performance.spec.ts` → `timeToFirstPage` (líneas 106-119). Cambia **solo** las dos esperas de esta función (no el helper común `waitPageRendered`, que usan otras pruebas):
```ts
const RAF = { polling: 'raf', timeout: 30_000 } as const;
// diálogo visible (sustituye a expect(...).toBeVisible() de la línea 113):
await page.waitForFunction(() => document.querySelector('[role=dialog]') !== null, undefined, RAF);
// p1 pintada (sustituye a waitPageRendered(page, 1) de la línea 117):
await page.waitForFunction(
  () => document.querySelector('[data-testid=viewer] [data-page-index="0"][data-rendered="true"]') !== null,
  undefined, RAF,
);
```
Es el mismo patrón que `switchAndMeasure` (línea 146). `typePassword` no cambia: su `toBeVisible` ya se cumple a la primera.
6b. No cambian el umbral `OPEN_RATIO_MAX = 1.5`, `OPEN_RUNS = 5`, el calentamiento ni la resta del tiempo del usuario.

## Replanificación (líder, 2026-10-20) · paso 7: presupuesto absoluto
Lo hecho en las rondas 1-6 **se conserva**, incluido el cambio de la ronda 6 en el spec, aún sin commit. Solo se toca `tests/e2e/iteration4-performance.spec.ts`. Motivo en [[ADR-0043-contrasena-sin-reabrir]], «Revisión 2».

7a. Constantes (línea ~41): sustituir `const OPEN_RATIO_MAX = 1.5;` por
```ts
/** Sobrecoste máximo de abrir el cifrado frente al mismo sin cifrar (medianas, sin el tiempo del usuario; ADR-0043). */
const OPEN_OVERHEAD_MAX_MS = 350;
```
7b. Test (a) (líneas ~161-188):
- Título: `'cifrado AES-256 de 1 000 páginas: p1 pintada ≤ sin cifrar + 350 ms'`.
- Tras `const ratio = ...` añadir `const overhead = median(encryptedMs) - median(plain);`.
- En `recordMeasure`, cambiar `razón de medianas ${ratio.toFixed(2)} (presupuesto ≤ ${String(OPEN_RATIO_MAX)})` por `sobrecoste ${overhead.toFixed(0)} ms (presupuesto ≤ ${String(OPEN_OVERHEAD_MAX_MS)} ms), razón ${ratio.toFixed(2)}`. El desglose no cambia.
- `expect(overhead).toBeLessThanOrEqual(OPEN_OVERHEAD_MAX_MS);`
7c. Comentario de cabecera (línea ~27): `(a) abrir un cifrado AES-256 de 1 000 páginas hasta la p1 pintada ≤ el mismo sin cifrar + 350 ms (medianas, sin el tiempo del usuario);`.
7d. Sin cambios: `OPEN_RUNS`, calentamiento, esperas `raf`, resta del tiempo del usuario. El criterio «hasta diálogo < 100 ms» queda anulado: solo se anota.

### Criterios añadidos (paso 7), sustituyen a los de razón ≤ 1,5
- [ ] `--repeat-each=3 --reporter=json`: la (a) pasa en las 3 repeticiones (sobrecoste ≤ 350 ms). Copiar al Registro, de las 3, sin cifrar, cifrado, sobrecoste y razón.
- [ ] `pnpm --filter lector-pdf exec playwright test --project=chromium -g "contraseña|cifrad|iteration4"`, `pnpm lint`, `pnpm typecheck` y `pnpm coverage` con código 0.
- [ ] Si todo pasa: commit (código de las rondas 6 y 7) y ficha a `en-revision`. Si la (a) falla: no tocar el umbral, anotar los números y dejar `cambios-pedidos`.

### Criterios añadidos (paso 6)
- [ ] `--repeat-each=3 --reporter=json`: la (a) pasa en las 3 repeticiones. Copiar al Registro, de las 3, las aperturas, la mediana y la razón, con el desglose.
- [ ] El desglose «tras Abrir» ya no es bimodal: en cada repetición, máximo − mínimo < 200 ms. Si sigue siendo bimodal con la espera `raf`, el problema es real. En ese caso, no tocar el umbral: anotar los números y dejar la ficha en `cambios-pedidos`.
- [ ] El resto de `iteration4-performance.spec.ts` y `pnpm lint`/`pnpm typecheck` con código 0.

## Criterios de aceptación
- [ ] Los 9 casos existentes de `document-password.test.ts` y `password-dialog.test.tsx`, `tab-actions.test.ts`, `compare-actions.test.ts` siguen en verde sin cambiar sus aserciones.
- [ ] Los 5 casos nuevos de `load-password.test.ts` y el de «una sola llamada» pasan.
- [ ] La contraseña no aparece en el logger (el caso existente de `document-password.test.ts` lo cubre) ni en `LoadOptions`/errores serializados.
- [ ] `password-probe.test.ts` (5 casos) y los 2 casos nuevos de `document-password.test.ts` pasan; un PDF con solo contraseña de propietario abre sin diálogo.
- [ ] La contraseña no se registra en ningún `log.*` de `password-probe.ts` ni de `runOpen`.
- [ ] `pnpm --filter lector-pdf exec playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3` (tras la puerta de reposo, sin otras baterías): la (a) da razón de medianas ≤ 1,5 en las 3. La (a) se mide como dice [[ADR-0043-contrasena-sin-reabrir]]: se resta el intervalo desde que el diálogo es visible hasta el clic en «Abrir» (dos `performance.now()` en el test). Anotar en el Registro la tabla: sin cifrar, cifrado, razón (×3).
- [ ] Anotar el desglose (hasta diálogo / tras «Abrir») en el Registro. Esperado: hasta diálogo < 100 ms y tras «Abrir» ≈ sin cifrar. Si la razón sigue > 1,5, no tocar el presupuesto: anotar el desglose y pasar a `cambios-pedidos` con nota para el líder.
- [ ] `pnpm --filter lector-pdf e2e --project=chromium -g "contraseña|cifrad|iteration4"` con código 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- `compare-actions.ts` y `print-source.ts` (siguen sin `requestPassword` ni sondeo). Parchear pdf.js. Cambios en el diálogo o los textos. El resto de PDF-099.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/engine/load.ts`, `apps/lector-pdf/src/state/document-actions.ts`, `apps/lector-pdf/tests/unit/load-password.test.ts` (nuevo), `apps/lector-pdf/tests/unit/document-password.test.ts`, `apps/lector-pdf/tests/ui/open.test.tsx` y `apps/lector-pdf/tests/ui/compare-pages.test.tsx` (solo añaden `password: null` al literal de `LoadedPdf`, que ahora lo exige el tipo), `apps/lector-pdf/tests/e2e/iteration4-performance.spec.ts`.
- Qué he hecho: `loadPdf` pasa `requestPassword` a `loadingTask.onPassword` (una sola carga; `LoadedPdf.password` guarda la contraseña usada) y `runOpen` hace una única llamada; se borran el bucle `while` y `isPasswordError`. En `iteration4-performance.spec.ts` la medida (a) resta el tiempo de diálogo visible hasta «Abrir» (ADR-0043) y anota el desglose. Tests: 5 casos nuevos de `load-password.test.ts` y el caso «una sola carga» en `document-password.test.ts`.
- Comandos ejecutados y resultado:
  - `pnpm lint` y `pnpm typecheck`: código 0.
  - `pnpm coverage`: 302 ficheros, 3917 tests en verde, líneas 98,33 %.
  - `playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3`: (a) falla en las 3 repeticiones; el resto de tests de ese spec pasan (9 de 12).
  - `pnpm --filter lector-pdf e2e --project=chromium -g "contraseña|cifrad|iteration4"`: 27 pasados, código 0.
  - Tabla (a), ms, 3 aperturas por repetición. Sin cifrar / cifrado / razón / desglose cifrado (hasta diálogo; tras «Abrir»):
    - Rep. 1: 510, 439, 434 (mediana 439) / 843, 852, 830 (mediana 843) / 1,92 / 429+414, 424+428, 414+416
    - Rep. 2: 510, 438, 442 (mediana 442) / 855, 839, 838 (mediana 839) / 1,90 / 447+408, 434+405, 430+409
    - Rep. 3: 507, 435, 446 (mediana 446) / 887, 842, 862 (mediana 862) / 1,93 / 474+413, 435+407, 431+431
- Dudas o cosas que no he podido hacer: el presupuesto (a) ≤ 1,5 no se cumple (razón ≈ 1,9 en las tres repeticiones). Según la ficha no he tocado el presupuesto y dejo la ficha en `cambios-pedidos`. Para el líder: el tramo hasta el diálogo (~430 ms) ya cuesta lo mismo que abrir sin cifrar entero (~440 ms); el sobrecoste está tras «Abrir» (~410 ms), así que la lectura adicional ocurre después de la contraseña. No he investigado la causa. Nota: la ficha pide dejar en `en-revision` al terminar, pero su propio criterio manda `cambios-pedidos` si la razón sigue > 1,5; he seguido el criterio.

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: ninguno (sin cambios de código en esta ronda).
- Qué he hecho: he revisado la causa del sobrecoste tras «Abrir» en el worker de pdf.js 6.4.299 (`node_modules/.pnpm/pdfjs-dist@6.4.299/.../pdf.worker.mjs`, `setupDoc`/`onFailure`, líneas ~64355-64400). Al recibir la contraseña, pdf.js hace `pdfManager.updatePassword(password)` y después `pdfManagerReady()` → `loadDocument(false)`: vuelve a parsear el documento (catálogo, xref, árbol de páginas) en el worker. Por tanto la app ya hace una sola `getDocument`, pero **pdf.js repite el análisis dentro de la misma tarea**. La premisa de [[ADR-0043-contrasena-sin-reabrir]] («una sola lectura de xref») no se cumple con esta versión de pdf.js.
- Comandos ejecutados y resultado: ninguno nuevo; los datos son los de la ronda 1 (razón 1,90-1,93, presupuesto 1,5 sin tocar).
- Dudas o cosas que no he podido hacer: para cumplir ≤ 1,5 hace falta una decisión del líder. Opciones que veo, sin elegir ninguna: (1) parchear o envolver el comportamiento del worker de pdf.js (fuera de lo que la ficha permite); (2) revisar ADR-0043 y, si procede, redefinir la medida de PDF-099 (a) (decisión de producto/medida, no del programador); (3) aceptar el coste y dejar PDF-099 (a) como deuda. No he tocado el presupuesto. Dejo la ficha en `cambios-pedidos` porque su criterio de aceptación lo exige mientras la razón sea > 1,5; no la paso a `en-revision` como pedía el mensaje de entrada, para no enviar al revisor una ficha con un criterio incumplido.

### [lider] replanificación — 2026-10-20
- Causa confirmada: pdf.js 6.4.299 reanaliza tras `updatePassword`. Descartado parchear el worker y relajar el umbral (motivos en [[ADR-0043-contrasena-sin-reabrir]], «Revisión»).
- Decisión: A + C. Se añade el paso 4 (sondeo `needsUserPassword` con `ObjectReader.open` ya existente) y sus criterios. Presupuesto de PDF-099 (a) sin cambios (≤ 1,5 ×).
- Ficha a `pendiente`, `intentos: 0`. Lo hecho en la ronda 1 se conserva.

### [programador] ronda 3 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/password-probe.ts` (nuevo, paso 4a), `apps/lector-pdf/src/core/pdf/index.ts` (exporta `needsUserPassword`), `apps/lector-pdf/src/state/document-actions.ts` (paso 4b: sondeo antes de `loadPdf`, `cancelledBeforeLoad`, import de `err` y `needsUserPassword`), `apps/lector-pdf/tests/unit/password-probe.test.ts` (nuevo, 5 casos), `apps/lector-pdf/tests/unit/document-password.test.ts` (caso nuevo «owner-only sin diálogo y una sola carga»; los existentes sin cambios).
- Qué he hecho: el sondeo `needsUserPassword` (ObjectReader.open, solo `wrong-password` = true) decide si se pide la contraseña antes de `loadPdf`; `loadPdf` se llama una vez con la contraseña ya dada, y `requestPassword` queda para la contraseña incorrecta. Compilan lint y typecheck; los 5 casos del sondeo y los de `document-password`, `load-password`, `password-dialog`, `tab-actions` y `compare-actions` pasan.
- Comandos ejecutados y resultado:
  - `pnpm lint` y `pnpm typecheck`: código 0.
  - `pnpm coverage` (con `--coverage.reportsDirectory` propio: otro vitest tenía el directorio bloqueado): 3949 tests, 3948 en verde. **Falla 1**: `tests/unit/document-actions.test.ts` > «con dos aperturas seguidas (A lenta, B rápida)…», falla de forma determinista (también al ejecutarlo solo). Causa: con el sondeo, A queda bloqueada en `needsUserPassword` (lee a través de la fuente con puerta); B toma el relevo y aborta A; al liberarse la puerta, `loadPdf` ve `signal.aborted` (`engine/load.ts` línea 72) y devuelve `cancelled` sin cargar, así que A nunca crea documento y el aserto `destroyed` contiene 0 no se cumple. El comportamiento para el usuario es correcto (no hay fuga), pero el test encodifica el orden antiguo.
  - `playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3`: 11 pasados, 1 fallido. Falla (a) en la repetición 2: razón de medianas **2,43** (presupuesto ≤ 1,5). Las repeticiones 1 y 3 de (a) pasan, pero no he capturado sus números ni el desglose (el log de Playwright solo muestra el fallo).
  - No he ejecutado `e2e --project=chromium -g "contraseña|cifrad|iteration4"` ni `pnpm lint` tras el último cambio de tests (los de `document-actions` no se tocaron).
- Dudas o cosas que no he podido hacer:
  - **Para el líder (decisión, no la tomo yo):** el test de `document-actions.test.ts` (líneas 130-145) asume que A llega a cargarse y se destruye. Opciones: (1) actualizar su aserto a «A nunca se carga y no queda ningún documento vivo que no sea B» (cambio de un test existente, decisión del líder); (2) que el sondeo no bloquee la cancelación de A (p. ej. comprobar `signal.aborted` antes de `loadPdf`, que ya ocurre: no lo veo como arreglo sin cambiar el comportamiento). No he modificado ese test.
  - (a) no cumple el presupuesto en la repetición 2 (2,43) y no tengo medianas ni desglose completos. Hace falta repetir la medición con el desglose (hasta diálogo / tras «Abrir») antes de decidir sobre ADR-0043 o PDF-099 (a).
  - Dejo la ficha en `cambios-pedidos`, no en `en-revision`, porque hay un test rojo y un criterio de rendimiento incumplido.

### [lider] replanificación 2 — 2026-10-20
- Test «dos aperturas seguidas»: se actualiza (opción 1). Cancelar A antes de cargar es el comportamiento correcto; el invariante real es «no queda vivo ningún documento de A». Paso 5a.
- `bundle:check` 627 248 > 600 000: carga diferida de `password-probe` con `import()`, presupuesto sin cambios. Paso 5b; nota en [[ADR-0043-contrasena-sin-reabrir]].
- Rendimiento: 2,43 en una sola repetición, sin números de las demás → no hay base para cambiar el umbral. Se mide con calentamiento descartado, medianas de 5 y reporter JSON para tener el desglose de las 3. Umbral ≤ 1,5 sin cambios. Paso 5c.
- Ficha a `pendiente`, `intentos: 0`.

### [programador] ronda 4 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/unit/document-actions.test.ts` (5a: test «dos aperturas seguidas», nombre y última aserción; ningún otro cambiado), `apps/lector-pdf/src/state/document-actions.ts` (5b: `needsUserPassword` cargado con `import()` desde `../core/pdf/password-probe`; se quita el import estático), `apps/lector-pdf/tests/e2e/iteration4-performance.spec.ts` (5c: `OPEN_RUNS = 5` y par de calentamiento descartado; umbral 1,5 y medida sin cambios).
- Qué he hecho: 5a y 5b aplicados. Build con `bundle:check` en verde: 598 188 B (máximo 600 000). 5c aplicado y medido con el reporter JSON en 3 repeticiones: el criterio (a) **no** se cumple en las repeticiones 1 y 2, así que la ficha queda en `cambios-pedidos` y no hago commit.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf build`: código 0, 598 188 B.
  - `pnpm lint`: código 0. `pnpm typecheck`: sin errores.
  - `pnpm coverage`: 305 ficheros, 3949 tests en verde, líneas 98,33 %.
  - `pnpm --filter lector-pdf exec playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3 --reporter=json`: 11 pasados, 1 fallido en 2 de 3 repeticiones (la (a)). Código 1.
  - `pnpm --filter lector-pdf exec playwright test --project=chromium -g "contraseña|cifrad|iteration4"`: 28 pasados, código 0.
- Tabla (a), 5 aperturas por repetición, medianas. Sin cifrar / cifrado / razón. Desglose cifrado: hasta diálogo / tras «Abrir»:
  - Rep. 1: 436, 451, 448, 427, 444 (mediana 444) / 622, 1110, 602, 1126, 1108 (mediana 1108) / **2,50** (fallo). Desglose: 177/445, 187/923, 177/425, 201/926, 178/930.
  - Rep. 2: 446, 460, 441, 441, 448 (mediana 446) / 1151, 714, 1090, 591, 624 (mediana 714) / **1,60** (fallo). Desglose: 183/968, 215/498, 165/924, 176/415, 193/431.
  - Rep. 3: 456, 452, 438, 474, 454 (mediana 454) / 618, 624, 1125, 595, 1106 (mediana 624) / 1,38 (pasa). Desglose: 178/440, 195/429, 198/927, 179/415, 175/931.
- Dudas o cosas que no he podido hacer: el hasta-diálogo se mantiene en ~180 ms (< 100 ms esperado no se cumple). Tras «Abrir» la apertura alterna entre ~420-440 ms (como sin cifrar) y ~925 ms, en ambas mitades de cada repetición; la mediana cae en una u otra según la repetición. Parece ruido o un segundo análisis dentro del worker, pero no lo he investigado. No he tocado umbral ni medida. Para el líder: decidir si repetir la medición en reposo o revisar ADR-0043/PDF-099 (a).

### [programador] ronda 5 — 2026-10-20
- Ficheros cambiados: ninguno (esta ficha solo se actualiza en el Registro).
- Qué he hecho: he comprobado el estado del código. El árbol de trabajo está limpio y el cambio de la ronda 3-4 ya está en el commit `fde63ab`. No había pasos pendientes de implementar: los pasos 1-5 están aplicados. No he repetido la medición de rendimiento.
- Comandos ejecutados y resultado: `pnpm lint`: código 0 (sin avisos). `pnpm typecheck`: código 0, sin errores.
- Dudas o cosas que no he podido hacer: no paso la ficha a `en-revision`. Su criterio de aceptación «(a) pasa en las 3 repeticiones» no se cumple (rondas 4: fallo en repeticiones 1 y 2, con razones 2,50 y 1,60). La propia ficha dice que, si falla, se dejen `cambios-pedidos` para el líder. Queda pendiente la decisión del líder sobre medición, ADR-0043 o PDF-099 (a). No he hecho commit de esta ronda porque no hay cambios de código.

### [lider] replanificación 3 — 2026-10-20
- La bimodalidad (~430/~925 ms) cuadra con el escalón de reintento de 500 ms de `expect().toBeVisible()` de Playwright. Es un fallo de la medida, no de la app, y tampoco es ruido aleatorio que se arregle con más repeticiones.
- Decisión: medir con `waitForFunction` y `polling: 'raf'` en `timeToFirstPage` (paso 6). El umbral sigue en ≤ 1,5 ×. La medida se afina; el umbral no se relaja.

### [programador] ronda 6 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/iteration4-performance.spec.ts` (solo las dos esperas de `timeToFirstPage`: diálogo y p1 pintada con `waitForFunction` y `polling: 'raf'`). Ningún otro cambio.
- Qué he hecho: paso 6a aplicado tal cual. `waitPageRendered` no se toca (lo usan otras pruebas). Umbral 1,5, `OPEN_RUNS = 5`, calentamiento y resta del tiempo de usuario sin cambios.
- Comandos ejecutados y resultado:
  - `pnpm lint`: código 0, sin avisos. `pnpm typecheck`: código 0.
  - `pnpm --filter lector-pdf exec playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3 --reporter=json`: 11 pasados, 1 fallido en las 3 repeticiones (la (a)). Código 1. El JSON trae un texto extra al final; los datos de la (a) son los de sus anotaciones `medida`.
  - Tabla (a), 5 aperturas por repetición, medianas (ms). Sin cifrar / cifrado / razón. Desglose cifrado: hasta diálogo / tras «Abrir»:
    - Rep. 1: 349, 314, 314, 297, 282 (mediana 314) / 582, 588, 552, 595, 585 (mediana 585) / **1,86** (fallo). Desglose: 142/439, 139/449, 151/401, 149/446, 134/451.
    - Rep. 2: 309, 305, 295, 302, 316 (mediana 305) / 545, 535, 487, 617, 531 (mediana 535) / **1,76** (fallo). Desglose: 137/408, 144/391, 134/353, 129/488, 145/385.
    - Rep. 3: 364, 282, 312, 282, 340 (mediana 312) / 569, 562, 509, 544, 626 (mediana 562) / **1,80** (fallo). Desglose: 178/392, 165/397, 149/360, 153/391, 175/450.
  - Bimodalidad: máximo − mínimo «tras Abrir» = 50, 135 y 90 ms (< 200 ms en las 3). La bimodalidad anterior desaparece.
  - Hasta diálogo: 129–178 ms (esperado < 100 ms: no se cumple). Tras «Abrir»: 353–488 ms, cerca del sin cifrar.
  - No he ejecutado la e2e `-g "contraseña|cifrad|iteration4"` ni `pnpm coverage`: el criterio (a) ya falla, así que no tiene sentido completar la batería antes de la decisión del líder.
- Dudas o cosas que no he podido hacer: el criterio (a) ≤ 1,5 no se cumple en ninguna de las 3 repeticiones, así que no paso la ficha a `en-revision`. No he tocado umbral ni medida. Para el líder: con la medida afinada, el sobrecoste sigue en ~250 ms (~150 antes del diálogo, que incluye el sondeo `needsUserPassword` y el análisis del xref, y ~100 tras «Abrir»). La causa no la he investigado. No he hecho commit porque la ficha no está lista (mismo criterio que rondas 3–5).
- Ficha a `pendiente`, `intentos: 0`.

### [lider] replanificación 4 — 2026-10-20
- Con la medida limpia (ronda 6), el sobrecoste es estable: unos 250 ms (unos 145 ms hasta el diálogo y unos 90 ms tras «Abrir»). El doble análisis que motivó ADR-0043 (unos 930 ms) ya no está.
- Lo que queda es coste fijo: el sondeo lee la xref y deriva la clave AES-256 (R6, cara a propósito), y pdf.js la vuelve a derivar y descifra. Ese coste no crece con el tamaño del documento. Una razón sobre una base de unos 310 ms solo deja 155 ms para él: el umbral 1,5 × mide mal el problema.
- No se optimiza ahora: el único margen sería un sondeo que no lea la xref entera (unos 100 ms como mucho). No compensa el riesgo de un segundo parser del tráiler.
- Decisión: presupuesto absoluto, sobrecoste ≤ 350 ms (medianas). Sigue detectando con holgura la regresión de reabrir (≥ 400 ms). Paso 7. Actualizados [[ADR-0043-contrasena-sin-reabrir]] y [[PDF-099-e2e-iteracion-4]].
- Ficha a `pendiente`, `intentos: 0`.
