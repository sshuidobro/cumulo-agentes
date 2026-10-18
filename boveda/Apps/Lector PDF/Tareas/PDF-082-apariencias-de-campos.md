---
tipo: tarea
id: PDF-082
titulo: Apariencias /AP de campos de texto, combo y lista
app: pdf
estado: en-curso
depende_de: [PDF-079]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, formato, core]
---

# PDF-082 · Apariencias /AP de campos de texto, combo y lista

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]] · [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Función pura que genera el Form XObject de apariencia normal de un widget de texto, combo o lista con su valor, para que Adobe y cualquier visor muestren el valor guardado.

## Contexto
- Leer: `src/core/annotations/appearance.ts` (`num`, `nums`, `pdfText`, `HELV_FONT`, `stream` + `flateEncode`), `helvetica-widths.ts` (`textWidth(s, fontSize)`), `wrap.ts` (`wrapText(text, maxWidth, fontSize)`), `winansi.ts`, `src/core/forms/model.ts`.
- Exporta `HELV_FONT` desde `appearance.ts` (hoy es `const` interna) y reúsalo; no dupliques.

## Qué hay que hacer
1. `src/core/forms/appearance.ts`:
```ts
/** Apariencia del widget con `value`, o `null` para casilla, opción, firma y botón (no se regeneran). */
export function buildFieldAppearance(field: FormField, widget: FormWidget, value: FieldValue): PdfStream | null;
```
2. Geometría: `w`, `h` = ancho y alto de `widget.rect`. Con `rotation` 90 o 270, la caja es `bw = h`, `bh = w`; si no, `bw = w`, `bh = h`. `/BBox [0 0 bw bh]`. `/Matrix` solo si `rotation ≠ 0`: 90 → `[0 1 -1 0 w 0]`; 180 → `[-1 0 0 -1 w h]`; 270 → `[0 -1 1 0 0 h]` (las mismas que pdf.js).
3. Contenido (líneas separadas por `\n`):
```
/Tx BMC
q
[r g b rg 0 0 bw bh re f]                       ← si widget.background
[r g b RG 1 w 0.5 0.5 bw-1 bh-1 re S]           ← si widget.border
1 1 bw-2 bh-2 re W n
BT /Helv <tam> Tf <r g b> rg … ET
Q
EMC
```
   Recursos `<< /Font << /Helv HELV_FONT >> >>`, `/Filter /FlateDecode`. Texto siempre WinAnsi (`pdfText`).
4. Texto (`text`, una línea): `tam` = `fontSize` o, si 0, `min(12, (bh − 4) / 1.15)` reducido hasta que `textWidth(texto, tam) ≤ bw − 4`, mínimo 4. Línea base `y = (bh − 0.925·tam) / 2 + 0.207·tam`. `x` = 2 (izquierda), `(bw − ancho)/2` (centro), `bw − 2 − ancho` (derecha). Contraseña: `*` por carácter.
5. Multilínea: `tam` = `fontSize` o 12; líneas = `wrapText(texto, bw − 4, tam)`; primera base `bh − 2 − tam`, interlineado `1.15·tam`; cada línea alineada según `align`.
6. Peine (`comb && maxLen > 0 && !multiline`): celda = `bw / maxLen`; carácter i en `x = i·celda + (celda − ancho_i)/2`, misma base que una línea; un `Td` + `Tj` por carácter (usar `1 0 0 1 x y Tm`).
7. Combo: como texto de una línea con el `displayValue` de la opción cuyo `exportValue` es `selected[0]` (si no hay, el propio `selected[0]`; vacío si no hay selección).
8. Lista: `tam` = `fontSize` o 12; alto de fila `lh = 1.15·tam`; opción i ocupa `[bh − 1 − (i+1)·lh, bh − 1 − i·lh]`; si está en `selected`, antes `0.6 0.75 0.87 rg 1 <y_inf> bw-2 <lh> re f`; texto con base `y_inf + 0.25·tam`, `x = 2`. Las opciones que no caben (y_inf < 0) no se dibujan.
9. Valor vacío (`''` o sin selección en combo): solo fondo/borde (sin `BT…ET`).
10. Tests `tests/unit/forms-appearance.test.ts`: decodificar el flujo (`decodeStreamData`) y comprobar operadores; y prueba integrada: escribir cada apariencia en un PDF mínimo con un widget (usa `PdfBuilder` de `tests/fixtures/pdf-builder.ts`) y renderizar con pdf.js en Node para comprobar que no da error y que `getTextContent()` de la apariencia no hace falta: basta `page.getOperatorList()` sin excepción.

## Criterios de aceptación
- [ ] `nombre` con «María José»: el contenido contiene `/Helv 12 Tf`, `0 0 0 rg` y `(Mar\355a Jos\351) Tj` (WinAnsi); `BBox [0 0 228 20]`; sin `/Matrix`.
- [ ] `importe` (`fontSize 0`, `align 2`, azul) con «1234567890,12»: `tam` < 12 tal que el ancho cabe en 96 pt; `0 0 1 rg`; la `x` del `Td` = `bw − 2 − ancho` (±0,01).
- [ ] `codigo` (peine, 6) con «ABC»: 3 operadores `Tj`; la `x` del primero = `(25 − ancho('A'))/2` (±0,01).
- [ ] `rotado` (90): `BBox [0 0 160 20]` y `/Matrix [0 1 -1 0 20 0]`.
- [ ] `pais` con `selected ['pt']` dibuja `(Portugal)`; `idiomas` con `['Francés']` tiene exactamente un `re f` de selección con `0.6 0.75 0.87 rg`.
- [ ] `acepto`, `color`, `firma` → `null`.
- [ ] Texto con «€» y «ñ» se codifica en WinAnsi; «你» se escribe como `?`.
- [ ] Mismo `field`, `widget` y `value` → mismos bytes (determinista).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Fuentes de `/DR` o incrustadas (mejora anotada). Escribirlas en el fichero (PDF-042).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
