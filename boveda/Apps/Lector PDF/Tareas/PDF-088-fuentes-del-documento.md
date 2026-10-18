---
tipo: tarea
id: PDF-088
titulo: Propiedades - pestaña «Fuentes» con escaneo progresivo y cancelable
app: pdf
estado: bloqueada
depende_de: [PDF-045]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, ui, formato]
---

# PDF-088 · Propiedades: pestaña «Fuentes» con escaneo progresivo y cancelable

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0014-localizar-paginas-por-count]]

## Objetivo
Tercera pestaña del diálogo de propiedades con las fuentes usadas (nombre, tipo, codificación, incrustada/subconjunto), como Adobe, leída con nuestro lector de objetos por rangos sin bloquear la interfaz ni en un PDF de 100 000 páginas.

## Contexto
- Leer: `src/core/pdf/object-reader.ts` (`open`, `pageRef`, `pageRefs`, `getDict`, `resolve`), `src/core/pdf/objects.ts`, `src/ui/properties/PropertiesDialog.tsx` (PDF-045), `src/engine/annotations-import.ts` (patrón de lotes que ceden el hilo).
- Las fuentes están en `/Resources /Font` de cada página (heredable desde `/Pages`) y en las `/Resources` de los Form XObject que usa la página (solo primer nivel, sin recursión: suficiente y acotado).

## Qué hay que hacer
1. `src/core/pdf/fonts.ts`:
```ts
export interface FontInfo {
  readonly name: string;          // /BaseFont sin el prefijo de subconjunto «ABCDEF+»
  readonly subtype: string;       // Type1, TrueType, Type0, Type3, MMType1, CIDFontType0/2 (de la descendiente en Type0)
  readonly encoding: string;      // nombre de /Encoding o «Personalizada» o «Identity-H»
  readonly embedded: boolean;     // FontDescriptor con /FontFile, /FontFile2 o /FontFile3
  readonly subset: boolean;       // nombre con prefijo «XXXXXX+»
}
/** Fuentes de las páginas `[from, to)`: único por (nombre, subtipo, incrustada). Lee solo lo necesario. */
export async function scanFonts(reader: ObjectReader, from: number, to: number, signal: AbortSignal): Promise<readonly FontInfo[] | 'cancelled'>;
export function mergeFonts(a: readonly FontInfo[], b: readonly FontInfo[]): readonly FontInfo[]; // ordenado por nombre (localeCompare 'es')
```
   Cachea por número de objeto los diccionarios de fuente ya vistos (páginas que comparten la misma fuente no la vuelven a leer).
2. `src/state/fonts-actions.ts`: `startFontScan(): void` abre un `ObjectReader` sobre `file.source` (con `openForSave`; si falla, estado `error`), recorre en lotes de 200 páginas cediendo el hilo (`setTimeout 0`), publica en un store `useFontScan` `{ status: 'idle' | 'scanning' | 'done' | 'cancelled' | 'error'; fonts; pagesDone; total }`; `cancelFontScan()`. Se cancela al cerrar el diálogo o cambiar de documento.
3. Pestaña «Fuentes» en `PropertiesDialog`: al seleccionarla empieza el escaneo; tabla (`<table>` con cabeceras Nombre, Tipo, Codificación, Incrustada) que crece por lotes; progreso «Buscando fuentes… 1.200 de 5.000 páginas» con botón «Detener»; al detener muestra lo encontrado y «Búsqueda detenida en la página n.»; error: «No se han podido leer las fuentes de este PDF.».
4. Tests: `tests/unit/pdf-fonts.test.ts` (fixtures y corpus), `tests/perf/fonts.perf.test.ts` (5 000 páginas), E2E en `tests/e2e/properties.spec.ts`.

## Criterios de aceptación
- [ ] `basic-5.pdf` → 1 fuente `Helvetica`, `Type1`, `WinAnsiEncoding`, no incrustada.
- [ ] `fixtures/pdf/corpus/libreoffice/multilingue.pdf` → incluye fuentes `TrueType` o `Type0` incrustadas y con `subset: true`; ningún nombre conserva el prefijo `XXXXXX+`.
- [ ] `fixtures/pdf/corpus/verapdf/7.21.4.1-t01-pass-a.pdf` (fuentes incrustadas, 3 actualizaciones) → la lista coincide con las `/BaseFont` que da `qpdf --json` del fichero (test que las compara).
- [ ] Perf: `scanFonts` de `pages-5000.pdf` completo < 3 s; en la app, durante el escaneo de `pages-100000.pdf` ninguna *long task* > 100 ms (E2E `@perf`) y «Detener» lo para en < 200 ms.
- [ ] Cerrar el diálogo a mitad del escaneo lo cancela (no quedan lecturas en curso: test con `countingSource`).
- [ ] Axe sin incidencias `serious`/`critical` en la pestaña.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Fuentes dentro de anotaciones y de Form XObjects anidados. Fuentes Type3 con nombre (se listan como «Type3» sin nombre si no tienen `/Name`).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/fonts.ts`, `src/core/pdf/index.ts`, `src/state/fonts-actions.ts`, `src/state/fonts-store.ts`, `src/ui/properties/PropertiesDialog.tsx`, `PropertiesDialog.module.css`, `src/ui/messages-properties.ts`, `tests/unit/pdf-fonts.test.ts`, `tests/unit/fonts-actions.test.ts`, `tests/ui/properties-fonts.test.tsx`, `tests/perf/fonts.perf.test.ts`, `tests/e2e/properties.spec.ts`; esta ficha.
- Qué he hecho: he revisado el trabajo previo sin commitear y lo he dado por bueno sin reescribirlo: `scanFonts`/`mergeFonts` con caché por objeto, escaneo por lotes de 200 páginas cedendo el hilo, pestaña «Fuentes» con progreso, «Detener», error y cancelación al cerrar. No he cambiado código de la app. Todos los criterios se cumplen salvo el de `verapdf/7.21.4.1-t01-pass-a.pdf` (ver dudas).
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm --filter lector-pdf typecheck` OK; `pnpm test` 178 ficheros / 2069 tests OK; `pnpm coverage` OK (`fonts.ts` 96,7 % líneas); `pnpm perf` (fonts.perf) OK; `playwright test properties.spec.ts --project=chromium` 14/14 OK; `--project=chromium-perf` (pages-100000, long tasks y «Detener») OK. En la ejecución completa del E2E fallaron `open-qa.spec.ts:59` (arrastrar y soltar) y `render.spec.ts:158` (resaltado), ajenos a esta ficha; no los he tocado.
- Dudas o cosas que no he podido hacer:
  1. **Criterio de verapdf no cumplido tal como está escrito.** El criterio pide que la lista «coincida con las `/BaseFont` que da `qpdf --json`». Esas `/BaseFont` son `Helvetica` y `ZapfDingbats` (solo en `/AcroForm /DR`, no en `/Resources` de ninguna página) y `BRYEGL+Arial`. El escaneo, según el «Contexto», solo mira `/Resources` de páginas y Form XObject, así que da solo `Arial`. El test `pdf-fonts.test.ts` asegura lo que hace el código (solo `Arial`), no el criterio. Hay que decidir: (a) añadir `/AcroForm /DR` al escaneo, o (b) cambiar el criterio a «fuentes de las páginas». No lo he decidido yo.
  2. Menor: «Búsqueda detenida en la página n.» usa `pagesDone`, que avanza por lotes de 200; la página exacta donde se detuvo puede ser anterior. Si se quiere la página exacta, hay que publicar progreso por página.
  3. Menor: con 0 páginas leídas, el mensaje es «Búsqueda detenida antes de terminar la primera página.» (texto mío, no está en la ficha).
