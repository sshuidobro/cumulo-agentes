# Fuentes de los documentos de prueba

Procedencia y licencia de cada documento versionado en `fixtures/`. Decisión: [ADR-0011](../boveda/Decisiones/ADR-0011-documentos-de-prueba-pdf.md). Ningún documento personal del usuario se incluye aquí.

Commit del corpus veraPDF usado: `bb75f4f0073d9350dfd058c0162a367e6fadf25e`.

## PDF · corpus público (`fixtures/pdf/corpus/verapdf/`)

| Fichero | Procedencia | Licencia | Qué aporta |
|---|---|---|---|
| `7.1-t01-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.1%20General/7.1-t01-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | xref stream, enlace, índice |
| `7.10-t01-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.10%20Optional%20content/7.10-t01-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | 5 actualizaciones incrementales, capas |
| `7.18.1-t02-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.18%20Annotations/7.18.1%20General/7.18.1-t02-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | Anotación Highlight y Popup de otro productor |
| `7.18.4-t01-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.18%20Annotations/7.18.4%20Forms/7.18.4-t01-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | Object streams, formulario |
| `7.18.5-t01-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.18%20Annotations/7.18.5%20Links/7.18.5-t01-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | Object streams, enlace |
| `7.18.5-t02-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.18%20Annotations/7.18.5%20Links/7.18.5-t02-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | Object streams, enlace |
| `7.21.4.1-t01-pass-a.pdf` | [veraPDF-corpus @ bb75f4f](https://github.com/veraPDF/veraPDF-corpus/blob/bb75f4f0073d9350dfd058c0162a367e6fadf25e/PDF_UA-1/7.21%20Fonts/7.21.4%20Embedding/7.21.4.1%20General/7.21.4.1-t01-pass-a.pdf) | CC BY 4.0 — veraPDF Consortium | Fuentes incrustadas, 3 actualizaciones |

Atribución: los ficheros de `verapdf/` son del corpus de veraPDF, licenciado bajo [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Sin cambios de contenido; solo se han copiado con el nombre original.

## PDF · exportados con LibreOffice (`fixtures/pdf/corpus/libreoffice/`)

| Fichero | Procedencia | Licencia | Qué aporta |
|---|---|---|---|
| `informe.pdf` | exportado con LibreOffice 24.2 desde `src/informe.html` el 2026-10-17 | propia | Índice desde títulos, tildes, ñ, ¿¡, €, tabla, enlaces interno y externo |
| `multilingue.pdf` | exportado con LibreOffice 24.2 desde `src/multilingue.html` el 2026-10-17 | propia | Texto en español, griego, ruso, árabe (RTL) y chino |
| `largo.pdf` | exportado con LibreOffice 24.2 desde `src/largo.html` (generado por `src/make-largo.mjs`) el 2026-10-17 | propia | Documento de 81 páginas con 40 capítulos e índice |

Los HTML de origen y el script de regeneración (`make-libreoffice.sh`) están en `fixtures/pdf/corpus/src/`.

## Generados

Los PDF generados por código (no versionados, carpeta `fixtures/pdf/generated/`) se describen en `apps/lector-pdf/tests/fixtures/catalog.ts`.
