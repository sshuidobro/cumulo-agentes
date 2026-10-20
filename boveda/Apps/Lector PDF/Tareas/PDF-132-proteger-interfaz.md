---
tipo: tarea
id: PDF-132
titulo: Proteger con contraseña y quitar protección - interfaz
app: pdf
estado: pendiente
depende_de: [PDF-131, PDF-130]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
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

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/protect.spec.ts`; esta ficha. El código de la ronda 1 (`src/state/protect-actions.ts`, `src/ui/security/ProtectDialog.tsx`, `DocumentMenu.tsx`, `App.tsx`, `messages-security.ts`, tests) ya estaba commiteado en `8978075` y lo he revisado contra la ficha: sin cambios.
- Qué he hecho: el E2E «solo restricciones» fallaba al reabrir porque Chromium no acepta `setInputFiles` con una ruta que contiene «» (el título del test). Ahora la descarga se guarda en una carpeta temporal ASCII. Se borró `apps/lector-pdf/dist-pdf132` y `dist-pdf151` (salida de build ignorada por git) porque ESLint los recorría y rompía `pnpm lint`.
- Comandos ejecutados y resultado:
  - `pnpm lint`: OK (tras borrar las salidas de build).
  - `pnpm typecheck`: OK.
  - `pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratchpad>` (el directorio por defecto estaba ocupado por otro proceso de Vitest): código 0, todos los tests en verde; cobertura de líneas 98,33 %.
  - `LECTOR_E2E_PORT=4199 LECTOR_E2E_OUTDIR=dist-pdf132 playwright test tests/e2e/protect.spec.ts --project=chromium`: 7/7 OK.
  - `bundle:check` (build en `dist-pdf132`): **ROJO**: 610 071 bytes frente a 600 000. El commit anterior (`8978075^`), compilado en un worktree temporal, ya da 604 265 bytes: el exceso viene de antes de esta ficha. PDF-132 añade unos 6 KB al arranque (`App.tsx` importa `useProtectDialog` de `protect-actions.ts` de forma estática, y el chunk `view-actions` lleva los textos de `securityMsg`).
- Dudas o cosas que no he podido hacer:
  1. **Decisión para el líder (bloquea el criterio de `bundle:check`)**: el arranque ya superaba el presupuesto antes de esta ficha. Hay que elegir entre subir el presupuesto de `tests/bundle/bundle-budget.ts` (`ENTRY_JS_BUDGET_BYTES`) o recortar código del arranque en otra ficha. No lo cambio yo.
  2. Desviación menor: `protectDocument` detecta firmas con `doc.getSignatures()` (solo las firmadas) en vez de `getFieldObjects` como dice la ficha. Es el mismo criterio y el test de firmas ya está cubierto.
  3. Un proceso ajeno (otro agente) tiene borrados en el árbol 469 ficheros versionados de `apps/lector-pdf/dist-firma/`, `dist-qa049/` y similares. No los he tocado ni restaurado; el commit de esta ronda incluye solo mis dos ficheros.

## Replanificación (líder, 2026-10-20) · paso 6: sacar `split` del arranque
El presupuesto **no** sube ([[ADR-0041-presupuesto-arranque-600kb]]). Lo hecho en las rondas 1-2 se conserva; falta solo esto.

**Causa medida.** `src/state/extract-actions.ts` (estático en `App.tsx`) importa `extractFileName` y `splitZipName` de `src/core/organize/split.ts`, que arrastra `ObjectCopier`, `page-tree`, `serialize` y, por ahí, `crypt-rules` (RC4/AES): ~45 KB que solo usa el Worker. Probado por el líder en un worktree: con el cambio de abajo el arranque baja de **610 071 B a 565 171 B**.

6. Crear `src/core/organize/split-names.ts` **sin ningún `import`**, y mover ahí (cortar de `split.ts`, mismo código y comentarios):
   - `export type SplitMode`, `export const SPLIT_SIZES_MB`, `export function extractFileName`, `export function splitZipName`, `export function splitPartNames`.
   - En `split.ts`: `import type { SplitMode } from './split-names';` si lo usa internamente, y `export { SPLIT_SIZES_MB, extractFileName, splitPartNames, splitZipName, type SplitMode } from './split-names';` para no romper `core/doc-ops/ops/index.ts` ni `tests/unit/organize/split.test.ts`.
   - Cambiar el import a `split-names` en `src/state/extract-actions.ts`, `src/ui/organize/ExtractDialog.tsx` y `src/ui/organize/SplitDialog.tsx`.
   - No tocar `tests/bundle/bundle-budget.ts`.

**Criterio añadido.**
- [ ] `pnpm --filter lector-pdf build` y `bundle:check`: arranque ≤ 575 000 B (dato en el Registro).
- [ ] `grep -n "^import" apps/lector-pdf/src/core/organize/split-names.ts` no devuelve nada.
- [ ] `tests/unit/organize/split.test.ts` sigue en verde sin cambios.
