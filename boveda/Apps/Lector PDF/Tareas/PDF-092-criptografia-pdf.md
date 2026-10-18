---
tipo: tarea
id: PDF-092
titulo: Manejador de seguridad estándar - claves, contraseñas y cifrado por objeto
app: pdf
estado: en-revision
depende_de: [PDF-091]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, seguridad, formato, core]
---

# PDF-092 · Manejador de seguridad estándar: claves, contraseñas y cifrado por objeto

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0022-pdf-cifrados]]

## Objetivo
Módulo puro `src/core/pdf/crypto/` que, a partir del diccionario `/Encrypt`, el `/ID` y una contraseña (de usuario o de propietario), obtiene la clave del fichero y cifra/descifra cadenas y flujos de cualquier objeto, para RC4 40/128, AES-128 y AES-256 (R2-R6).

## Contexto
- Dependencias nuevas aprobadas (versión exacta): `@noble/hashes@2.4.0` (`md5` en `@noble/hashes/legacy.js`; `sha256`, `sha384`, `sha512` en `@noble/hashes/sha2.js`) y `@noble/ciphers@2.4.0` (`cbc`, `ecb` en `@noble/ciphers/aes.js`, opción `{ disablePadding: true }`). Solo se importan en `src/core/pdf/crypto/`.
- Leer: `src/core/pdf/objects.ts`, `src/core/pdf/text-string.ts`.
- Constantes: relleno `PAD` = `28 BF 4E 5E 4E 75 8A 41 64 00 4E 56 FF FA 01 08 2E 2E 00 B6 D0 68 3E 80 2F 0C A9 FE 64 53 69 7A`.

## Qué hay que hacer
1. `rc4.ts`: `export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array` (KSA + PRGA estándar).
2. `security.ts`:
```ts
export type CryptMethod = 'none' | 'rc4' | 'aes128' | 'aes256';
export interface SecurityHandler {
  readonly revision: 2 | 3 | 4 | 5 | 6;
  readonly fileKey: Uint8Array;
  readonly stringMethod: CryptMethod; readonly streamMethod: CryptMethod;
  readonly encryptMetadata: boolean;
  readonly permissions: number;          // /P como entero con signo
  readonly authenticatedAs: 'user' | 'owner';
}
export type SecurityError = 'unsupported' | 'wrong-password';
/** Prueba la contraseña como usuario y, si falla, como propietario. */
export function openSecurity(encrypt: PdfDict, id0: Uint8Array, password: string): { ok: true; value: SecurityHandler } | { ok: false; error: SecurityError };
export function decryptBytes(h: SecurityHandler, kind: 'string' | 'stream', num: number, gen: number, data: Uint8Array): Uint8Array;
export function encryptBytes(h: SecurityHandler, kind: 'string' | 'stream', num: number, gen: number, data: Uint8Array, random: (n: number) => Uint8Array): Uint8Array;
```
3. Lectura de `/Encrypt`: `/Filter /Standard` (si no → `unsupported`); `/V` 1 o 2 → RC4 con `/Length` (40 por defecto; bits/8 bytes); `/V` 4 → `/CF /StdCF /CFM` `/V2` (RC4 128) o `/AESV2` (AES-128), `/StmF` y `/StrF` (`/Identity` → `none`); `/V` 5 → `/AESV3`; otro → `unsupported`. `/EncryptMetadata` por defecto `true`.
4. Algoritmos (ISO 32000-2 §7.6.4):
   - **Clave R2-R4 (alg. 2):** `MD5(pad32(pw) ‖ O ‖ P como 4 bytes little-endian ‖ ID[0] ‖ (R≥4 y !EncryptMetadata ? FF FF FF FF : ∅))`; si R≥3, 50 veces `h = MD5(h[0..n])`; clave = `h[0..n]` (`n` = 5 en R2; `Length/8` en el resto). `pad32`: contraseña en Latin-1 (caracteres > 255 → `?`), cortada a 32 y completada con `PAD`.
   - **Comprobar usuario (alg. 4/5):** R2: `rc4(clave, PAD) == U`; R3/4: `x = rc4(clave, MD5(PAD ‖ ID[0]))`, luego para `i = 1..19` `x = rc4(clave XOR i, x)`; comparar con los 16 primeros bytes de `U`.
   - **Propietario R2-R4 (alg. 7):** `h = MD5(pad32(pw))`; R≥3: 50 veces `h = MD5(h)`; `okey = h[0..n]`; R2: `pwUsuario = rc4(okey, O)`; R≥3: `x = O`, para `i = 19..0` `x = rc4(okey XOR i, x)`; `pwUsuario = x`; después alg. 2 con esos 32 bytes (ya rellenos) y comprobar como usuario.
   - **R6 (alg. 2.A / 2.B):** contraseña UTF-8 (NFKC como aproximación de SASLprep), máximo 127 bytes. Usuario: `hash(pw, U[32..40], ∅) == U[0..32]` → `ik = hash(pw, U[40..48], ∅)`, `fileKey = AES-256-CBC-descifrar(ik, IV 0, UE)` sin relleno. Propietario: `hash(pw, O[32..40], U[0..48]) == O[0..32]` → `ik = hash(pw, O[40..48], U[0..48])`, `fileKey` de `OE`. R5: `hash = SHA-256(pw ‖ sal ‖ udata)`. `hash` de R6 (2.B): `K = SHA-256(pw ‖ sal ‖ udata)`; repetir: `K1 = (pw ‖ K ‖ udata)` × 64; `E = AES-128-CBC-cifrar(clave K[0..16], IV K[16..32], K1)` sin relleno; `m = (suma de E[0..16]) mod 3`; `K = SHA-256 / SHA-384 / SHA-512 (E)` para `m` = 0/1/2; ronda++; parar cuando `ronda ≥ 64` y `E[último] ≤ ronda − 32`; devolver `K[0..32]`.
   - **Clave por objeto (alg. 1, RC4 y AES-128):** `MD5(fileKey ‖ num (3 bytes LE) ‖ gen (2 bytes LE) ‖ (AES ? "sAlT" : ∅))[0..min(n+5, 16)]`. AES-256: `fileKey` tal cual.
   - **AES:** cifrar = IV aleatorio de 16 bytes ‖ AES-CBC con relleno PKCS#7; descifrar = IV = primeros 16 bytes, resto con relleno (si el relleno es inválido, devolver los bytes sin quitar relleno: los visores son tolerantes).
5. Tests `tests/unit/pdf-crypto.test.ts`: RC4 con vectores RFC 6229 (clave `0102030405`, primeros 16 bytes), MD5 de «abc», y con los fixtures de PDF-091 (leer `/Encrypt` y `/ID` con `ObjectReader` sin descifrar).

## Criterios de aceptación
- [ ] RC4 (RFC 6229, clave de 40 bits `0102030405`, desplazamiento 0): `b2 39 63 05 f0 3d c0 27 cc c3 52 4a 0a 11 18 a8`.
- [ ] Para los 6 fixtures con contraseña: `openSecurity` con `usuario` → `authenticatedAs: 'user'`; con `propietario` → `'owner'` y la **misma** `fileKey`; con `mal` → `wrong-password`. `encrypted-owner-only.pdf` con `''` → `user`.
- [ ] Descifrar el flujo de contenido de la p1 de cada fixture (`decryptBytes` + `decodeStreamData`) contiene el mismo texto que el flujo de la p1 de su fichero base sin cifrar (`basic-5.pdf`: `Página 1 de 5` en WinAnsi; `compressed.pdf` y `annotated.pdf`: comparar con el flujo decodificado del original).
- [ ] Ida y vuelta `encryptBytes`/`decryptBytes` con los 4 métodos, cadenas de 0, 1, 15, 16 y 1 000 bytes; con `random` fijo el resultado es determinista.
- [ ] `/Filter /FooBar`, `/V 3` y `/CFM /None` raro → `unsupported` (nunca lanza).
- [ ] Rendimiento: `openSecurity` R6 < 50 ms (test en `tests/perf/`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` (≥ 90 % en `crypto/`), `pnpm perf` con código 0.

## Fuera de alcance
- Usarlo al leer y escribir (PDF-093). Crear o cambiar cifrado (PDF-060). `/PubSec`.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/crypto/rc4.ts` (nuevo), `apps/lector-pdf/src/core/pdf/crypto/security.ts` (nuevo), `apps/lector-pdf/src/core/pdf/crypto/index.ts` (nuevo), `apps/lector-pdf/tests/unit/pdf-crypto.test.ts` (nuevo, 39 tests), `apps/lector-pdf/tests/perf/pdf-crypto.perf.test.ts` (nuevo), `apps/lector-pdf/package.json` (`@noble/hashes@2.4.0`, `@noble/ciphers@2.4.0`), `pnpm-lock.yaml` (lo regenera `pnpm install`).
- Qué he hecho: `rc4`, `openSecurity` (R2-R6, usuario y propietario, `/Filter`, `/V`, `/CF`, `/EncryptMetadata`), `decryptBytes`/`encryptBytes` para RC4, AES-128 y AES-256 y `none`. Nunca lanza por datos del fichero: lo no soportado es `unsupported`. Las claves de R2-R4 usan el alg. 3 de ISO 32000-1 (50 rehashes sobre los `n` primeros bytes, también en la de propietario).
- Comandos ejecutados y resultado: `pnpm lint` sin errores ni avisos. `pnpm typecheck` OK. `pnpm coverage`: 197 ficheros, 2374 tests en verde; `crypto/` con 100 % de líneas. `pnpm perf`: 18 ficheros, 29 tests en verde (R6 < 50 ms).
- Dudas o cosas que no he podido hacer:
  1. **Desviación de la ficha, por código existente:** `ObjectReader.open` lanza `PdfSyntaxError('encrypted')` en cuanto el trailer tiene `/Encrypt` (`xref.ts`). No se puede leer `/Encrypt` ni `/ID` «con ObjectReader sin descifrar» sin cambiar ese comportamiento, que es de PDF-093. Los tests leen `/Encrypt` y `/ID` con el analizador directo (`parseIndirectObject`) sobre el texto del fichero, y localizan el flujo de contenido por su texto (`P\341gina 1 de 5`, `…de 50`, `…de 3`) en vez de «la p1» por el árbol de páginas. Comparan el flujo descifrado con el del fichero base. Si el líder prefiere otra vía, lo cambio cuando PDF-093 haga legible el cifrado.
  2. Los tests importan `@noble/*` (MD5 de referencia y AES para el texto de prueba). Solo el código de producción lo importa desde `crypto/`.
  3. `pnpm install` ha reescrito además entradas de `pnpm-lock.yaml` que no son mías (jsdom/vitest/whatwg-url, cambios de forma del lockfile). Conviene revisarlo antes del commit.
  4. No he hecho commit (lo pediste). PDF-090 y PDF-102 no se han tocado.
