---
tipo: tarea
id: PDF-025
titulo: Objetos PDF - analizador léxico, analizador y serializador
app: pdf
estado: en-curso
depende_de: [PDF-023]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, formato]
---

# PDF-025 · Objetos PDF: leer y escribir

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
Base del escritor incremental: representar objetos PDF (ISO 32000-1 §7.3), leerlos desde bytes y volver a escribirlos byte a byte de forma determinista, incluidas cadenas de texto en PDFDocEncoding/UTF-16BE y fechas.

## Contexto
- Leer: [[ADR-0009-anotaciones-escritor-incremental]], ISO 32000-1 §7.2 (léxico: blancos `\0 \t \n \f \r espacio`, delimitadores `( ) < > [ ] { } / %`), §7.3 (objetos), §7.9.2 (cadenas de texto), §7.9.4 (fechas), Anexo D (PDFDocEncoding).
- Solo `src/core/pdf/`. Sin dependencias. Trabaja con `Uint8Array` (nunca convierte el fichero entero a `string`).
- `PdfSyntaxError` es **interno**: lo lanzan el analizador y el lector (PDF-026); el borde (PDF-028/037) lo convierte en `AppError`. No lo dejes escapar a la UI.

## Qué hay que hacer
1. `src/core/pdf/objects.ts`:
   ```ts
   export interface PdfName { readonly kind: 'name'; readonly value: string }            // sin la barra, ya decodificado (#20 → ' ')
   export interface PdfString { readonly kind: 'string'; readonly bytes: Uint8Array; readonly hex: boolean }
   export interface PdfRef { readonly kind: 'ref'; readonly num: number; readonly gen: number }
   export interface PdfDict { readonly kind: 'dict'; readonly entries: ReadonlyMap<string, PdfValue> } // claves sin barra, en orden de inserción
   export interface PdfStream { readonly kind: 'stream'; readonly dict: PdfDict; readonly data: Uint8Array } // data tal cual (sin decodificar)
   export type PdfValue = null | boolean | number | PdfName | PdfString | PdfRef | PdfDict | PdfStream | readonly PdfValue[];
   export const name: (v: string) => PdfName;
   export const ref: (num: number, gen?: number) => PdfRef;
   export function dict(entries: Record<string, PdfValue> | ReadonlyMap<string, PdfValue>): PdfDict;
   export function stream(d: Record<string, PdfValue>, data: Uint8Array): PdfStream; // fija /Length = data.length
   export function bytesString(bytes: Uint8Array, hex?: boolean): PdfString;
   export function dictGet(d: PdfDict, key: string): PdfValue | undefined;
   export function withEntries(d: PdfDict, changes: Record<string, PdfValue | undefined>): PdfDict; // undefined borra; conserva el orden, las nuevas al final
   export class PdfSyntaxError extends Error { constructor(message: string, readonly offset: number) }
   ```
2. `src/core/pdf/text-string.ts`:
   ```ts
   export function encodeTextString(s: string): PdfString;  // si todos los caracteres están en PDFDocEncoding → esos bytes; si no → FE FF + UTF-16BE
   export function decodeTextString(p: PdfString): string;  // detecta FE FF (UTF-16BE) y EF BB BF (UTF-8, PDF 2.0); si no, PDFDocEncoding
   export function pdfDate(iso: string): PdfString;         // usa toPdfDate de src/core/pdf-date.ts (PDF-023)
   ```
   Tabla PDFDocEncoding completa (Anexo D, Tabla D.2) como constante: 0x18-0x1F (˘ ˇ ˆ ˙ ˝ ˛ ˚ ˜), 0x80-0x9E (• † ‡ … — – ƒ ⁄ ‹ › − ‰ „ " " ' ' ‚ ™ ﬁ ﬂ Ł Œ Š Ÿ Ž ı ł œ š ž), 0xA0 €, 0xA1-0xFF = Latin-1 (0xAD sin definir); 0x7F, 0x9F y 0xAD no definidos.
3. `src/core/pdf/lexer.ts` + `parser.ts`:
   ```ts
   export class PdfLexer { constructor(bytes: Uint8Array, offset?: number); get offset(): number; next(): Token } // Token: número, nombre, cadena literal/hex, palabra clave ('obj','endobj','stream','R','true','false','null','xref','trailer','startxref', etc.), '[', ']', '<<', '>>', 'eof'
   export function parseValue(bytes: Uint8Array, offset: number): { readonly value: PdfValue; readonly end: number };
   export function parseIndirectObject(bytes: Uint8Array, offset: number, resolveLength?: (r: PdfRef) => number | null): { readonly num: number; readonly gen: number; readonly value: PdfValue; readonly end: number };
   ```
   - Cadenas literales: paréntesis anidados, escapes `\n \r \t \b \f \( \) \\ \ddd` (1-3 dígitos octales), `\` + fin de línea = continuación, fin de línea sin escapar → `\n`. Hex: ignora blancos, número impar de dígitos → último 0.
   - `n g R` se resuelve con mirada de 2 tokens. Comentarios `%...` se ignoran.
   - Streams: tras `stream` acepta `\r\n` o `\n`; usa `/Length` (directo o vía `resolveLength`); si falta o no cuadra con `endstream` (comprobado tras saltar blancos), busca `endstream` hacia delante y recorta el fin de línea final.
   - Errores (token inesperado, fin de datos, anidamiento > 100) → `PdfSyntaxError` con el `offset`.
4. `src/core/pdf/serialize.ts`:
   ```ts
   export function serializeValue(v: PdfValue): Uint8Array;
   export function serializeIndirect(num: number, gen: number, v: PdfValue): Uint8Array; // "num gen obj\n" + valor + "\nendobj\n"
   ```
   Reglas deterministas: números enteros sin decimales; reales con hasta 4 decimales sin ceros finales (`0.5`, `-12.25`, nunca exponente, `-0` → `0`); `NaN`/`Infinity` → `throw new RangeError`. Nombres: bytes fuera de `!`..`~` y delimitadores/`#` → `#XX`. Cadenas `hex: true` → `<...>` en mayúsculas; si no, literal escapando `( ) \` y bytes < 0x20 o > 0x7E como `\ddd`. Diccionarios `<< /K v /K2 v2 >>` (espacio entre elementos), arrays `[a b]`, stream: diccionario + `\nstream\n` + datos + `\nendstream`.
5. `src/core/pdf/index.ts` reexporta. Tests en `tests/unit/pdf/` (`lexer.test.ts`, `parser.test.ts`, `serialize.test.ts`, `text-string.test.ts`).

## Criterios de aceptación
- [ ] (T) `parseValue` de `<< /Type /Annot /Rect [0 0 10.5 -3] /C [1 0 0] /P 12 0 R /T (Ana \(x\)) /N#20a /H <4E6F> /O true /Z null >>` da el diccionario esperado (comprobar cada entrada y el orden de claves).
- [ ] (T) Cadena literal `(a\nb\\c\051\
d(e)f)` → bytes `a`, LF, `b\c)` `d(e)f`.
- [ ] (T) Ida y vuelta: para 20 valores de prueba (incluidos anidados, nombres con `#`, cadenas binarias 0..255) `parseValue(serializeValue(v)).value` es igual a `v`.
- [ ] (T) `serializeValue(0.1 + 0.2)` → `0.3`; `serializeValue(-0)` → `0`; `serializeValue(1e21)` no usa exponente; `NaN` lanza `RangeError`.
- [ ] (T) `parseIndirectObject` de un stream con `/Length 5 0 R` usa `resolveLength`; con `/Length` erróneo recupera los datos buscando `endstream`.
- [ ] (T) `encodeTextString('Comentario é €')` usa PDFDocEncoding (sin BOM); `encodeTextString('Привет')` empieza por `FE FF`; `decodeTextString` invierte ambos; `'•'` se codifica como `0x80`.
- [ ] (T) Entradas inválidas (`<< /A`, `[1 2`, `(abc`, 101 corchetes anidados) lanzan `PdfSyntaxError` con `offset`; nunca bucle infinito (timeout del test 2 s).
- [ ] (T, comportamiento, `tests/unit/`) analizar 10 000 diccionarios de anotación concatenados devuelve 10 000 objetos.
- [ ] (T, rendimiento, `tests/perf/pdf-objects.perf.test.ts` con `measureBest`) ese análisis en < 300 ms.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `src/core/pdf/` ≥ 95 % de líneas.

## Fuera de alcance
- Xref, filtros y lectura por rangos (PDF-026). Cifrado (PDF-047).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] suite de rendimiento — 2026-10-17
Por [[ADR-0012-suite-de-rendimiento]], los asserts de tiempo de reloj (`performance.now()`) no van en `tests/unit/` ni `tests/ui/` (fallan bajo `pnpm coverage`), sino en `tests/perf/*.perf.test.ts`, que se ejecuta con `pnpm perf` (sin cobertura, en serie). Presupuestos sin cambios. Los relojes falsos inyectados (`now`) siguen en `tests/unit/`.
Si `vitest.perf.config.ts` (raíz), el script `perf` del `package.json` raíz, su entrada en `tsconfig.json` y `apps/lector-pdf/tests/perf/measure.ts` aún no existen (PDF-006 sin terminar), créalos **exactamente** como dice [[PDF-006-layout-virtual]] (Registro, entrada del líder, pasos 1-4); si existen, no los cambies.
