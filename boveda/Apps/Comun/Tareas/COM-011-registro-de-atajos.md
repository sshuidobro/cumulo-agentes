---
tipo: tarea
id: COM-011
titulo: Crear el registro único de atajos de teclado en @suite/shared
app: comun
estado: hecha
depende_de: [COM-004]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, atajos]
---

# COM-011 · Registro único de atajos de teclado

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0010-stack-apps-web-y-pruebas]]

## Objetivo
`@suite/shared` exporta un registro de atajos puro (sin DOM): parsear "Mod+Shift+N", comprobar si un evento de teclado coincide (Ctrl en Windows/Linux, Cmd en Mac), formatearlo en español para tooltips y menús, y detectar atajos duplicados.

## Contexto
- Leer: `packages/shared/src/index.ts`, skill `stack-typescript-react` (sección "Accesibilidad e idioma").
- Sin DOM: el evento se recibe como `KeyEventLike` (un `KeyboardEvent` lo cumple).

## Qué hay que hacer
1. `packages/shared/src/shortcuts/chord.ts`:
   ```ts
   export interface KeyChord {
     readonly key: string;          // normalizada: letras/dígitos en minúscula, '+', '-', '=', 'ArrowLeft', 'F3', 'PageDown', 'Space'...
     readonly code: string | null;  // solo si se escribió 'code:NumpadAdd'
     readonly mod: boolean; readonly shift: boolean; readonly alt: boolean;
   }
   export interface KeyEventLike { readonly key: string; readonly code: string; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean; }
   export function parseChord(text: string): KeyChord;
   export function chordId(c: KeyChord): string; // forma canónica para comparar: "mod+shift+alt+<key|code:X>" con solo los modificadores activos
   export function matchChord(e: KeyEventLike, c: KeyChord, isMac: boolean): boolean;
   export function formatChord(c: KeyChord, isMac: boolean): string;
   export function isEditableTarget(target: unknown): boolean;
   ```
   - `parseChord`: partes separadas por `+`; modificadores `Mod`, `Shift`, `Alt` (sin distinguir mayúsculas); la última parte es la tecla; `Plus` → `'+'`; `Minus` → `'-'`; `code:X` → `code = X`. Texto vacío, modificador desconocido o tecla vacía → `throw new Error('Atajo no válido: <texto>')` (es un bug del programador).
   - Normalizar tecla: longitud 1 → minúscula; `' '` → `'Space'`; el resto tal cual.
   - `matchChord`: `mod` = `isMac ? metaKey : ctrlKey`, y la otra tecla (Ctrl en Mac / Meta fuera de Mac) debe estar suelta; `alt` debe coincidir; `shift` debe coincidir **salvo** si la tecla del atajo es un único carácter que no es letra ni dígito (p. ej. `+`, `-`, `=`): entonces se ignora `shiftKey` (en muchos teclados `+` exige Mayús). Con `code` compara `e.code === c.code`; sin `code` compara la tecla normalizada de `e.key`.
   - `formatChord` fuera de Mac: `Ctrl+`, `Mayús+`, `Alt+` en ese orden y la tecla: letras en mayúscula, nombres de la tabla; en Mac: `⌘`, `⇧`, `⌥` sin separador. Tabla: ArrowLeft "Flecha izquierda", ArrowRight "Flecha derecha", ArrowUp "Flecha arriba", ArrowDown "Flecha abajo", PageUp "Re Pág", PageDown "Av Pág", Home "Inicio", End "Fin", Escape "Esc", Enter "Intro", Delete "Supr", Backspace "Retroceso", Space "Espacio"; `code:NumpadAdd` → "+ (teclado numérico)", `code:NumpadSubtract` → "- (teclado numérico)".
   - `isEditableTarget(t)`: `true` si `t` es un objeto con `isContentEditable === true`, o `tagName` `TEXTAREA`/`SELECT`, o `tagName` `INPUT` cuyo `type` no es `checkbox`, `radio`, `button`, `submit`, `range` ni `color`.
2. `packages/shared/src/shortcuts/registry.ts`:
   ```ts
   export interface ShortcutDef<Id extends string> { readonly id: Id; readonly chords: readonly string[]; readonly description: string; }
   export class ShortcutRegistry<Id extends string> {
     constructor(defs: readonly ShortcutDef<Id>[]); // parsea todo; dos defs con el mismo chordId → throw new Error('Atajo duplicado: <texto>')
     match(e: KeyEventLike, isMac: boolean): Id | null; // primera coincidencia en orden de definición
     chordsFor(id: Id, isMac: boolean): string[];       // formateados
     list(): readonly ShortcutDef<Id>[];
   }
   ```
3. `src/shortcuts/index.ts` y `src/index.ts`: exportar todo lo anterior.
4. Tests `packages/shared/tests/shortcuts/*.test.ts`.

## Criterios de aceptación
- [ ] (T) `parseChord('Mod+Shift+N')` → `{ key: 'n', code: null, mod: true, shift: true, alt: false }`; `'Mod+Plus'` → key `'+'`; `'Mod+code:NumpadAdd'` → `code 'NumpadAdd'`; `''`, `'Hyper+K'`, `'Mod+'` lanzan.
- [ ] (T) `matchChord`: `Ctrl+Mayús+N` (key `'N'`) coincide con `Mod+Shift+N` en Windows y no en Mac; `Meta+F` coincide con `Mod+F` en Mac; `Ctrl+Meta+F` no coincide en ninguno; `Ctrl+Shift+'+'` coincide con `Mod+Plus`; `Ctrl+'0'` coincide con `Mod+0` pero `Ctrl+Shift+'0'` no; `Alt+ArrowLeft` no coincide con `ArrowLeft`.
- [ ] (T) `formatChord(parseChord('Mod+Shift+N'), false)` → `'Ctrl+Mayús+N'`; en Mac → `'⌘⇧N'`; `'Alt+ArrowLeft'` → `'Alt+Flecha izquierda'`; `'PageDown'` → `'Av Pág'`.
- [ ] (T) Registro: devuelve el id correcto, `null` sin coincidencia; definir `Mod+F` dos veces (o `Mod+f` y `Mod+F`) lanza `Atajo duplicado`.
- [ ] (T) `isEditableTarget({ tagName: 'INPUT', type: 'text' })` → `true`; `{ tagName: 'INPUT', type: 'checkbox' }` → `false`; `{ isContentEditable: true }` → `true`; `null` → `false`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `src/shortcuts` ≥ 95 % de líneas.

## Fuera de alcance
- Escuchar eventos del DOM, menús y personalización de atajos por el usuario.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/shared/src/shortcuts/chord.ts`, `packages/shared/src/shortcuts/registry.ts`, `packages/shared/src/shortcuts/index.ts` (nuevos); `packages/shared/src/index.ts` (una línea: `export * from './shortcuts'`); `packages/shared/tests/shortcuts/chord.test.ts` y `registry.test.ts` (nuevos); esta ficha.
- Qué he hecho: implementado `parseChord`, `chordId`, `matchChord`, `formatChord`, `isEditableTarget` y `ShortcutRegistry` según la ficha, con tests de cada criterio de aceptación y de las ramas de formato y de `isEditableTarget`. Sin dependencias nuevas.
- Comandos ejecutados y resultado: `pnpm lint` 0 (sin avisos); `pnpm typecheck` 0; `pnpm test` 138 tests en verde (13 ficheros); `pnpm coverage` 0, `src/shortcuts` 100 % líneas (97,82 % ramas), global 99,69 % líneas.
- Dudas o cosas que no he podido hacer: la ficha no fijaba algunos detalles y he tomado la opción literal: (a) en un atajo `code:X` el campo `key` es `''`, y ahí Mayús se exige siempre; (b) en Mac el orden de modificadores es ⌘ ⇧ ⌥ (el de la ficha); (c) `code:X` sin entrada en la tabla se muestra tal cual (`Numpad5`); (d) las teclas se normalizan solo si tienen un carácter (`F3` se conserva; `f3` no coincidiría con el evento `F3`, lo que sigue la regla "el resto tal cual"). Si el líder quiere que `f3` equivalga a `F3`, es un cambio pequeño en `normalizeKey`.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Lint, typecheck y 138 tests en verde. `pnpm coverage` no se pudo repetir (directorio de cobertura en uso por otro revisor); se acepta el 100 % de líneas del programador. Cada criterio tiene su test; código conforme a la ficha, sin DOM.
1. (opcional) `chord.ts:54` — `f3` no equivale a `F3`; decisión menor, documentada por el programador.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| parseChord (válidos e inválidos) | OK | `chord.test.ts` + QA: `Mod++`, `++`, `Mod+code:`, `Ctrl+S` lanzan `Atajo no válido` |
| matchChord (Win/Mac, Ctrl+Meta, `+`, `0`, Alt+flecha) | OK | `chord.test.ts`; QA añade Unicode (Ñ, emoji), teclas `Dead`/`Process`, `code:` con Alt |
| formatChord | OK | tests del programador + `Ctrl+Ñ` |
| Registro, duplicados | OK | QA: duplicado dentro de un mismo def y con modificadores en distinto orden/mayúsculas; registro vacío |
| isEditableTarget | OK | QA: textarea, select, input sin type, radio/button/submit/range/color, `undefined`, string, número |
| lint / typecheck / test / coverage | OK | lint 0, typecheck 0, 147 tests (14 ficheros), `src/shortcuts` 100 % líneas (97,82 % ramas) |

Tests añadidos: `packages/shared/tests/shortcuts/qa.test.ts` (9 tests). Rendimiento: no aplica (funciones puras O(1)).
Observaciones no bloqueantes: (1) `Mod+Plus` y `Mod+Shift+Plus` tienen distinto `chordId` pero coinciden con los mismos eventos (Mayús se ignora), así que el registro no detecta ese solapamiento; (2) `f3` no equivale a `F3` (ya anotado por el revisor); (3) en Mac, Alt+letra produce caracteres especiales en `e.key` y no coincidiría; usar `code:` en esos casos. En el primer `pnpm coverage` hubo un fallo de carrera con otra ejecución concurrente; repetido, pasa.
