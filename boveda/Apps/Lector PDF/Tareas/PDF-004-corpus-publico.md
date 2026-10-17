---
tipo: tarea
id: PDF-004
titulo: Añadir el corpus público (veraPDF) y PDFs exportados con LibreOffice
app: pdf
estado: en-test
depende_de: [PDF-005]
intentos: 0
skills: [pruebas-calidad, formatos-ofimatica]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, fixtures, corpus]
---

# PDF-004 · Corpus público y de LibreOffice

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0011-documentos-de-prueba-pdf]]

## Objetivo
`fixtures/pdf/corpus/` contiene 7 PDFs del corpus veraPDF (CC BY 4.0) y 3 PDFs exportados por LibreOffice a partir de HTML escrito por nosotros, con su procedencia en `fixtures/FUENTES.md`, y un test comprueba que el motor los abre todos.

## Contexto
- Leer: [[ADR-0011-documentos-de-prueba-pdf]], `apps/lector-pdf/src/engine/load.ts` (PDF-005), `apps/lector-pdf/tests/fixtures/paths.ts`.
- Descarga por `raw.githubusercontent.com` (funciona por el proxy; la API de GitHub no). URL base: `https://raw.githubusercontent.com/veraPDF/veraPDF-corpus/bb75f4f0073d9350dfd058c0162a367e6fadf25e/` + ruta con `%20` en los espacios.
- `soffice` está instalado (LibreOffice 24.2). Hay fuentes con chino (WenQuanYi Zen Hei), árabe (DejaVu/FreeSerif), griego y cirílico.
- **Nunca** añadas otros PDFs ni documentos del usuario.

## Qué hay que hacer
1. Descarga a `fixtures/pdf/corpus/verapdf/` estos 7 ficheros (nombre local = nombre del fichero):
   | Ruta en el repositorio veraPDF | Qué aporta |
   |---|---|
   | `PDF_UA-1/7.1 General/7.1-t01-pass-a.pdf` | xref stream, enlace, índice |
   | `PDF_UA-1/7.10 Optional content/7.10-t01-pass-a.pdf` | 5 actualizaciones incrementales, capas |
   | `PDF_UA-1/7.18 Annotations/7.18.1 General/7.18.1-t02-pass-a.pdf` | Highlight + Popup de otro productor |
   | `PDF_UA-1/7.18 Annotations/7.18.4 Forms/7.18.4-t01-pass-a.pdf` | object streams, formulario |
   | `PDF_UA-1/7.18 Annotations/7.18.5 Links/7.18.5-t01-pass-a.pdf` | object streams, enlace |
   | `PDF_UA-1/7.18 Annotations/7.18.5 Links/7.18.5-t02-pass-a.pdf` | object streams, enlace |
   | `PDF_UA-1/7.21 Fonts/7.21.4 Embedding/7.21.4.1 General/7.21.4.1-t01-pass-a.pdf` | fuentes incrustadas, 3 actualizaciones |
2. En `fixtures/pdf/corpus/src/` escribe:
   - `informe.html`: `<h1>Informe anual</h1>`, tres `<h2>` (`Introducción`, `Resultados`, `Conclusiones`) con 8 párrafos cada uno de texto en español con tildes, ñ, ¿¡ y € (frases tuyas), una tabla 5×4, un enlace interno `<a href="#conclusiones">` a la tercera sección y uno externo a `https://example.org/`.
   - `multilingue.html`: un párrafo por idioma con su etiqueta `lang`: español `Año, niño, ¿qué?`, griego `Καλημέρα κόσμε`, ruso `Привет, мир`, árabe (`dir="rtl"`) `مرحبا بالعالم`, chino `你好，世界`.
   - `make-largo.mjs`: escribe `largo.html` con `<h1>Documento largo</h1>` y 40 `<h2>Capítulo N</h2>`, cada uno con 15 párrafos de unas 80 palabras (texto determinista generado con un bucle sobre una lista fija de palabras en español). `largo.html` también se versiona.
   - `make-libreoffice.sh`: `node make-largo.mjs` y, para cada HTML, `soffice --headless --infilter="HTML (StarWriter)" --convert-to 'pdf:writer_pdf_Export:{"ExportBookmarks":{"type":"boolean","value":"true"}}' --outdir ../libreoffice <fichero>`.
   Ejecuta el script y versiona `fixtures/pdf/corpus/libreoffice/{informe,multilingue,largo}.pdf`.
3. `fixtures/FUENTES.md`: tabla con fichero, procedencia (URL con commit / "exportado con LibreOffice 24.2 desde `src/<x>.html` el AAAA-MM-DD"), licencia (`CC BY 4.0 — veraPDF Consortium` / `propia`) y qué aporta. Incluye la frase de atribución CC BY 4.0 con enlace a la licencia. Añade una sección "Generados" que remita a `apps/lector-pdf/tests/fixtures/catalog.ts`.
4. `tests/unit/corpus.test.ts`: para cada PDF del corpus, `loadPdf(memorySource(bytes), { assetBaseUrl: nodeAssetBase() })` → `ok`, `numPages ≥ 1`, y `getTextContent()` de la página 1 sin lanzar. Casos concretos en los criterios.

## Criterios de aceptación
- [ ] `fixtures/pdf/corpus/` tiene exactamente 10 PDFs (7 veraPDF + 3 LibreOffice); tamaño total < 1,5 MB (`du -sh` en el Registro).
- [ ] (T) Los 10 se abren con `loadPdf` sin error.
- [ ] (T) `libreoffice/informe.pdf`: el texto contiene `Introducción` y `€`; `getOutline()` no está vacío; `largo.pdf` tiene ≥ 30 páginas.
- [ ] (T) `libreoffice/multilingue.pdf`: el texto de la página 1 contiene `Привет`, `Καλημέρα` y `你好` (si el chino no se extrae, anota en el Registro qué devuelve y abre una observación al líder; no es un fallo de esta ficha).
- [ ] (T) `7.18.1-t02-pass-a.pdf` tiene una anotación `Highlight` en la página 1.
- [ ] `fixtures/FUENTES.md` lista los 10 ficheros con licencia; `git status` muestra los PDFs del corpus como añadidos (no ignorados).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Usar el corpus en E2E (PDF-022) o en el escritor (PDF-029).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `fixtures/pdf/corpus/verapdf/` (7 PDF de veraPDF), `fixtures/pdf/corpus/src/` (`informe.html`, `multilingue.html`, `make-largo.mjs`, `make-libreoffice.sh`, `largo.html`), `fixtures/pdf/corpus/libreoffice/` (`informe.pdf`, `multilingue.pdf`, `largo.pdf`), `fixtures/FUENTES.md`, `apps/lector-pdf/tests/unit/corpus.test.ts`, esta ficha.
- Qué he hecho: descargados los 7 PDF de veraPDF (commit `bb75f4f`, licencia CC BY 4.0 verificada en su README) y escritos los HTML de origen; `make-libreoffice.sh` genera los 3 PDF con LibreOffice 24.2. `corpus.test.ts` (15 casos): inventario exacto de 10 PDF, `loadPdf` sin error y texto de la página 1 en los 10, texto `Introducción`/`€` y outline no vacío en `informe`, ≥ 30 páginas en `largo` (81), `Привет`/`Καλημέρα`/`你好` en `multilingue`, anotación `Highlight` en `7.18.1-t02-pass-a.pdf`.
- Comandos ejecutados y resultado:
  - `du -sh fixtures/pdf/corpus` → 864K (836 620 bytes, < 1,5 MB).
  - `pnpm typecheck` → código 0.
  - `pnpm test` → código 0: 53 ficheros, 694 tests pasan.
  - `pnpm lint` → código 1 por un fichero ajeno: 5 errores `no-console` en `apps/lector-pdf/tests/unit/pdf/zz-debug.test.ts` (sin versionar, de otro programador). Mis ficheros pasan ESLint sin avisos. No lo he tocado.
  - `git check-ignore` de los PDF → sin coincidencias: se añaden como nuevos.
- Dudas o cosas que no he podido hacer: `pnpm lint` queda en rojo hasta que se corrija `zz-debug.test.ts`. Chino, griego y ruso se extraen bien. El árabe se extrae en orden visual (bidi); el test no lo comprueba. Sin dudas de producto.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
- Procedencia y licencia: `FUENTES.md` lista los 10 ficheros con commit fijado, licencia CC BY 4.0 (veraPDF) y atribución con enlace. Comprobados por SHA-256 3 de los 7 PDF contra la descarga del commit `bb75f4f`: idénticos. Metadatos de los veraPDF: autor "veraPDF Consortium". Los 3 de LibreOffice no contienen autor ni rutas personales. Sin documentos personales.
- Tamaño 836 620 bytes (< 1,5 MB); 10 PDF versionados (`git ls-files`). `corpus.test.ts` 15/15 verde; typecheck OK; HTML de origen cumplen la ficha (3×8 párrafos, 40 capítulos, `lang`/`dir`).
- (opcional) El test del árabe no comprueba texto; aceptable, la ficha no lo exige.
