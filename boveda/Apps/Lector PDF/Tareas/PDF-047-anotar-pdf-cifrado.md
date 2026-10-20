---
tipo: tarea
id: PDF-047
titulo: Guardar anotaciones, firmas y formularios en PDF cifrado
app: pdf
estado: hecha
depende_de: [PDF-093, PDF-046]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, seguridad, anotaciones, formato]
---

# PDF-047 · Guardar anotaciones, firmas y formularios en PDF cifrado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0022-pdf-cifrados]] · [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
En la app, Ctrl+S, Guardar como e Imprimir funcionan con PDFs cifrados (con contraseña de usuario o solo de propietario) usando la contraseña que el usuario escribió al abrir, sin volver a pedirla.

## Contexto
- Leer: `src/state/save-actions.ts` (`buildCurrentDelta`, `reopenSaved`), `src/state/print-source.ts` (abre el documento temporal: también necesita la contraseña), `src/state/document-actions.ts` (`currentPassword`, PDF-046), `src/state/fonts-actions.ts` (abre un `ObjectReader`: pásale la contraseña), `src/core/pdf/incremental.ts` (`openForSave(source, password)`, PDF-093).

## Qué hay que hacer
1. `buildCurrentDelta` llama a `openForSave(file.source, currentPassword() ?? undefined)`.
2. `reopenSaved` y Guardar como (reapertura del fichero nuevo) usan `openDocument(file, { restore, password: currentPassword() })` — para «Guardar como», la contraseña del original (el fichero nuevo tiene el mismo cifrado).
3. `openPrintSource` abre el documento temporal con `password: currentPassword()`.
4. `fonts-actions.ts` abre su lector con la contraseña.
5. Errores `save-wrong-password` / `save-encryption-unsupported` se muestran como aviso, igual que los demás fallos de guardado.
6. E2E `tests/e2e/encrypted-save.spec.ts`.

## Criterios de aceptación
- [ ] E2E, para `encrypted-rc4-40.pdf`, `encrypted-aes-128.pdf`, `encrypted-aes-256.pdf` y `encrypted-aes-256-objstm.pdf`: abrir con «usuario», resaltar texto de la p1, añadir una nota «Cifrado ñ €», Ctrl+S (descarga en web) → el fichero descargado, abierto con pdf.js en Node y contraseña `usuario`, tiene ambas anotaciones con su texto; `qpdf --check --password=usuario` código 0; reabrirlo en la app pide contraseña y muestra las anotaciones.
- [ ] E2E `encrypted-owner-only.pdf`: anotar y guardar sin que se pida ninguna contraseña; el resultado se abre sin contraseña y conserva sus permisos (`getPermissions()` igual que antes).
- [ ] E2E formularios: `form-full.pdf` cifrado en el propio test con `qpdfEncrypt` (de PDF-091; `--encrypt usuario propietario 256 --`): rellenar `nombre` con «Cifrado» y marcar `acepto`, guardar → pdf.js con contraseña `usuario` lee `fieldValue` «Cifrado» y `Si`; `qpdf --check --password=usuario` 0.
- [ ] E2E: firma dibujada en `encrypted-aes-128.pdf` → guardada y visible tras reabrir.
- [ ] E2E: imprimir la p1 de `encrypted-aes-256.pdf` con una anotación sin guardar → el PDF de impresión (`page.pdf()`) incluye la anotación (no aparece el aviso «Los cambios sin guardar no se incluyen»).
- [ ] La contraseña no se pide en ningún paso tras abrir (contador de apariciones del diálogo = 1 por apertura).
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Cambiar o quitar la contraseña (PDF-060).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/state/save-actions.ts` (`buildCurrentDelta` abre con `currentPassword()`), `apps/lector-pdf/src/state/print-source.ts` (el temporal se abre con la contraseña), `apps/lector-pdf/src/state/fonts-actions.ts` (lector con la contraseña), `apps/lector-pdf/tests/e2e/encrypted-save.spec.ts` (nuevo, 8 casos), `apps/lector-pdf/tests/e2e/password.spec.ts` (el caso «Ctrl+S avisa de contraseña incorrecta» pasa a «Ctrl+S guarda sin pedir la contraseña», que describía el comportamiento anterior a PDF-047), `apps/lector-pdf/tests/support/qpdf.ts` y `tests/support/form-fields.ts` (contraseña opcional). `reopenSaved` ya usaba `currentPassword()` desde PDF-046.
- Qué he hecho: Ctrl+S, Guardar como (reapertura) e Imprimir reutilizan la contraseña con la que se abrió el PDF; las fuentes también. Los casos E2E cubren los cuatro cifrados con usuario, owner-only, formulario cifrado con qpdfEncrypt, firma y impresión con anotación sin guardar. El diálogo de contraseña aparece una vez por apertura.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` código 0 (212 ficheros, 2583 tests); `pnpm --filter lector-pdf e2e` código 0 (233 passed, incluidos los @perf); `encrypted-save.spec.ts` 8/8.
- Dudas o cosas que no he podido hacer:
  1. Los cambios sin commitear que había al empezar (`annotations-import.ts`, `annotation-actions.ts`, `document-actions.ts` y sus tests) son de [[PDF-104-etiqueta-firma-conexion|PDF-104]] (lectura del nombre de los sellos), no de esta ficha. No los he tocado ni commiteado.
  2. Los títulos de los tests van sin tildes ni «»: con esos caracteres en la carpeta de salida de Playwright, abrir el fichero guardado para reabrirlo fallaba sin mensaje.
  3. «Firma visible tras reabrir»: se comprueba como sello de solo lectura (sin zona editable) en el panel de comentarios, con etiqueta «Firma» o «Sello» mientras PDF-104 esté pendiente.
  4. «Ambas anotaciones con su texto»: la nota tiene su texto en `contents`; el resaltado no guarda texto, así que se comprueba con sus `quads`.
  5. «Guardar como» no tiene E2E propio: usa la misma reapertura (`reopenSaved`) y no estaba en los criterios.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
Commit 343600b revisado. Los 3 cambios de `src` son mínimos y correctos (`openForSave`, temporal de impresión y fuentes con `currentPassword()`); sin cambios de seguridad. Lint, typecheck y tests de unidad verdes; E2E no ejecutado por mí (los pasará el tester: `encrypted-save.spec.ts` 8 casos, owner-only sin diálogo, formularios con qpdfEncrypt, firma, impresión, contador de diálogo = 1). (opcional) El E2E de firma acepta `Firma|Sello` mientras PDF-104 siga abierto: endurecerlo a «Firma» cuando PDF-104 esté hecha (y haga falta pasar la contraseña, ver PDF-104 punto 4).

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| E2E 4 cifrados, owner-only, formulario qpdfEncrypt, firma, impresión, diálogo = 1 | OK | `encrypted-save.spec.ts` 8/8 verdes en `pnpm --filter lector-pdf e2e` |
| lint / typecheck / coverage | OK | código 0; líneas 98,72 % |
| e2e completo | OK en 2.ª pasada (222 passed) | 1.ª pasada: `ink.spec.ts:141` (@perf, long tasks) falló una vez bajo carga; no relacionado con PDF-047, pasó al repetir |
Tests añadidos: ninguno (los del programador cubren los criterios). Nota: el E2E de firma sigue aceptando `Firma|Sello` hasta PDF-104; ink @perf es sensible a carga.
