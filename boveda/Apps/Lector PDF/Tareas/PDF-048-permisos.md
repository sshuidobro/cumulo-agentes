---
tipo: tarea
id: PDF-048
titulo: Respetar los permisos del documento (copiar, imprimir) y avisar al anotar
app: pdf
estado: pendiente
depende_de: [PDF-046, PDF-044, PDF-045]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
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
