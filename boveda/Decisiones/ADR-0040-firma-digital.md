---
tipo: decision
id: ADR-0040
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, firma, seguridad, dependencias]
---

# ADR-0040 · Firma digital: node-forge para PKCS#12 y RSA, CMS propio, PAdES B-B sin sello de tiempo

## Contexto
[[PDF-066-firma-digital|PDF-066]]: firmar con un certificado personal (`.p12`/`.pfx`) y validar firmas existentes. La investigación ([[Paridad Adobe Acrobat]] §firma) apuntaba a `@signpdf/signpdf` + pdf-lib; pdf-lib quedó descartado ([[ADR-0028-reescribir-pdfs]]). Comprobado el 2026-10-19:
- `pkijs` 3.4.1 (BSD-3) no descifra PKCS#12 con PBE heredado (`pbeWithSHAAnd3-KeyTripleDES-CBC`, RC2), que es lo que exportan muchos Windows y certificados de la FNMT. WebCrypto tampoco tiene 3DES ni RC2.
- `node-forge` 1.4.0 (licencia dual `BSD-3-Clause OR GPL-2.0`; se usa bajo **BSD-3**, actualizado en 2026-03): PKCS#12 con todos esos algoritmos, ASN.1/DER, X.509, RSA PKCS#1 v1.5 y SHA-256. No admite claves EC.
- `@signpdf/signpdf` 4.0.0 (MIT) usa node-forge y espera el PDF entero en memoria.
- `pdfsig` (poppler) y `openssl` están en la máquina de pruebas.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. node-forge (PKCS#12, X.509, RSA) + CMS SignedData propio con `forge.asn1` + incremento propio** | Lee cualquier .p12 habitual; control total de los atributos PAdES; el PDF se lee por rangos | ~300 líneas propias de CMS y de firma | BSD-3 |
| B. pkijs + WebCrypto | CMS completo, ECDSA | No abre .p12 heredados (los más comunes en España) | BSD-3 |
| C. @signpdf/signpdf | Hecho | Necesita el PDF entero y su propio colocador; sin control del incremento ni del cifrado | MIT |

## Decisión
**Opción A.** Dependencia `node-forge@1.4.0` (y `@types/node-forge` en desarrollo). Solo `src/core/signature/digital/` la importa, con `import()` diferido desde la interfaz.
- Firma **PAdES B-B** (`/SubFilter /ETSI.CAdES.detached`): atributos firmados `contentType`, `messageDigest` y `signingCertificateV2`; hora en `/M` del diccionario de firma (sin atributo `signingTime`). SHA-256 y RSA PKCS#1 v1.5. Hueco `/Contents` de 16 384 bytes.
- **Sin sello de tiempo (TSA) ni comprobación de revocación (OCSP/CRL)**: implicarían conexiones de red. Si el usuario los quiere, será una decisión de producto aparte.
- Validar firmas: integridad (resumen del `/ByteRange` y firma RSA o ECDSA con WebCrypto) y «cambios después de firmar». La identidad se muestra como **no verificada** (no se instala ninguna lista de confianza).
- No se firman PDFs cifrados (se pide quitar la protección antes) ni con claves EC (mensaje claro).

## Consecuencias
- Las firmas creadas se validan en `pdfsig` («Signature is Valid») y en Adobe con el aviso de identidad desconocida si el certificado no es de confianza en ese equipo (lista manual del usuario).
- Las firmas de DNIe o tarjetas (PKCS#11) quedan fuera.
