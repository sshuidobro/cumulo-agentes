---
tipo: tarea
id: PDF-040
titulo: Generar el documento de prueba de formularios completo (form-full.pdf)
app: pdf
estado: pendiente
depende_de: []
intentos: 0
skills: [formatos-ofimatica, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, fixtures]
---

# PDF-040 · Generar el documento de prueba de formularios completo (form-full.pdf)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]] · [[ADR-0011-documentos-de-prueba-pdf]] · Paridad: [[Paridad Adobe Acrobat]] (área 5)

> 2026-10-18 (líder): la ficha era «ADR y prueba técnica». El líder ha tomado la decisión ([[ADR-0019-formularios-acroform]], con las comprobaciones en pdf.js) y la ficha pasa a ser el documento de prueba que necesitan PDF-079 a PDF-083.

## Objetivo
`pnpm --filter lector-pdf fixtures` genera `fixtures/pdf/generated/form-full.pdf`: 2 páginas con todos los tipos de campo AcroForm que la app debe rellenar o mostrar, con apariencias `/AP`.

## Contexto
- Leer: `apps/lector-pdf/tests/fixtures/structure.ts` (`buildForm`, `buildAnnotated`: mismo estilo), `tests/fixtures/pdf-builder.ts` (`PdfBuilder.addObject`, `addStream`, `winAnsi`), `tests/fixtures/document.ts` (`buildDocument` con `setup`), `tests/fixtures/catalog.ts`.
- Cadenas con tildes: siempre con `winAnsi(...)` dentro de `(...)`.
- Sin dependencias nuevas.

## Qué hay que hacer
1. En `structure.ts`, `export function buildFormFull(): Uint8Array` con `buildDocument(2, …)` (A4 por defecto del generador). Texto de página: `Formulario completo · página N`.
2. Campos (todos con `/F 4`, `/P` a su página, `/DA` propio salvo que se diga otra cosa, `/AP << /N … >>`). Rectángulos en puntos:

| Nombre completo | Tipo y banderas | Rect | Valor inicial y detalles |
|---|---|---|---|
| `nombre` | `/FT /Tx`, campo padre con `/Kids` de 2 widgets (sin `/T` en los widgets) | p1 `[72 760 300 780]`, p2 `[72 760 300 780]` | `/V (Ana)`, `/DA (/Helv 12 Tf 0 g)`; apariencia de ambos widgets con «Ana» |
| `comentarios` | `/Tx`, `/Ff 4096` (multilínea) | p1 `[72 640 523 740]` | sin `/V`; `/DA (/Helv 10 Tf 0 g)` |
| `codigo` | `/Tx`, `/Ff 16777216` (peine), `/MaxLen 6` | p1 `[72 600 222 620]` | sin `/V` |
| `importe` | `/Tx`, `/Q 2` | p1 `[320 600 420 620]` | `/V (12,50)`, `/DA (/Helv 0 Tf 0 0 1 rg)` (tamaño automático, azul) |
| `acepto` | `/Btn` casilla | p1 `[72 560 86 574]` | `/V /Off /AS /Off`; `/AP /N << /Si … /Off … >>` (estado activado `Si`, no `Yes`) |
| `color` | `/Btn` `/Ff 49152` (radio + NoToggleToOff), padre con 3 widgets hijos | p1 `[72 520 86 534]`, `[120 520 134 534]`, `[168 520 182 534]` | `/V /Verde`; estados `Rojo`, `Verde`, `Azul`; `/AS /Verde` en el 2.º, `/Off` en el resto |
| `pais` | `/Ch` `/Ff 131072` (combo) | p1 `[72 470 252 490]` | `/Opt [(España) (Francia) [(pt) (Portugal)]]`, `/V (España)` |
| `idiomas` | `/Ch` `/Ff 2097152` (multiselección, lista) | p1 `[320 430 470 490]` | `/Opt [(Español) (Inglés) (Francés) (Alemán)]`, `/V [(Español) (Inglés)]`, `/I [0 1]` |
| `persona.apellido` | padre `/T (persona)` sin `/FT`; hijo `/T (apellido)` `/FT /Tx` fusionado con su widget | p1 `[72 400 300 420]` | sin `/V` |
| `solo_lectura` | `/Tx` `/Ff 1` | p1 `[320 400 523 420]` | `/V (No editable)` |
| `obligatorio` | `/Tx` `/Ff 2`, `/TU (Campo obligatorio)` | p1 `[72 360 300 380]` | sin `/V` |
| `firma` | `/FT /Sig` sin firmar | p1 `[320 340 523 380]` | sin `/V` |
| `rotado` | `/Tx`, `/MK << /R 90 >>` | p1 `[540 600 560 760]` | `/V (Girado)` |
| `pagina2` | `/Tx` | p2 `[72 700 300 720]` | sin `/V` |

3. Apariencias: texto `<< /Type /XObject /Subtype /Form /BBox [0 0 w h] /Resources << /Font << /Helv <fuente> 0 R >> >> >>` con `0.9 g 0 0 w h re f` y, si hay valor, `/Tx BMC BT /Helv 12 Tf 0 g 2 5 Td (<valor>) Tj ET EMC`; casilla/opción: cuadro vacío para `Off`, cuadro con relleno interior para el estado activado (como `buildForm`); combo y lista: fondo gris y el texto de las opciones elegidas.
4. `/AcroForm << /Fields [nombre comentarios codigo importe acepto color pais idiomas persona solo_lectura obligatorio firma rotado pagina2] /NeedAppearances false /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv … >> >> >>` (solo campos de primer nivel en `/Fields`). `/Annots` de cada página con sus widgets en el orden de la tabla.
5. `catalog.ts`: `{ name: 'form-full.pdf', build: buildFormFull }` y `GENERATOR_VERSION = 3`.
6. Test `apps/lector-pdf/tests/unit/fixtures-form-full.test.ts` con pdf.js en Node (ver `tests/helpers/pdfjs-node.ts`).

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf fixtures` crea `form-full.pdf`; `qpdf --check fixtures/pdf/generated/form-full.pdf` termina con código 0.
- [ ] Test: `page.getAnnotations()` de la p1 devuelve 15 widgets (`subtype: 'Widget'`) y la p2 devuelve 2, con estos `fieldName`/`fieldType`/`fieldValue`: `nombre`/`Tx`/`Ana` (en ambas páginas), `comentarios`/`Tx`/`''`, `codigo` con `comb: true` y `maxLen: 6`, `importe` con `textAlignment: 2`, `acepto` con `checkBox: true`, `exportValue: 'Si'`, `fieldValue: 'Off'`, tres `color` con `radioButton: true` y `buttonValue` `Rojo`/`Verde`/`Azul` y `fieldValue: 'Verde'`, `pais` con `combo: true` y `options[2]` = `{ exportValue: 'pt', displayValue: 'Portugal' }`, `idiomas` con `multiSelect: true` y `fieldValue` `['Español', 'Inglés']`, `persona.apellido`, `solo_lectura` con `readOnly: true`, `obligatorio` con `required: true` y `alternativeText: 'Campo obligatorio'`, `firma`/`Sig`, `rotado`, `pagina2`.
- [ ] Todos los widgets tienen `hasAppearance: true`.
- [ ] Los fixtures anteriores no cambian (sus tests siguen en verde).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Leer los campos en la app (PDF-079). JavaScript, cálculos, XFA.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
