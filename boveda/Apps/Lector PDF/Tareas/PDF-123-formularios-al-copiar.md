---
tipo: tarea
id: PDF-123
titulo: Formularios al copiar páginas a un PDF nuevo
app: pdf
estado: en-test
depende_de: [PDF-122]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, formularios, nucleo]
---

# PDF-123 · Formularios al copiar páginas a un PDF nuevo

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] (punto 4), [[ADR-0019-formularios-acroform]] · Antes: [[PDF-122-destinos-e-indice-al-copiar]]

## Objetivo
Los campos de formulario de las páginas copiadas siguen siendo campos rellenables en el PDF nuevo (extraer, dividir, combinar), con su valor y su apariencia.

## Contexto
- `src/core/pdf/new-document.ts` y `object-copier.ts` (PDF-120/121/122).
- `src/core/organize/forms-cleanup.ts` (PDF-119): recorrido de `/Fields` y `/Kids` a imitar.
- ISO 32000-1 §12.7.2 (`/AcroForm`: `/Fields`, `/DR`, `/DA`, `/Q`, `/NeedAppearances`, `/SigFlags`, `/CO`), §12.7.3.1 (jerarquía de campos por `/Parent`).
- Fixtures: `form.pdf`, `form-full.pdf`.

## Qué hay que hacer
1. `new-document.ts`: tras copiar las páginas de cada parte, si su catálogo tiene `/AcroForm`:
   - Para cada widget copiado (anotación con `/Subtype /Widget` en las páginas copiadas) se sube por `/Parent` (en el origen, máx. 32 niveles) hasta el campo raíz; las raíces distintas (por número de origen), en el orden en que aparecen, forman `/Fields`. Las raíces se copian con el mismo `ObjectCopier` (el memo evita duplicados).
   - En cada campo copiado con `/Kids`, se quitan de `/Kids` las refs que han quedado a `null` o cuyos widgets no se copiaron; un campo sin ningún hijo útil se quita de su padre (y de `/Fields`). Los objetos huérfanos que el copier ya había copiado se quedan (no se referencian; tamaño despreciable).
   - `/DR`, `/DA`, `/Q` y `/NeedAppearances` del `/AcroForm` de **la primera parte que tenga formulario**; las fuentes de `/DR` de las demás partes se añaden bajo nombres que no existan (`Helv`, `Helv_2`…), sin cambiar los `/DA` de sus campos (se copian tal cual).
   - `/SigFlags`: no se copia (las firmas digitales copiadas dejan de ser válidas; sus campos se copian como campos de firma vacíos: se quita `/V` de los campos `/FT /Sig`).
   - `/CO` se descarta.
2. Tests en `tests/unit/pdf/new-document.test.ts` (casos nuevos).

## Criterios de aceptación
- [ ] Extraer de `form-full.pdf` una página con campos → pdf.js `getFieldObjects()` del resultado lista exactamente los campos de esa página con sus valores; `qpdf --check` 0.
- [ ] Extraer **todas** las páginas de `form-full.pdf` → mismos nombres de campo y valores que el original (compara `getFieldObjects()` nombre a nombre).
- [ ] Campo con widgets en dos páginas: extraer solo una → el campo aparece una vez con un único widget.
- [ ] Combinar `form.pdf` + `form-full.pdf` → `/AcroForm /Fields` contiene las raíces de ambos; los rellenables de los dos se pueden leer en pdf.js.
- [ ] Un PDF con un campo de firma firmado (créalo con `pdf-builder.ts`: `/FT /Sig` con `/V` a un diccionario) → en el resultado el campo existe y no tiene `/V`.
- [ ] Documentos sin formulario → el catálogo no tiene `/AcroForm` (los tests de PDF-121/122 siguen igual).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Renombrar campos con el mismo nombre al combinar (compartirán valor; [[ADR-0035-organizar-en-la-app]]). JavaScript de formularios y orden de cálculo. XFA.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/new-document-forms.ts` (nuevo), `apps/lector-pdf/src/core/pdf/new-document.ts`, `apps/lector-pdf/tests/unit/pdf/new-document.test.ts` (casos nuevos de formularios).
- Qué he hecho: `FormsBuilder` copia por parte con `/AcroForm` los widgets de las páginas copiadas hasta su raíz (`/Parent`, máx. 32), quita los `/Kids` no copiados (campos sin hijos útiles fuera), quita `/V` de campos `/Sig` (también heredado) y construye `/AcroForm` (`/Fields`, `/DA`, `/Q`, `/NeedAppearances`, `/DR` de la primera parte; fuentes de las demás con nombre libre `X_2`…). `/SigFlags` y `/CO` no se copian. Sin `/AcroForm` en ninguna parte, el catálogo no lo tiene.
- Comandos ejecutados y resultado: `pnpm lint` (sin avisos); `pnpm typecheck` (0 errores); `pnpm coverage`: código 0, 255 ficheros y 3229 tests en verde; `new-document-forms.ts` con 96 % de líneas. Tests nuevos: 7 casos en `new-document.test.ts` (pdf.js `getFieldObjects` y qpdf) y los 29 del fichero en verde.
- Dudas o cosas que no he podido hacer: (1) he separado la lógica en `new-document-forms.ts` por tamaño del fichero; la ficha no lo pedía. (2) Las fuentes de `/DR` de la segunda parte se renombran (`Helv_2`) pero sus `/DA` no cambian, como pide la ficha: un campo de la segunda parte con `/DA /Helv` usará la fuente `Helv` de la primera parte. Conviene que el revisor lo valore. (3) Un `/Kids` más profundo de 32 niveles se trata como no copiable (se quita); la ficha no decía nada. (4) Si una parte tiene `/AcroForm` pero ninguno de sus widgets se copia, el resultado tiene `/Fields []`.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Lint, typecheck y coverage con código 0. Los 7 tests nuevos cubren los criterios (pdf.js `getFieldObjects`, qpdf, firma sin `/V`, sin `/AcroForm`).
- Duda `/DA` con `Helv_2`: es lo que pide literalmente la ficha y los widgets llevan su propia apariencia (`/AP`) con recursos propios, así que el render no cambia. No bloquea. (opcional) Si al editar un campo de la segunda parte se ve una fuente distinta, planificar una ficha para reescribir `/DA` con el nombre renombrado.
- (opcional) `/DA` solo de la primera parte con formulario: si esa no lo tiene y otra sí, se pierde.
