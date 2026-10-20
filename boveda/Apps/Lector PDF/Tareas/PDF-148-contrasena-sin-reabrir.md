---
tipo: tarea
id: PDF-148
titulo: Pedir la contraseña sobre la misma carga de pdf.js, sin reabrir el documento
app: pdf
estado: pendiente
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
Abrir un PDF cifrado hace **un solo** `getDocument`: la tarea de carga de pdf.js espera la contraseña (`loadingTask.onPassword`) y continúa. Abrir un AES-256 de 1 000 páginas queda ≤ 1,5 × el sin cifrar.

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
