---
tipo: tarea
id: PDF-048
titulo: Respetar los permisos del documento (copiar, imprimir) y avisar al anotar
app: pdf
estado: en-test
depende_de: [PDF-046, PDF-044, PDF-045]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, seguridad, ui]
---

# PDF-048 · Respetar los permisos del documento (copiar, imprimir) y avisar al anotar

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0022-pdf-cifrados]] · Paridad: [[Paridad Adobe Acrobat]] (área 9)

## Objetivo
Como Adobe Reader, si el PDF prohíbe copiar o imprimir, esas acciones se deshabilitan con una explicación; si solo prohíbe la alta calidad, se imprime a 150 ppp. Anotar y rellenar se permiten siempre (requisito del usuario), con un aviso una vez por documento si el PDF no los permite. Las propiedades muestran los permisos.

## Contexto
- pdf.js: `doc.getPermissions()` → `Set<number>` de `PermissionFlag` (`PRINT 4`, `MODIFY_CONTENTS 8`, `COPY 16`, `MODIFY_ANNOTATIONS 32`, `FILL_INTERACTIVE_FORMS 256`, `COPY_FOR_ACCESSIBILITY 512`, `ASSEMBLE 1024`, `PRINT_HIGH_QUALITY 2048`) o `null` sin restricciones.
- Leer: `src/state/document-actions.ts`, `src/ui/viewer/text-selection.ts` (manejador `copy`), `src/ui/viewer/SelectionActions.tsx` (botón Copiar), `src/state/print-actions.ts` y `src/ui/print/PrintDialog.tsx` (PDF-044), `src/ui/properties/PropertiesDialog.tsx` (PDF-045), `src/ui/messages-security.ts`.

## Qué hay que hacer
1. `src/core/permissions.ts`:
```ts
export interface DocPermissions { readonly copy: boolean; readonly print: boolean; readonly printHighQuality: boolean; readonly annotate: boolean; readonly fillForms: boolean; readonly assemble: boolean; readonly modify: boolean }
export const ALL_PERMISSIONS: DocPermissions; // todo true
export function permissionsFrom(flags: ReadonlySet<number> | null): DocPermissions; // null → ALL; fillForms = 256 ∨ 32
```
2. `src/engine/permissions.ts`: `readPermissions(doc): Promise<ReadonlySet<number> | null>` (nunca lanza: error → `null`).
3. `useViewer` gana `permissions: DocPermissions` (por defecto `ALL_PERMISSIONS`); `openDocument` lo rellena tras abrir.
4. Copiar: si `!copy`, el manejador `copy` de la capa de texto hace `preventDefault` y muestra `securityMsg.copyBlocked` («El autor de este PDF no permite copiar su texto.»); el botón «Copiar» de la barra de selección se deshabilita con ese `title`. Seleccionar texto, buscar y resaltar siguen funcionando.
5. Imprimir: si `!print`, botón «Imprimir», entrada de menú y Ctrl+P deshabilitados (Ctrl+P muestra `securityMsg.printBlocked` «El autor de este PDF no permite imprimirlo.»). Si `print && !printHighQuality`, «Alta calidad» deshabilitada con su explicación y se imprime a 150 ppp.
6. Anotar/rellenar: si `!annotate` (o `!fillForms` al rellenar), la primera vez que se crea un cambio en ese documento, aviso `securityMsg.annotateAnyway` («Este PDF no permite comentarios; tus cambios se guardarán igualmente en tu copia.»). No se bloquea nada.
7. Propiedades: pestaña nueva «Seguridad» con «Cifrado: Ninguno / RC4 40 bits / RC4 128 bits / AES 128 bits / AES 256 bits» (de `info.EncryptFilterName` y del `/Encrypt` leído por `ObjectReader` sin contraseña si hace falta: `/V`, `/Length`, `/CF`) y la lista de permisos Permitido/No permitido.
8. Tests: unit, UI y E2E `tests/e2e/permissions.spec.ts` con `encrypted-owner-only.pdf`.

## Criterios de aceptación
- [ ] E2E `encrypted-owner-only.pdf`: seleccionar texto y Ctrl+C → el portapapeles **no** cambia (valor previo puesto por el test) y aparece el aviso; el botón «Copiar» está deshabilitado con su `title`.
- [ ] E2E: «Imprimir» deshabilitado; Ctrl+P muestra el aviso y no abre el diálogo de impresión ni el del navegador.
- [ ] E2E: crear un resaltado → aviso `annotateAnyway` una vez (un segundo resaltado no lo repite); Ctrl+S guarda correctamente (PDF-047).
- [ ] E2E `basic-5.pdf`: copiar e imprimir funcionan como antes; ningún aviso al anotar.
- [ ] Propiedades › Seguridad de `encrypted-owner-only.pdf`: «AES 256 bits» y «Imprimir: No permitido», «Copiar: No permitido», «Comentar: No permitido»; de `encrypted-rc4-40.pdf`: «RC4 40 bits».
- [ ] Unit: `permissionsFrom(new Set([4]))` → `print` true, `printHighQuality` false, `copy` false.
- [ ] Axe sin incidencias `serious`/`critical` en la pestaña Seguridad.
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Cambiar permisos (PDF-060). Bloquear anotar o rellenar (decisión: nunca se bloquea).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/permissions.ts` (nuevo), `src/engine/permissions.ts` (nuevo), `src/engine/index.ts`, `src/state/viewer-store.ts`, `src/state/document-actions.ts`, `src/state/annotation-actions.ts`, `src/state/print-actions.ts`, `src/ui/messages-security.ts`, `src/ui/viewer/text-selection.ts`, `src/ui/viewer/SelectionActions.tsx`, `src/ui/print/PrintDialog.tsx` y `.module.css`, `src/ui/kit/MenuButton.tsx`, `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/properties/PropertiesDialog.tsx`; tests nuevos `tests/unit/document-permissions.test.ts`, `tests/ui/document-permissions.test.tsx`, `tests/e2e/permissions.spec.ts`; `tests/ui/open.test.tsx` (una línea: `readPermissions` en el mock de `engine`).
- Qué he hecho: permisos leídos al abrir (`doc.getPermissions()`, en `useViewer.permissions`); copiar bloqueado en el manejador `copy` y en el botón «Copiar»; imprimir bloqueado en botón, menú, Ctrl+P (aviso) y `startPrint`; alta calidad deshabilitada con explicación y, si no se permite, 150 ppp; aviso `annotateAnyway` una vez por documento al anotar o rellenar sin permiso (sin bloquear); pestaña «Seguridad» en Propiedades con cifrado y permisos.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` OK (225 ficheros, 2695 tests; cobertura global 96,5 %); `pnpm --filter lector-pdf e2e -- tests/e2e/permissions.spec.ts` 6/6 OK (incluye axe en la pestaña Seguridad sin incidencias serias ni críticas). No he ejecutado `pnpm perf` ni `pnpm --filter lector-pdf build` (no lo pide la ficha).
- Dudas o cosas que no he podido hacer:
  - El cifrado se deriva del manejador de seguridad que ya expone `ObjectReader` (revisión, métodos y longitud de la clave), no de leer `/V`, `/Length` y `/CF` a mano. Da los mismos valores en los fixtures comprobados.
  - «Copiar» se rige solo por la bandera 16 (como dice la ficha). La bandera 512 (copia para accesibilidad) no se considera: si el usuario quiere que se respete, es decisión de producto.
  - `printHighQuality` es la bandera 2048 sin condicionarla a la 4, tal como indica la ficha.
  - Para deshabilitar la entrada «Imprimir…» del menú he añadido `disabled?` a `MenuActionSpec` (componente compartido de `ui/kit`). Es un cambio mínimo sin efecto en el resto de entradas.
  - El aviso de anotar comparte un único indicador por documento para anotar y para rellenar.
  - Durante la ronda, `typecheck` y `lint` fallaron por ficheros ajenos a esta ficha (`fullscreen-actions.test.ts` y un `zz-measure.perf.test.ts` que otro agente ha retirado después); al repetir, pasaron. No los he tocado.
  - No hago commit, según la petición.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
1. Lint y typecheck OK; tests de la ficha (unit y UI de permisos, open) 26/26 OK. `pnpm coverage` completo no se pudo lanzar (otro Vitest usaba `coverage/`); el programador informa de 2695 tests verdes y 96,5 %. El tester debe repetirlo.
2. Duda bandera 512: decisión de revisión, se mantiene solo la bandera 16 para copiar. Es lo que hace Adobe Reader (512 solo habilita la extracción para lectores de pantalla, no el portapapeles). Sin cambios.
3. (opcional) `cipherKindOf` distingue RC4 40/128 por la longitud de la clave (<= 5 bytes); correcto para los fixtures, vigilar R3 con `/Length` 40.
4. Cambios ajenos en el árbol (PDF-097, PDF-050: Viewer, ViewMenu, view-actions) no pertenecen a esta ficha; deben ir en sus propios commits.
