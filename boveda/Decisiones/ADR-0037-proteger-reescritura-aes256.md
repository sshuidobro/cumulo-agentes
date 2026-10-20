---
tipo: decision
id: ADR-0037
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, seguridad, cifrado]
---

# ADR-0037 · Proteger y quitar protección: reescritura completa con AES-256 (R6)

## Contexto
[[PDF-060-proteger|PDF-060]]: poner contraseña de apertura y/o de permisos y quitar la protección. Ya leemos y escribimos incrementos en PDFs cifrados con `@noble/ciphers` y `@noble/hashes` ([[ADR-0022-pdf-cifrados]]). Un incremento no puede cambiar el cifrado de los objetos que ya están en el fichero, y conservar las revisiones antiguas sin cifrar dejaría el contenido legible.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Reescritura completa propia**: todos los objetos alcanzables desde `/Root` e `/Info`, renumerados, con o sin cifrado nuevo; xref clásica | Sin dependencias; quita revisiones antiguas (también sirve para redactar y para «guardar optimizado») | Lee el documento entero (segundos con 100 000 páginas, en el Worker) | propia |
| B. Incremento con `/Encrypt` nuevo | Rápido | No es válido: los objetos antiguos quedarían sin cifrar o con la clave anterior | — |
| C. qpdf (WASM) | Robusto | Descartado en [[ADR-0028-reescribir-pdfs]] | Apache-2.0 |

## Decisión
**Opción A** en `src/core/pdf/rewrite.ts` (`rewriteDocument`) con el escritor de ficheros completos de `new-document` ([[PDF-121-documento-nuevo|PDF-121]]).
- Cifrado nuevo siempre **AES-256, revisión 6** (ISO 32000-2 §7.6.4.4, algoritmos 8, 9 y 10), `EncryptMetadata true`. No se ofrece RC4 ni AES-128.
- Contraseña de permisos vacía con restricciones → se usa una aleatoria de 32 bytes (nadie podrá quitar las restricciones; el diálogo lo avisa).
- Quitar la protección exige haber abierto con la contraseña de **propietario** si el documento tiene restricciones; con solo la de usuario y restricciones, se pide la de propietario.
- La reescritura descarta objetos no alcanzables (revisiones antiguas y páginas borradas).

## Consecuencias
- Tras proteger, el fichero pierde su historial de incrementos (como Acrobat al «Guardar como»).
- Firmas digitales existentes quedan invalidadas al reescribir: el diálogo avisa si el documento tiene campos de firma firmados.
