---
tipo: tarea
id: PDF-132
titulo: Proteger con contraseña y quitar protección - interfaz
app: pdf
estado: en-curso
depende_de: [PDF-131, PDF-130]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, seguridad, ui]
---

# PDF-132 · Proteger con contraseña y quitar protección: interfaz

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0037-proteger-reescritura-aes256]], [[ADR-0035-organizar-en-la-app]] (`writeDocument`) · Antes: [[PDF-131-reescribir-documento]]

## Objetivo
«Más acciones → Proteger con contraseña…» cifra el PDF abierto con AES-256 con contraseña de apertura y/o restricciones (imprimir, cambios, copiar); «Más acciones → Quitar protección» lo deja sin cifrar (pidiendo la contraseña de permisos si hace falta). El fichero se sustituye de forma atómica y se reabre.

## Contexto
- Ops `'protect'` y `'unprotect'` (PDF-131); `PermissionChoice`, `ALL_ALLOWED` (PDF-060).
- `src/state/save-actions.ts` → `writeDocument({ kind: 'replace', bytes, password })`, `buildCurrentDelta` (PDF-124); `concatSource`.
- `src/state/doc-ops.ts` → `runDocOp`; `src/state/extract-actions.ts` → `useDocOpJob`; `src/ui/kit/DocOpProgress.tsx`.
- `src/state/password-prompt.ts` → `askPassword`; `src/state/document-actions.ts` → `currentPassword`; `useViewer` → `permissions`, cifrado (`cipherKindOf` en `src/core/permissions.ts`, pestaña Seguridad de Propiedades).
- **Patrón de diálogo**: `src/ui/print/PrintDialog.tsx`, `src/ui/security/PasswordDialog.tsx` (campo con «Mostrar contraseña»), `src/ui/messages-security.ts`.

## Qué hay que hacer
1. `src/state/protect-actions.ts`:
```ts
export type ChangesAllowed = 'none' | 'assemble' | 'forms' | 'comments' | 'all-but-extract';
export interface ProtectForm {
  readonly requireOpen: boolean; readonly openPassword: string; readonly openConfirm: string;
  readonly restrict: boolean; readonly ownerPassword: string; readonly ownerConfirm: string;
  readonly print: 'none' | 'low' | 'high'; readonly changes: ChangesAllowed; readonly copy: boolean;
}
export const useProtectDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly form: ProtectForm }>>;
export function toPermissionChoice(f: ProtectForm): PermissionChoice;   // sin `restrict` → ALL_ALLOWED
export function protectFormError(f: ProtectForm): string | null;         // mensaje del primer problema o null
export async function protectDocument(f: ProtectForm): Promise<SaveResult>;
export async function removeProtection(): Promise<SaveResult>;
```
   - `toPermissionChoice`: `none` → todo `false`; `assemble` → solo `assemble`; `forms` → `fillForms`; `comments` → `annotate` + `fillForms`; `all-but-extract` → `modify`, `annotate`, `fillForms`, `assemble`; `print` y `copy` según el formulario.
   - `protectFormError`: ni `requireOpen` ni `restrict` → «Elige al menos una protección.»; contraseña vacía en una opción marcada → «Escribe la contraseña.»; confirmación distinta → «Las contraseñas no coinciden.»; abrir y permisos iguales → «La contraseña de permisos debe ser distinta de la de apertura.».
   - `protectDocument`: si el documento tiene campos de firma firmados (pdf.js `getFieldObjects` con tipo firma y valor), `askChoice` «Al proteger el documento, sus firmas digitales dejarán de ser válidas.» Continuar / Cancelar. Fuente con cambios sin guardar → op `'protect'` (contraseña actual, `userPassword` = abrir o `''`, `ownerPassword` = permisos o `''`) con progreso → `writeDocument({ kind: 'replace', bytes, password: userPassword === '' ? null : userPassword })` → aviso «Documento protegido.».
   - `removeProtection`: op `'unprotect'`; `owner-password-required` → `askPassword` con texto «Escribe la contraseña de permisos de “nombre”.» y reintenta con ella; → `writeDocument({ kind: 'replace', bytes, password: null })` → aviso «Protección quitada.».
2. `src/ui/security/ProtectDialog.tsx` (+ CSS, `lazy`): grupo «Contraseña para abrir» (casilla + campo + confirmación, con «Mostrar contraseña»), grupo «Restringir edición e impresión» (casilla + contraseña de permisos + confirmación + «Impresión permitida» `select` + «Cambios permitidos» `select` + casilla «Permitir copiar texto, imágenes y otro contenido»), aviso fijo «Si olvidas la contraseña de apertura no podrás abrir el documento.», error de `protectFormError` en `role="alert"`, «Proteger» deshabilitado con error.
3. `DocumentMenu.tsx`: «Proteger con contraseña…» y «Quitar protección» (habilitada solo si el documento está cifrado; deshabilitada con `title` si no).
4. `securityMsg` gana los textos del diálogo y avisos (todos los citados arriba más `protectMenu`, `unprotectMenu`, `protectTitle` «Proteger con contraseña», `openGroup`, `restrictGroup`, `printNone` «No permitida», `printLow` «Baja resolución (150 ppp)», `printHigh` «Alta resolución», `changes*` para las cinco opciones, `allowCopy`, `protect` «Proteger», `progressProtect(done, total)`).
5. Tests: `tests/unit/protect-actions.test.ts`, `tests/ui/protect-dialog.test.tsx`, `tests/e2e/protect.spec.ts`.

## Criterios de aceptación
- [ ] **Criterio original** (E2E): proteger `basic-5.pdf` con contraseña de apertura `abc` → la app reabre el documento sin volver a pedirla; al abrir el fichero guardado de nuevo, pdf.js pide contraseña; en Node, `qpdf --show-encryption --password=abc` del fichero descargado muestra AES-256 (`R = 6`, `AESv3`).
- [ ] E2E: proteger solo con restricciones (sin copiar, sin imprimir) → al reabrir, «Copiar» e «Imprimir» quedan deshabilitados con su explicación (PDF-048) y Propiedades → Seguridad muestra AES 256 bits.
- [ ] E2E: «Quitar protección» en `encrypted-aes-256.pdf` abierto con `usuario` → pide la de permisos; con `propietario` → documento sin cifrar (Propiedades → Seguridad: «Ninguno»).
- [ ] E2E: con un resaltado sin guardar, proteger → el resaltado está en el documento protegido.
- [ ] Unit: `toPermissionChoice` de las 5 opciones; `protectFormError` de todos los casos; error de op → aviso en español y fichero sin tocar.
- [ ] Teclado y accesibilidad: diálogo operable con teclado; campos con etiqueta; axe sin violaciones; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Cambiar la contraseña conservando la anterior (se hace quitando y volviendo a proteger). Cifrado por certificado. Recordar contraseñas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
