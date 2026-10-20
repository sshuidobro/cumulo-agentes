---
tipo: tarea
id: PDF-066
titulo: Firma digital - abrir certificado PKCS#12 y firmar PAdES B-B por incremento (núcleo)
app: pdf
estado: en-revision
depende_de: [PDF-043, PDF-052, PDF-118]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, firma, seguridad, nucleo]
---

# PDF-066 · Firma digital: abrir certificado PKCS#12 y firmar PAdES B-B por incremento (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0040-firma-digital]], [[ADR-0009-anotaciones-escritor-incremental]] · Paridad: [[Paridad Adobe Acrobat]] · Siguen: [[PDF-138-firma-digital-validar]], [[PDF-139-firma-digital-interfaz]]

## Objetivo
Abrir un certificado personal `.p12`/`.pfx` (también con cifrado heredado 3DES/RC2) y firmar el PDF con una firma **PAdES B-B** (`ETSI.CAdES.detached`, SHA-256, RSA) escrita por actualización incremental, visible o invisible, que `pdfsig` dé por válida.

## Contexto
- [[ADR-0040-firma-digital]] (librería, atributos, tamaño del hueco, límites).
- `src/core/pdf/delta-writer.ts` → `DeltaWriter`, `startDelta`, `reserveXref`, `finishDelta`.
- `src/core/pdf/incremental.ts` → `rewritePage`/`annotsOf` (cómo se añade a `/Annots` directo o indirecto).
- `src/core/annotations/appearance.ts` → `HELV_FONT`, `pdfText`, patrón de apariencia de texto libre; `src/core/annotations/wrap.ts` → `wrapText`.
- `src/core/pdf/text-string.ts` → `encodeTextString`, `pdfDate`; `@noble/hashes/sha2.js` → `sha256` (incremental: `sha256.create().update()`).
- RFC 5652 (CMS SignedData), RFC 5035 (`signingCertificateV2`), ETSI EN 319 142-1 (PAdES B-B), ISO 32000-1 §12.8 (firmas: `/ByteRange`, `/Contents`, `/SigFlags`).

## Qué hay que hacer
1. Dependencias: `node-forge@1.4.0` (`dependencies`) y `@types/node-forge` (versión actual compatible, `devDependencies`). Lint: solo `src/core/signature/digital/` puede importar `node-forge`.
2. `src/core/signature/digital/p12.ts`:
```ts
export interface CertificateInfo { readonly subject: string; readonly issuer: string; readonly serial: string; readonly validFrom: string; readonly validTo: string }  // CN (o DN completo si no hay CN); fechas ISO
export interface SigningIdentity { readonly info: CertificateInfo; readonly certDer: Uint8Array; readonly chainDer: readonly Uint8Array[]; sign(data: Uint8Array): Uint8Array }  // RSA PKCS#1 v1.5 sobre SHA-256(data)
export function openP12(bytes: Uint8Array, password: string): Result<SigningIdentity>;
```
   Errores (códigos nuevos en `errors.ts`): `'p12-wrong-password'` «La contraseña del certificado no es correcta.», `'p12-invalid'` «El fichero no es un certificado .p12 o .pfx válido.», `'p12-no-key'` «El certificado no incluye la clave privada.», `'p12-unsupported-key'` «Solo se admiten certificados con clave RSA.». El certificado del firmante es el que corresponde a la clave privada (mismo módulo); el resto, la cadena.
3. `src/core/signature/digital/cms.ts`: `export function buildCadesSignature(identity: SigningIdentity, digest: Uint8Array): Uint8Array` (DER de `ContentInfo` → `SignedData` v1): `digestAlgorithms {sha256}`, `encapContentInfo { id-data }` sin contenido, `certificates [0]` = firmante + cadena, un `SignerInfo` v1 con `issuerAndSerialNumber`, `digestAlgorithm sha256`, `signedAttrs [0]` = `contentType id-data`, `messageDigest digest`, `signingCertificateV2 { certs: [ESSCertIDv2 { certHash: sha256(certDer) }] }` (sin `signingTime`), ordenados por su codificación DER, `signatureAlgorithm rsaEncryption`, `signature = identity.sign(DER(SET OF signedAttrs))`. Construido con `forge.asn1`.
4. `src/core/pdf/delta-writer.ts`: `DeltaWriter.raw(num: number, gen: number, bytes: Uint8Array): number` — registra el offset del objeto, escribe los bytes tal cual (deben incluir `num gen obj … endobj\n`) y devuelve el offset **relativo al delta** en que empiezan.
5. `src/core/signature/digital/sign-pdf.ts`:
```ts
export const SIGNATURE_CONTENTS_BYTES = 16384;
export interface SignInput {
  readonly source: ByteSource; readonly reader: ObjectReader;
  readonly identity: SigningIdentity;
  readonly pageIndex: number;
  readonly rect: RectPt | null;          // null = invisible ([0 0 0 0] en la página)
  readonly reason: string; readonly location: string;   // '' = no se escribe
  readonly now: string;
}
export async function buildSignatureUpdate(input: SignInput): Promise<Result<{ readonly delta: Uint8Array; readonly expectedSize: number }>>;
```
   - Documento cifrado → `err('sign-encrypted')` «No se puede firmar un PDF protegido con contraseña: quita la protección antes.».
   - Objetos nuevos: diccionario de firma, campo+widget (un único diccionario `{ Type: /Annot, Subtype: /Widget, FT: /Sig, T: (Firma N), V, F: 132, P, Rect }` con `N` = primer número libre entre los nombres de campo existentes) y, si es visible, su apariencia (`/AP { N }`: recuadro con «Firmado digitalmente por», el CN y la fecha `dd/mm/aaaa hh:mm`, Helvetica, ajustado a `rect`).
   - `/AcroForm`: si existe, se añade el campo a `/Fields` y `/SigFlags 3` (reescribiendo el objeto que corresponda: `/AcroForm` indirecto, `/Fields` indirecto o el catálogo si `/AcroForm` es directo); si no, se reescribe el catálogo con `/AcroForm { Fields: [campo], SigFlags: 3 }`. La página recibe el widget en `/Annots` como hace `incremental.ts`.
   - El diccionario de firma se escribe con `raw` como texto fijo: `/Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /M (D:…) /Name (CN)` [`/Reason`, `/Location`] `/ByteRange [0 0000000000 0000000000 0000000000] /Contents <` + 32 768 ceros + `>`; se recuerdan los offsets del `[` de `/ByteRange` y del `<` de `/Contents`.
   - Tras `finishDelta`: `a = source.size + offset('<')`, `b = a + 32 770` (incluye `<` y `>`); `/ByteRange [0 a b total−b]` escrito en el hueco con cada número relleno con espacios a 10 caracteres; resumen SHA-256 de `[0, a)` y `[b, total)` (el original se lee en bloques de 1 MiB); `buildCadesSignature` → hexadecimal en el hueco (rellenado con `0`); más largo que el hueco → `err('sign-too-big')`.
6. Op `'p12-info'`: args `{ p12: Uint8Array; password: string }` → `ok(CertificateInfo)`. Op `'sign'`: args `{ password: string | null; p12: Uint8Array; p12Password: string; pageIndex; rect; reason; location; now }` → `ok({ delta })`.
7. Certificados de prueba en `tests/support/certs.ts` (genera con `openssl` en un directorio temporal al vuelo, nada versionado): RSA 2048 autofirmado con CN «Prueba Cúmulo», exportado a `.p12` con AES (`openssl pkcs12 -export`) y con 3DES (`-certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1`); un `.p12` con clave EC P-256.
8. Tests `tests/unit/signature/p12.test.ts`, `cms.test.ts`, `sign-pdf.test.ts`.

## Criterios de aceptación
- [ ] `openP12` abre los dos `.p12` RSA (AES y 3DES) con su contraseña y da el CN «Prueba Cúmulo»; contraseña mala → `p12-wrong-password`; bytes basura → `p12-invalid`; EC → `p12-unsupported-key`.
- [ ] `cms.ts`: `openssl cms -verify -binary -inform DER -content <datos> -noverify` acepta la firma de un bloque de datos conocido; `openssl asn1parse` muestra los tres atributos firmados y ningún `signingTime`.
- [ ] **Criterio original** (parte automática): `basic-5.pdf` firmado (invisible) → `pdfsig` del resultado dice «Signature Validation: Signature is Valid.» y el tipo `ETSI.CAdES.detached`; `qpdf --check` 0.
- [ ] Firma visible en la página 2 → pdf.js muestra un widget de firma con apariencia en la página 2; `pdfsig` válido.
- [ ] Firmar dos veces (sobre el resultado) → `pdfsig` muestra dos firmas válidas (la primera con «cubre todo el documento: no», que es lo esperado).
- [ ] `form-full.pdf` (con `/AcroForm`) → los campos existentes siguen y el nuevo campo de firma está en `/Fields`; `compressed.pdf` (xref de flujo) → `pdfsig` válido.
- [ ] `encrypted-aes-256.pdf` → `sign-encrypted`.
- [ ] Cobertura ≥ 90 % en `src/core/signature/digital/`. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.
- [ ] Lista de comprobación **manual para el usuario** (no la ejecuta el tester; se copia al Manual): abrir en Adobe Acrobat Reader un PDF firmado por la app → el panel de firmas muestra la firma y la integridad correcta («el documento no se ha modificado»), con aviso de identidad desconocida si el certificado no es de confianza.

## Fuera de alcance
- Validar firmas ([[PDF-138-firma-digital-validar]]) e interfaz ([[PDF-139-firma-digital-interfaz]]). Sello de tiempo, LTV, OCSP/CRL, claves EC, DNIe/tarjetas, firmar PDF cifrados, firma de certificación (DocMDP).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0040-firma-digital]] (librería decidida por el líder: node-forge bajo BSD-3; pkijs no abre .p12 con 3DES). Se parte en firmar (aquí), validar ([[PDF-138-firma-digital-validar]]) e interfaz ([[PDF-139-firma-digital-interfaz]]). La comprobación en Adobe queda como lista manual del usuario.

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/package.json` y `pnpm-lock.yaml` (`node-forge@1.4.0`, `@types/node-forge@1.3.14`); `eslint.config.js` (regla: solo `src/core/signature/digital/` importa `node-forge`); `apps/lector-pdf/src/core/errors.ts` (códigos `p12-*`, `sign-encrypted`, `sign-too-big`); `apps/lector-pdf/src/core/pdf/delta-writer.ts` (`DeltaWriter.raw`); nuevos: `apps/lector-pdf/src/core/signature/digital/{p12,cms,sign-pdf,index}.ts`, `apps/lector-pdf/src/core/doc-ops/ops/signature.ts` (ops `p12-info` y `sign`, registradas en `ops/index.ts`); tests `apps/lector-pdf/tests/unit/signature/{p12,cms,sign-pdf}.test.ts`, `apps/lector-pdf/tests/unit/doc-ops/signature-ops.test.ts`, soporte `apps/lector-pdf/tests/support/{certs,pdfsig}.ts` (certificados y `pdfsig` generados al vuelo).
- Qué he hecho: `openP12` (AES, 3DES, EC → `p12-unsupported-key`, sin clave, contraseña mala, basura), CMS PAdES B-B propio con `forge.asn1` (atributos `contentType`, `messageDigest`, `signingCertificateV2`, sin `signingTime`) y firma incremental con hueco de 16 KiB, `/ByteRange` y resumen por bloques de 1 MiB. Las ops `sign` y `p12-info` cargan el módulo bajo demanda (`import()`), así `node-forge` queda fuera del chunk común del Worker.
- Comandos ejecutados y resultado: `pnpm typecheck` → OK. `npx eslint` sobre todos los ficheros tocados → 0 errores; la regla de `node-forge` probada con un import indebido en `src/core/` (error, como debe). `pnpm coverage` (raíz) → exit 0: 279 ficheros, 3621 tests; cobertura de `src/core/signature/digital/`: 95,2 % de sentencias, 99,2 % de líneas, 85,5 % de ramas. Criterios automáticos cubiertos: `openssl cms -verify` acepta la firma; `openssl asn1parse`/`cms -print` muestran los atributos y ningún `signingTime`; `basic-5.pdf` firmado invisible → `pdfsig` «Signature is Valid», `ETSI.CAdES.detached`, `qpdf --check` 0; firma visible en la página 2 → pdf.js lista un widget `Sig` «Firma 1» con apariencia; dos firmas → dos válidas y «Not total document signed» en la primera; `form-full.pdf` conserva sus campos y el nuevo está en `/Fields`; `compressed.pdf` válido; `encrypted-aes-256.pdf` → `sign-encrypted`.
- Dudas o cosas que no he podido hacer:
  - `pnpm lint` completo falla por 48 errores en `apps/lector-pdf/dist-pdf115/` (carpeta de build ajena, no está en `ignores` de `eslint.config.js`; no la he tocado). Mis ficheros pasan lint sin avisos.
  - Un `pnpm coverage` anterior falló una vez en `tests/ui/comment-toolbar.test.tsx` (2 tests de teclado, código ajeno); en la ejecución siguiente pasó todo.
  - No ejecutado `pnpm build`/`bundle:check` (directorio `dist` compartido con otros programadores).
  - Decisiones menores que no estaban en la ficha: mensaje de `sign-too-big` («La firma no cabe en el espacio reservado para ella.»); clave RSA sin certificado que le corresponda → `p12-invalid` (no se puede generar con openssl, rama sin test); la fecha de la apariencia se muestra en hora local, `/M` va en UTC; `/Fields` y `/AcroForm` indirectos y `/Annots` indirecto/directo cubiertos con un PDF generado en el test.
  - La lista de comprobación en Adobe Acrobat es manual (no ejecutada), para el Manual.
  - El F = 132 del widget, el `/Name` (CN) y el resto de atributos siguen la ficha tal cual.
