---
tipo: plan
app: pdf
estado: en-curso
iteracion: 3
creado: 2026-10-17
actualizado: 2026-10-18
tags: [plan, pdf]
---

# Plan · Lector PDF

Investigación: [[Paridad Adobe Acrobat]] · [[Librerias y arquitectura PDF]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0008-plataforma-ficheros]] · [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0010-stack-apps-web-y-pruebas]] · [[ADR-0011-documentos-de-prueba-pdf]] · [[ADR-0014-localizar-paginas-por-count]] · [[ADR-0015-modo-noche-por-pixeles]] · [[ADR-0016-e2e-long-tasks-en-serie]] · [[ADR-0017-carga-diferida-de-pdfjs]] · [[ADR-0018-vista-previa-del-trazo-en-canvas]] · [[ADR-0019-formularios-acroform]] · [[ADR-0020-firma-visual]] · [[ADR-0021-impresion]] · [[ADR-0022-pdf-cifrados]] · [[ADR-0023-pestanas-y-recientes]] · [[ADR-0024-modos-de-pagina]] · [[ADR-0025-lienzo-de-detalle]] · Base común: [[Apps/Comun/Plan|Plan de Comun]] · Manual: [[Apps/Lector PDF/Manual|Manual]]

## Objetivo
Sustituir a Adobe Acrobat Reader (y a lo más usado de Acrobat Pro) para uso personal, en escritorio (Tauri) y navegador.
Petición literal del usuario: *"Desarrolla el lector de pdf, quiero que tenga las mismas funciones que adobe acrobat reader premium y que funcione de manera correcta, sin importar cuantas paginas tenga el pdf. se debe poder subrayar y hacer notas"*.
Interpretación ("Reader premium" no existe como producto, ver [[Paridad Adobe Acrobat]]): todo lo de Reader + funciones de pago de Acrobat Pro, por orden de prioridad de la nota de paridad. Requisitos transversales: mismo comportamiento con 5 o 100 000 páginas; anotar siempre (aunque el PDF no habilite comentarios); todo se guarda dentro del PDF como anotaciones estándar.

## Iteraciones
| # | Nombre | Qué deja usable | Estado |
|---|---|---|---|
| 1 | Visor robusto | Abrir (web y escritorio), leer cualquier PDF de cualquier tamaño, miniaturas, índice, buscar, zoom, girar vista, ir a página, copiar texto, enlaces, recordar página, tema oscuro | cerrada (2026-10-18) |
| 2 | Anotaciones | Resaltar, subrayar, tachar, notas, texto libre, dibujo, panel de comentarios, deshacer/rehacer, guardar dentro del PDF y recuperar tras cierre inesperado | cerrada (2026-10-18) |
| 3 | Formularios, firma e impresión | Rellenar y guardar AcroForm, firma visual, imprimir, propiedades y fuentes | detallada, en curso |
| 4 | Contraseñas y comodidad | Abrir con contraseña, anotar PDFs cifrados, permisos, recientes, pestañas, doble página, pantalla completa, zoom alto nítido | detallada |
| 5 | Organizar páginas | Girar, borrar, reordenar, extraer, dividir, insertar, combinar, crear desde imágenes | fichas creadas (a detallar) |
| 6 | Funciones Pro | Formas y sellos, respuestas y XFDF, añadir texto/imagen, proteger, OCR, redactar, comparar, exportar, editar texto, firma digital, leer en voz alta | fichas creadas (a detallar) |

Las fichas de las iteraciones 5-6 tienen título, dependencias y objetivo; el líder las detalla (y escribe sus ADR) al cerrar la iteración 4.

## Alcance de la iteración 1 · Visor robusto
**Entra:** base común ([[COM-004-monorepo-para-apps|COM-004]] a [[COM-011-registro-de-atajos|COM-011]], salvo COM-012 y COM-013, que son de la iteración 2); abrir con botón, Ctrl+O, arrastrar, "Abrir con" del SO (Tauri); lectura por rangos; visor virtualizado igual con 5, 5 000 o 100 000 páginas; miniaturas; índice; búsqueda incremental con resaltado y opciones (mayúsculas, palabra completa, tildes); zoom (pasos, %, ajustar ancho/página, tamaño real, Ctrl+rueda); rotación de vista; ir a página (con etiquetas de página); selección y copia de texto; herramienta mano; enlaces internos y externos (con confirmación) y atrás/adelante; recordar última página y zoom; tema claro/oscuro/sistema y modo noche de páginas; estados vacío/carga/error en español; app de escritorio Tauri (asociación .pdf, instancia única); fixtures generados + corpus público; E2E y presupuestos de rendimiento.
**No entra:** anotaciones (it. 2), contraseñas (muestra mensaje claro; it. 4), imprimir (it. 3), formularios interactivos (se ven, no se rellenan; it. 3), doble página/pantalla completa (it. 4), recientes y pestañas (it. 4), lienzo de detalle con zoom > 800 % (it. 4), capas OCG, adjuntos, XFA, JavaScript, multimedia/3D (nunca se ejecuta JS del PDF).

## Alcance de la iteración 2 · Anotaciones
**Entra:** modelo de anotaciones con deshacer/rehacer (Ctrl+Z, Ctrl+Y, Ctrl+Mayús+Z); resaltar, subrayar y tachar texto seleccionado (colores); nota adhesiva y comentario sobre un marcado; texto libre; dibujo a mano; seleccionar, mover (notas, texto libre y dibujos), cambiar color, editar texto y borrar (Supr); panel de comentarios; leer las anotaciones existentes de otros programas (y editarlas si son de los tipos soportados); guardar (Ctrl+S) y guardar como (Ctrl+Mayús+S) **dentro del PDF** por actualización incremental atómica; aviso al cerrar con cambios; recuperación de anotaciones tras cierre inesperado; verificación con pdf.js y qpdf y lista de comprobación manual en Adobe Reader.
**No entra:** formas y sellos, respuestas y estados de comentarios, XFDF (it. 6); anotar PDFs cifrados (it. 4, [[PDF-047-anotar-pdf-cifrado|PDF-047]]); mover/redimensionar marcados de texto; fuente incrustada en texto libre (no latino); deshacer después de guardar (el historial se vacía al guardar).

## Alcance de la iteración 3 · Formularios, firma e impresión
**Entra:** documento de prueba `form-full.pdf` con todos los tipos de campo; rellenar texto (una línea, multilínea, peine, contraseña, longitud máxima), casillas, botones de opción, combos (editables o no) y listas (selección múltiple), con Tab entre campos y páginas, resaltado de campos, deshacer/rehacer y recuperación junto a las anotaciones ([[ADR-0019-formularios-acroform]]); guardar `/V`, `/AS` y `/AP` por actualización incremental; firma visual dibujada, escrita (Dancing Script) o de imagen, con hasta 5 firmas guardadas, colocar/mover/redimensionar, guardada como `Stamp` ([[ADR-0020-firma-visual]]); imprimir (Ctrl+P) con rango, comentarios sí/no, calidad 150/300 ppp, progreso cancelable, incluyendo los cambios sin guardar ([[ADR-0021-impresion]]); propiedades del documento (Ctrl+D) con pestaña de fuentes; menú «Más acciones»; quitar las esperas fijas de los E2E.
**No entra:** firma digital con certificado (it. 6); crear o editar campos; JavaScript de formularios (cálculos, validaciones, formato: nunca se ejecuta JS del PDF); XFA; enviar formularios; importar/exportar FDF; fuentes no latinas en campos (ver «Mejoras conocidas»).

## Alcance de la iteración 4 · Contraseñas y comodidad
**Entra:** abrir PDFs con contraseña de usuario o propietario (RC4 40/128, AES-128, AES-256), contraseña solo en memoria; guardar anotaciones, firmas y formularios en PDFs cifrados manteniendo el cifrado ([[ADR-0022-pdf-cifrados]]); respetar las restricciones de copiar e imprimir, avisando (sin bloquear) al anotar o rellenar; documentos recientes (pantalla de inicio y menú) en web y escritorio; pestañas con varios documentos a la vez (máx. 10) ([[ADR-0023-pestanas-y-recientes]]); doble página (pares y con portada), una página a la vez, pantalla completa (Ctrl+L) ([[ADR-0024-modos-de-pagina]]); zoom hasta 6 400 % con lienzo de detalle nítido ([[ADR-0025-lienzo-de-detalle]]).
**No entra:** poner, cambiar o quitar contraseñas y permisos (PDF-060, it. 6); cifrado por certificado (`/Filter` distinto de `Standard`); recordar contraseñas; desplazamiento horizontal; arrastrar pestañas o varias ventanas; restaurar pestañas al reiniciar.

## Arquitectura
```
packages/shared/      Result, logger, UndoStack, registro de atajos (COM)
packages/platform/    @suite/platform: Platform, ByteSource, prefs, borradores; web/ y tauri/
packages/platform/rust/  crate suite-platform: registro de rutas, E/S atómica, comandos Tauri
apps/lector-pdf/
  src/main.tsx        arranque: worker de pdf.js, loadPlatform, render de <App/>
  src/core/           lógica pura (sin React, sin pdfjs, sin Node): layout, zoom, cola de render,
                      búsqueda, destinos, enlaces, posiciones, anotaciones, pdf/ (lexer, xref, escritor,
                      image, fonts, concat-source, crypto/), forms/ (it. 3), signature/ (it. 3),
                      print/ (it. 3), permissions, properties, view-mode, detail (it. 4)
  src/engine/         ÚNICO sitio que importa pdfjs-dist: carga por rangos, render, texto, enlaces,
                      índice, dimensiones, importar anotaciones
  src/state/          stores zustand: viewer, search, annotations (puente con UndoStack), forms, print,
                      signatures, recent, tabs (suspender/reanudar por módulo, it. 4), fullscreen
  src/ui/             componentes React: shell, toolbar, viewer/, sidebar/, search/, annotations/, kit/,
                      print/, signature/, properties/, security/, tabs/ (it. 3-4)
  src-tauri/          app de escritorio (usa suite-platform con feature tauri)
  scripts/copy-pdfjs-assets.mjs   copia cmaps, fuentes estándar, wasm e icc a public/pdfjs/
  tests/unit (node) · tests/ui (jsdom) · tests/e2e (Playwright) · tests/fixtures/generate-fixtures.ts
fixtures/pdf/generated/ (no versionado) · fixtures/pdf/corpus/ (versionado) · fixtures/FUENTES.md
```
**Flujo de abrir:** UI → `platform.openFile()` → `OpenedFile` (con `ByteSource`) → `engine/load.ts` (`PDFDataRangeTransport`) → `PDFDocumentProxy` → store (`status: 'ready'`) → `core/layout` con dimensiones supuestas → el visor monta solo las páginas visibles ± 1 → cola de render → lienzos. En segundo plano: escaneo de dimensiones por lotes.
**Flujo de anotar y guardar:** herramienta → comando `Command<AnnotationEdits>` (cambios sobre la línea base importada del fichero) → `UndoStack` → capa SVG de la página (las del fichero sin tocar las pinta pdf.js; las editadas se ocultan del lienzo con `annotationStorage`). Ctrl+S → `diffAnnotations(línea base, cambios)` → `core/pdf/incremental.ts` (lee xref por rangos, construye el delta) → `platform.save(file, { kind: 'append' })` (atómico) → recarga del documento.
**Reglas:** `core/` solo importa `@suite/shared` y tipos; `ui/` no importa `pdfjs-dist` ni `@tauri-apps/*` (lint, [[COM-004-monorepo-para-apps|COM-004]]); textos en `src/ui/messages.ts` y, desde la it. 3, uno por función en `src/ui/messages-<funcion>.ts` (`formMsg`, `printMsg`, `signatureMsg`, `propertiesMsg`, `securityMsg`, `tabsMsg`, `viewMsg`) para que las fichas en paralelo no choquen; atajos en `src/ui/shortcuts.ts` sobre `ShortcutRegistry`.
**Valores de formulario:** van en `AnnotationEdits.fields` (mismo historial, borrador y guardado que las anotaciones); el lienzo de pdf.js los pinta con `annotationStorage` y la capa `FormLayer` pone los controles HTML encima ([[ADR-0019-formularios-acroform]]).
**Pestañas (it. 4):** todo módulo de `state/` con estado de documento registra un `TabParticipant` (`suspend`/`resume`/`dispose`) en `state/tabs.ts`; las suscripciones que reaccionan a «documento nuevo» comprueban `isSwitchingTab()` ([[ADR-0023-pestanas-y-recientes]]). Quien añada estado de documento a `state/` debe añadirlo a su instantánea.

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
| Guardar formularios en `form-full.pdf` · imprimir 20 páginas de 5 000 (it. 3, [[PDF-090-e2e-iteracion-3|PDF-090]]) | < 1 s · < 20 s sin *long tasks* |
| Cambiar de pestaña hasta pintar la página (3 × 1 000 páginas, it. 4) | ≤ 500 ms (p95); heap estable (+50 MB máx. tras 20 cambios) |
| Lienzos con zoom alto (it. 4) | ≤ 12 base + 1 de detalle por página visible; ≤ 300 MB de lienzos |
| JavaScript estático del arranque (pdf.js diferido, [[ADR-0017-carga-diferida-de-pdfjs]]) | ≤ 500 000 bytes (`bundle:check`, vigente con [[PDF-075-pdfjs-diferido]]) |

## Comandos
- Requisitos del sistema (una vez, Linux): `apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev qpdf` (WebKitGTK solo para compilar Tauri; `qpdf` para validar PDFs escritos).
- Instalar: `pnpm install`
- Lint / typecheck / test / cobertura (raíz): `pnpm lint && pnpm typecheck && pnpm coverage` (`pnpm coverage` ya ejecuta todos los tests: no hace falta `pnpm test` antes; [[ADR-0026-ahorro-de-tokens]])
- Rendimiento (raíz, [[ADR-0012-suite-de-rendimiento]]): `pnpm perf` — asserts de tiempo de reloj en `apps/lector-pdf/tests/perf/*.perf.test.ts`, sin cobertura y en serie. Nunca `performance.now()` en `tests/unit/` ni `tests/ui/`. Benchmarks informativos: `pnpm exec vitest bench --run`.
- Fixtures: `pnpm --filter lector-pdf fixtures` (los tests los generan solos si faltan)
- Desarrollo web: `pnpm --filter lector-pdf dev` (http://localhost:5173)
- Build web: `pnpm --filter lector-pdf build` · Previsualizar: `pnpm --filter lector-pdf preview` · Presupuesto del arranque tras el build: `pnpm --filter lector-pdf bundle:check` ([[PDF-074-presupuesto-bundle-arranque]]; desde [[PDF-075-pdfjs-diferido]] lo ejecuta `build`)
- E2E (web, Chromium de `/opt/pw-browsers`): `pnpm --filter lector-pdf e2e` (o `pnpm e2e` en la raíz). Las pruebas de *long tasks* llevan `{ tag: '@perf' }` y corren en el proyecto `chromium-perf` (en serie, tras el resto; [[ADR-0016-e2e-long-tasks-en-serie]]). Cada prueba `@perf` espera antes de empezar a que la CPU real esté en reposo (< 15 % en 3 s seguidos, máximo 150 s; si no, falla con «La máquina no está en reposo…»; [[PDF-078-reposo-cpu-antes-de-perf]], revisión 2 de ADR-0016); no lanzar otros `playwright`/`vitest`/`vite build` mientras se mide. `--repeat-each` no repite proyectos de dependencia: repetir con `e2e --project=chromium --repeat-each=N` y `e2e --project=chromium-perf --no-deps --repeat-each=N` (revisión de ADR-0016).
- Rust: `cargo fmt --check && cargo clippy --workspace --all-targets --all-features -- -D warnings && cargo test --workspace --all-features`
- Escritorio (solo en la máquina del usuario): `pnpm --filter lector-pdf tauri dev` · `pnpm --filter lector-pdf tauri build`
- Comprobación completa de una ficha: `pnpm install && pnpm lint && pnpm typecheck && pnpm coverage` (`pnpm coverage` ya ejecuta todos los tests: no hace falta `pnpm test` antes; [[ADR-0026-ahorro-de-tokens]]) + lo que pida la ficha (`pnpm perf`, e2e, cargo).

## Tareas
### Iteración 1 · Base común (en [[Apps/Comun/Plan|Comun]]) · cerrada
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-004-monorepo-para-apps]] | Preparar el monorepo para apps | — | hecha |
| [[COM-005-platform-tipos-y-bytesource]] | @suite/platform: tipos, ByteSource, prefs | COM-004 | hecha |
| [[COM-006-platform-web-abrir]] | Platform web: abrir, soltar, enlaces, título | COM-005 | hecha |
| [[COM-007-platform-web-guardar]] | Platform web: guardar y guardar como | COM-006 | hecha |
| [[COM-008-crate-rust-ficheros]] | Crate Rust: registro y E/S atómica | — | hecha |
| [[COM-009-comandos-tauri-platform]] | Comandos Tauri de suite-platform | COM-008 | hecha |
| [[COM-010-platform-tauri]] | Platform Tauri (TS) con mocks | COM-005 | hecha |
| [[COM-011-registro-de-atajos]] | Registro de atajos | COM-004 | hecha |

### Iteración 1 · Lector PDF · cerrada
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[PDF-001-esqueleto-app]] | Esqueleto de la app lector-pdf | COM-004 | hecha |
| [[PDF-002-fixtures-paginas]] | Generador de fixtures: páginas, tamaños y dañados | PDF-001 | hecha |
| [[PDF-003-fixtures-estructura]] | Generador de fixtures: índice, enlaces, etiquetas, xref comprimido, anotaciones, formulario | PDF-002 | hecha |
| [[PDF-004-corpus-publico]] | Corpus público (veraPDF) y de LibreOffice | PDF-005 | hecha |
| [[PDF-005-motor-carga-por-rangos]] | Motor: carga por rangos y errores | PDF-002, COM-005 | hecha |
| [[PDF-006-layout-virtual]] | Núcleo: dimensiones y layout virtual | PDF-001 | hecha |
| [[PDF-007-zoom-y-cola-de-render]] | Núcleo: zoom, cola de render y tamaño de lienzo | PDF-001 | hecha |
| [[PDF-008-abrir-documento]] | Abrir documento en la app | PDF-005, PDF-006, COM-006, COM-011 | hecha |
| [[PDF-009-visor-virtualizado]] | Visor virtualizado (marcos y scroll) | PDF-008, PDF-007 | hecha |
| [[PDF-010-render-de-paginas]] | Render de páginas en lienzos | PDF-009 | hecha |
| [[PDF-011-zoom-y-rotacion-ui]] | Zoom y rotación de vista en la interfaz | PDF-010 | hecha |
| [[PDF-012-ir-a-pagina]] | Ir a página y navegación | PDF-011, PDF-003 | hecha |
| [[PDF-013-capa-de-texto]] | Capa de texto: seleccionar y copiar; herramienta mano | PDF-011, PDF-004 | hecha |
| [[PDF-014-enlaces]] | Enlaces, destinos e historial | PDF-012, PDF-003 | hecha |
| [[PDF-015-panel-lateral-miniaturas]] | Panel lateral y miniaturas | PDF-012 | hecha |
| [[PDF-016-indice-marcadores]] | Índice (marcadores) | PDF-015, PDF-014 | hecha |
| [[PDF-017-busqueda-nucleo]] | Núcleo de búsqueda incremental | PDF-005 | hecha |
| [[PDF-018-busqueda-ui]] | Búsqueda en la interfaz | PDF-017, PDF-013 | hecha |
| [[PDF-019-recordar-posicion]] | Recordar última página y zoom | PDF-012 | hecha |
| [[PDF-020-tema-y-modo-noche]] | Tema claro/oscuro y modo noche | PDF-015 | hecha |
| [[PDF-021-app-tauri]] | App de escritorio Tauri | PDF-008, COM-009, COM-010 | hecha |
| [[PDF-022-e2e-y-rendimiento-iteracion-1]] | E2E y presupuestos de la iteración 1 | PDF-004, PDF-011, PDF-012, PDF-013, PDF-014, PDF-016, PDF-018, PDF-019, PDF-020, PDF-021 | hecha |

Paralelo desde el inicio: COM-004 y COM-008. Tras COM-004: COM-005, COM-011, PDF-001. Tras PDF-001: PDF-002, PDF-006, PDF-007, PDF-023 (la iteración 2 puede adelantar su núcleo puro sin esperar a la UI). Tras COM-005: COM-006, COM-010, COM-012.

### Iteración 2 · Anotaciones · cerrada
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-012-almacen-de-borradores]] | Almacén de borradores (IndexedDB) | COM-005 | hecha |
| [[COM-013-cerrar-ventana]] | `Platform.closeWindow()` | COM-007, COM-010 | hecha |
| [[PDF-023-modelo-anotaciones]] | Modelo de anotaciones, comandos y fechas PDF | PDF-001 | hecha |
| [[PDF-024-importar-anotaciones]] | Importar anotaciones existentes | PDF-023, PDF-005, PDF-003 | hecha |
| [[PDF-025-objetos-pdf]] | Léxico, analizador y serializador de objetos PDF | PDF-023 | hecha |
| [[PDF-026-lector-xref]] | Lector de xref y filtros (partida, ver [[ADR-0014-localizar-paginas-por-count]]) | PDF-025, PDF-003 | hecha |
| [[PDF-068-lector-objetos]] | Lector de objetos por rangos y `pageRef` por `/Count` | PDF-026 | hecha |
| [[PDF-027-apariencias]] | Apariencias /AP de anotaciones | PDF-023, PDF-026 | hecha |
| [[PDF-028-escritor-incremental]] | Escritor incremental de anotaciones | PDF-068, PDF-027, PDF-024 | hecha |
| [[PDF-029-interoperabilidad-anotaciones]] | Interoperabilidad (qpdf, pdf.js, corpus) | PDF-028, PDF-004 | hecha |
| [[PDF-030-estado-de-anotaciones]] | Estado de anotaciones, deshacer/rehacer y atajos (UI movida a PDF-069 y PDF-031) | PDF-023, PDF-024, PDF-009, COM-011 | hecha |
| [[PDF-069-barra-comentar]] | Barra «Comentar» y deshacer/rehacer en la barra principal | PDF-030, PDF-011, PDF-020 | hecha |
| [[PDF-031-capa-de-anotaciones]] | Capa de anotaciones: dibujar, seleccionar, mover, borrar; cursor por herramienta; importación perezosa | PDF-030, PDF-010, PDF-011, PDF-013 | hecha |
| [[PDF-032-resaltar-subrayar-tachar]] | Resaltar, subrayar y tachar | PDF-031, PDF-013, PDF-069 | hecha |
| [[PDF-033-notas-emergentes]] | Notas emergentes y comentarios | PDF-031, PDF-069 | hecha |
| [[PDF-034-texto-libre]] | Texto libre | PDF-031, PDF-069 | hecha |
| [[PDF-035-dibujo-a-mano]] | Dibujo a mano | PDF-031, PDF-069 | hecha |
| [[PDF-036-panel-de-comentarios]] | Panel de comentarios | PDF-031, PDF-015 | hecha |
| [[PDF-037-guardar-anotaciones]] | Guardar y guardar como dentro del PDF; aviso de cambios | PDF-028, PDF-030, PDF-019, COM-007, COM-010, COM-013 | hecha |
| [[PDF-038-recuperar-anotaciones]] | Recuperar anotaciones tras cierre inesperado | PDF-037, COM-012 | hecha |
| [[PDF-070-panel-comentarios-accesible]] | Panel de comentarios accesible (nombre visible, Borrar fuera de la fila, Supr) | PDF-036 | hecha |
| [[PDF-071-barra-comentar-flechas]] | ←/→/Inicio/Fin de la barra «Comentar» sin cambiar de página (test rojo previo) | PDF-069 | hecha |
| [[PDF-072-nota-con-teclado]] | Colocar una nota solo con teclado | PDF-033, PDF-070, PDF-071 | hecha |
| [[PDF-074-presupuesto-bundle-arranque]] | Comprobar tras el build el presupuesto del JavaScript de arranque (rojo previo) | — | hecha |
| [[PDF-075-pdfjs-diferido]] | Cargar pdf.js con `import()` diferido (arranque sin tarea de ~100 ms) | PDF-074 | hecha |
| [[PDF-076-vista-previa-trazo-canvas]] | Vista previa del trazo incremental en canvas temporal (test rojo previo) | — | hecha |
| [[PDF-077-diagnostico-long-tasks]] | Diagnóstico de long tasks y carga de CPU en las pruebas @perf | — | hecha |
| [[PDF-078-reposo-cpu-antes-de-perf]] | Puerta de reposo de CPU antes de cada prueba @perf y CPU real en el diagnóstico | — | hecha |
| [[PDF-073-e2e-long-tasks-en-serie]] | Pruebas e2e de long tasks en un proyecto Playwright en serie (config hecha; queda verificar) | PDF-075, PDF-076, PDF-077, PDF-078 | hecha |
| [[PDF-039-e2e-anotaciones]] | E2E y rendimiento de anotaciones | PDF-029, PDF-032, PDF-033, PDF-034, PDF-035, PDF-036, PDF-038, PDF-069, PDF-070, PDF-071, PDF-072, PDF-073 | hecha |

Cadena del formato (puede avanzar en paralelo a la iteración 1): PDF-023 → PDF-025 → PDF-026 → (PDF-027 ∥ PDF-068) → PDF-028 → PDF-029. PDF-031 y PDF-069 en paralelo (ambas tras PDF-030; PDF-031 tras PDF-013, PDF-069 tras PDF-020). Tras PDF-031 y PDF-069: PDF-032 a PDF-035 en paralelo; PDF-036 solo necesita PDF-031 y PDF-015. Correcciones de accesibilidad y teclado salidas de PDF-039: PDF-070 ∥ PDF-071 → PDF-072 (tras ambas) → PDF-039. Estabilidad de las medidas de long tasks: (PDF-074 → PDF-075) ∥ PDF-076 ∥ PDF-077 → PDF-078 → PDF-073 (verificación) → PDF-039.

### Iteración 3 · Formularios, firma e impresión
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-014-imprimir-desde-la-plataforma]] | Platform.print() - imprimir la ventana en web y en Tauri | — | pendiente |
| [[PDF-040-formularios-adr]] | Generar el documento de prueba de formularios completo (form-full.pdf) | — | pendiente |
| [[PDF-079-formularios-modelo-e-importacion]] | Núcleo de formularios - modelo de campos e importación desde pdf.js | PDF-040 | pendiente |
| [[PDF-080-valores-de-campo-en-el-historial]] | Valores de campo en el historial común y en los borradores | PDF-079 | pendiente |
| [[PDF-081-estado-de-formularios]] | Estado de formularios y sincronización con el lienzo de pdf.js | PDF-080 | pendiente |
| [[PDF-082-apariencias-de-campos]] | Apariencias /AP de campos de texto, combo y lista | PDF-079 | pendiente |
| [[PDF-041-rellenar-formularios]] | Rellenar campos de texto, combos y listas en pantalla | PDF-081 | pendiente |
| [[PDF-042-guardar-formularios]] | Guardar formularios dentro del PDF (/V, /AS y /AP) por actualización incremental | PDF-081, PDF-082, PDF-087 | pendiente |
| [[PDF-083-casillas-opciones-y-tabulacion]] | Casillas, botones de opción, tabulación entre páginas y E2E de formularios | PDF-041, PDF-042 | pendiente |
| [[PDF-084-objetos-de-imagen-pdf]] | Objetos de imagen PDF desde RGBA y JPEG | — | pendiente |
| [[PDF-085-anotacion-de-firma]] | Anotación de firma - modelo, apariencia, escritura y dibujo en la capa | PDF-084, PDF-080 | pendiente |
| [[PDF-086-crear-firma]] | Crear firma (dibujar, escribir o imagen) y firmas guardadas | PDF-085 | pendiente |
| [[PDF-043-firma-visual]] | Firmar - colocar, mover y redimensionar la firma en la página | PDF-086 | pendiente |
| [[PDF-087-nucleo-de-impresion]] | Núcleo de impresión - rangos, plan de hoja y documento temporal con el incremento | — | pendiente |
| [[PDF-045-propiedades]] | Propiedades del documento (Ctrl+D) y menú «Más acciones» | — | pendiente |
| [[PDF-088-fuentes-del-documento]] | Propiedades - pestaña «Fuentes» con escaneo progresivo y cancelable | PDF-045 | cambios-pedidos |
| [[PDF-044-imprimir]] | Imprimir (Ctrl+P) con rango, comentarios, calidad y progreso cancelable | PDF-087, PDF-045, COM-014 | pendiente |
| [[PDF-089-esperas-fijas-e2e]] | Quitar las esperas fijas de las pruebas e2e y prohibirlas con ESLint | — | hecha |
| [[PDF-103-etiqueta-firma-al-reabrir]] | Etiqueta «Firma» para sellos de la suite - núcleo (`ObjectReader`) | PDF-085 | pendiente |
| [[PDF-104-etiqueta-firma-conexion]] | Etiqueta «Firma» al reabrir - conexión con la sesión de anotaciones | PDF-103 | pendiente |
| [[PDF-090-e2e-iteracion-3]] | E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 3 | PDF-083, PDF-043, PDF-044, PDF-088, PDF-089 | pendiente |

Orden (sin dos fichas en paralelo sobre el mismo fichero): **ola A** en paralelo PDF-040, PDF-084, PDF-087, PDF-045, PDF-089, COM-014 → **ola B** PDF-079 ∥ PDF-088 ∥ PDF-044 → **ola C** PDF-080 ∥ PDF-082 → **ola D** PDF-081 ∥ PDF-085 → **ola E** PDF-041 ∥ PDF-086 → **ola F** PDF-042 (tras PDF-085, comparten `incremental.ts`) → **ola G** PDF-083 ∥ PDF-043 (ficheros distintos: `FormLayer` frente a `AnnotationLayer` y barra) → PDF-090.

### Iteración 4 · Contraseñas y comodidad
| Id | Título | Depende de | Estado |
|---|---|---|---|
| [[COM-015-recientes-web]] | Documentos recientes en @suite/platform - tipos e implementación web | COM-014 | pendiente |
| [[COM-016-recientes-tauri]] | Documentos recientes en Tauri (lista guardada por Rust) | COM-015 | pendiente |
| [[COM-017-pantalla-completa]] | Pantalla completa en @suite/platform | COM-016 | pendiente |
| [[PDF-091-fixtures-cifrados]] | Documentos de prueba cifrados y con permisos (qpdf) | PDF-040 | pendiente |
| [[PDF-092-criptografia-pdf]] | Manejador de seguridad estándar - claves, contraseñas y cifrado por objeto | PDF-091 | pendiente |
| [[PDF-093-lector-y-escritor-cifrados]] | Lector de objetos y escritor incremental con cifrado | PDF-092, PDF-090 | pendiente |
| [[PDF-046-abrir-con-contrasena]] | Abrir PDF con contraseña | PDF-091, PDF-090 | pendiente |
| [[PDF-047-anotar-pdf-cifrado]] | Guardar anotaciones, firmas y formularios en PDF cifrado | PDF-093, PDF-046 | pendiente |
| [[PDF-048-permisos]] | Respetar los permisos del documento (copiar, imprimir) y avisar al anotar | PDF-046, PDF-044, PDF-045 | pendiente |
| [[PDF-049-recientes-y-pestanas]] | Documentos recientes en la pantalla de inicio y en «Abrir recientes» | COM-015, COM-016, PDF-090 | pendiente |
| [[PDF-094-sesiones-de-documento]] | Sesiones de documento - núcleo de pestañas (suspender y reanudar) | PDF-090, PDF-046 | pendiente |
| [[PDF-100-pestanas-historial-busqueda-posicion]] | Pestañas - historial, búsqueda, posición y panel lateral por documento | PDF-094 | pendiente |
| [[PDF-101-pestanas-anotaciones-formularios-borradores]] | Pestañas - anotaciones, formularios y borradores por documento | PDF-094, PDF-048 | pendiente |
| [[PDF-095-pestanas]] | Barra de pestañas y atajos para varios documentos | PDF-100, PDF-101, PDF-049, PDF-097 | pendiente |
| [[PDF-096-layout-doble-pagina]] | Layout de doble página (pares y con portada) | — | pendiente |
| [[PDF-102-modo-de-vista-estado]] | Modo de vista - estado, preferencia y navegación por filas | PDF-096 | pendiente |
| [[PDF-050-modos-de-pagina]] | Modos de página en el visor y menú «Vista» | PDF-102, PDF-049 | pendiente |
| [[PDF-097-pantalla-completa]] | Modo pantalla completa (lectura y presentación) | PDF-050, COM-017 | pendiente |
| [[PDF-098-plan-lienzo-detalle]] | Zoom hasta 6 400 % y cálculo de la zona de detalle | — | pendiente |
| [[PDF-051-lienzo-de-detalle]] | Lienzo de detalle para zoom alto | PDF-098, PDF-050 | pendiente |
| [[PDF-099-e2e-iteracion-4]] | E2E, accesibilidad, interoperabilidad y rendimiento de la iteración 4 | PDF-047, PDF-048, PDF-095, PDF-097, PDF-051 | pendiente |

Orden: pueden adelantarse durante la it. 3 (núcleo puro o paquetes sin choques): PDF-096, PDF-098, PDF-091 (tras PDF-040), PDF-092, PDF-102, COM-015 → COM-016 → COM-017 (tras COM-014; las cuatro de Comun tocan `types.ts` y van en serie). Tras PDF-090: PDF-093 ∥ PDF-046 ∥ PDF-049 → PDF-047 ∥ PDF-048 (tras PDF-046) ∥ PDF-050 (tras PDF-049) → PDF-094 ∥ PDF-097 ∥ PDF-051 → PDF-100 ∥ PDF-101 → PDF-095 → PDF-099.

### Iteraciones 5-6 (fichas por detallar)
| Id | Título | Depende de | Estado |
|---|---|---|---|
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
- 2026-10-17: PDF-030 desbloqueada partiendo su UI: barra «Comentar» → [[PDF-069-barra-comentar]]; cursor e importación perezosa por página → [[PDF-031-capa-de-anotaciones]] (que corrige su `depende_de`).
- 2026-10-18: PDF-039 desbloqueada: axe en el panel de comentarios → [[PDF-070-panel-comentarios-accesible]]; bug de flechas en la barra «Comentar» → [[PDF-071-barra-comentar-flechas]]; nota con teclado → [[PDF-072-nota-con-teclado]]. PDF-039 vuelve a `pendiente` tras ellas.
- 2026-10-18: PDF-039 (ronda 2) bloqueada por dos pruebas de long tasks preexistentes que fallan solo con carga concurrente → [[ADR-0016-e2e-long-tasks-en-serie]] y [[PDF-073-e2e-long-tasks-en-serie]] (proyecto `chromium-perf`, `workers: 1`, sin tocar umbrales). PDF-039 → `pendiente` tras PDF-073.
- 2026-10-18: PDF-073 (ronda 1) bloqueada: `images-200` 101 ms y `ink` [79, 145] ms en serie. Diagnóstico del líder: el primero es la evaluación del chunk de arranque de 917 KB (67-101 ms, real) → [[ADR-0017-carga-diferida-de-pdfjs]], [[PDF-074-presupuesto-bundle-arranque]], [[PDF-075-pdfjs-diferido]]; el segundo no se reproduce (6/6 sin long tasks, máquina cargada por otras baterías) pero hay coste O(n²) y re-render por frame → [[ADR-0018-vista-previa-del-trazo-en-canvas]], [[PDF-076-vista-previa-trazo-canvas]]; diagnóstico en cada `@perf` → [[PDF-077-diagnostico-long-tasks]]; `--repeat-each` y dependencias: limitación de diseño de Playwright, se repite por proyecto. Umbrales intactos. PDF-073 → `pendiente` (solo verificación).
- 2026-10-18: PDF-073 (ronda 2) bloqueada: `ink` 52 ms al soltar el trazo, con `loadavg` 4,69 heredado. Trazas en reposo: tarea máxima 18,5 ms, `pointerup` 9-11 ms, sin *long tasks* ni con CPU ×2 → no es regresión de la app. `loadavg` y `ps pcpu` no miden la CPU actual → puerta de reposo por prueba `@perf` con `os.cpus()` ([[ADR-0016-e2e-long-tasks-en-serie]], revisión 2; [[PDF-078-reposo-cpu-antes-de-perf]]). Umbrales intactos. PDF-073 → `pendiente` tras PDF-078.
- 2026-10-18: **iteraciones 1 y 2 cerradas.** Todas sus fichas en `hecha` (PDF-039 verificada por el tester con las baterías ×3 y la puerta de reposo). Se crea el [[Apps/Lector PDF/Manual|Manual]] y se marca lo cubierto en [[Paridad Adobe Acrobat]].
- 2026-10-18: **iteraciones 3 y 4 detalladas** con ADR-0019 a ADR-0025. PDF-040 pasa de «ADR y prueba» a generar `form-full.pdf` (el ADR lo escribe el líder). Fichas nuevas: PDF-079 a PDF-102 y COM-014 a COM-017. PDF-049 se parte (recientes aquí; pestañas en PDF-094, PDF-100, PDF-101 y PDF-095); PDF-050 se parte (layout PDF-096, estado PDF-102, visor PDF-050, pantalla completa PDF-097); PDF-051 se apoya en PDF-098. Dependencias añadidas solo para evitar choques de ficheros entre fichas en paralelo (ver «Orden» de cada tabla).

## Mejoras conocidas (no planificadas)
- Texto libre con caracteres no latinos: incrustar una fuente en la apariencia.
- Deshacer después de guardar (hoy el historial se vacía al recargar).
- ~~Formularios: cómo combinar `ENABLE_STORAGE` con la capa HTML~~ → resuelto en [[ADR-0019-formularios-acroform]].
- Campos de formulario con texto no latino: la apariencia usa Helvetica WinAnsi (como el texto libre); incrustar una fuente resolvería ambos casos.
- Firmas guardadas en el perfil local sin cifrar (preferencias de la app): valorar cifrarlas con una clave del sistema (llavero) en Tauri.
- Restaurar las pestañas abiertas al reiniciar la app.
