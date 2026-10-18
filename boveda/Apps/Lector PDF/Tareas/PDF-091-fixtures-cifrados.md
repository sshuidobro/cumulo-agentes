---
tipo: tarea
id: PDF-091
titulo: Documentos de prueba cifrados y con permisos (qpdf)
app: pdf
estado: en-revision
depende_de: [PDF-040]
intentos: 0
skills: [formatos-ofimatica, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-4, seguridad, fixtures]
---

# PDF-091 · Documentos de prueba cifrados y con permisos (qpdf)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Decisiones: [[ADR-0022-pdf-cifrados]] · [[ADR-0011-documentos-de-prueba-pdf]]

## Objetivo
`pnpm --filter lector-pdf fixtures` genera, con `qpdf --encrypt`, los PDF cifrados que necesitan abrir con contraseña (PDF-046), el manejador de seguridad (PDF-092, PDF-093), guardar cifrado (PDF-047) y permisos (PDF-048).

## Contexto
- Leer: `tests/fixtures/catalog.ts`, `tests/fixtures/cli.ts`, `tests/fixtures/ensure.ts`, `tests/support/qpdf.ts` (`spawnSync`, mensaje de instalación).
- `qpdf` 11.9 ya es requisito de desarrollo (Plan, «Comandos»). RC4 necesita `--allow-weak-crypto`.
- El catálogo construye en memoria (`build: () => Uint8Array`): para qpdf, escribe la base en un temporal (`os.tmpdir()`), ejecuta qpdf a otro temporal, lee y borra ambos.

## Qué hay que hacer
1. `tests/fixtures/encrypted.ts`: `export function qpdfEncrypt(input: Uint8Array, args: readonly string[]): Uint8Array` (lanza con el mensaje de instalación si no hay qpdf, y con la salida de error si qpdf falla).
2. En `catalog.ts` (y `GENERATOR_VERSION` + 1), todos a partir de `basic-5.pdf` salvo que se diga otra cosa; contraseña de usuario `usuario`, de propietario `propietario`:

| Fichero | Argumentos de qpdf |
|---|---|
| `encrypted-rc4-40.pdf` | `--allow-weak-crypto --encrypt usuario propietario 40 --` |
| `encrypted-rc4-128.pdf` | `--allow-weak-crypto --encrypt usuario propietario 128 --use-aes=n --` |
| `encrypted-aes-128.pdf` | `--encrypt usuario propietario 128 --use-aes=y --` |
| `encrypted-aes-256.pdf` | `--encrypt usuario propietario 256 --` |
| `encrypted-aes-256-objstm.pdf` | base `compressed.pdf`; `--object-streams=generate --encrypt usuario propietario 256 --` |
| `encrypted-owner-only.pdf` | `--encrypt "" propietario 256 --print=none --extract=n --modify=none --annotate=n --` (se abre sin contraseña) |
| `encrypted-annotated-aes-128.pdf` | base `annotated.pdf`; `--encrypt usuario propietario 128 --use-aes=y --` |

3. Documenta en `fixtures/FUENTES.md` (sección «Generados») que los cifrados salen de qpdf y sus contraseñas.
4. Test `tests/unit/fixtures-encrypted.test.ts`: pdf.js en Node.

## Criterios de aceptación
- [ ] Los 7 ficheros se generan; `qpdf --check --password=usuario <f>` código 0 en los seis con contraseña y `qpdf --check` en el de propietario.
- [ ] pdf.js sin contraseña da `PasswordException` (`NEED_PASSWORD`) en los seis; con `usuario` y con `propietario` abre y la p1 tiene el texto «Página 1 de 5» (o el de `compressed.pdf`/`annotated.pdf`); con `mal` da `INCORRECT_PASSWORD`.
- [ ] `encrypted-owner-only.pdf` abre sin contraseña y `getPermissions()` no contiene `PRINT` (4), `COPY` (16) ni `MODIFY_ANNOTATIONS` (32).
- [ ] `encrypted-annotated-aes-128.pdf` abierto con `usuario` tiene las mismas anotaciones que `annotated.pdf` (`getAnnotations` de las 3 páginas: mismos subtipos).
- [ ] Sin qpdf instalado, el generador falla con «Instala qpdf: apt-get install -y qpdf» (test con `PATH` vacío en un proceso hijo).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Abrirlos en la app (PDF-046). Certificados (`/PubSec`).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/fixtures/encrypted.ts` (nuevo), `apps/lector-pdf/tests/fixtures/catalog.ts` (7 cifrados, `GENERATOR_VERSION` 3 → 4), `apps/lector-pdf/tests/support/qpdf.ts` (exporta `run`), `apps/lector-pdf/tests/unit/fixtures-encrypted.test.ts` (nuevo, 29 tests), `apps/lector-pdf/tests/unit/fixtures.test.ts` (18 → 25 ficheros), `fixtures/FUENTES.md` (sección «Generados» con tabla de cifrados y contraseñas).
- Qué he hecho: `qpdfEncrypt(input, args)` escribe la base y la salida en un temporal de `os.tmpdir()`, ejecuta `qpdf` y borra el directorio siempre; sin qpdf lanza «Instala qpdf: apt-get install -y qpdf». Los 7 cifrados de la tabla están en el catálogo. El test comprueba `qpdf --check` (con y sin contraseña), pdf.js con `NEED_PASSWORD` / `INCORRECT_PASSWORD`, texto de la página 1 con `usuario` y `propietario`, permisos del de propietario, anotaciones iguales a `annotated.pdf` y el fallo con `PATH` vacío en un proceso hijo.
- Comandos ejecutados y resultado:
  - `pnpm exec vitest run tests/unit/fixtures-encrypted.test.ts`: 29/29 OK.
  - `pnpm lint`: mis ficheros limpios. Quedan 9625 errores ya existentes en `apps/lector-pdf/dist-firma/` y en `tests/e2e/signature.spec.ts` (no tocados).
  - `pnpm typecheck`: falla en `apps/lector-pdf/tests/unit/forms-actions.test.ts` (líneas 259-260, `flatMap` sobre `MapIterator`). Ese fichero no lo he tocado; tiene cambios sin commitear de otra ficha. Mis ficheros pasan.
  - `pnpm coverage`: 2319 tests OK y 1 fallo en `tests/ui/zoom-controls.test.tsx` (foco en «Reducir»/«Ampliar»). No importa fixtures; depende de `Viewer.tsx` y `use-shortcuts.ts`, con cambios sin commitear de otra ficha. Falla también al ejecutarlo solo.
- Dudas o cosas que no he podido hacer: el criterio «pnpm lint/typecheck/coverage con código 0» no se cumple por los dos fallos ajenos descritos; hace falta que el dueño de PDF-042/043 los resuelva o que se commitee aparte. No he ejecutado `pnpm --filter lector-pdf fixtures` completo (lo hace globalSetup al correr los tests).

