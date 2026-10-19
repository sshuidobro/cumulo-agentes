---
tipo: tarea
id: PDF-131
titulo: Reescribir el documento completo (con o sin cifrado nuevo)
app: pdf
estado: en-revision
depende_de: [PDF-060, PDF-121]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, seguridad, nucleo]
---

# PDF-131 · Reescribir el documento completo (con o sin cifrado nuevo)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0037-proteger-reescritura-aes256]], [[ADR-0039-redaccion-real]] · Antes: [[PDF-060-proteger]], [[PDF-121-documento-nuevo]] · Lo usan: [[PDF-132-proteger-interfaz]], [[PDF-135-redactar-aplicar]]

## Objetivo
`rewriteDocument` escribe un fichero PDF nuevo con **solo** los objetos alcanzables desde `/Root` e `/Info` del documento leído (sin revisiones antiguas ni objetos huérfanos), renumerados, y opcionalmente cifrado con un cifrado nuevo. Es la base de proteger, quitar la protección y redactar.

## Contexto
- `src/core/pdf/file-writer.ts` → `writeCompleteFile`, `FileEncryption` (PDF-121).
- `src/core/pdf/object-reader.ts` → `get`, `encryptRef`, `xref.trailer`.
- `src/core/pdf/crypto/create-security.ts` → `createAes256Security` (PDF-060).
- `src/core/doc-ops/ops/index.ts` → `DOC_OPS`.

## Qué hay que hacer
1. `src/core/pdf/rewrite.ts`:
```ts
export interface RewriteInput {
  readonly reader: ObjectReader;               // ya abierto con la contraseña (descifra al leer)
  readonly encryption: NewSecurityInput | null; // null = sin cifrar
  readonly now: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;   // objetos escritos / alcanzados hasta ahora
}
export async function rewriteDocument(input: RewriteInput): Promise<Result<{ readonly bytes: Uint8Array; readonly objects: number }>>;
```
   - Recorrido en anchura desde las refs de `/Root` e `/Info` del trailer, con pila explícita y conjunto de visitados por número; refs a objetos libres o inexistentes → `null`; el objeto `/Encrypt` original nunca se copia.
   - Numeración nueva 1..N en orden de descubrimiento; todas las refs internas se reescriben con el mapa (función `remap(value)` recursiva para valores directos, profundidad ≤ 100).
   - Flujos: datos tal cual leídos (descifrados, sin decodificar), `/Length` directo = `data.length`.
   - Se quita `/Perms` del catálogo (permisos de uso `UR3` y certificación `DocMDP` dejan de ser válidos al reescribir); el resto se copia.
   - `/ID`: `id0` el original si existe (16 bytes o el que haya); si no, nuevo.
   - Con `encryption` → `createAes256Security(…)` y `writeCompleteFile({ …, encryption: { handler, encrypt, random } })`; sin él, fichero sin cifrar.
   - Progreso cada 1 000 objetos; `signal` → `cancelled`; excepciones → `toSaveError`.
2. Ops en `DOC_OPS`:
   - `'protect'`: args `{ password: string | null; userPassword: string; ownerPassword: string; permissions: PermissionChoice; now: string }` → `rewriteDocument` con cifrado → `ok({ bytes })`.
   - `'unprotect'`: args `{ password: string | null; now: string }` → si el lector no está cifrado → `err` con código nuevo `'not-protected'`; si está autenticado como `'user'` y `permissions` no son todas → `err('owner-password-required')`; si no, `rewriteDocument` sin cifrado → `ok({ bytes })`.
   - `'rewrite'`: args `{ password: string | null; now: string }` → sin cifrado nuevo pero **conservando** el del original si lo tenía (mismas contraseñas no se pueden recuperar: si está cifrado, reutiliza su `SecurityHandler` y su diccionario `/Encrypt` tal cual leído) → `ok({ bytes })`. Lo usa la redacción.
3. `src/core/errors.ts`: `'not-protected'` → «Este PDF no tiene contraseña.»; `'owner-password-required'` → «Para quitar la protección hace falta la contraseña de permisos.».
4. Tests `tests/unit/pdf/rewrite.test.ts` y `tests/unit/doc-ops/protect-ops.test.ts`; rendimiento en `tests/perf/rewrite.perf.test.ts`.

## Criterios de aceptación
- [ ] `incremental-updates.pdf` reescrito → una sola sección xref (`qpdf --show-xref` sin `/Prev`), mismas páginas y texto en pdf.js, y los objetos de revisiones antiguas no están (busca en el resultado una cadena que solo existía en la revisión antigua del fixture).
- [ ] `basic-5.pdf` tras borrar la página 2 con `buildPageTreeUpdate` + reescritura → el fichero es más pequeño que el concatenado y no contiene el contenido de la página borrada.
- [ ] `'protect'` de `basic-5.pdf` con `abc`/`propietario` y sin copiar → pdf.js pide contraseña y abre con `abc`; `qpdf --show-encryption --password=abc` muestra `R = 6`, `AESv3` y «extract for any purpose: not allowed»; `qpdf --check --password=abc` 0.
- [ ] `'unprotect'` de `encrypted-aes-256.pdf` abierto con `propietario` → sin cifrar y legible; `encrypted-owner-only.pdf` abierto con la contraseña vacía (usuario, con restricciones) → `owner-password-required`; abierto con `propietario` → sin cifrar; de `basic-5.pdf` → `not-protected`.
- [ ] `'rewrite'` de `encrypted-aes-128.pdf` (`usuario`) → sigue cifrado y abre con `usuario` y `propietario`.
- [ ] `annotated.pdf`, `form-full.pdf`, `outline.pdf`, `compressed.pdf` → anotaciones, campos e índice intactos tras reescribir (pdf.js) y `qpdf --check` 0.
- [ ] `pnpm perf`: reescribir `pages-100000.pdf` < 20 000 ms; con cifrado < 25 000 ms.
- [ ] Cobertura de `rewrite.ts` ≥ 90 %. `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Object streams y xref de flujo en la salida (siempre tabla clásica). Linealizar. Interfaz.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/rewrite.ts` (nuevo); `apps/lector-pdf/src/core/doc-ops/ops/index.ts` (ops `protect`, `unprotect`, `rewrite` y helpers); `apps/lector-pdf/src/core/errors.ts` (`not-protected`, `owner-password-required`); `apps/lector-pdf/tests/unit/pdf/rewrite.test.ts`; `apps/lector-pdf/tests/unit/doc-ops/protect-ops.test.ts`; `apps/lector-pdf/tests/perf/rewrite.perf.test.ts`.
- Qué he hecho: `rewriteDocument` recorre en anchura desde `/Root` e `/Info` con cola explícita y numeración 1..N por descubrimiento; quita `/Perms`, descarta `/Encrypt` y las referencias inexistentes (→ `null`), fija `/Length` directo y cifra con `createAes256Security` si se pide. Las tres ops se registran en `DOC_OPS`. Tests: 22 de reescritura y 11 de ops, incluidos qpdf (`--check`, `--show-encryption`) y pdf.js.
- Decisión menor a revisar: `RewriteInput` tiene un campo opcional `keepEncryption` (no está en la ficha). Con `encryption: null`, `rewrite` necesita conservar el cifrado original y `unprotect` no; sin el campo no hay forma de distinguirlos sin cambiar la firma pedida. Un `Info` directo (no referencia) se descarta: la ficha solo prevé referencias.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf typecheck`: sin errores de mis ficheros. Quedan errores en `tests/unit/pdf/flatten.test.ts` (fichero de otro programador, en curso).
  - ESLint sobre mis 6 ficheros: sin errores. `pnpm lint` de la raíz falla con 11 746 errores, todos en `apps/lector-pdf/dist-pdf095/` (carpeta de build no excluida en `eslint.config`; no es mía).
  - `vitest run` de mis 2 ficheros de test: 33/33 OK. Cobertura de `rewrite.ts` (con esos tests): líneas 100 %, sentencias 90,9 %, ramas 84 %.
  - `pnpm perf` (solo `rewrite.perf.test.ts`, con `vitest run --config vitest.perf.config.ts <fichero>`): 2/2 OK; cada pasada sobre `pages-100000.pdf` tarda unos 8 s, sin y con cifrado (límites 20 s y 25 s).
  - `pnpm coverage` completo: 2 ficheros fallan que no son míos: `tests/unit/fixtures.test.ts` (espera 28 fixtures y `catalog.ts` tiene 29 ahora, cambio de otro programador) y `tests/unit/search-actions.test.ts` (`revealSeq`). `pnpm perf` completo: una prueba falla en `annotation-layer.perf.test.ts` (107,7 ms frente a 100 ms), tampoco mía.
- Dudas o cosas que no he podido hacer: los criterios de pdf.js y qpdf están automatizados en los tests, no comprobados a mano en la interfaz (PDF-132 la usará). Sin commit, como se pidió.
