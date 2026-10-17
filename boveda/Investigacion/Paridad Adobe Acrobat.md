---
tipo: investigacion
app: pdf
estado: completa
creado: 2026-10-17
actualizado: 2026-10-17
tags: [investigacion, suite, pdf, paridad]
---

# Paridad Adobe Acrobat

## Preguntas
1. ¿Qué funciones tienen Acrobat Reader (gratis) y Acrobat Pro/Standard (pago), y cuáles son imprescindibles para sustituirlos?
2. ¿Cuánta dificultad tiene cada una y cuáles se pueden hacer con pdf.js / pdf-lib?

## Resumen
- Reader gratis: ver, imprimir, comentar, rellenar formularios y firmar con firma propia. No edita, organiza, combina, compara ni protege ([comparativa Maine](https://tdx.maine.edu/TDClient/2624/Portal/KB/Article/172841/Adobe-Acrobat-Reader-vs-Acrobat-Pro), [comparativa Seattle U](https://seattleuniversity.atlassian.net/wiki/x/D4C3G)).
- Pro añade editar texto/imágenes, combinar, exportar a Office/imagen, restringir edición/impresión, OCR, redacción, comparar y cumplimiento ISO/accesibilidad (mismas fuentes + [hilo Adobe Community](https://community.adobe.com/t5/acrobat-discussions/adobe-reader-standard-and-pro-comparison/m-p/13525851)).
- "Acrobat Reader Pro" de pago no es un producto de Adobe; las páginas que lo citan no son fiables.
- Las peticiones del usuario (subrayar y notas, cualquier nº de páginas) caen en áreas 1-4: son el núcleo. Subrayar y notas en Reader real solo aparecen con comentarios habilitados en el PDF ([Adobe: comentar](https://helpx.adobe.com/sg/acrobat/using/commenting-pdfs.html)); en nuestra app deben estar siempre disponibles (nuestra mejora).
- pdf.js cubre visor, búsqueda, miniaturas, outline e impresión, y trae editor de anotaciones (texto libre, tinta, sello, resaltado), sin subrayado ni tachado nativos ([Nutrient](https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/), no oficial). pdf-lib cubre modificar páginas y formularios, pero el original 1.17.1 no cifra ni descifra (ver Riesgos).
- Reader tiene límite: Reader y pdf.js comparten el rol "leer"; el valor diferencial es hacer gratis lo que Adobe cobra (organizar, combinar, proteger, OCR).

## Leyenda
Prioridad: **I** imprescindible, **M** importante, **O** opcional. Dificultad: B baja, M media, A alta, MA muy alta. Adobe: R = Reader gratis, P = solo Pro/Standard. Motor: pdf.js (render/UI), pdf-lib (escritura), otro = librería adicional (decidir en ADR). Atajos de Adobe: solo se listan los verificados; el resto, "no verificado" (la tabla oficial no se pudo abrir, ver Riesgos).

## 1. Visor
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Render fiel de página (texto, vectores, imágenes, fuentes) | I | R | M | pdf.js |
| Virtualización: solo renderizar páginas visibles, cache y liberar memoria (PDFs de miles de páginas) | I | R | A | pdf.js (hay que construir el visor propio; PDFViewer lo hace en parte) |
| Zoom (%, ajustar ancho/página, tamaño real), Ctrl+rueda, pellizco | I | R | B | pdf.js |
| Rotar vista (sin guardar) | I | R | B | pdf.js |
| Modos de página: continua, una página, dos páginas, portada | M | R | M | pdf.js (scroll/spread modes: no verificado en docs oficiales) |
| Modo lectura / pantalla completa / presentación | M | R | B | pdf.js ([FAQ pdf.js](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions/e81e9207c1d6a90d9e89f517ce3bf25f3d8d8f90)) |
| Modo noche / tema oscuro del documento | M | R | B | CSS/canvas filter (propio) |
| Selección y copia de texto (capa de texto) | I | R | M | pdf.js |
| Herramienta mano / selección | I | R | B | propio |
| Leer en voz alta | O | R | M | Web Speech API (propio) |
| Propiedades del documento, metadatos | M | R | B | pdf.js / pdf-lib |
| Pestañas / varios documentos, reabrir última página, recientes | M | R | M | propio |
| Capas (OCG) | O | R | M | pdf.js |
| PDF portfolio / adjuntos | O | R | M | pdf.js (attachments) |
| XFA (formularios dinámicos) | O | R | A | pdf.js tiene soporte parcial (no verificado) |
| PDF 3D, multimedia, JavaScript de Acrobat | O | R | MA | no soportable; ignorar con aviso |

## 2. Navegación
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Miniaturas de páginas (lazy) | I | R | M | pdf.js |
| Marcadores / índice (outline) | I | R | B | pdf.js |
| Ir a página, anterior/siguiente, inicio/fin | I | R | B | pdf.js |
| Enlaces internos y URI (con confirmación para externos) | I | R | B | pdf.js |
| Destinos nombrados y atrás/adelante en historial | M | R | M | pdf.js |
| Crear/editar marcadores | M | P | M | pdf-lib (editar `/Outlines` a mano) |
| Panel de comentarios | I | R | M | propio |

Atajos Windows verificados: Ctrl+F buscar ([Adobe móvil/teclado](https://helpx.adobe.com/ee/acrobat/mobile/get-started/keyboard-shortcuts.html)). Ctrl+L pantalla completa solo en lista de terceros ([tutkit](https://www.tutkit.com/en/text-tutorials/264-keyboard-shortcuts-in-acrobat)). Re Pág/Av Pág, Ctrl+0/+/-, Ctrl+P, Ctrl+Z: convención general, no verificados en la tabla oficial. Los atajos de una sola tecla vienen desactivados por defecto en Adobe ([Adobe: atajos](https://helpx.adobe.com/acrobat/using/keyboard-shortcuts.html), vía buscador).

## 3. Búsqueda
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Buscar con resaltado y siguiente/anterior (Ctrl+F) | I | R | M | pdf.js (PDFFindController) |
| Coincidir mayúsculas, palabra completa, diacríticos | M | R | B | pdf.js |
| Contador de resultados y lista de resultados en panel | M | R | M | pdf.js + propio |
| Búsqueda avanzada en carpeta / varios PDFs, índice | O | R | A | propio (índice en Worker) |
| Búsqueda en PDFs enormes sin bloquear (incremental, cancelable) | I | R | A | propio sobre pdf.js |

## 4. Anotaciones (prioridad máxima del usuario)
Reader ofrece: nota adhesiva, resaltar/subrayar/tachar texto, texto libre, dibujo a mano, formas, sellos ([Adobe: comentar](https://helpx.adobe.com/sg/acrobat/using/commenting-pdfs.html), [formas y dibujos](https://helpx.adobe.com/acrobat/desktop/share-and-review-documents/review-documents/add-stickynotes-bubbles.html), [sellos](https://helpx.adobe.com/acrobat/using/adding-stamp-pdf.html)). Las notas a texto se hacen desde la barra flotante al seleccionar.

| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Resaltar texto (varios colores, opacidad) | I | R | M | pdf.js (editor Highlight) o propio con QuadPoints; guardar `/Highlight` con pdf-lib |
| Subrayar y tachar texto | I | R | M | pdf.js no lo trae; propio (`/Underline`, `/StrikeOut` con QuadPoints) + pdf-lib |
| Nota adhesiva (icono + texto emergente) | I | R | M | propio, `/Text` + `/Popup` con pdf-lib |
| Añadir nota a un resaltado (comentario asociado) | I | R | M | propio (`/Contents` en la anotación) |
| Cuadro de texto / texto libre | M | R | M | pdf.js (FreeText editor) o propio |
| Dibujo a mano (tinta) | M | R | M | pdf.js (Ink editor) |
| Formas: línea, flecha, rectángulo, elipse, polilínea, nube | M | R | M | propio, `/Line /Square /Circle /PolyLine` |
| Sellos (imagen/estándar) | O | R | M | pdf.js (Stamp editor) |
| Responder, estado, autor, fecha en comentarios | M | R | M | propio |
| Lista de comentarios, filtrar, ordenar | M | R | M | propio |
| Importar/exportar comentarios (FDF/XFDF) | O | R | M | propio ([Adobe](https://helpx.adobe.com/acrobat/using/importing-exporting-comments.html)) |
| Deshacer/rehacer anotaciones | I | R | M | propio (ver [[Deshacer y rehacer en editores]]) |
| Guardar anotaciones en el PDF como estándar (visibles en Adobe y otros) | I | R | A | pdf-lib; con apariencia `/AP` generada |
| Leer anotaciones existentes creadas por otros programas | I | R | M | pdf.js |
| Pegar enlaces (crear enlace) | O | P | M | pdf-lib |
| Aplanar anotaciones | O | P | M | pdf-lib |

Quejas: los comentarios solo aparecen si el PDF los habilita; interfaz de Adobe cambiante y con nubes/IA integradas (no verificado con fuente). Oportunidad: anotar siempre y guardar sin pedir cuenta.

## 5. Formularios
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Rellenar AcroForm (texto, casillas, radio, lista, combo) | I | R | M | pdf.js renderiza; pdf-lib `PDFForm` guarda |
| Resaltar campos, tabulación, autocompletado | M | R | B | propio |
| Guardar el formulario relleno con apariencias correctas | I | R | A | pdf-lib (`updateFieldAppearances`, fuentes no latinas problemáticas) |
| Rellenar y firmar (texto libre sobre PDF no formulario) | I | R | M | propio + pdf-lib |
| Cálculo/validación/JS de campos | O | R | A | no cubierto; ignorar o intérprete limitado |
| Crear formularios / editar campos | M | P | A | pdf-lib (campos básicos) |
| Enviar formulario por red | O | R | M | excluido (nada sale del ordenador) |
| XFA | O | R | A | no soportable bien |

## 6. Firma
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Firma visual (dibujar/escribir/imagen) colocada en página | I | R | M | propio + pdf-lib |
| Ver validez de firmas digitales existentes | M | R | A | otro (node-forge/pkijs, no verificado) |
| Firmar digitalmente con certificado (PAdES) | M | R | MA | otro: [@signpdf/signpdf](https://www.npmjs.com/package/@signpdf/signpdf) v3.3.0 MIT (npm view) + pdf-lib para el hueco de firma |
| Sellado de tiempo, LTV | O | P | MA | otro |
| Solicitar firmas a terceros (Adobe Sign) | O | P (coste extra) | - | fuera de alcance (servicio externo) |

Firmar con firma propia es gratis en Reader; solicitar firmas es de pago ([comparativa Maine](https://tdx.maine.edu/TDClient/2624/Portal/KB/Article/172841/Adobe-Acrobat-Reader-vs-Acrobat-Pro)).

## 7. Imprimir
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Imprimir (Ctrl+P): rangos, copias, orientación, ajustar a página | I | R | M | pdf.js (render alta resolución) + diálogo del sistema/Tauri; en PDFs grandes imprimir por lotes |
| Varias páginas por hoja, folleto, póster, a dos caras | M | R | M | pdf-lib (componer) |
| Imprimir con comentarios / sin | M | R | B | propio |
| Imprimir a PDF | O | R | B | del SO |
| Vista previa de impresión | M | R | M | propio |

## 8. Organizar páginas
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Girar páginas (y guardar) | I | P (Reader no) | B | pdf-lib |
| Eliminar, extraer, reordenar páginas | I | P | M | pdf-lib |
| Insertar páginas de otro PDF / combinar PDFs | I | P | M | pdf-lib (`copyPages`) |
| Dividir documento | M | P | M | pdf-lib |
| Recortar páginas, numeración Bates, encabezados/pies, marca de agua | O | P | M | pdf-lib |
| Crear PDF desde imágenes | M | P | B | pdf-lib |
| Optimizar / comprimir | M | P | A | pdf-lib limitado; otro (ej. mupdf, AGPL, [npm](https://www.npmjs.com/package/mupdf) 1.28.1) |

## 9. Seguridad y contraseña
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Abrir PDF con contraseña de usuario | I | R | M | pdf.js (callback de contraseña) |
| Guardar anotaciones en un PDF cifrado | I | R | A | pdf-lib original no descifra; usar fork [@cantoo/pdf-lib](https://www.npmjs.com/package/@cantoo/pdf-lib) 2.11.1 MIT (npm view) o reescribir |
| Proteger con contraseña / permisos (cifrado AES-256) | M | P | A | pdf-lib original no cifra (ver Riesgos); fork o otro |
| Respetar permisos (no copiar/imprimir) | M | R | B | pdf.js expone permisos |
| Quitar seguridad (con contraseña conocida) | O | P | M | fork |
| Aviso de enlaces/JS/adjuntos peligrosos | I | R | M | propio (PDF = entrada no confiable) |
| Propiedades y metadatos, eliminar información oculta | O | P | M | pdf-lib |

## 10. Edición Pro
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Editar texto existente (reflujo, fuentes) | O | P | MA | ninguno; requiere motor de contenido propio. Fuera de alcance inicial |
| Editar/mover imágenes, objetos | O | P | A | pdf-lib de bajo nivel |
| Añadir texto / imagen nueva sobre la página | M | P | M | pdf-lib |
| Enlaces, fondo, encabezado/pie, Bates | O | P | M | pdf-lib |
| Cumplimiento PDF/A, PDF/UA, accesibilidad | O | P | MA | otro |
| Etiquetado de accesibilidad | O | P | MA | no cubierto |

## 11. OCR
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Reconocer texto en escaneados y hacerlos buscables | M | P | A | [tesseract.js](https://www.npmjs.com/package/tesseract.js) 7.0.0 Apache-2.0 (npm view, local, Worker) + pdf-lib para capa de texto invisible |
| Idiomas (español, inglés) sin red | M | P | M | traineddata local |

OCR es Pro según [hilo Adobe Community](https://community.adobe.com/t5/acrobat-discussions/adobe-reader-standard-and-pro-comparison/m-p/13525851) (fuente no oficial).

## 12. Redacción
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Marcar y aplicar redacción (eliminar de verdad el contenido bajo la caja) | O | P | MA | pdf-lib no puede borrar texto del content stream; requiere reescribir streams o rasterizar la página. Pro-only según hilo Community (no oficial). La barra flotante de Reader ya muestra "Redact text" |
| Buscar y redactar patrones, borrar metadatos | O | P | MA | propio |

## 13. Comparar
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Comparar dos PDFs (texto y visual) | O | P | A | pdf.js extrae texto/render; diff propio (píxel + texto) |

## 14. Exportar
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib |
|---|---|---|---|---|
| Exportar páginas a imagen (PNG/JPG) | M | P | B | pdf.js canvas |
| Exportar texto plano | M | P | B | pdf.js |
| Exportar a Word/Excel/PowerPoint | O | P | MA | sin librería madura abierta; baja prioridad |
| Guardar copia / guardar como (atómico) | I | R | B | pdf-lib / Tauri fs |
| Compartir por correo/nube | O | R | - | excluido (privacidad) |
| Exportar comentarios (resumen) | O | R | M | propio |

## Resumen de imprescindibles (orden sugerido)
1. Visor virtualizado (cualquier nº de páginas), zoom, rotar, miniaturas, outline, selección, enlaces.
2. Búsqueda incremental con resaltado.
3. Resaltar/subrayar/tachar + notas adhesivas + comentario sobre resaltado, guardados como anotaciones estándar y con deshacer.
4. Rellenar formularios, firma visual.
5. Imprimir, guardar atómico, contraseña al abrir.
6. Organizar páginas (girar, borrar, extraer, combinar, reordenar): Pro en Adobe, importante para sustituirlo.

## Riesgos
- pdf-lib original 1.17.1 último cambio 2022-05-12 (npm view): sin mantenimiento; no cifra ni descifra ([CryptoID](https://cryptoid.com.br/international-news/implementing-encryption-feature-in-pdf-lib/)). Alternativas con commits recientes: @cantoo/pdf-lib 2.11.1 (2026-09-15) y @pdfme/pdf-lib 6.2.6 (2026-10-16), ambos MIT (npm view). Hay que verificar su estado real de descifrado antes del ADR.
- pdf-lib reserializa todo el fichero al guardar ([Obsidian Study PDF](https://www.obsidianstats.com/plugins/study-pdf)), lento y pesado con PDFs de cientos de MB: probar actualización incremental (append) para anotar.
- mupdf (WASM) es AGPL-3.0; válido para uso personal, anotarlo ([npm](https://www.npmjs.com/package/mupdf)).
- pdf.js: editor de anotaciones sin subrayado/tachado según fuente no oficial ([Nutrient](https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/)); comprobar en pdfjs-dist 6.4.299 (Apache-2.0, 2026-10-03, npm view).
- No se pudo abrir la tabla oficial de atajos ni la comparativa oficial de Adobe (proxy rechazó el fetch): lo marcado como "no verificado" debe contrastarse. Clasificación Reader/Pro de redacción, comparar, OCR y exportar se apoya en foros e instituciones, no en Adobe.
- Quejas habituales de Adobe (precio, suscripción, publicidad, IA, lentitud): no verificadas con fuente en esta nota.

## Recomendaciones
1. Planificar el MVP con las áreas 1-4 y guardado atómico; el objetivo "subrayar y notas" entra en la primera iteración junto al visor virtualizado.
2. Decidir por ADR el motor de anotaciones: pdf.js AnnotationEditor (rápido, falta subrayar/tachar) frente a capa propia con QuadPoints y escritura con pdf-lib. Recomendado: capa propia que escriba anotaciones PDF estándar con `/AP`, reutilizando el editor de pdf.js para tinta/texto/sello si encaja.
3. Pedir una investigación aparte ("Lector PDF - librerias y arquitectura"): comparar pdf-lib vs @cantoo/pdf-lib vs @pdfme/pdf-lib vs mupdf, guardado incremental y rendimiento con PDFs de miles de páginas.
4. Poner un presupuesto de rendimiento en la ficha de virtualización: memoria acotada (liberar canvas fuera de pantalla), render en Worker, búsqueda cancelable.
5. Dejar fuera del alcance inicial: edición de texto existente, exportar a Office, PDF/A y accesibilidad, XFA, JS de Acrobat, envío a servicios externos. Documentarlo en el Plan.
6. Dejar OCR, redacción real y firma digital PAdES para una iteración tardía, cada una con su ADR (redacción exige borrar contenido de verdad, no solo tapar).
7. Que el programador verifique los atajos contra la tabla oficial de Adobe antes de fijarlos.

## Fuentes
- [Adobe: Acrobat Reader vs Pro (Univ. Maine)](https://tdx.maine.edu/TDClient/2624/Portal/KB/Article/172841/Adobe-Acrobat-Reader-vs-Acrobat-Pro) — consultado 2026-10-17 (solo resumen del buscador)
- [Reader vs Pro (Seattle University)](https://seattleuniversity.atlassian.net/wiki/x/D4C3G) — 2026-10-17 (resumen del buscador)
- [Adobe Community: Reader, Standard y Pro](https://community.adobe.com/t5/acrobat-discussions/adobe-reader-standard-and-pro-comparison/m-p/13525851) — 2026-10-17
- [Adobe: comentar PDFs](https://helpx.adobe.com/sg/acrobat/using/commenting-pdfs.html) — 2026-10-17
- [Adobe: formas, líneas y dibujos](https://helpx.adobe.com/acrobat/desktop/share-and-review-documents/review-documents/add-stickynotes-bubbles.html) — 2026-10-17
- [Adobe: sellos](https://helpx.adobe.com/acrobat/using/adding-stamp-pdf.html) — 2026-10-17
- [Adobe: importar/exportar comentarios](https://helpx.adobe.com/acrobat/using/importing-exporting-comments.html) — 2026-10-17
- [Adobe: atajos de teclado (escritorio)](https://helpx.adobe.com/acrobat/using/keyboard-shortcuts.html) — 2026-10-17 (no abierta)
- [Adobe: atajos (móvil/teclado)](https://helpx.adobe.com/ee/acrobat/mobile/get-started/keyboard-shortcuts.html) — 2026-10-17
- [tutkit: atajos Acrobat](https://www.tutkit.com/en/text-tutorials/264-keyboard-shortcuts-in-acrobat) — 2026-10-17 (tercero)
- [pdf.js FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions/e81e9207c1d6a90d9e89f517ce3bf25f3d8d8f90) — 2026-10-17
- [Nutrient: pdf.js annotation editor](https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/) — 2026-10-17
- [CryptoID: cifrado en pdf-lib](https://cryptoid.com.br/international-news/implementing-encryption-feature-in-pdf-lib/) — 2026-10-17
- [Obsidian Study PDF](https://www.obsidianstats.com/plugins/study-pdf) — 2026-10-17
- Versiones y licencias: `npm view` de pdfjs-dist, pdf-lib, @cantoo/pdf-lib, @pdfme/pdf-lib, mupdf, tesseract.js, @signpdf/signpdf — 2026-10-17
