---
tipo: plan
app: pdf
estado: en-curso
iteracion: 1
creado: 2026-10-17
actualizado: 2026-10-17
tags: [plan, pdf]
---

# Plan · Lector PDF

Investigación: [[Paridad Adobe Acrobat]] · [[Librerias y arquitectura PDF]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0008-plataforma-ficheros]] · [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0010-stack-apps-web-y-pruebas]] · [[ADR-0011-documentos-de-prueba-pdf]] · Base común: [[Apps/Comun/Plan|Plan de Comun]] · Manual: [[Apps/Lector PDF/Manual|Manual]] (se crea al cerrar la iteración 1)

## Objetivo
Sustituir a Adobe Acrobat Reader (y a lo más usado de Acrobat Pro) para uso personal, en escritorio (Tauri) y navegador.
Petición literal del usuario: *"Desarrolla el lector de pdf, quiero que tenga las mismas funciones que adobe acrobat reader premium y que funcione de manera correcta, sin importar cuantas paginas tenga el pdf. se debe poder subrayar y hacer notas"*.
Interpretación ("Reader premium" no existe como producto, ver [[Paridad Adobe Acrobat]]): todo lo de Reader + funciones de pago de Acrobat Pro, por orden de prioridad de la nota de paridad. Requisitos transversales: mismo comportamiento con 5 o 100 000 páginas; anotar siempre (aunque el PDF no habilite comentarios); todo se guarda dentro del PDF como anotaciones estándar.

## Iteraciones
| # | Nombre | Qué deja usable | Estado |
|---|---|---|---|
| 1 | Visor robusto | Abrir (web y escritorio), leer cualquier PDF de cualquier tamaño, miniaturas, índice, buscar, zoom, girar vista, ir a página, copiar texto, enlaces, recordar página, tema oscuro | planificada |
| 2 | Anotaciones | Resaltar, subrayar, tachar, notas, texto libre, dibujo, panel de comentarios, deshacer/rehacer, guardar dentro del PDF y recuperar tras cierre inesperado | planificada |
| 3 | Formularios, firma e impresión | Rellenar AcroForm, firma visual, imprimir, propiedades | fichas creadas (a detallar) |
| 4 | Contraseñas y comodidad | Abrir con contraseña, anotar PDFs cifrados, permisos, recientes y pestañas, modos de página, zoom alto nítido | fichas creadas (a detallar) |
| 5 | Organizar páginas | Girar, borrar, reordenar, extraer, dividir, insertar, combinar, crear desde imágenes | fichas creadas (a detallar) |
| 6 | Funciones Pro | Formas y sellos, respuestas y XFDF, añadir texto/imagen, proteger, OCR, redactar, comparar, exportar, editar texto, firma digital, leer en voz alta | fichas creadas (a detallar) |

Las fichas de las iteraciones 3-6 tienen título, dependencias y objetivo; el líder las detalla (y escribe sus ADR) al cerrar la iteración anterior.

## Alcance de la iteración 1 · Visor robusto
**Entra:** base común ([[COM-004-monorepo-para-apps|COM-004]] a [[COM-011-registro-de-atajos|COM-011]], salvo COM-012 y COM-013, que son de la iteración 2); abrir con botón, Ctrl+O, arrastrar, "Abrir con" del SO (Tauri); lectura por rangos; visor virtualizado igual con 5, 5 000 o 100 000 páginas; miniaturas; índice; búsqueda incremental con resaltado y opciones (mayúsculas, palabra completa, tildes); zoom (pasos, %, ajustar ancho/página, tamaño real, Ctrl+rueda); rotación de vista; ir a página (con etiquetas de página); selección y copia de texto; herramienta mano; enlaces internos y externos (con confirmación) y atrás/adelante; recordar última página y zoom; tema claro/oscuro/sistema y modo noche de páginas; estados vacío/carga/error en español; app de escritorio Tauri (asociación .pdf, instancia única); fixtures generados + corpus público; E2E y presupuestos de rendimiento.
**No entra:** anotaciones (it. 2), contraseñas (muestra mensaje claro; it. 4), imprimir (it. 3), formularios interactivos (se ven, no se rellenan; it. 3), doble página/pantalla completa (it. 4), recientes y pestañas (it. 4), lienzo de detalle con zoom > 800 % (it. 4), capas OCG, adjuntos, XFA, JavaScript, multimedia/3D (nunca se ejecuta JS del PDF).

## Alcance de la iteración 2 · Anotaciones
**Entra:** modelo de anotaciones con deshacer/rehacer (Ctrl+Z, Ctrl+Y, Ctrl+Mayús+Z); resaltar, subrayar y tachar texto seleccionado (colores); nota adhesiva y comentario sobre un marcado; texto libre; dibujo a mano; seleccionar, mover (notas, texto libre y dibujos), cambiar color, editar texto y borrar (Supr); panel de comentarios; leer las anotaciones existentes de otros programas (y editarlas si son de los tipos soportados); guardar (Ctrl+S) y guardar como (Ctrl+Mayús+S) **dentro del PDF** por actualización incremental atómica; aviso al cerrar con cambios; recuperación de anotaciones tras cierre inesperado; verificación con pdf.js y qpdf y lista de comprobación manual en Adobe Reader.
**No entra:** formas y sellos, respuestas y estados de comentarios, XFDF (it. 6); anotar PDFs cifrados (it. 4, [[PDF-047-anotar-pdf-cifrado|PDF-047]]); mover/redimensionar marcados de texto; fuente incrustada en texto libre (no latino); deshacer después de guardar (el historial se vacía al guardar).

## Arquitectura
```
packages/shared/      Result, logger, UndoStack, registro de atajos (COM)
packages/platform/    @suite/platform: Platform, ByteSource, prefs, borradores; web/ y tauri/
packages/platform/rust/  crate suite-platform: registro de rutas, E/S atómica, comandos Tauri
apps/lector-pdf/
  src/main.tsx        arranque: worker de pdf.js, loadPlatform, render de <App/>
  src/core/           lógica pura (sin React, sin pdfjs, sin Node): layout, zoom, cola de render,
                      búsqueda, destinos, enlaces, posiciones, anotaciones, pdf/ (lexer, xref, escritor)
  src/engine/         ÚNICO sitio que importa pdfjs-dist: carga por rangos, render, texto, enlaces,
                      índice, dimensiones, importar anotaciones
  src/state/          stores zustand: viewer, search, annotations (puente con UndoStack)
  src/ui/             componentes React: shell, toolbar, viewer/, sidebar/, search/, annotations/, kit/
  src-tauri/          app de escritorio (usa suite-platform con feature tauri)
  scripts/copy-pdfjs-assets.mjs   copia cmaps, fuentes estándar, wasm e icc a public/pdfjs/
  tests/unit (node) · tests/ui (jsdom) · tests/e2e (Playwright) · tests/fixtures/generate-fixtures.ts
fixtures/pdf/generated/ (no versionado) · fixtures/pdf/corpus/ (versionado) · fixtures/FUENTES.md
```
**Flujo de abrir:** UI → `platform.openFile()` → `OpenedFile` (con `ByteSource`) → `engine/load.ts` (`PDFDataRangeTransport`) → `PDFDocumentProxy` → store (`status: 'ready'`) → `core/layout` con dimensiones supuestas → el visor monta solo las páginas visibles ± 1 → cola de render → lienzos. En segundo plano: escaneo de dimensiones por lotes.
**Flujo de anotar y guardar:** herramienta → comando `Command<AnnotationEdits>` (cambios sobre la línea base importada del fichero) → `UndoStack` → capa SVG de la página (las del fichero sin tocar las pinta pdf.js; las editadas se ocultan del lienzo con `annotationStorage`). Ctrl+S → `diffAnnotations(línea base, cambios)` → `core/pdf/incremental.ts` (lee xref por rangos, construye el delta) → `platform.save(file, { kind: 'append' })` (atómico) → recarga del documento.
**Reglas:** `core/` solo importa `@suite/shared` y tipos; `ui/` no importa `pdfjs-dist` ni `@tauri-apps/*` (lint, [[COM-004-monorepo-para-apps|COM-004]]); textos en `src/ui/messages.ts`; atajos en `src/ui/shortcuts.ts` sobre `ShortcutRegistry`.

## Presupuestos (verificados en [[PDF-022-e2e-y-rendimiento-iteracion-1|PDF-022]] y [[PDF-039-e2e-anotaciones|PDF-039]])
| Medida | Presupuesto |
|---|---|
| Abrir PDF de ≤ 20 páginas hasta ver la página 1 | < 1 s |
| Abrir PDF de 5 000 y de 100 000 páginas hasta ver la página 1 | < 5 s |
| Saltar a la última página (Fin) en 5 000 / 100 000 páginas | página visible en < 1,5 s |
| Lienzos `<canvas>` de página vivos en cualquier momento | ≤ 12 (+ miniaturas visibles) |
| Nodos de página en el DOM | ≤ 12, independiente del total |
| Heap JS tras recorrer 5 000 páginas a saltos | < 400 MB (Chromium, `performance.memory`) |
| Búsqueda en 5 000 páginas | 1.ª coincidencia < 1 s; recorrido completo < 15 s; la UI responde durante la búsqueda |
| Guardar anotaciones en un PDF de 5 000 páginas | < 1 s; el fichero crece < 50 KB por 10 anotaciones |
| Ninguna tarea bloquea el hilo principal | > 100 ms (Long Tasks en e2e) |

## Comandos
- Requisitos del sistema (una vez, Linux): `apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev qpdf` (WebKitGTK solo para compilar Tauri; `qpdf` para validar PDFs escritos).
- Instalar: `pnpm install`
- Lint / typecheck / test / cobertura (raíz): `pnpm lint && pnpm typecheck && pnpm test && pnpm coverage`
- Rendimiento (raíz, [[ADR-0012-suite-de-rendimiento]]): `pnpm perf` — asserts de tiempo de reloj en `apps/lector-pdf/tests/perf/*.perf.test.ts`, sin cobertura y en serie. Nunca `performance.now()` en `tests/unit/` ni `tests/ui/`. Benchmarks informativos: `pnpm exec vitest bench --run`.
- Fixtures: `pnpm --filter lector-pdf fixtures` (los tests los generan solos si faltan)
- Desarrollo web: `pnpm --filter lector-pdf dev` (http://localhost:5173)
- Build web: `pnpm --filter lector-pdf build` · Previsualizar: `pnpm --filter lector-pdf preview`
- E2E (web, Chromium de `/opt/pw-browsers`): `pnpm --filter lector-pdf e2e` (o `pnpm e2e` en la raíz)
- Rust: `cargo fmt --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace --all-features`
- Escritorio (solo en la máquina del usuario): `pnpm --filter lector-pdf tauri dev` · `pnpm --filter lector-pdf tauri build`
- Comprobación completa de una ficha: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm coverage` + lo que pida la ficha (`pnpm perf`, e2e, cargo).

## Tareas
### Iteración 1 · Base común (en [[Apps/Comun/Plan|Comun]])
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-004-monorepo-para-apps]] | Preparar el monorepo para apps | — | pendiente |
| [[COM-005-platform-tipos-y-bytesource]] | @suite/platform: tipos, ByteSource, prefs | COM-004 | pendiente |
| [[COM-006-platform-web-abrir]] | Platform web: abrir, soltar, enlaces, título | COM-005 | pendiente |
| [[COM-007-platform-web-guardar]] | Platform web: guardar y guardar como | COM-006 | pendiente |
| [[COM-008-crate-rust-ficheros]] | Crate Rust: registro y E/S atómica | — | pendiente |
| [[COM-009-comandos-tauri-platform]] | Comandos Tauri de suite-platform | COM-008 | pendiente |
| [[COM-010-platform-tauri]] | Platform Tauri (TS) con mocks | COM-005 | pendiente |
| [[COM-011-registro-de-atajos]] | Registro de atajos | COM-004 | pendiente |

### Iteración 1 · Lector PDF
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[PDF-001-esqueleto-app]] | Esqueleto de la app lector-pdf | COM-004 | pendiente |
| [[PDF-002-fixtures-paginas]] | Generador de fixtures: páginas, tamaños y dañados | PDF-001 | pendiente |
| [[PDF-003-fixtures-estructura]] | Generador de fixtures: índice, enlaces, etiquetas, xref comprimido, anotaciones, formulario | PDF-002 | pendiente |
| [[PDF-004-corpus-publico]] | Corpus público (veraPDF) y de LibreOffice | PDF-005 | pendiente |
| [[PDF-005-motor-carga-por-rangos]] | Motor: carga por rangos y errores | PDF-002, COM-005 | pendiente |
| [[PDF-006-layout-virtual]] | Núcleo: dimensiones y layout virtual | PDF-001 | cambios-pedidos (replanificada, [[ADR-0012-suite-de-rendimiento]]) |
| [[PDF-007-zoom-y-cola-de-render]] | Núcleo: zoom, cola de render y tamaño de lienzo | PDF-001 | pendiente |
| [[PDF-008-abrir-documento]] | Abrir documento en la app | PDF-005, PDF-006, COM-006, COM-011 | pendiente |
| [[PDF-009-visor-virtualizado]] | Visor virtualizado (marcos y scroll) | PDF-008, PDF-007 | pendiente |
| [[PDF-010-render-de-paginas]] | Render de páginas en lienzos | PDF-009 | pendiente |
| [[PDF-011-zoom-y-rotacion-ui]] | Zoom y rotación de vista en la interfaz | PDF-010 | pendiente |
| [[PDF-012-ir-a-pagina]] | Ir a página y navegación | PDF-011, PDF-003 | pendiente |
| [[PDF-013-capa-de-texto]] | Capa de texto: seleccionar y copiar; herramienta mano | PDF-011, PDF-004 | pendiente |
| [[PDF-014-enlaces]] | Enlaces, destinos e historial | PDF-012, PDF-003 | pendiente |
| [[PDF-015-panel-lateral-miniaturas]] | Panel lateral y miniaturas | PDF-012 | pendiente |
| [[PDF-016-indice-marcadores]] | Índice (marcadores) | PDF-015, PDF-014 | pendiente |
| [[PDF-017-busqueda-nucleo]] | Núcleo de búsqueda incremental | PDF-005 | pendiente |
| [[PDF-018-busqueda-ui]] | Búsqueda en la interfaz | PDF-017, PDF-013 | pendiente |
| [[PDF-019-recordar-posicion]] | Recordar última página y zoom | PDF-012 | pendiente |
| [[PDF-020-tema-y-modo-noche]] | Tema claro/oscuro y modo noche | PDF-015 | pendiente |
| [[PDF-021-app-tauri]] | App de escritorio Tauri | PDF-008, COM-009, COM-010 | pendiente |
| [[PDF-022-e2e-y-rendimiento-iteracion-1]] | E2E y presupuestos de la iteración 1 | PDF-004, PDF-011, PDF-012, PDF-013, PDF-014, PDF-016, PDF-018, PDF-019, PDF-020, PDF-021 | pendiente |

Paralelo desde el inicio: COM-004 y COM-008. Tras COM-004: COM-005, COM-011, PDF-001. Tras PDF-001: PDF-002, PDF-006, PDF-007, PDF-023 (la iteración 2 puede adelantar su núcleo puro sin esperar a la UI). Tras COM-005: COM-006, COM-010, COM-012.

### Iteración 2 · Anotaciones
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-012-almacen-de-borradores]] | Almacén de borradores (IndexedDB) | COM-005 | pendiente |
| [[COM-013-cerrar-ventana]] | `Platform.closeWindow()` | COM-007, COM-010 | pendiente |
| [[PDF-023-modelo-anotaciones]] | Modelo de anotaciones, comandos y fechas PDF | PDF-001 | pendiente |
| [[PDF-024-importar-anotaciones]] | Importar anotaciones existentes | PDF-023, PDF-005, PDF-003 | pendiente |
| [[PDF-025-objetos-pdf]] | Léxico, analizador y serializador de objetos PDF | PDF-023 | pendiente |
| [[PDF-026-lector-xref]] | Lector de xref y objetos por rangos | PDF-025, PDF-003 | pendiente |
| [[PDF-027-apariencias]] | Apariencias /AP de anotaciones | PDF-023, PDF-026 | pendiente |
| [[PDF-028-escritor-incremental]] | Escritor incremental de anotaciones | PDF-026, PDF-027, PDF-024 | pendiente |
| [[PDF-029-interoperabilidad-anotaciones]] | Interoperabilidad (qpdf, pdf.js, corpus) | PDF-028, PDF-004 | pendiente |
| [[PDF-030-estado-de-anotaciones]] | Estado de anotaciones, deshacer/rehacer y barra «Comentar» | PDF-023, PDF-024, PDF-009, COM-011 | pendiente |
| [[PDF-031-capa-de-anotaciones]] | Capa de anotaciones: dibujar, seleccionar, mover, borrar | PDF-030 | pendiente |
| [[PDF-032-resaltar-subrayar-tachar]] | Resaltar, subrayar y tachar | PDF-031, PDF-013 | pendiente |
| [[PDF-033-notas-emergentes]] | Notas emergentes y comentarios | PDF-031 | pendiente |
| [[PDF-034-texto-libre]] | Texto libre | PDF-031 | pendiente |
| [[PDF-035-dibujo-a-mano]] | Dibujo a mano | PDF-031 | pendiente |
| [[PDF-036-panel-de-comentarios]] | Panel de comentarios | PDF-031, PDF-015 | pendiente |
| [[PDF-037-guardar-anotaciones]] | Guardar y guardar como dentro del PDF; aviso de cambios | PDF-028, PDF-030, PDF-019, COM-007, COM-010, COM-013 | pendiente |
| [[PDF-038-recuperar-anotaciones]] | Recuperar anotaciones tras cierre inesperado | PDF-037, COM-012 | pendiente |
| [[PDF-039-e2e-anotaciones]] | E2E y rendimiento de anotaciones | PDF-029, PDF-032, PDF-033, PDF-034, PDF-035, PDF-036, PDF-038 | pendiente |

Cadena del formato (puede avanzar en paralelo a la iteración 1): PDF-023 → PDF-025 → PDF-026 → PDF-027 → PDF-028 → PDF-029. Tras PDF-031: PDF-032 a PDF-036 en paralelo.

### Iteraciones 3-6 (fichas por detallar)
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[PDF-040-formularios-adr]] | ADR y prueba: formularios AcroForm | PDF-039 | pendiente |
| [[PDF-041-rellenar-formularios]] | Rellenar formularios | PDF-040 | pendiente |
| [[PDF-042-guardar-formularios]] | Guardar formularios con apariencias | PDF-041, PDF-028 | pendiente |
| [[PDF-043-firma-visual]] | Firma visual (dibujar, escribir, imagen) | PDF-039 | pendiente |
| [[PDF-044-imprimir]] | Imprimir | PDF-039 | pendiente |
| [[PDF-045-propiedades]] | Propiedades del documento | PDF-022 | pendiente |
| [[PDF-046-abrir-con-contrasena]] | Abrir PDF con contraseña | PDF-022 | pendiente |
| [[PDF-047-anotar-pdf-cifrado]] | Guardar anotaciones en PDF cifrado | PDF-046, PDF-037 | pendiente |
| [[PDF-048-permisos]] | Respetar permisos del documento | PDF-046 | pendiente |
| [[PDF-049-recientes-y-pestanas]] | Recientes y pestañas | PDF-022 | pendiente |
| [[PDF-050-modos-de-pagina]] | Modos de página y pantalla completa | PDF-022 | pendiente |
| [[PDF-051-lienzo-de-detalle]] | Lienzo de detalle (zoom hasta 6 400 %) | PDF-022 | pendiente |
| [[PDF-052-organizar-adr]] | ADR y prueba: reescribir PDFs (organizar, reparar xref) | PDF-039 | pendiente |
| [[PDF-053-organizar-paginas]] | Girar, borrar y reordenar páginas | PDF-052 | pendiente |
| [[PDF-054-extraer-dividir]] | Extraer y dividir | PDF-053 | pendiente |
| [[PDF-055-insertar-combinar]] | Insertar páginas y combinar PDFs | PDF-053 | pendiente |
| [[PDF-056-pdf-desde-imagenes]] | Crear PDF desde imágenes | PDF-052 | pendiente |
| [[PDF-057-formas-y-sellos]] | Formas y sellos | PDF-039 | pendiente |
| [[PDF-058-respuestas-xfdf]] | Respuestas, estado y XFDF | PDF-036 | pendiente |
| [[PDF-059-anadir-texto-imagen]] | Añadir texto e imagen a la página | PDF-052 | pendiente |
| [[PDF-060-proteger]] | Proteger con contraseña y permisos | PDF-052, PDF-047 | pendiente |
| [[PDF-061-ocr]] | OCR (investigación de motor local) | PDF-052 | pendiente |
| [[PDF-062-redactar]] | Redacción real | PDF-052 | pendiente |
| [[PDF-063-comparar]] | Comparar dos PDFs | PDF-022 | pendiente |
| [[PDF-064-exportar]] | Exportar a imagen y texto | PDF-022 | pendiente |
| [[PDF-065-editar-texto]] | Editar texto existente (investigación) | PDF-052 | pendiente |
| [[PDF-066-firma-digital]] | Firma digital con certificado | PDF-043, PDF-052 | pendiente |
| [[PDF-067-leer-en-voz-alta]] | Leer en voz alta | PDF-022 | pendiente |

## Historial de iteraciones
- 2026-10-17: plan creado. Iteraciones 1 y 2 detalladas; 3-6 con fichas de título y dependencias.

## Mejoras conocidas (no planificadas)
- Texto libre con caracteres no latinos: incrustar una fuente en la apariencia.
- Deshacer después de guardar (hoy el historial se vacía al recargar).
- Formularios: con `ENABLE_STORAGE` los widgets se pintan en el lienzo; la it. 3 decidirá cómo combinarlo con la capa HTML de formularios (ver [[PDF-040-formularios-adr]]).
