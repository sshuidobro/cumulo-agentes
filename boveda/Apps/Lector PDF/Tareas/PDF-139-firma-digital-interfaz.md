---
tipo: tarea
id: PDF-139
titulo: Firma digital - firmar con certificado y panel de firmas
app: pdf
estado: hecha
depende_de: [PDF-138, PDF-137, COM-018]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-21
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

### [programador] ronda 1 — 2026-10-21
- Ficheros cambiados: `src/state/digital-signature-actions.ts` (nuevo: `useSignDialog`, `useSignatures`, firma, validación, participante `signatures`), `src/core/signature/digital/placement.ts` (nuevo: geometría del recuadro y validez del certificado, puro), `src/core/sidebar.ts` (`'signatures'`), `src/main.tsx` (registro del participante), `src/ui/messages-digital-signature.ts`, `src/ui/signature/{DigitalSignDialog.tsx,SignaturePlacement.tsx,SignatureBanner.tsx}` + CSS, `src/ui/sidebar/{SignaturesPanel.tsx,SignaturesPanel.module.css,Sidebar.tsx,Sidebar.module.css}`, `src/ui/toolbar/DocumentMenu.tsx` («Firmar con certificado…»), `src/ui/viewer/PageView.tsx` (capa de colocación), `src/ui/App.tsx` (diálogo en diferido, banner, teclado de colocación). Tests: `tests/unit/digital-signature-actions.test.ts`, `tests/unit/signature/placement.test.ts`, `tests/ui/digital-sign-dialog.test.tsx`, `tests/ui/signatures-panel.test.tsx`, `tests/e2e/digital-signature.spec.ts`, `tests/support/signing-fixtures.ts` (nuevo; genera el `.p12`, el PDF firmado con revisión posterior y el PDF con un byte alterado en `global-setup`), `tests/e2e/global-setup.ts`. Manual: `boveda/Apps/Lector PDF/Manual.md` (sección «Firmar con certificado» y la lista de comprobación en Adobe).
- Qué he hecho: firma con `.p12`/`.pfx` (invisible, o visible arrastrando en cualquier página, mínimo 60×20 pt; Intro coloca 200×60 pt en el centro de la página actual; Escape cancela), sobre el documento con los cambios sin guardar encadenados como en OCR. Certificado y contraseña solo en memoria (se borran al cerrar, al firmar y al cancelar). Validación automática al abrir un PDF con firmas (por pestaña), pestaña «Firmas» (solo si hay firmas o se está comprobando), banner (rojo si alguna firma no es válida) y menú. Cifrado → aviso `sign-encrypted` antes de pedir nada; certificado caducado o no vigente → aviso y «Firmar» deshabilitado.
- Comandos ejecutados y resultado:
  - `pnpm lint` → OK. `pnpm typecheck` → OK.
  - `pnpm coverage` → exit 0: 323 ficheros, 4153/4153 tests. `placement.ts` 100 % líneas y ramas.
  - `pnpm --filter lector-pdf e2e` (puerto 4391, `LECTOR_E2E_OUTDIR=dist-firma`; el 4173 lo usaba otra ejecución) → exit 0: 384/384 (incluye los 8 de `digital-signature.spec.ts`: `pdfsig` «Signature is Valid.» en invisible y visible, `Prueba Cúmulo` y «Firma válida…» en la pestaña, contraseña errónea, banner «Se han hecho cambios…» y banner rojo, teclado Escape/Intro, axe en claro y oscuro).
  - `pnpm assets && vite build --outDir dist-firma && node tests/bundle/check-bundle.ts dist-firma` → «Arranque: 592711 bytes (máximo 600000)». `node-forge` solo en los chunks `digital-*.js` y en el Worker; el chunk de entrada no lo contiene.
- Dudas o cosas que no he podido hacer:
  1. **pdf.js no lista las firmas en `getFieldObjects`** (devuelve `{}` con un PDF firmado). Para saber si hay firmas uso `getSignatures` (solo firmas con valor, como `protect-actions`). La ficha citaba `getFieldObjects`; confirmar el cambio.
  2. Criterio «borradores»: el test comprueba `platform.prefs.set`; no hay test del almacén de borradores (IndexedDB) porque la firma no escribe nada en él.
  3. «Firmar con teclado de principio a fin»: el diálogo se abre con ratón en los E2E; sí se prueban con teclado Intro en la contraseña, Escape e Intro en la colocación.
  4. `useSignatures` (nombre de la ficha) coincide con el de las firmas dibujadas (`signature-actions.ts`). No se importan los dos a la vez; convendría renombrar uno en una ficha futura.
  5. `useSignDialog` tiene un campo `error` (mensaje del diálogo) que no está en la firma de la ficha.
  6. Un arrastre menor de 60×20 pt se descarta con un aviso; no se ajusta al mínimo.
  7. La barra de pestañas del panel ahora parte en filas cuando no caben (con «Firmas» hay cuatro pestañas en 232 px); cambia `Sidebar.module.css` para todas las pestañas.
  8. Margen del presupuesto de arranque: 7,3 KB (592 711 de 600 000). La siguiente ficha que añada código al arranque lo notará.
  9. En Playwright, `setInputFiles` no abre un PDF cuya ruta tiene tildes o «ñ» (la carpeta de salida del test contenía el título). Las descargas se guardan ahora en una carpeta temporal ASCII. No he comprobado si pasa con rutas reales del usuario en otros navegadores.
  10. La comprobación en Adobe Acrobat queda como lista manual en el Manual (no ejecutada). Lo que la app no verifica: cadena de confianza, revocación, sello de tiempo.

### [revisor] ronda 1 — 2026-10-21 — CAMBIOS
Lint, typecheck y `pnpm coverage` OK (98,34 % líneas); tests de la ficha en verde. Cambiar `getFieldObjects` por `getSignatures` se acepta (dudas 1, 4, 5 y 6 aceptadas; 9 y 10 aceptadas).
1. `apps/lector-pdf/src/ui/signature/DigitalSignDialog.tsx:69` — la contraseña escrita vive en el estado local `password` del componente, que sigue montado al cerrar el diálogo: si se escribe, se cancela y se reabre (o se elige otro certificado con `chooseCertificate`) la contraseña anterior reaparece en el campo. Incumple «contraseña solo en memoria mientras el diálogo está abierto» — hay que vaciar `password` al cerrar y al cambiar de certificado (p. ej. con `key` ligada a `open`/nombre del certificado, o leyendo el valor del store), y añadir un test de ui que lo cubra (escribir, cancelar, reabrir → campo vacío).
2. `apps/lector-pdf/tests/unit/digital-signature-actions.test.ts` (criterio «borradores») — solo se espía `prefs.set`; el criterio exige también el almacén de borradores. Añadir un espía del almacén de borradores (o una aserción de que no se invoca su escritura durante la firma).
3. `tests/e2e/digital-signature.spec.ts` / criterio «firmar con teclado de principio a fin» — el diálogo se abre con ratón. Añadir un E2E (o test ui) que abra «Firmar con certificado…» y recorra el diálogo solo con teclado (Tab/Intro/Espacio) hasta «Firmar».

### [programador] ronda 2 — 2026-10-21
- Ficheros cambiados: `apps/lector-pdf/src/ui/signature/DigitalSignDialog.tsx` (el cuerpo con la contraseña se desmonta al cerrar; al cambiar de certificado se vacía el campo), `apps/lector-pdf/tests/ui/digital-sign-dialog.test.tsx` (2 tests nuevos: cancelar y reabrir; elegir otro certificado), `apps/lector-pdf/tests/unit/digital-signature-actions.test.ts` (espía del almacén de borradores), `apps/lector-pdf/tests/e2e/digital-signature.spec.ts` (E2E «teclado de principio a fin»).
- Qué he hecho: (1) La contraseña escrita ya no sobrevive a cerrar, reabrir o cambiar de certificado: el estado vive en un componente que solo existe con el diálogo abierto y se reinicia al cambiar el objeto `form.p12`. (2) El test unitario espía el `DraftStore` con `startDraftSync` y comprueba que no se escribe ningún borrador durante la firma ni la contraseña en él. (3) E2E que abre «Firmar con certificado…» desde el menú con Intro, elige el certificado con Intro, desbloquea con Intro, recorre con Tab hasta «Firmar» y firma; `pdfsig` valida la copia.
- Comandos ejecutados y resultado:
  - `pnpm lint` → OK. `pnpm typecheck` → OK.
  - `vitest run` de `digital-signature-actions` y `digital-sign-dialog` → 25/25.
  - `pnpm --filter lector-pdf e2e -- tests/e2e/digital-signature.spec.ts` → 10/10.
  - `pnpm coverage` → exit 0: 323 ficheros, 4158/4158 tests, 98,34 % líneas.
- Dudas o cosas que no he podido hacer: otra ejecución de Vitest con cobertura compartía el directorio `coverage/` y bloqueó la primera llamada a `pnpm coverage`; esperé a que terminara y la repetí sin cambios. No he ejecutado `bundle:check` porque el cambio no añade código de arranque relevante (solo lógica del diálogo ya diferido).

### [revisor] ronda 2 — 2026-10-21 — APROBADO
Lint, typecheck y los 31 tests de la ficha en verde. Los 3 puntos de la ronda 1 resueltos: contraseña vaciada al cerrar y al cambiar de certificado (cuerpo desmontado + test), espía del almacén de borradores, E2E de teclado de principio a fin. 0 problemas.

### [tester] ronda 1 — 2026-10-21 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| lint, typecheck, coverage | OK | exit 0; 98,34 % líneas |
| E2E completo (incluye `digital-signature.spec.ts`: pdfsig válida, visible, contraseña errónea, banners, teclado, axe claro/oscuro) | OK | `pnpm --filter lector-pdf e2e` -> 385 passed, exit 0 |
| bundle:check | OK | Arranque: 592625 bytes (máximo 600000) |
| Unit prefs/borradores, manual | OK | tests en coverage; Manual con lista Adobe |

Rendimiento: tests @perf del E2E en verde. Margen de arranque: 7,4 KB.
