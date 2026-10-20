---
tipo: decision
id: ADR-0035
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, organizar, ui]
---

# ADR-0035 · Organizar, extraer, dividir, insertar y combinar en la app

## Contexto
El núcleo para reorganizar en el sitio ya existe ([[ADR-0028-reescribir-pdfs]], [[PDF-052-organizar-adr|PDF-052]]). Falta decidir cómo lo usa el usuario y cómo se crean documentos nuevos (la opción 2 de ADR-0028). Paridad: [[Paridad Adobe Acrobat]] → «Organizar». Requisitos: igual con 5 que con 100 000 páginas, deshacer, no perder cambios sin guardar y no bloquear la interfaz ([[ADR-0034-operaciones-en-worker]]).

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **A. Vista «Organizar páginas» con plan pendiente**: cuadrícula de miniaturas que edita una lista de páginas (con su propio deshacer); «Guardar» escribe el incremento y reabre | El visor no tiene que mostrar un documento que aún no existe; deshacer simple (el plan es una lista inmutable); igual que la herramienta de Acrobat | Los cambios de páginas solo se ven en el visor después de guardar |
| B. Aplicar cada cambio al momento sobre un documento en memoria (`concatSource`) y reabrir pdf.js | El visor siempre muestra el resultado | Reabrir pdf.js por cada giro (segundos con 100 000 páginas); deshacer = varios incrementos; complica pestañas y borradores |
| C. Reescribir el documento entero en cada guardado | Fichero más pequeño | Lento con 100 000 páginas; pierde las ventajas de [[ADR-0028-reescribir-pdfs]] |

## Decisión
**Opción A**, con estas reglas:
1. **Plan de páginas** (`src/core/organize/plan.ts`): lista inmutable de huecos `original | blank | imported` con su giro absoluto. Los comandos (girar, borrar, mover, insertar) pasan por un `UndoStack` propio de la vista (profundidad 30).
2. **Guardar** (Ctrl+S dentro de la vista): se encadena primero el incremento de anotaciones y formularios sin guardar (`buildCurrentDelta`) y, sobre `concatSource(original, delta1)`, el incremento de páginas (Worker). Al fichero se anexa `delta1 + delta2` de forma atómica y se reabre. En web sin escritura en sitio, se descarga la copia (como el resto de guardados).
3. **Formularios**: al borrar páginas se quitan sus widgets de `/AcroForm /Fields` (y de `/Kids` y `/CO`). **Índice**: las entradas a páginas borradas se conservan y no hacen nada al pulsarlas (como hoy; limpiarlas queda en «Mejoras conocidas»).
4. **Documentos nuevos** (extraer, dividir, combinar, crear desde imágenes): copia de los objetos alcanzables desde las páginas elegidas con numeración nueva (`object-copier.ts`) y fichero completo con xref clásica (`new-document.ts`). Las referencias a páginas no copiadas pasan a `null`; los destinos con nombre se convierten en explícitos; se copian los formularios de las páginas copiadas. El PDF nuevo **no se cifra** aunque el original lo esté (el diálogo lo avisa; [[PDF-060-proteger|Proteger]] permite cifrarlo después).
5. **Insertar desde otro PDF** dentro de la vista: los objetos del otro PDF se copian dentro del mismo incremento con números nuevos ([[PDF-055-insertar-combinar|PDF-055]]).
6. **Salidas**: un PDF → `saveAs` con `{ kind: 'bytes' }` y se abre en una pestaña nueva solo al combinar; varios PDF (dividir) → un ZIP sin recomprimir con `exportFile` (mismo criterio que [[ADR-0032-exportar-imagenes-y-texto]]).
7. **Permisos** ([[PDF-048-permisos|PDF-048]]): sin «montar» (`assemble`), organizar avisa una vez y deja seguir (como comentar); sin «copiar», extraer y dividir quedan deshabilitados (como exportar).

## Consecuencias
- El visor y las miniaturas laterales no cambian hasta guardar; la vista de organizar es el único sitio con el resultado pendiente.
- Borrar páginas no reduce el tamaño del fichero (lo dirá el Manual); «Guardar optimizado» llegará con la reescritura completa de [[PDF-131-reescribir-documento|PDF-131]].
- Campos con el mismo nombre al insertar o combinar PDFs con formularios comparten valor (comportamiento de Acrobat sin renombrar); se documenta en «Fuera de alcance» de PDF-055.
