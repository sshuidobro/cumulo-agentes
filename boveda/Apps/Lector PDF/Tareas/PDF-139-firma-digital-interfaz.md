---
tipo: tarea
id: PDF-139
titulo: Firma digital - firmar con certificado y panel de firmas
app: pdf
estado: pendiente
depende_de: [PDF-138, PDF-137, COM-018]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, firma, seguridad, ui]
---

# PDF-139 · Firma digital: firmar con certificado y panel de firmas

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0040-firma-digital]] · Antes: [[PDF-066-firma-digital]], [[PDF-138-firma-digital-validar]]

## Objetivo
«Más acciones → Firmar con certificado…» firma el PDF con un `.p12`/`.pfx` (visible, dibujando el recuadro, o invisible), y una pestaña «Firmas» del panel lateral muestra las firmas del documento con su estado; al abrir un PDF firmado, un aviso lo indica.

## Contexto
- Ops `'p12-info'`, `'sign'` (PDF-066) y `'verify-signatures'` (PDF-138); `CertificateInfo`, `SignatureStatus`.
- `src/state/save-actions.ts` → `buildCurrentDelta`, `writeDocument({ kind: 'append' })`; `concatSource`; `src/state/doc-ops.ts`; `useDocOpJob`, `DocOpProgress`.
- `services().platform.importFile` (COM-018).
- Colocar un recuadro en la página: patrón de `placeSignature` / `placeSignatureFromKeyboard` en `src/state/annotation-actions.ts` y del arrastre de zonas de redacción (PDF-137) en `AnnotationLayer.tsx`.
- `src/ui/sidebar/Sidebar.tsx` (`SIDEBAR_TABS`), `src/core/sidebar.ts` (`SidebarTab`), `src/ui/sidebar/CommentsPanel.tsx` (patrón de lista), `src/ui/open/IoErrorBanner.tsx` (patrón de banner).
- `src/state/document-actions.ts` → punto en que el documento queda `ready` (para lanzar la validación).

## Qué hay que hacer
1. `src/state/digital-signature-actions.ts`:
```ts
export interface SignForm { readonly p12: { readonly name: string; readonly bytes: Uint8Array } | null; readonly password: string; readonly info: CertificateInfo | null; readonly visible: boolean; readonly reason: string; readonly location: string }
export const useSignDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly form: SignForm; readonly placing: boolean }>>;
export async function chooseCertificate(): Promise<void>;        // importFile([{ name: 'Certificado', extensions: ['p12','pfx'] }], 1 MiB)
export async function unlockCertificate(password: string): Promise<boolean>;   // op 'p12-info'; error → mensaje en el diálogo
export function startPlacing(): void;                             // cierra el diálogo y activa el arrastre de recuadro
export async function signDocument(pageIndex: number, rect: RectPt | null): Promise<SaveResult>;
export const useSignatures: UseBoundStore<StoreApi<{ readonly status: 'idle' | 'checking' | 'ready' | 'error'; readonly list: readonly SignatureStatus[] }>>;
export async function refreshSignatures(): Promise<void>;         // op 'verify-signatures' en el Worker
```
   - Firmar: con cambios sin guardar, se encadenan como en organizar (`prefix` + delta de firma) → `writeDocument({ kind: 'append' })`. Documento cifrado → aviso `sign-encrypted` antes de pedir nada. Certificado caducado o aún no válido → aviso en el diálogo y botón «Firmar» deshabilitado.
   - La contraseña del certificado y sus bytes solo viven en memoria mientras el diálogo está abierto o se está firmando; nunca en preferencias ni borradores.
   - Validación: al quedar `ready` un documento con algún campo `/FT /Sig` firmado (lo indica `getFieldObjects` de pdf.js), `refreshSignatures()`; el estado es por pestaña (participante `{ id: 'signatures', order: 42 }`).
2. `src/ui/signature/DigitalSignDialog.tsx` (+ CSS, `lazy`): «Certificado» (botón «Elegir certificado…» y nombre), «Contraseña del certificado» + «Desbloquear», ficha del certificado (titular, emisor, válido desde/hasta), radios «Firma visible (dibuja el recuadro en la página)» / «Firma invisible», «Motivo» y «Lugar» opcionales, nota «La firma se hace en este equipo. No se usa ningún servicio externo ni sello de tiempo.», botón «Firmar» (visible → «Colocar y firmar»).
3. Colocar (visible): cursor en cruz sobre las páginas; arrastrar dibuja el recuadro (mínimo 60×20 pt); Intro con el teclado lo coloca en el centro de la página actual con 200×60 pt; Escape cancela; al soltar → `signDocument`.
4. Pestaña «Firmas» en el panel (`SidebarTab` gana `'signatures'`; solo visible si el documento tiene firmas o se está validando): por firma, icono y texto de estado — válida: «Firma válida. La identidad del firmante no se ha verificado.»; inválida: su `problem`; desconocida: su `problem`; si `changedAfter`: «Se han hecho cambios después de firmar.» — titular, fecha, motivo y lugar; clic → va a la página del widget.
5. Banner al abrir un PDF firmado: «Este documento está firmado digitalmente.» + botón «Ver firmas» (abre la pestaña); en rojo si alguna es `invalid`.
6. `DocumentMenu.tsx`: «Firmar con certificado…». `src/ui/messages-digital-signature.ts` (`digitalSignMsg`) con todos los textos.
7. Tests: `tests/unit/digital-signature-actions.test.ts`, `tests/ui/digital-sign-dialog.test.tsx`, `tests/ui/signatures-panel.test.tsx`, `tests/e2e/digital-signature.spec.ts` (el `.p12` de prueba se genera en `global-setup` con `tests/support/certs.ts` en una carpeta temporal).

## Criterios de aceptación
- [ ] **Criterio original** (E2E + Node): firmar `basic-5.pdf` (invisible) con el `.p12` de prueba → el fichero descargado/guardado pasa `pdfsig` con «Signature is Valid.»; la pestaña «Firmas» muestra «Prueba Cúmulo» y «Firma válida. La identidad del firmante no se ha verificado.».
- [ ] E2E: firma visible en la página 2 dibujando el recuadro → el recuadro con «Firmado digitalmente por Prueba Cúmulo» aparece en la página 2 tras recargar.
- [ ] E2E: contraseña del certificado errónea → mensaje en el diálogo y «Firmar» deshabilitado.
- [ ] E2E: abrir un PDF firmado y modificado después (fixture creado en `global-setup` con un incremento de anotación) → banner y estado «Se han hecho cambios después de firmar.»; uno con un byte alterado → banner rojo y «El documento se ha modificado después de firmarlo.».
- [ ] Unit: los bytes y la contraseña del certificado no se escriben en `platform.prefs` ni en borradores (espía de `prefs.set` y del almacén de borradores).
- [ ] Teclado y accesibilidad: firmar con teclado de principio a fin (incluido colocar con Intro); axe sin violaciones en diálogo y pestaña; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto (node-forge solo en *chunks* diferidos y en el Worker).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.
- [ ] Manual: se añade al [[Apps/Lector PDF/Manual|Manual]] la lista de comprobación en Adobe de [[PDF-066-firma-digital]].

## Fuera de alcance
- Certificados del almacén del sistema y DNIe. Sello de tiempo. Confianza en la cadena. Firmar campos de firma vacíos ya existentes (se crea siempre uno nuevo).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
