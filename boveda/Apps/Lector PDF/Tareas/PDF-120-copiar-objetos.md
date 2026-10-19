---
tipo: tarea
id: PDF-120
titulo: Copiar páginas y sus objetos entre PDFs (ObjectCopier)
app: pdf
estado: en-revision
depende_de: [PDF-052]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, nucleo]
---

# PDF-120 · Copiar páginas y sus objetos entre PDFs (ObjectCopier)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0028-reescribir-pdfs]] (opción 2), [[ADR-0035-organizar-en-la-app]] (punto 4) · Siguen: [[PDF-121-documento-nuevo]], [[PDF-055-insertar-combinar]]

## Objetivo
Una clase del núcleo que copia una página de un PDF (leído con `ObjectReader`) y todo lo que alcanza (contenido, recursos, fuentes, imágenes, anotaciones) a objetos con **números nuevos**, sin arrastrar el resto del documento. Base de extraer, dividir, combinar e insertar.

## Contexto
- `src/core/pdf/object-reader.ts` → `ObjectReader.get`, `getDict`, `resolve`, `pageRefs` (los flujos ya llegan descifrados).
- `src/core/pdf/objects.ts` → `PdfValue`, `dict`, `ref`, `withEntries`, `dictGet`.
- `src/core/pdf/page-tree.ts` → `ancestorsOf`/`chainFrom` (lógica de antecesores a copiar, son privadas: replica la regla, máx. 64 niveles).
- ISO 32000-1 §7.7.3.4 (atributos heredables) y §12.3.2 (destinos).

## Qué hay que hacer
1. `src/core/pdf/object-copier.ts`:
```ts
export interface CopiedPage { readonly ref: PdfRef; readonly dict: PdfDict }   // dict sin /Parent, aún no escrito
export interface CopierOptions {
  readonly from: ObjectReader;
  /** Asigna números nuevos (p. ej. `createAllocator` de page-tree.ts o un contador desde 1). */
  readonly alloc: () => PdfRef;
}
export class ObjectCopier {
  constructor(o: CopierOptions);
  /**
   * Reserva el número de cada página que se va a copiar (por índice 0-based del origen). Debe llamarse con
   * TODAS las páginas antes de `copyPage`, para que los enlaces entre ellas se remapeen.
   */
  reservePages(indices: readonly number[]): Promise<ReadonlyMap<number, PdfRef>>;
  /** Copia la página `index` (ya reservada). Devuelve su diccionario listo para recibir `/Parent`. */
  copyPage(index: number): Promise<CopiedPage>;
  /** Objetos copiados (no páginas) en orden de copia: [ref, valor]. Se vacía con `drain()`. */
  drain(): readonly (readonly [PdfRef, PdfValue])[];
  /** Ref nueva de un objeto ya copiado del origen (por número), o undefined. */
  mapped(sourceNum: number): PdfRef | undefined;
}
```
2. Reglas de copia (`copyValue` recursivo con memo por número de objeto de origen; nunca copia dos veces el mismo objeto):
   - Referencia a un objeto que es página (`/Type /Page`) o nodo (`/Type /Pages`): si es una página reservada → su ref nueva; si no → `null`.
   - Página copiada: se quitan `/Parent`, `/B` (artículos) y `/StructParents`; se añaden, si la página no los tiene, `/Resources`, `/MediaBox`, `/CropBox` y `/Rotate` del antecesor más cercano (resueltos y copiados).
   - Anotación (`/Type /Annot` o con `/Subtype` en un `/Annots`): `/P` → página nueva o se quita la clave; `/Popup` y `/IRT` se copian normalmente (se remapean por el memo); `/StructParent` se quita.
   - Destinos explícitos (array cuyo primer elemento es ref a página) se remapean por la regla de páginas (los no copiados quedan con `null` en la primera posición y pdf.js los ignora).
   - Flujos: datos tal cual (siguen codificados con su `/Filter`), `/Length` directo = `data.length`. Nunca se decodifican.
   - Refs a objetos libres o inexistentes → `null`.
   - Claves `/Parent` de diccionarios que no son páginas (campos de formulario) se copian normalmente.
   - Profundidad de recursión de valores directos ≤ 100 (`PdfSyntaxError` si se supera); los objetos indirectos se copian con una pila explícita (sin recursión por número) para no desbordar con cadenas largas.
3. Tests `tests/unit/pdf/object-copier.test.ts`:
   - Copiar la página 3 de `basic-5.pdf` con `alloc` desde 1: el conjunto de objetos copiados no contiene ninguna página distinta ni nodos `/Pages`; la página tiene `/MediaBox` y `/Resources` propios.
   - `links.pdf` (enlaces de la página 1 a las páginas 2 y 3): reservar `[0, 2]` → el destino a la página 3 apunta a la ref nueva de la página 3; el de la 2 queda con `null`.
   - `annotated.pdf`: las anotaciones de la página copiada mantienen subtipo, `/Contents` y su `/Popup` remapeado; `/P` apunta a la página nueva.
   - `compressed.pdf` (object streams) y `encrypted-aes-256.pdf` (`usuario`): los flujos copiados son los del original descifrados (compara con `reader.get` del original).
   - Ciclos (`/Popup` ↔ `/Parent` de la popup): termina y cada objeto aparece una sola vez.

## Criterios de aceptación
- [ ] Los tests anteriores pasan.
- [ ] Copiar la página 2 500 de `pages-5000.pdf`: `drain()` devuelve como mucho 20 objetos y, espiando `reader.get` con `vi.spyOn`, no se pide ningún diccionario de otra página (solo sus antecesores `/Pages`): no arrastra el documento.
- [ ] Cobertura de `object-copier.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Escribir el fichero ([[PDF-121-documento-nuevo]]). Destinos con nombre, índice y `/AcroForm` ([[PDF-122-destinos-e-indice-al-copiar]], [[PDF-123-formularios-al-copiar]]). Estructura etiquetada.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/object-copier.ts` (nuevo), `apps/lector-pdf/tests/unit/pdf/object-copier.test.ts` (nuevo), esta ficha (estado y Registro).
- Qué he hecho: `ObjectCopier` con `reservePages`, `copyPage`, `drain`, `mapped`. Copia de objetos indirectos con pila explícita y memo por número de origen; páginas y `/Pages` remapeadas o `null`; atributos heredados (`Resources`, `MediaBox`, `CropBox`, `Rotate`) resueltos y copiados; anotaciones con `/P` y `/StructParent` tratados; flujos con `/Length` directo. 14 tests, todos en verde. Criterio de `pages-5000.pdf` (página 2 500) verificado con espía sobre `reader.get`.
- Comandos ejecutados y resultado: `pnpm exec eslint` sobre los dos ficheros nuevos: limpio. `pnpm typecheck`: limpio. `pnpm exec vitest run tests/unit/pdf/object-copier.test.ts --coverage` (cobertura del módulo): 14/14 tests; `object-copier.ts` con 99,1 % de líneas. `pnpm coverage` completo: 5 tests fallan en `tests/unit/tabs-annotations.test.ts` y `tests/ui/draft-sync-tabs.test.tsx`, y `pnpm lint` falla en `tests/unit/tabs-annotations.test.ts` (`no-console`): ficheros de otro trabajo en curso, no tocados por mí.
- Dudas o cosas que no he podido hacer: (1) El límite de profundidad de 100 lo aplica el analizador antes que el copiador, así que la guarda `demasiados niveles de anidamiento` del copiador es inalcanzable desde un PDF; la prueba comprueba el error de sintaxis que llega primero. (2) No he hecho commit, por indicación del usuario.
