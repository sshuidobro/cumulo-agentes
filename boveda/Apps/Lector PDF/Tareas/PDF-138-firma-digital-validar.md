---
tipo: tarea
id: PDF-138
titulo: Firma digital - validar las firmas de un PDF (núcleo)
app: pdf
estado: hecha
depende_de: [PDF-066]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, firma, seguridad, nucleo]
---

# PDF-138 · Firma digital: validar las firmas de un PDF (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0040-firma-digital]] · Antes: [[PDF-066-firma-digital]] · Sigue: [[PDF-139-firma-digital-interfaz]]

## Objetivo
Para cada campo de firma firmado de un PDF: quién firmó, cuándo, si la firma es íntegra (el contenido firmado no ha cambiado y la firma matemática es correcta) y si se hicieron cambios después de firmar. Sin red y sin lista de confianza (identidad «no verificada»).

## Contexto
- [[ADR-0040-firma-digital]] (validación).
- `src/core/signature/digital/p12.ts` → `CertificateInfo`; `cms.ts` (estructura que hay que leer).
- `src/core/organize/forms-cleanup.ts` (recorrido de `/AcroForm /Fields` y `/Kids`).
- `@noble/hashes/sha2.js` (`sha256`, `sha384`, `sha512`) y `@noble/hashes/legacy.js` (`sha1`); WebCrypto `crypto.subtle` (ECDSA), disponible en navegador y Node 22.

## Qué hay que hacer
1. `src/core/signature/digital/verify.ts`:
```ts
export type SignatureVerdict = 'valid' | 'invalid' | 'unknown';
export interface SignatureStatus {
  readonly fieldName: string;
  readonly pageIndex: number | null;
  readonly signer: CertificateInfo | null;
  readonly signedAt: string | null;           // ISO de /M
  readonly reason: string | null; readonly location: string | null;
  readonly subFilter: string;
  readonly verdict: SignatureVerdict;
  /** Motivo en español si no es 'valid' (p. ej. «El documento se ha modificado después de firmarlo.»). */
  readonly problem: string | null;
  /** Hay bytes después del final del rango firmado (revisiones posteriores). */
  readonly changedAfter: boolean;
}
export async function verifySignatures(source: ByteSource, reader: ObjectReader): Promise<Result<readonly SignatureStatus[]>>;
```
2. Reglas:
   - Campos `/FT /Sig` (también heredado) con `/V` diccionario; `/ByteRange [0 b c d]` con `0 < b < c`, `c + d ≤ source.size` → si no, `invalid` «La firma no cubre el documento correctamente.».
   - `/SubFilter` `adbe.pkcs7.detached` o `ETSI.CAdES.detached` → se valida; otros (`adbe.pkcs7.sha1`, `adbe.x509.rsa_sha1`) → `unknown` «Tipo de firma no admitido para validar.».
   - Resumen del rango con el algoritmo del `SignerInfo` (SHA-1, SHA-256, SHA-384, SHA-512). Con `signedAttrs`: `messageDigest` debe coincidir (si no → `invalid` «El documento se ha modificado después de firmarlo.») y la firma se comprueba sobre el DER de `signedAttrs` re-etiquetado como `SET` (0x31). Sin `signedAttrs`: la firma es sobre el resumen del rango.
   - RSA (`rsaEncryption` o `sha*WithRSAEncryption`) con `forge`; ECDSA (`ecdsa-with-SHA256/384/512`) con `crypto.subtle.verify` (convierte la firma DER `(r, s)` a P1363 y la clave pública del certificado a SPKI); otro algoritmo → `unknown`. Firma incorrecta → `invalid` «La firma no es válida.».
   - `changedAfter = c + d < source.size` (sin contar blancos finales).
   - Errores al leer la estructura de una firma → esa firma `unknown` con su motivo; nunca falla todo el resultado por una firma rota.
3. Op `'verify-signatures'`: args `{ password: string | null }` → `ok(SignatureStatus[])`.
4. Tests `tests/unit/signature/verify.test.ts`:
   - PDF firmado con `buildSignatureUpdate` (PDF-066) → `valid`, `changedAfter: false`.
   - El mismo con un byte cambiado dentro del rango firmado → `invalid` (modificado).
   - El mismo + un incremento de anotaciones posterior → `valid`, `changedAfter: true`.
   - Firma **ECDSA hecha con openssl** (`tests/support/certs.ts` gana una clave EC; el test escribe un PDF con hueco con el código de PDF-066, extrae los rangos, firma con `openssl cms -sign -binary -outform DER -md sha256 -signer … -inkey …` y pega la firma) → `valid`.
   - Firma con `adbe.pkcs7.sha1` (construida en el test) → `unknown`.

## Criterios de aceptación
- [ ] Los casos anteriores pasan; `pdfsig` coincide con nuestro veredicto en los casos `valid` e `invalid`.
- [ ] Un PDF sin firmas → `ok([])`; `form-full.pdf` → `ok([])`.
- [ ] Cobertura ≥ 90 % de `verify.ts`. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Confianza en la cadena, revocación (OCSP/CRL), sellos de tiempo, LTV, firmas de certificación y permisos `DocMDP`.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/core/signature/digital/verify.ts` (nuevo), `digital/index.ts` (exporta `verifySignatures`), `src/core/doc-ops/ops/signature.ts` y `ops/index.ts` (op `'verify-signatures'`), `tests/unit/signature/verify.test.ts` (nuevo, 26 tests), `tests/support/certs.ts` (certificado y clave RSA y EC en PEM para `openssl`). No he tocado `p12.ts`, `forms-cleanup.ts` ni los ficheros de PDF-112/PDF-135.
- Qué he hecho: validación por campo `/FT /Sig` con `/V` (FT y V heredados, nombre completo), `/ByteRange`, `messageDigest`, firma RSA con forge y ECDSA con WebCrypto (DER a P1363), `changedAfter` ignorando blancos finales, y cada firma rota aislada como `unknown`. El firmante se lee del ASN.1 del CMS porque `forge.pki.certificateFromAsn1` no admite claves EC; el test comprueba que coincide con `openP12`.
- Comandos ejecutados y resultado: `vitest run tests/unit/signature/verify.test.ts` 26/26 OK. Cobertura de `verify.ts` 95,7 % de líneas. `pnpm typecheck` y `pnpm lint`: sin errores en mis ficheros. Errores ajenos: typecheck en `src/core/redact/apply.ts` y `tests/unit/redact/apply.test.ts`; lint en `tests/unit/compare-actions.test.ts` y `tests/unit/redact/apply.test.ts`. `pnpm coverage` completo: 282 ficheros OK; fallan 14 tests de `tests/unit/redact/apply.test.ts` y 1 fichero más ajeno. Por eso el comando completo no sale con código 0 (criterio pendiente hasta que esos ficheros estén verdes).
- Dudas o cosas que no he podido hacer:
  1. ECDSA sin `signedAttrs` → `unknown` («Tipo de firma no admitido»): WebCrypto no verifica un resumen ya calculado. La ficha no lo dice; confirmar.
  2. Sin `signedAttrs` con RSA, el resumen se calcula con el algoritmo de la firma (`sha*WithRSA`) y no con `digestAlgorithm`; es lo que exige CMS, pero la ficha habla del algoritmo del SignerInfo.
  3. Solo se valida el primer SignerInfo; `sid` por SubjectKeyIdentifier → `unknown`.
  4. `/ByteRange` con `a ≠ 0` o que no sean 4 enteros → `invalid` (interpretación de «[0 b c d]»).
  5. Sin probar: PDF cifrado. El lector descifra también `/Contents`, así que la firma saldría `unknown`; no hay test.
  6. `pageIndex`: se toma de `/P` del widget (o del primer hijo). Campos con hijos sin cubrir por tests.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- `pnpm lint` y `pnpm typecheck` OK. `pnpm coverage`: 3696/3697 tests; el único fallo (`protect-ops.test.ts`, timeout de 5 s bajo carga) pasa solo (11/11), no es de esta ficha. `verify.test.ts` 26/26; `verify.ts` 95,7 % de líneas; pdfsig contrastado en valid/invalid.
1. (opcional) `verify.ts:213` — no se comprueba que el hueco `[b, c)` coincida con la posición de `/Contents` (defensa contra «signature wrapping»); valdría un criterio en una ficha futura.
2. (opcional) Dudas del programador 1-4 aceptadas como interpretación razonable; documentar ECDSA sin `signedAttrs` → `unknown` en el Manual. Falta test de PDF cifrado (duda 5) y de campos con `/Kids` (duda 6), recomendable en PDF-139.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Casos de la ficha (válido, byte cambiado, incremento posterior, ECDSA openssl, sha1) | OK | `verify.test.ts` 26/26 dentro de `pnpm coverage` |
| pdfsig coincide en valid/invalid | OK | tests con `pdfsig` (líneas 170, 181, 220, 240) |
| Sin firmas y `form-full.pdf` → `ok([])` | OK | test línea 308 |
| Cobertura `verify.ts` ≥ 90 % | OK | 95,71 % líneas |
| lint, typecheck, coverage con código 0 | OK | lint y typecheck limpios; coverage exit=0, 283 ficheros, 3697/3697 tests |

Sin tests añadidos. Pendientes recomendados (no bloquean): PDF cifrado y campos con `/Kids` (PDF-139), según el revisor.
