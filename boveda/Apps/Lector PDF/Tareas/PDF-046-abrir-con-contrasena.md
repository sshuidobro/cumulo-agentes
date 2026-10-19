---
tipo: tarea
id: PDF-046
titulo: Abrir PDF con contraseña
app: pdf
estado: en-revision
depende_de: [PDF-091, PDF-090]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, seguridad, ui]
---

# PDF-046 · Abrir PDF con contraseña

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0022-pdf-cifrados]] · Paridad: [[Paridad Adobe Acrobat]] (área 9)

## Objetivo
Al abrir un PDF protegido aparece un diálogo propio que pide la contraseña; si es incorrecta se avisa y se puede reintentar; Cancelar vuelve al estado anterior. La contraseña vive solo en memoria mientras el documento está abierto (para reabrir tras guardar).

## Contexto
- Leer: `src/engine/load.ts` (ya acepta `password` y devuelve `password-required` / `password-incorrect`), `src/state/document-actions.ts` (`openDocument`, `Session`, `showError`), `src/state/save-actions.ts` (`reopenSaved`), `src/core/errors.ts`, `src/ui/kit/Dialog.tsx`, `src/ui/open/ErrorState.tsx`.
- Textos en `src/ui/messages-security.ts` (`securityMsg`).

## Qué hay que hacer
1. `src/state/password-prompt.ts`: store `usePasswordPrompt` `{ request: { name: string; incorrect: boolean } | null }` y `askPassword(name: string, incorrect: boolean): Promise<string | null>` (resuelve con la contraseña o `null` si se cancela). Un solo diálogo a la vez.
2. `openDocument(file, opts?: { restore?; password?: string })`: si `loadPdf` devuelve `password-required` o `password-incorrect`, `askPassword(file.name, code === 'password-incorrect')`; con contraseña, reintenta `loadPdf` con ella (bucle hasta abrir o cancelar); con `null`, vuelve al estado vacío (si había otro documento abierto antes, este ya se cerró: estado vacío, igual que hoy al cancelar una apertura) y cierra el fichero. La contraseña aceptada se guarda en `Session.password` (`string | null`) y se expone con `currentPassword(): string | null`. Nunca se registra (logger), ni en preferencias, ni en borradores.
3. `reopenSaved` (guardar) reabre con `password: currentPassword()` para no volver a pedirla.
4. `src/ui/security/PasswordDialog.tsx`: `Dialog` «Contraseña necesaria» con texto «“<nombre>” está protegido. Escribe la contraseña para abrirlo.», `<input type="password" autocomplete="off">` con etiqueta «Contraseña» y foco inicial en él, casilla «Mostrar contraseña», mensaje de error `role="alert"` «La contraseña no es correcta.» cuando `incorrect`, botones «Abrir» (deshabilitado con campo vacío; Intro también) y «Cancelar» (Esc).
5. `errors.ts`: `password-required` pasa a «Este PDF está protegido con contraseña.» (ya no dice «próxima versión»).
6. Tests: UI del diálogo, acciones (`FakePlatform` + fixtures cifrados) y E2E `tests/e2e/password.spec.ts`.

## Criterios de aceptación
- [ ] E2E: abrir cada uno de los 5 cifrados con contraseña de usuario (`encrypted-rc4-40`, `-rc4-128`, `-aes-128`, `-aes-256`, `-aes-256-objstm`) → diálogo → «usuario» + Intro → página 1 visible con su texto.
- [ ] E2E: contraseña «mal» → el diálogo sigue abierto con «La contraseña no es correcta.» y el campo vacío y enfocado; después «propietario» también abre.
- [ ] E2E: Cancelar (y Esc) → estado vacío «Abre un PDF para empezar», sin mensaje de error.
- [ ] E2E: `encrypted-owner-only.pdf` abre sin diálogo.
- [ ] E2E: tras abrir con contraseña, añadir una nota y Ctrl+S → (hoy) aviso de `save-encrypted` sin pedir de nuevo la contraseña; tras PDF-047, guardado y reapertura sin diálogo (este criterio lo comprueba PDF-047).
- [ ] UI: la contraseña no aparece en ningún `log.*` (espía del logger) ni en `platform.prefs` tras abrir.
- [ ] Recordar posición (PDF-019) y borradores funcionan igual con un PDF cifrado (abrir, ir a la p3, cerrar, reabrir con contraseña → p3).
- [ ] Axe sin incidencias `serious`/`critical` con el diálogo, con y sin error.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Guardar anotaciones en cifrados (PDF-047). Permisos (PDF-048). Recordar contraseñas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/state/password-prompt.ts` (nuevo), `apps/lector-pdf/src/state/document-actions.ts`, `apps/lector-pdf/src/state/save-actions.ts`, `apps/lector-pdf/src/ui/security/PasswordDialog.tsx` y `PasswordDialog.module.css` (nuevos), `apps/lector-pdf/src/ui/messages-security.ts` (nuevo), `apps/lector-pdf/src/ui/App.tsx`, `apps/lector-pdf/src/ui/kit/Dialog.tsx`, `apps/lector-pdf/src/core/errors.ts` (solo el texto de `password-required`), `apps/lector-pdf/tests/unit/errors.test.ts`, `apps/lector-pdf/tests/unit/password-prompt.test.ts` (nuevo), `apps/lector-pdf/tests/unit/document-password.test.ts` (nuevo), `apps/lector-pdf/tests/ui/password-dialog.test.tsx` (nuevo), `apps/lector-pdf/tests/e2e/password.spec.ts` (nuevo).
- Qué he hecho: `askPassword`/`submitPassword`/`cancelPassword` (una petición a la vez, sin registrar la contraseña). `openDocument` pide la contraseña con bucle hasta abrir o cancelar; `Session.password` y `currentPassword()`; `reopenSaved` la reutiliza. Diálogo «Contraseña necesaria» con campo, casilla de mostrar, aviso `role="alert"`, Intro, Cancelar y Esc.
- Decisiones menores tomadas (avisar si no son válidas): la ficha cita `messages-security.ts` como existente, pero no existía, así que lo creé. La petición lleva un `id` además de `name` e `incorrect`, para que el diálogo se remonte con el campo vacío en cada intento. `Dialog` acepta `data-initial-focus` para que el foco inicial vaya al campo y no al primer botón (cambio aditivo en el kit).
- Comandos ejecutados y resultado: `pnpm coverage` → 204 ficheros, 2454 tests en verde, cobertura global 96,6 % líneas. `pnpm typecheck` → sin errores. `playwright test tests/e2e/password.spec.ts --project=chromium` → 10/10. `pnpm lint` → falla por errores en ficheros ajenos a esta ficha (`src/ui/open/RecentList.tsx`, `tests/ui/recent.test.tsx`, `tests/unit/pdf/incremental.test.ts`); mis ficheros no tienen avisos.
- Dudas o cosas que no he podido hacer: (1) El criterio «tras abrir con contraseña, añadir una nota y Ctrl+S → aviso sin pedir la contraseña» no tiene E2E: falta añadir la nota en el test. (2) Los criterios de «recordar posición y borradores con PDF cifrado» no tienen test. (3) El `errors.ts` del árbol está modificado por otro programador (`save-encrypted` → `save-wrong-password`, `save-encryption-unsupported`): no he tocado esas líneas. Solo he commiteado mi cambio de `password-required`.
