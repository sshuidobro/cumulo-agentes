---
tipo: tarea
id: PDF-106
titulo: Separar el escritor de incrementos (delta-writer.ts) de incremental.ts
app: pdf
estado: en-test
depende_de: [PDF-047, PDF-104]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, refactor]
---

# PDF-106 · Separar el escritor de incrementos (`delta-writer.ts`) de `incremental.ts`

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0028-reescribir-pdfs]], [[ADR-0009-anotaciones-escritor-incremental]], [[ADR-0022-pdf-cifrados]] · Sigue: [[PDF-052-organizar-adr]]

## Objetivo
Mover a `src/core/pdf/delta-writer.ts` todo lo que no es específico de anotaciones (acumular el delta, cifrar objetos, escribir xref y trailer, `/ID`), sin cambiar ni un byte de lo que escribe el guardado actual. Así PDF-052 (árbol de páginas) reutiliza el mismo escritor.

## Contexto
- `src/core/pdf/incremental.ts`: `writeUpdate` (líneas 128-234: pasos 3 y 4), `trailerDict`, `documentId`, `idSeed`, `idBytes`, `Group`, `groupsOf`, `tableRow`, `streamRows`, `DeltaWriter` (líneas 335-470), constantes `LF`, `CR`, `STREAM_ROW_BYTES`, `FNV_*`, `ID_BYTES`.
- Tests actuales que no deben cambiar: `tests/unit/pdf/incremental.test.ts`, `incremental-qa.test.ts`, `interop.test.ts`, `tests/unit/incremental-encrypted.test.ts`, `tests/perf/incremental.perf.test.ts`.
- Si [[PDF-047-anotar-pdf-cifrado|PDF-047]] o [[PDF-104-etiqueta-firma-conexion|PDF-104]] han cambiado esas líneas, mueve también lo que hayan añadido al trailer o a la escritura de objetos.

## Qué hay que hacer
1. **Antes de tocar nada**, crea `tests/unit/pdf/delta-writer-golden.test.ts` y fija con el código actual el SHA-256 (`node:crypto`, `createHash('sha256')`, hex) del `delta` de `buildIncrementalUpdate` en tres casos, con `now = '2026-10-19T10:00:00.000Z'`:
   - `basic-5.pdf` + un resaltado nuevo en la página 1 (`newAnnotation` de `tests/unit/annotations/factories.ts`).
   - `compressed.pdf` (xref stream) + una nota nueva en la página 1.
   - `encrypted-aes-128.pdf` (contraseña `usuario`) + un dibujo nuevo, con `random: () => new Uint8Array(16).fill(7)` (o la forma de `RandomBytes` que use el código).
   Ejecuta el test, copia los tres hashes al test como constantes y comprueba que pasa. Ese test es el contrato de esta ficha.
2. Crea `src/core/pdf/delta-writer.ts` con (mueve el código, no lo reescribas):
```ts
export interface XrefRow { readonly offset: number; readonly gen: number }
/** Igual que la clase privada actual: acumula el delta y cifra con `security` lo que escribe `object`. */
export class DeltaWriter {
  readonly offsets: Map<number, XrefRow>;
  constructor(base: number, security: SecurityHandler | null, random: RandomBytes);
  get offset(): number;
  write(bytes: Uint8Array): void;
  object(num: number, gen: number, value: PdfValue): void;
  toBytes(): Uint8Array;
}
/** Crea el escritor sobre `source` y escribe el LF inicial si el original no acaba en LF/CR. */
export async function startDelta(source: ByteSource, reader: ObjectReader, random?: RandomBytes): Promise<DeltaWriter>;
export interface FinishDeltaOptions {
  readonly reader: ObjectReader;
  readonly root: PdfRef;
  /** `/Size` del nuevo trailer (siguiente número libre, incluido el de la xref de flujo si la hay). */
  readonly size: number;
  /** Número reservado para la xref de flujo, o `null` si la última sección del original es una tabla. */
  readonly xrefNum: number | null;
  /** ISO 8601: semilla de `/ID` junto con `sourceSize` y el número de objetos nuevos (`size - reader.xref.size`). */
  readonly now: string;
  readonly sourceSize: number;
}
/** Escribe la sección xref (tabla o flujo, como la última del original), el trailer y `%%EOF`; devuelve el delta completo. */
export function finishDelta(writer: DeltaWriter, o: FinishDeltaOptions): Uint8Array;
/** `reader.xref.lastKind === 'stream'` → reserva `next` para la xref y devuelve `{ xrefNum: next, size: next + 1 }`; si no, `{ xrefNum: null, size: next }`. */
export function reserveXref(reader: ObjectReader, next: number): { readonly xrefNum: number | null; readonly size: number };
```
3. `incremental.ts` pasa a usar `startDelta`, `reserveXref` y `finishDelta`; borra lo movido. Debe quedar por debajo de 360 líneas. Exporta lo nuevo desde `src/core/pdf/index.ts`.
4. Tests unitarios nuevos en `tests/unit/pdf/delta-writer.test.ts`: `startDelta` añade LF solo si falta; `finishDelta` con tabla (filas de 20 bytes, subsecciones agrupadas) y con flujo (`/W [1 4 2]`, `/Index`), `/Prev` = `lastXrefOffset`, conserva `/Info` y `/Encrypt`, `/ID[0]` original; `reserveXref` en los dos casos.

## Criterios de aceptación
- [ ] `delta-writer-golden.test.ts` pasa con los hashes fijados en el paso 1 (mismo delta byte a byte que antes del cambio).
- [ ] Todos los tests listados en «Contexto» pasan sin modificarlos.
- [ ] `wc -l apps/lector-pdf/src/core/pdf/incremental.ts` < 360; `delta-writer.ts` no importa nada de `core/annotations` ni de `core/forms`.
- [ ] Cobertura de `delta-writer.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` y `pnpm perf` con código 0 (presupuesto de `incremental.perf.test.ts` sin cambios).

## Fuera de alcance
- Cambiar el formato del delta, el `/ID` o el orden de escritura. Árbol de páginas (PDF-052).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/tests/unit/pdf/delta-writer.test.ts` (nuevo, 9 tests). `src/core/pdf/delta-writer.ts`, `incremental.ts` y `tests/unit/pdf/delta-writer-golden.test.ts` ya estaban en HEAD con el refactor y los hashes fijados (commits 4dee6d9 y f6995dd); no los he modificado.
- Qué he hecho: he comprobado que el golden test pasa contra el código actual (3/3) y que `delta-writer.ts` cumple la API de la ficha (no importa `core/annotations` ni `core/forms`). He añadido los tests de `startDelta`, `DeltaWriter`, `reserveXref`, `finishDelta` (tabla, flujo, `/ID`, cifrado AES-128) reabriendo el delta con `ObjectReader`. `incremental.ts` tiene 298 líneas.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` OK (220 ficheros, 2647 tests; `delta-writer.ts` 99,13 % líneas). `pnpm perf`: `incremental.perf` y `layout.perf` OK; **falla** `compare.perf.test.ts` «se compara en ≤ 30 ms (cálculo)» (190-287 ms), también al repetirlo con la carga de la máquina bajando (load 5-7 en 4 núcleos por otros agentes). Ese código (`core/compare`) no lo toca esta ficha.
- Dudas o cosas que no he podido hacer: el criterio `pnpm perf` con código 0 no se cumple por `compare.perf` (fallo previo, fuera de esta ficha). Hace falta revisar si el presupuesto es estable en esta máquina o si corresponde a PDF-063. No he hecho commit de otros ficheros con cambios sin confirmar (`packages/platform/tests/web/...`, `apps/lector-pdf/src/state/document-actions.ts` y similares son de otros programadores).

### [revisor] ronda 1 — 2026-10-19 — APROBADO
1. Sin problemas bloqueantes. lint y typecheck OK; golden, delta-writer, incremental, incremental-qa, interop e incremental-encrypted pasan (159 tests). `incremental.ts` 298 líneas (<360); `delta-writer.ts` sin imports de annotations/forms y exportado en `index.ts`. Cobertura 99,13 % según programador. `compare.perf` (30 ms) es ajeno a la ficha y no se tiene en cuenta; el tester debe repetir `pnpm perf` en máquina en reposo.
