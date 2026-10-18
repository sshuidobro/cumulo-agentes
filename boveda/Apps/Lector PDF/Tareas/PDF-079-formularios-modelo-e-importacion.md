---
tipo: tarea
id: PDF-079
titulo: Núcleo de formularios - modelo de campos e importación desde pdf.js
app: pdf
estado: pendiente
depende_de: [PDF-040]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, core]
---

# PDF-079 · Núcleo de formularios: modelo de campos e importación desde pdf.js

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]] · [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Tipos puros de los campos AcroForm y la importación de los widgets de cada página a partir de lo que devuelve `page.getAnnotations()`, integrada en la importación de anotaciones que ya existe.

## Contexto
- Leer: `apps/lector-pdf/src/core/annotations/import.ts` (estilo: puro, nunca lanza, `RawAnnotation`, `REF_PATTERN`, ids `<num>R`), `src/core/annotations/model.ts` (`PdfObjRef`, `RectPt`, `Rgb`), `src/engine/annotations-import.ts`.
- Valores de pdf.js comprobados en [[ADR-0019-formularios-acroform]] (sección «Hechos»). `fontColor`, `backgroundColor` y `borderColor` vienen en 0-255 (`Uint8ClampedArray` u objeto `{0,1,2}`) o `null`. `rotation` del widget viene en `raw.rotation` (0/90/180/270).
- Sin `!` (no-non-null-assertion), sin `any`.

## Qué hay que hacer
1. `src/core/forms/model.ts`:
```ts
export type FieldType = 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'signature' | 'button';
export type FieldValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'checkbox'; readonly checked: boolean }
  | { readonly kind: 'radio'; readonly selected: string | null }   // estado del botón elegido
  | { readonly kind: 'choice'; readonly selected: readonly string[] }; // valores de exportación
export interface ChoiceOption { readonly exportValue: string; readonly displayValue: string }
export interface FormWidget {
  readonly id: string;                 // id de pdf.js, p. ej. "9R"
  readonly ref: PdfObjRef;
  readonly pageIndex: number;
  readonly rect: RectPt;               // normalizado x1<=x2, y1<=y2
  readonly onState: string | null;     // casilla: exportValue; opción: buttonValue; resto null
  readonly rotation: 0 | 90 | 180 | 270;
  readonly background: Rgb | null;     // /MK /BG en [0,1]
  readonly border: Rgb | null;         // /MK /BC en [0,1]
}
export interface FormField {
  readonly name: string; readonly type: FieldType;
  readonly readOnly: boolean; readonly required: boolean;
  readonly multiline: boolean; readonly password: boolean; readonly comb: boolean;
  readonly maxLen: number;             // 0 = sin límite
  readonly multiSelect: boolean;
  readonly editable: boolean;          // combo con bit Edit (fieldFlags & 262144)
  readonly options: readonly ChoiceOption[];
  readonly align: 0 | 1 | 2;
  readonly fontSize: number;           // 0 = automático
  readonly textColor: Rgb;
  readonly tooltip: string;            // /TU o ''
  readonly initial: FieldValue;
  readonly widgets: readonly FormWidget[];
}
export function valueEquals(a: FieldValue, b: FieldValue): boolean;   // profunda; listas: mismo orden
export function isFieldValue(v: unknown): v is FieldValue;            // validación completa (borradores)
export function isFillable(f: FormField): boolean; // !readOnly && type ∈ text|checkbox|radio|combo|list
```
2. `src/core/forms/import.ts`:
   - `export function importWidget(raw: RawAnnotation, pageIndex: number): FormField | null` — `null` si `subtype !== 'Widget'`, `hidden === true`, sin `fieldName` (cadena) o `fieldType` desconocido. Un `FormField` con **un** widget. Tipos: `Tx`→`text`; `Btn`+`checkBox`→`checkbox`, +`radioButton`→`radio`, +`pushButton`→`button`; `Ch`+`combo`→`combo`, si no `list`; `Sig`→`signature`.
   - `initial`: texto → `fieldValue` (si es array, el primero; si no es cadena, `''`); casilla → `checked: fieldValue === exportValue`; opción → `selected: fieldValue` salvo `'Off'`, `''` o ausente → `null`; combo/lista → `fieldValue` cadena → `[v]` (o `[]` si `''`), array de cadenas → tal cual; `signature`/`button` → `{ kind: 'text', text: '' }`.
   - Campos ausentes toman valor por defecto (`false`, `0`, `[]`, `''`, negro); `textAlignment` null → 0.
   - `export function mergeFields(current: ReadonlyMap<string, FormField>, incoming: readonly FormField[]): ReadonlyMap<string, FormField>` — nuevo `Map`; por nombre: si no existe, se añade; si existe, se le añaden los widgets cuyo `id` no tenga ya (en orden de llegada); el resto de propiedades se conserva del primero. Si `incoming` está vacío devuelve `current` (misma referencia).
3. `src/core/forms/index.ts` reexporta `model` e `import`.
4. `src/core/annotations/import.ts`: `ImportedPage` gana `readonly widgets: readonly FormField[]`; en `importPageAnnotations`, los raws con `subtype === 'Widget'` pasan por `importWidget` (los `null` se descartan) en vez de ignorarse. `Popup` y `Link` siguen ignorados. Actualiza los sitios que construyen `ImportedPage` (el compilador los señala).
5. Tests `apps/lector-pdf/tests/unit/forms-import.test.ts`: con raws escritos a mano (cada rama) y con `form-full.pdf` real vía `readPageAnnotations` de `src/engine`.

## Criterios de aceptación
- [ ] Con `form-full.pdf`: importar p1 y p2 y `mergeFields` da 14 campos; `nombre` tiene 2 widgets (páginas 0 y 1) e `initial` `{ kind: 'text', text: 'Ana' }`; `color` es `radio` con 3 widgets `onState` `Rojo`/`Verde`/`Azul` e `initial.selected === 'Verde'`; `acepto` `checkbox` con `onState 'Si'` y `checked: false`; `pais` `combo` con 3 opciones; `idiomas` `list`, `multiSelect`, `initial.selected` `['Español','Inglés']`; `importe.align === 2`, `fontSize === 0`, `textColor` `[0,0,1]`; `rotado` con `rotation 90`; `solo_lectura` no es `isFillable`; `firma` es `signature`; `obligatorio.tooltip === 'Campo obligatorio'`.
- [ ] `importWidget` con raws inválidos (sin `fieldName`, `fieldType: 'Xx'`, `hidden: true`, `subtype: 'Link'`) devuelve `null` y nunca lanza (test con 6 casos).
- [ ] `valueEquals` e `isFieldValue`: tests de cada variante, incluidos `{ kind: 'choice', selected: [1] }` → `false` y objeto con clave extra desconocida → `false`.
- [ ] Los tests de importación de anotaciones existentes siguen en verde; con `annotated.pdf` `widgets` es `[]`.
- [ ] Cobertura de `src/core/forms/` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Estado, historial y UI (PDF-080, PDF-081, PDF-041). Escritura (PDF-042).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
