---
tipo: tarea
id: PDF-093
titulo: Lector de objetos y escritor incremental con cifrado
app: pdf
estado: en-revision
depende_de: [PDF-092, PDF-090]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-4, seguridad, formato, core]
---

# PDF-093 · Lector de objetos y escritor incremental con cifrado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0022-pdf-cifrados]] · [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0014-localizar-paginas-por-count]]

## Objetivo
`ObjectReader` descifra lo que lee y `buildIncrementalUpdate` cifra lo que escribe, de modo que anotar y rellenar formularios funciona en PDFs cifrados con cualquiera de los métodos de PDF-092, sin tocar el resto del fichero.

## Contexto
- Leer: `src/core/pdf/object-reader.ts` (`open`, `load`, `readAt`, `readCompressed`, `objectStream`), `src/core/pdf/incremental.ts` (`openForSave`, `writeUpdate`, `trailerDict`, `DeltaWriter.object`), `src/core/pdf/serialize.ts`, `src/core/pdf/crypto/security.ts` (PDF-092), `src/core/errors.ts`.
- Reglas (ISO 32000-2 §7.6.2): se cifran todas las cadenas y los datos de todos los flujos de los objetos de primer nivel, con el número y la generación **del objeto que los contiene**. No se cifran: el diccionario `/Encrypt`, los *xref streams* (`/Type /XRef`), las cadenas dentro de *object streams* (va cifrado el flujo entero), el flujo `/Metadata` si `EncryptMetadata` es `false`, y los flujos con `/Filter /Crypt` `/Name /Identity`.

## Qué hay que hacer
1. `ObjectReader.open(src: ByteSource, opts?: { readonly password?: string; readonly random?: (n: number) => Uint8Array }): Promise<ObjectReader>`. Si el trailer tiene `/Encrypt`: leerlo sin descifrar (su número se recuerda como `encryptNum`), `openSecurity(encrypt, id0, password ?? '')`; `wrong-password` → `PdfSyntaxError('wrong-password')`; `unsupported` → `PdfSyntaxError('encryption-unsupported')`. Expón `readonly security: SecurityHandler | null` y `readonly encryptRef: PdfRef | null`.
2. Al leer un objeto de primer nivel (`readAt`) con `security`: si su número no es `encryptNum`, descifrar recursivamente sus cadenas (`decryptBytes(h, 'string', num, gen, bytes)`, conservando `hex`) y, si es un flujo que no es `/XRef`, sus datos (`'stream'`), salvo los casos de «no se cifran». En `objectStream`: descifrar los datos del flujo antes de `decodeStreamData`; los objetos que salen de él **no** se descifran otra vez.
3. `src/core/pdf/encrypt-value.ts`: `export function encryptValue(h: SecurityHandler, num: number, gen: number, v: PdfValue, random): PdfValue` — devuelve una copia con todas las cadenas cifradas y, en flujos que no sean `/XRef`, los datos cifrados con `/Length` actualizado.
4. `incremental.ts`:
   - `openForSave(source, password?: string)` pasa la contraseña a `ObjectReader.open`. Errores: `wrong-password` → nuevo código `save-wrong-password`; `encryption-unsupported` → nuevo `save-encryption-unsupported` («Este PDF usa un cifrado que no se puede modificar.»). Quitar el rechazo `save-encrypted` de `writeUpdate`.
   - `DeltaWriter.object` cifra con `encryptValue` cuando `reader.security` existe (excepto el *xref stream*, que se escribe aparte sin cifrar).
   - `trailerDict` añade `Encrypt: reader.encryptRef` si existe (también en el diccionario del *xref stream*). `/ID[0]` se conserva (ya se hace).
   - `IncrementalInput` gana `random?: (n: number) => Uint8Array` (por defecto `crypto.getRandomValues`), para tests deterministas.
5. `errors.ts`: mensajes nuevos; `save-encrypted` se mantiene en el tipo solo si algún sitio lo sigue usando (si no, se elimina).
6. Tests `tests/unit/incremental-encrypted.test.ts` con los fixtures de PDF-091 (pdf.js en Node con contraseña + `qpdf --check --password=usuario`).

## Criterios de aceptación
- [ ] `ObjectReader` sobre `encrypted-annotated-aes-128.pdf` con `usuario`: el `/Contents` de la nota de la p2 se lee en claro (igual que en `annotated.pdf`); sobre `encrypted-aes-256-objstm.pdf` se leen los objetos comprimidos (páginas encontradas por `pageRef`).
- [ ] Para los 6 fixtures con contraseña y `encrypted-owner-only.pdf` (con `''`): añadir un resaltado y una nota con texto «Cifrado ñ €», modificar y borrar una anotación existente en `encrypted-annotated-aes-128.pdf` → `original + delta` abierto con pdf.js (contraseña `usuario`, o sin contraseña en el de propietario) muestra las anotaciones con su texto correcto y `qpdf --check --password=usuario` (o sin contraseña) da código 0.
- [ ] El trailer del incremento contiene `/Encrypt` con la misma referencia que el original y `/ID` con el primer elemento original.
- [ ] Con `random` fijo, el delta es determinista; sin él, dos guardados dan deltas distintos (IV aleatorio) pero ambos válidos.
- [ ] Contraseña incorrecta al guardar → `save-wrong-password`; `/Filter /FooBar` → `save-encryption-unsupported`; el fichero no se toca.
- [ ] PDFs sin cifrar: todos los tests de escritura existentes en verde y el delta byte a byte igual que antes (test de regresión con `basic-5.pdf` y un resaltado con `now` fijo).
- [ ] `pnpm perf` sin regresiones (`incremental.perf.test.ts`, `object-reader.perf.test.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Integración en la app (PDF-047). Formularios: funcionan por el mismo camino (lo comprueba PDF-047).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/crypt-rules.ts` (nuevo), `apps/lector-pdf/src/core/pdf/encrypt-value.ts` (nuevo), `apps/lector-pdf/src/core/pdf/object-reader.ts`, `apps/lector-pdf/src/core/pdf/incremental.ts`, `apps/lector-pdf/src/core/pdf/xref.ts`, `apps/lector-pdf/src/core/errors.ts`, `apps/lector-pdf/tests/unit/incremental-encrypted.test.ts` (nuevo, 27 tests), `apps/lector-pdf/tests/unit/pdf/incremental.test.ts`, `apps/lector-pdf/tests/unit/pdf/xref.test.ts`, `apps/lector-pdf/tests/unit/save-actions.test.ts`.
- Qué he hecho: `ObjectReader.open(src, { password, random })` abre `/Encrypt` (sin descifrarlo), expone `security`, `encryptRef` y `random`, y descifra cadenas y flujos de primer nivel al leer. `encryptValue` (en `encrypt-value.ts`) y `decryptValue` comparten las reglas de `crypt-rules.ts`. `openForSave(source, password?)` y `buildIncrementalUpdate` cifran el delta y conservan `/Encrypt` y `/ID[0]` en el trailer. Los errores nuevos son `save-wrong-password` y `save-encryption-unsupported`; se elimina `save-encrypted`. `readXref` ya no rechaza `/Encrypt`.
- Comandos ejecutados y resultado: `pnpm typecheck` OK. `pnpm exec eslint` sobre los ficheros tocados: sin errores ni avisos. Suite completa con cobertura (`vitest run --coverage`): 172 ficheros, 2104 tests en verde. Cobertura: `crypt-rules`, `encrypt-value` y `object-reader` 100 %, `incremental` 99,06 %, `xref` 96,5 %. `pnpm perf`: 18 ficheros, 29 tests en verde. `qpdf --check` (con `--password=usuario` o sin contraseña) da 0 en los 7 PDF cifrados. Regresión: el delta de `basic-5.pdf` con un resaltado y `now` fijo es byte a byte el de HEAD (`cmp` contra un worktree de HEAD, sha256 `9fe763…ed86`, test incluido).
- Dudas o cosas que no he podido hacer:
  1. `pnpm lint` de la raíz falla por `apps/lector-pdf/dist-recientes/` (carpeta sin seguimiento, ajena a esta ficha; unos 20 ficheros con `no-undef`). No la he tocado. Los ficheros de esta ficha pasan el lint.
  2. El commit incluye solo mis cambios de `errors.ts`. Ese fichero tiene además un cambio sin commit de otro programador (mensaje de `password-required`), que he dejado fuera.
  3. Decisiones que tomé donde la ficha no decía nada: `/Encrypt` directo (no indirecto) en el trailer → `encryption-unsupported`. `/Encrypt` que no es un diccionario Standard válido → `save-encryption-unsupported`. Texto de `save-wrong-password`: «No se pueden guardar los cambios: la contraseña no es correcta.». La ficha pedía descifrar en `objectStream`, pero no hace falta: el flujo del objeto comprimido ya llega descifrado desde `readAt`, porque es de primer nivel.
  4. Tests cambiados (no saltados): se elimina «trailer con /Encrypt → save-encrypted» de `incremental.test.ts` (el comportamiento que probaba ya no existe; lo cubre el nuevo fichero). Los de `xref`, `save-actions` e `incremental` pasan a los códigos nuevos.
  5. Para PDF-047: `buildCurrentDelta` (`src/state/save-actions.ts`) sigue llamando a `openForSave(file.source)` sin contraseña. Un PDF de usuario guardado desde la app devolverá `save-wrong-password` hasta que se pase la contraseña abierta. Lo dejo fuera de alcance según la ficha.
  6. No he ejecutado los E2E.
