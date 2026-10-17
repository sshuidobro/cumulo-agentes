---
tipo: decision
id: ADR-0011
app: pdf
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, pdf, pruebas, fixtures]
---

# ADR-0011 · Documentos de prueba del lector PDF

## Contexto
Hay que probar con PDFs pequeños, enormes (≥ 5 000 páginas), variados y dañados, **sin documentos personales** (CLAUDE.md). Investigación: [[Librerias y arquitectura PDF]] (sección 4). Comprobado el 2026-10-17: el corpus veraPDF se descarga con `git clone` (licencia **CC BY 4.0** en su README, commit `bb75f4f0073d9350dfd058c0162a367e6fadf25e`); `soffice --headless` exporta PDF en esta máquina.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **Generador propio** (TypeScript, sin dependencias) | Determinista, cualquier tamaño (5 000 páginas en < 0,1 s), casos exactos | PDFs "sintéticos" | propia |
| **PDFs exportados por LibreOffice** desde HTML nuestro | Productor real, fuentes TrueType incrustadas, índice desde títulos | No deterministas byte a byte (se versionan una vez) | propia (contenido nuestro) |
| **Corpus veraPDF** (selección) | Hechos por otras herramientas: xref streams, object streams, varias actualizaciones incrementales, anotaciones previas | Pequeños (1 página) | CC BY 4.0 |
| Corpus de tests de pdf.js | Muy variado | Licencia por fichero sin verificar | — |

## Decisión
- **Generados**: `apps/lector-pdf/tests/fixtures/generate-fixtures.ts` escribe en `fixtures/pdf/generated/` (en `.gitignore`); se crean al vuelo en el `globalSetup` de Vitest y de Playwright si faltan.
- **Versionados** en `fixtures/pdf/corpus/`: 7 ficheros veraPDF (lista exacta en [[PDF-004-corpus-publico]]) y 3 PDFs exportados con LibreOffice desde HTML escrito por nosotros. Atribución y procedencia en `fixtures/FUENTES.md`.
- Prohibido añadir PDFs descargados de otros sitios o del usuario sin un ADR que verifique la licencia.

## Consecuencias
- El repositorio crece ~400 KB.
- Las pruebas con documentos "reales" de Adobe/Word se completan a mano por el usuario (lista de comprobación del Manual), nunca subiendo sus ficheros.
