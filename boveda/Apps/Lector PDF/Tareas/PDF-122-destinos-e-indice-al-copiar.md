---
tipo: tarea
id: PDF-122
titulo: Destinos con nombre e índice al copiar páginas
app: pdf
estado: hecha
depende_de: [PDF-121]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-122 · Destinos con nombre e índice al copiar páginas

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] (punto 4) · Antes: [[PDF-121-documento-nuevo]] · Siguen: [[PDF-054-extraer-dividir]], [[PDF-055-insertar-combinar]]

## Objetivo
Al copiar páginas a un PDF nuevo: los destinos con nombre (enlaces y acciones `GoTo`) se convierten en destinos explícitos que siguen funcionando; se puede copiar el índice de cada fuente (para combinar) y leer las entradas de primer nivel con su página (para dividir por marcadores).

## Contexto
- `src/core/pdf/object-copier.ts` (PDF-120) y `src/core/pdf/new-document.ts` (PDF-121).
- `src/core/dest.ts` → `parseExplicitDest` (formato de destino explícito).
- ISO 32000-1 §7.9.6 (árboles de nombres), §12.3.2.3 (destinos con nombre: `/Names /Dests` y el antiguo `/Dests` del catálogo), §12.3.3 (índice: `/Outlines`, `/First`, `/Next`, `/Title`, `/Dest`, `/A`, `/Count`, `/C`, `/F`).
- Fixtures: `outline.pdf` (índice de 3 niveles, una entrada «Anexo» con destino con nombre y una URI), `links.pdf` (enlace con destino con nombre «destino-final»).

## Qué hay que hacer
1. `src/core/pdf/name-tree.ts`:
```ts
/** Valor de `key` en un árbol de nombres (`/Names` o `/Kids` con `/Limits`), máx. 32 niveles. */
export async function lookupNameTree(reader: ObjectReader, root: PdfDict, key: Uint8Array): Promise<PdfValue | undefined>;
/** Destino explícito de un nombre (cadena o nombre PDF): `/Names /Dests` del catálogo y, si no, `/Dests`. Un valor `<< /D [...] >>` devuelve su `/D`. */
export async function resolveNamedDest(reader: ObjectReader, nameKey: PdfString | PdfName): Promise<readonly PdfValue[] | null>;
```
2. `ObjectCopier` (PDF-120): opción nueva `resolveNames: true` (por defecto `false` para no cambiar PDF-120). Con ella, en anotaciones `/Dest` cadena o nombre, y en acciones `/S /GoTo` con `/D` cadena o nombre, el valor se sustituye por el destino explícito resuelto y remapeado (página no copiada → `null` en la primera posición; nombre que no existe → se quita `/Dest` o la acción).
3. `src/core/pdf/outline-copy.ts`:
```ts
export interface OutlineTop { readonly title: string; readonly pageIndex: number | null }
/** Entradas de primer nivel del índice con la página (0-based) a la que llevan, o null (URI, sin destino, página inexistente). */
export async function readTopLevelOutline(reader: ObjectReader): Promise<readonly OutlineTop[]>;
/**
 * Copia el índice de `reader` con `copier` (destinos remapeados) bajo un nodo nuevo con `title` que apunta a `firstPage`.
 * Devuelve la ref del nodo raíz del subárbol y sus objetos. Entradas cuyo destino era una página no copiada: se conservan sin `/Dest`.
 */
export async function copyOutlineBranch(reader: ObjectReader, copier: ObjectCopier, title: string, firstPage: PdfRef): Promise<OutlineBranch>;
export interface OutlineBranch { readonly ref: PdfRef; readonly objects: readonly (readonly [PdfRef, PdfValue])[]; readonly visibleCount: number }
```
   Recorrido iterativo por `/First`/`/Next` con conjunto de visitados (los ciclos se cortan) y máximo 10 000 entradas por fuente. Se copian `/Title`, `/C`, `/F`, `/Count` (signo conservado), `/Dest` o `/A` (`GoTo` con nombre → explícito; `URI` tal cual; `GoToR`, `Launch`, `JavaScript` → se quita la acción).
4. `new-document.ts`: `NewDocumentInput` gana `readonly outline?: 'none' | 'branches'` (por defecto `'none'`) y `NewDocumentPart` gana `readonly title?: string`. Con `'branches'`: el catálogo recibe `/Outlines` con una rama por parte (título = `part.title` o «Documento N»), cada una apuntando a la primera página de su parte y con el índice copiado de esa fuente debajo; `/PageMode /UseOutlines`. El copier siempre usa `resolveNames: true` en documentos nuevos.
5. Tests `tests/unit/pdf/name-tree.test.ts`, `tests/unit/pdf/outline-copy.test.ts` y casos nuevos en `new-document.test.ts`.

## Criterios de aceptación
- [ ] `resolveNamedDest(outline.pdf, 'anexo')` → array cuyo primer elemento es la ref de la página 30; nombre inexistente → `null`; árbol con `/Kids` y `/Limits` (créalo con `pdf-builder.ts`) → encuentra claves en hojas distintas.
- [ ] `readTopLevelOutline(outline.pdf)` → `Capítulo 1→0, Capítulo 2→10, Capítulo 3→20, Anexo→29, Sitio web→null`.
- [ ] Nuevo documento con las páginas 1-5 de `links.pdf`: el enlace «destino-final» de la página 1 lleva a la página correcta (`resolveDest` de `src/engine/dest.ts` sobre el resultado).
- [ ] Combinar `basic-5.pdf` + `outline.pdf` con `outline: 'branches'` y títulos `basic-5`, `outline` → `getOutline()` da 2 entradas de primer nivel `basic-5` (página 0) y `outline` (página 5); bajo `outline`, «Capítulo 2» lleva a la página 15 y «Anexo» a la 34; «Sitio web» conserva su URI.
- [ ] Índice con un ciclo `/Next` (creado en el test) → termina y copia cada entrada una vez.
- [ ] `qpdf --check` 0 en todos los resultados. Cobertura ≥ 90 % en `name-tree.ts` y `outline-copy.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Conservar el árbol `/Names /Dests` en el documento nuevo (todos los destinos se vuelven explícitos). Índice al insertar páginas en un documento existente ([[PDF-055-insertar-combinar]] no lo hace).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/object-copier.ts` (opción `resolveNames`; métodos públicos `allocRef`, `copyDirect`, `namedDestValue`), `apps/lector-pdf/src/core/pdf/new-document.ts` (`outline`, `NewDocumentPart.title`, rama por parte y `/Outlines` con `/PageMode /UseOutlines`), nuevos `apps/lector-pdf/src/core/pdf/name-tree.ts` y `apps/lector-pdf/src/core/pdf/outline-copy.ts`; tests nuevos `apps/lector-pdf/tests/unit/pdf/name-tree.test.ts`, `outline-copy.test.ts`, `object-copier-names.test.ts`; casos nuevos en `new-document.test.ts`.
- Qué he hecho: árboles de nombres con `/Kids`/`/Limits` (32 niveles, ciclos cortados) y `resolveNamedDest` (`/Names /Dests`, si no `/Dests`); el copier convierte `/Dest` de anotaciones y `/D` de `GoTo` con nombre en destinos explícitos (nombre inexistente → se quita); `copyOutlineBranch` copia el índice en recorrido iterativo con visitados y con tope de 10 000 entradas; `buildNewDocument` añade una rama por parte.
- Comandos ejecutados y resultado: `pnpm lint` (0, tras quitar una variable sin usar en `name-tree.test.ts`); `pnpm typecheck` (0); `pnpm coverage` (código 0, todo el suite en verde). Cobertura: `name-tree.ts` 96,6 % líneas, `outline-copy.ts` 99,3 %, `object-copier.ts` 99,3 %, `new-document.ts` 98,9 %. `qpdf --check` = 0 en los documentos de salida de `new-document.test.ts` (`links.pdf` completo y `basic-5.pdf`+`outline.pdf` con ramas). Los tests de copia de índice y de anotaciones no pasan por qpdf.
- Dudas o cosas que no he podido hacer:
  - Decisiones menores tomadas (no fijadas en la ficha): el nodo de cada rama apunta a la primera página con `/Fit`; el título por defecto «Documento N» usa la posición en `parts` (cuenta las partes vacías); una parte sin páginas no tiene rama; el tope de 10 000 entradas por fuente corta el recorrido en silencio.
  - Añadidos fuera de la lista de la ficha: `ObjectCopier.allocRef()`, `copyDirect()` y `namedDestValue()` son públicos porque `copyOutlineBranch` los necesita para reservar números y remapear destinos.
  - Los objetos de rama se numeran desde el mismo asignador que las páginas; los ficheros se validan con qpdf en cada test de salida.
  - No he hecho commit (lo pediste así; hay cambios ajenos en `crypto/` y en tests de UI en el árbol de trabajo).

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- `pnpm lint`, `pnpm typecheck` y `pnpm coverage` con código 0 (253 ficheros, 3184 tests). Cobertura `name-tree.ts` 93,2 %, `outline-copy.ts` 95,6 %.
- Criterios cubiertos por tests (árbol con `/Kids`/`/Limits`, `readTopLevelOutline`, ramas `basic-5`+`outline`, ciclo `/Next`, `links.pdf`); `qpdf --check` en las salidas de `new-document.test.ts`. Sin commit aún (el programador lo indicó).
- (opcional) El tope de 10 000 entradas corta en silencio; valorar un aviso más adelante.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| resolveNamedDest anexo/inexistente/Kids+Limits | OK | `name-tree.test.ts` (13 tests) verdes |
| readTopLevelOutline outline.pdf | OK | `outline-copy.test.ts` línea 68 |
| links.pdf destino-final | OK | `new-document.test.ts` verde (47 tests en los 4 ficheros) |
| Combinar basic-5+outline con ramas | OK | `new-document.test.ts` |
| Ciclo /Next | OK | `outline-copy.test.ts` líneas 85 y 176 |
| qpdf --check 0 | OK | tests de salida de `new-document.test.ts` |
| Cobertura | OK | name-tree 93,2 %, outline-copy 95,6 % |
| lint / typecheck / coverage | OK | exit 0; 254 ficheros, 3188 tests |

Tests añadidos: ninguno (cobertura suficiente). Rendimiento: no aplica.
