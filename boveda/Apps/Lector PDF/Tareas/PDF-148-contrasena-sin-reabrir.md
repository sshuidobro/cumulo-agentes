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

## Criterios de aceptación
- [ ] Los 9 casos existentes de `document-password.test.ts` y `password-dialog.test.tsx`, `tab-actions.test.ts`, `compare-actions.test.ts` siguen en verde sin cambiar sus aserciones.
- [ ] Los 5 casos nuevos de `load-password.test.ts` y el de «una sola llamada» pasan.
- [ ] La contraseña no aparece en el logger (el caso existente de `document-password.test.ts` lo cubre) ni en `LoadOptions`/errores serializados.
- [ ] `pnpm --filter lector-pdf exec playwright test tests/e2e/iteration4-performance.spec.ts --project=chromium-perf --no-deps --repeat-each=3` (tras la puerta de reposo, sin otras baterías): la (a) da razón de medianas ≤ 1,5 en las 3. La (a) se mide como dice [[ADR-0043-contrasena-sin-reabrir]]: se resta el intervalo desde que el diálogo es visible hasta el clic en «Abrir» (dos `performance.now()` en el test). Anotar en el Registro la tabla: sin cifrar, cifrado, razón (×3).
- [ ] Si tras el cambio la razón sigue > 1,5: no tocar el presupuesto; anotar el desglose (hasta diálogo / tras «Abrir») y dejar la ficha en `cambios-pedidos` con la nota para el líder.
- [ ] `pnpm --filter lector-pdf e2e --project=chromium -g "contraseña|cifrad|iteration4"` con código 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- `compare-actions.ts` y `print-source.ts` (siguen sin `requestPassword`). Cambios en el diálogo o los textos. El resto de PDF-099.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
