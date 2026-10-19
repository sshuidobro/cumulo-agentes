---
tipo: tarea
id: PDF-060
titulo: Proteger - crear el cifrado AES-256 (R6) y los permisos (núcleo)
app: pdf
estado: en-revision
depende_de: [PDF-052, PDF-047]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, seguridad, cifrado, nucleo]
---

# PDF-060 · Proteger: crear el cifrado AES-256 (R6) y los permisos (núcleo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0037-proteger-reescritura-aes256]], [[ADR-0022-pdf-cifrados]] · Paridad: [[Paridad Adobe Acrobat]] · Siguen: [[PDF-131-reescribir-documento]], [[PDF-132-proteger-interfaz]]

## Objetivo
Crear un manejador de seguridad nuevo AES-256 revisión 6 a partir de una contraseña de apertura, una de permisos y los permisos elegidos, junto con su diccionario `/Encrypt`, de forma que nuestro lector, pdf.js y qpdf lo acepten.

## Contexto
- `src/core/pdf/crypto/security.ts` → `SecurityHandler`, `openSecurity`, `encryptBytes`; privadas a exportar: `hashAes256` (línea ~306), `saslPrep` (~297).
- `@noble/ciphers/aes.js` (`cbc`, `ecb`) y `@noble/hashes/sha2.js` (ya dependencias).
- `src/core/permissions.ts` → `PERMISSION_FLAG`, `permissionsFrom`.
- `src/core/pdf/crypt-rules.ts` → `RandomBytes`, `secureRandom`.
- ISO 32000-2 §7.6.4.3.3 (algoritmo 2.B), §7.6.4.4.7 (alg. 8: `U`, `UE`), §7.6.4.4.8 (alg. 9: `O`, `OE`), §7.6.4.4.9 (alg. 10: `Perms`), tabla 22 (bits de `/P`).

## Qué hay que hacer
1. `security.ts`: exporta `hashAes256` y `saslPrep` sin cambiar su comportamiento.
2. `src/core/pdf/crypto/create-security.ts`:
```ts
export interface PermissionChoice {
  readonly print: 'none' | 'low' | 'high';
  readonly modify: boolean;      // bit 4 (8)
  readonly copy: boolean;        // bit 5 (16)
  readonly annotate: boolean;    // bit 6 (32)
  readonly fillForms: boolean;   // bit 9 (256)
  readonly assemble: boolean;    // bit 11 (1024)
}
export const ALL_ALLOWED: PermissionChoice;
export interface NewSecurityInput {
  readonly userPassword: string;     // '' = se abre sin contraseña
  readonly ownerPassword: string;    // '' = aleatoria de 32 bytes (nadie podrá cambiar los permisos)
  readonly permissions: PermissionChoice;
  readonly random: RandomBytes;
}
export interface NewSecurity { readonly handler: SecurityHandler; readonly encrypt: PdfDict }
/** `/P` como entero con signo de 32 bits. */
export function permissionsValue(p: PermissionChoice): number;
export function createAes256Security(input: NewSecurityInput): NewSecurity;
```
   - `permissionsValue`: parte de `0xFFFFF0C0 | 0x200` (bits reservados 7-8 y 13-32 a 1, bit 10 «accesibilidad» siempre a 1, bits 1-2 a 0) y suma: imprimir baja → 4; alta → 4 + 2048; `modify` 8; `copy` 16; `annotate` 32; `fillForms` 256; `assemble` 1024. Devuelve `value | 0`.
   - Clave del fichero: 32 bytes de `random`. Contraseñas con `saslPrep` y truncadas a 127 bytes.
   - `U` = `hashAes256(6, user, uValSalt, ∅)` ‖ `uValSalt` (8) ‖ `uKeySalt` (8); `UE` = AES-256-CBC sin relleno, IV cero, clave `hashAes256(6, user, uKeySalt, ∅)`, de la clave del fichero.
   - `O` = `hashAes256(6, owner, oValSalt, U)` ‖ `oValSalt` ‖ `oKeySalt`; `OE` igual con `hashAes256(6, owner, oKeySalt, U)`.
   - `Perms` = AES-256-ECB con la clave del fichero de: `P` en 4 bytes *little-endian*, `FF FF FF FF`, `'T'` (EncryptMetadata), `'a' 'd' 'b'`, 4 bytes de `random`.
   - `/Encrypt`: `{ Filter: /Standard, V: 5, R: 6, Length: 256, CF: { StdCF: { AuthEvent: /DocOpen, CFM: /AESV3, Length: 32 } }, StmF: /StdCF, StrF: /StdCF, O, U, OE, UE, Perms, P, EncryptMetadata: true }` (cadenas en hexadecimal).
   - `handler`: `{ revision: 6, fileKey, stringMethod: 'aes256', streamMethod: 'aes256', encryptMetadata: true, permissions: P, authenticatedAs: 'owner' }`.
3. Tests `tests/unit/pdf/create-security.test.ts`.

## Criterios de aceptación
- [ ] Ida y vuelta: `openSecurity(encrypt, id0, userPassword)` → `ok`, `authenticatedAs: 'user'`, `fileKey` igual; con `ownerPassword` → `'owner'`; con otra → `wrong-password`.
- [ ] `userPassword: ''` → `openSecurity` con `''` abre como usuario.
- [ ] `permissionsValue(ALL_ALLOWED)` = `-4` (`0xFFFFF0C0 | 0x200 | 4 | 2048 | 8 | 16 | 32 | 256 | 1024` = `0xFFFFFFFC`, con signo); solo imprimir baja → bits 4 sí, 2048 no; `permissionsFrom` de las banderas resultantes da los mismos permisos elegidos.
- [ ] Con `random` fijo el resultado es determinista (golden de `U`, `O`, `UE`, `OE` y `Perms` en hexadecimal en el test).
- [ ] Un PDF mínimo de una página construido en el test (objetos con `serializeIndirect`, cifrados con `encryptValue(handler, …)`, `/Encrypt` sin cifrar, xref clásica y `/ID`) → `qpdf --show-encryption --password=<user>` muestra `R = 6` y `AESv3`, y pdf.js lo abre con la contraseña.
- [ ] Contraseñas con tildes y «ñ» (`saslPrep`) funcionan en la ida y vuelta.
- [ ] Cobertura de `create-security.ts` ≥ 95 %. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Reescribir el documento ([[PDF-131-reescribir-documento]]) e interfaz ([[PDF-132-proteger-interfaz]]). RC4/AES-128. Cifrado por certificado.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Ficha detallada con [[ADR-0037-proteger-reescritura-aes256]]: crear cifrado (aquí), reescritura completa ([[PDF-131-reescribir-documento]]) e interfaz ([[PDF-132-proteger-interfaz]]).
