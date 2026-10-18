---
tipo: decision
id: ADR-0022
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, seguridad, formato]
---

# ADR-0022 · PDF cifrados: contraseña en memoria y manejador de seguridad propio sobre @noble

## Contexto
Abrir PDFs con contraseña y guardar anotaciones en PDFs cifrados son imprescindibles ([[Paridad Adobe Acrobat]], área 9). pdf.js descifra al leer, pero nuestro escritor incremental ([[ADR-0009-anotaciones-escritor-incremental]]) hoy rechaza `/Encrypt` (`save-encrypted`). Muchos PDF «protegidos» solo tienen contraseña de propietario (se abren sin pedir nada pero están cifrados): hoy no se pueden anotar. Investigación: [[Librerias y arquitectura PDF]] (riesgos: pdf-lib no cifra; forks sin auditar).

Necesidades criptográficas (ISO 32000-2 §7.6, manejador estándar): MD5 y RC4 (revisiones 2-4), AES-128-CBC (AESV2), AES-256-CBC y SHA-256/384/512 (revisión 6, algoritmo 2.B con AES-128-CBC **sin relleno**). WebCrypto no tiene MD5, RC4 ni AES sin relleno, y es asíncrono.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Manejador propio (`core/pdf/crypto/`) con `@noble/hashes@2.4.0` (MD5, SHA-2) y `@noble/ciphers@2.4.0` (AES ECB/CBC con `disablePadding`) + RC4 propio (20 líneas)** | Síncrono (encaja en el serializador); librerías auditadas, sin dependencias, mantenidas (2026-08-27, `npm view`); funciona igual en Node, navegador y Tauri | Hay que implementar los algoritmos 1, 2, 2.A, 2.B, 4-7 con tests | MIT |
| B. Solo WebCrypto + MD5/RC4 propios | Sin dependencias | Asíncrono; AES sin relleno con trucos; MD5 propio sin auditar | — |
| C. `@cantoo/pdf-lib` (fork con cifrado) | Hecho | Reescribe todo el fichero; fork sin auditar | MIT |
| D. Pedir a pdf.js la clave | — | No está expuesta en la API pública | Apache-2.0 |

## Decisión
**Opción A.**
- **Contraseña:** se pide con un diálogo propio cuando `loadPdf` devuelve `password-required`; se reintenta con `password-incorrect`. Se guarda **solo en memoria** en la sesión del documento (para reabrir tras guardar, imprimir y cifrar el incremento). Nunca en disco, preferencias, borradores ni registros.
- **Manejador estándar** (`SecurityHandler`): lee `/Encrypt` (`/V` 1, 2, 4, 5; `/R` 2, 3, 4, 5, 6; `/CF`, `/StmF`, `/StrF` con `/V2`, `/AESV2`, `/AESV3`, `/Identity`; `/EncryptMetadata`), deriva la clave del fichero con la contraseña de usuario **o** de propietario (vacía si no se ha pedido) y cifra/descifra cadenas y flujos por objeto (algoritmo 1 para RC4/AES-128; clave directa para AES-256). IV aleatorio de 16 bytes (`crypto.getRandomValues`, inyectable en tests).
- **Leer:** `ObjectReader` descifra las cadenas de los objetos de primer nivel y los datos de los *object streams* antes de descomprimir. Nunca descifra el diccionario `/Encrypt` ni los *xref streams*.
- **Escribir:** el incremento cifra todas las cadenas y flujos de los objetos que escribe con su número y generación (no el *xref stream*), y el trailer conserva `/Encrypt` (misma referencia) y `/ID` primero original.
- **Formatos no soportados** (manejador no estándar, `/V` 3, filtros de cifrado públicos): error claro «Este PDF usa un cifrado que no se puede modificar» sin tocar el fichero.

## Consecuencias
- Dependencias nuevas: `@noble/hashes@2.4.0` y `@noble/ciphers@2.4.0` (MIT, sin dependencias). Solo se importan desde `src/core/pdf/crypto/`.
- Fixtures cifrados generados con `qpdf --encrypt` (herramienta de desarrollo ya requerida); validación de lo escrito con `qpdf --check --password=…` y pdf.js.
- RC4 y MD5 son débiles, pero es el formato del fichero del usuario: se respeta el método que ya tiene (no se «mejora» el cifrado al anotar; cambiar la protección es PDF-060).
