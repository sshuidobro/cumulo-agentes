---
tipo: investigacion
app: pdf
estado: completa
creado: 2026-10-17
actualizado: 2026-10-18
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

## Estado en la suite
La columna **Estado** (añadida por el líder el 2026-10-18 al cerrar las iteraciones 1 y 2 del [[Apps/Lector PDF/Plan|Lector PDF]]) dice qué está hecho y en qué iteración se planifica el resto. «No planificado» = sin ficha; «excluido» o «fuera de alcance» = decisión del Plan. Uso: [[Apps/Lector PDF/Manual|Manual]].

## Leyenda
Prioridad: **I** imprescindible, **M** importante, **O** opcional. Dificultad: B baja, M media, A alta, MA muy alta. Adobe: R = Reader gratis, P = solo Pro/Standard. Motor: pdf.js (render/UI), pdf-lib (escritura), otro = librería adicional (decidir en ADR). Atajos de Adobe: solo se listan los verificados; el resto, "no verificado" (la tabla oficial no se pudo abrir, ver Riesgos).

## 1. Visor
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Render fiel de página (texto, vectores, imágenes, fuentes) | I | R | M | pdf.js | hecho (it. 1) |
| Virtualización: solo renderizar páginas visibles, cache y liberar memoria (PDFs de miles de páginas) | I | R | A | pdf.js (hay que construir el visor propio; PDFViewer lo hace en parte) | hecho (it. 1): 5 a 100 000 páginas |
| Zoom (%, ajustar ancho/página, tamaño real), Ctrl+rueda, pellizco | I | R | B | pdf.js | hecho (it. 1); pellizco táctil no |
| Rotar vista (sin guardar) | I | R | B | pdf.js | hecho (it. 1) |
| Modos de página: continua, una página, dos páginas, portada | M | R | M | pdf.js (scroll/spread modes: no verificado en docs oficiales) | it. 4 ([[PDF-050-modos-de-pagina|PDF-050]]); sin horizontal |
| Modo lectura / pantalla completa / presentación | M | R | B | pdf.js ([FAQ pdf.js](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions/e81e9207c1d6a90d9e89f517ce3bf25f3d8d8f90)) | it. 4 ([[PDF-097-pantalla-completa|PDF-097]]) |
| Modo noche / tema oscuro del documento | M | R | B | CSS/canvas filter (propio) | hecho (it. 1) |
| Selección y copia de texto (capa de texto) | I | R | M | pdf.js | hecho (it. 1) |
| Herramienta mano / selección | I | R | B | propio | hecho (it. 1) |
| Leer en voz alta | O | R | M | Web Speech API (propio) | it. 6 ([[PDF-067-leer-en-voz-alta|PDF-067]]) |
| Propiedades del documento, metadatos | M | R | B | pdf.js / pdf-lib | it. 3 ([[PDF-045-propiedades|PDF-045]]) |
| Pestañas / varios documentos, reabrir última página, recientes | M | R | M | propio | reabrir última página: hecho (it. 1); recientes y pestañas: it. 4 ([[PDF-049-recientes-y-pestanas|PDF-049]], [[PDF-095-pestanas|PDF-095]]) |
| Capas (OCG) | O | R | M | pdf.js | no planificado |
| PDF portfolio / adjuntos | O | R | M | pdf.js (attachments) | no planificado |
| XFA (formularios dinámicos) | O | R | A | pdf.js tiene soporte parcial (no verificado) | fuera de alcance |
| PDF 3D, multimedia, JavaScript de Acrobat | O | R | MA | no soportable; ignorar con aviso | fuera de alcance (nunca se ejecuta JS) |

## 2. Navegación
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Miniaturas de páginas (lazy) | I | R | M | pdf.js | hecho (it. 1) |
| Marcadores / índice (outline) | I | R | B | pdf.js | hecho (it. 1) |
| Ir a página, anterior/siguiente, inicio/fin | I | R | B | pdf.js | hecho (it. 1) (con etiquetas) |
| Enlaces internos y URI (con confirmación para externos) | I | R | B | pdf.js | hecho (it. 1) |
| Destinos nombrados y atrás/adelante en historial | M | R | M | pdf.js | hecho (it. 1) |
| Crear/editar marcadores | M | P | M | pdf-lib (editar `/Outlines` a mano) | no planificado |
| Panel de comentarios | I | R | M | propio | hecho (it. 2) |

Atajos Windows verificados: Ctrl+F buscar ([Adobe móvil/teclado](https://helpx.adobe.com/ee/acrobat/mobile/get-started/keyboard-shortcuts.html)). Ctrl+L pantalla completa solo en lista de terceros ([tutkit](https://www.tutkit.com/en/text-tutorials/264-keyboard-shortcuts-in-acrobat)). Re Pág/Av Pág, Ctrl+0/+/-, Ctrl+P, Ctrl+Z: convención general, no verificados en la tabla oficial. Los atajos de una sola tecla vienen desactivados por defecto en Adobe ([Adobe: atajos](https://helpx.adobe.com/acrobat/using/keyboard-shortcuts.html), vía buscador).

## 3. Búsqueda
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Buscar con resaltado y siguiente/anterior (Ctrl+F) | I | R | M | pdf.js (PDFFindController) | hecho (it. 1) |
| Coincidir mayúsculas, palabra completa, diacríticos | M | R | B | pdf.js | hecho (it. 1) |
| Contador de resultados y lista de resultados en panel | M | R | M | pdf.js + propio | contador: hecho (it. 1); lista en panel no planificada |
| Búsqueda avanzada en carpeta / varios PDFs, índice | O | R | A | propio (índice en Worker) | no planificado |
| Búsqueda en PDFs enormes sin bloquear (incremental, cancelable) | I | R | A | propio sobre pdf.js | hecho (it. 1) |

## 4. Anotaciones (prioridad máxima del usuario)
Reader ofrece: nota adhesiva, resaltar/subrayar/tachar texto, texto libre, dibujo a mano, formas, sellos ([Adobe: comentar](https://helpx.adobe.com/sg/acrobat/using/commenting-pdfs.html), [formas y dibujos](https://helpx.adobe.com/acrobat/desktop/share-and-review-documents/review-documents/add-stickynotes-bubbles.html), [sellos](https://helpx.adobe.com/acrobat/using/adding-stamp-pdf.html)). Las notas a texto se hacen desde la barra flotante al seleccionar.

| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Resaltar texto (varios colores, opacidad) | I | R | M | pdf.js (editor Highlight) o propio con QuadPoints; guardar `/Highlight` con pdf-lib | hecho (it. 2) (colores) |
| Subrayar y tachar texto | I | R | M | pdf.js no lo trae; propio (`/Underline`, `/StrikeOut` con QuadPoints) + pdf-lib | hecho (it. 2) |
| Nota adhesiva (icono + texto emergente) | I | R | M | propio, `/Text` + `/Popup` con pdf-lib | hecho (it. 2) |
| Añadir nota a un resaltado (comentario asociado) | I | R | M | propio (`/Contents` en la anotación) | hecho (it. 2) |
| Cuadro de texto / texto libre | M | R | M | pdf.js (FreeText editor) o propio | hecho (it. 2) |
| Dibujo a mano (tinta) | M | R | M | pdf.js (Ink editor) | hecho (it. 2) |
| Formas: línea, flecha, rectángulo, elipse, polilínea, nube | M | R | M | propio, `/Line /Square /Circle /PolyLine` | it. 6 ([[PDF-057-formas-y-sellos|PDF-057]]) |
| Sellos (imagen/estándar) | O | R | M | pdf.js (Stamp editor) | it. 6 ([[PDF-057-formas-y-sellos|PDF-057]]) |
| Responder, estado, autor, fecha en comentarios | M | R | M | propio | autor y fecha: hecho (it. 2); responder y estado: it. 6 ([[PDF-058-respuestas-xfdf|PDF-058]]) |
| Lista de comentarios, filtrar, ordenar | M | R | M | propio | hecho (it. 2) (filtro por tipo) |
| Importar/exportar comentarios (FDF/XFDF) | O | R | M | propio ([Adobe](https://helpx.adobe.com/acrobat/using/importing-exporting-comments.html)) | it. 6 ([[PDF-058-respuestas-xfdf|PDF-058]]) |
| Deshacer/rehacer anotaciones | I | R | M | propio (ver [[Deshacer y rehacer en editores]]) | hecho (it. 2) |
| Guardar anotaciones en el PDF como estándar (visibles en Adobe y otros) | I | R | A | pdf-lib; con apariencia `/AP` generada | hecho (it. 2) (incremental, con /AP) |
| Leer anotaciones existentes creadas por otros programas | I | R | M | pdf.js | hecho (it. 2) |
| Pegar enlaces (crear enlace) | O | P | M | pdf-lib | no planificado |
| Aplanar anotaciones | O | P | M | pdf-lib | no planificado |

Quejas: los comentarios solo aparecen si el PDF los habilita; interfaz de Adobe cambiante y con nubes/IA integradas (no verificado con fuente). Oportunidad: anotar siempre y guardar sin pedir cuenta.

## 5. Formularios
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Rellenar AcroForm (texto, casillas, radio, lista, combo) | I | R | M | pdf.js renderiza; pdf-lib `PDFForm` guarda | it. 3 ([[PDF-041-rellenar-formularios|PDF-041]], [[PDF-083-casillas-opciones-y-tabulacion|PDF-083]]) |
| Resaltar campos, tabulación, autocompletado | M | R | B | propio | it. 3 (resaltar y tabular; autocompletado no) |
| Guardar el formulario relleno con apariencias correctas | I | R | A | pdf-lib (`updateFieldAppearances`, fuentes no latinas problemáticas) | it. 3 ([[PDF-042-guardar-formularios|PDF-042]]) |
| Rellenar y firmar (texto libre sobre PDF no formulario) | I | R | M | propio + pdf-lib | texto libre: hecho (it. 2); firma: it. 3 |
| Cálculo/validación/JS de campos | O | R | A | no cubierto; ignorar o intérprete limitado | fuera de alcance (no se ejecuta JS) |
| Crear formularios / editar campos | M | P | A | pdf-lib (campos básicos) | no planificado |
| Enviar formulario por red | O | R | M | excluido (nada sale del ordenador) | excluido |
| XFA | O | R | A | no soportable bien | fuera de alcance |

## 6. Firma
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Firma visual (dibujar/escribir/imagen) colocada en página | I | R | M | propio + pdf-lib | it. 3 ([[PDF-043-firma-visual|PDF-043]]) |
| Ver validez de firmas digitales existentes | M | R | A | otro (node-forge/pkijs, no verificado) | it. 6 ([[PDF-066-firma-digital|PDF-066]]) |
| Firmar digitalmente con certificado (PAdES) | M | R | MA | otro: [@signpdf/signpdf](https://www.npmjs.com/package/@signpdf/signpdf) v3.3.0 MIT (npm view) + pdf-lib para el hueco de firma | it. 6 ([[PDF-066-firma-digital|PDF-066]]) |
| Sellado de tiempo, LTV | O | P | MA | otro | no planificado |
| Solicitar firmas a terceros (Adobe Sign) | O | P (coste extra) | - | fuera de alcance (servicio externo) | excluido |

Firmar con firma propia es gratis en Reader; solicitar firmas es de pago ([comparativa Maine](https://tdx.maine.edu/TDClient/2624/Portal/KB/Article/172841/Adobe-Acrobat-Reader-vs-Acrobat-Pro)).

## 7. Imprimir
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Imprimir (Ctrl+P): rangos, copias, orientación, ajustar a página | I | R | M | pdf.js (render alta resolución) + diálogo del sistema/Tauri; en PDFs grandes imprimir por lotes | it. 3 ([[PDF-044-imprimir|PDF-044]]); copias y orientación en el diálogo del sistema |
| Varias páginas por hoja, folleto, póster, a dos caras | M | R | M | pdf-lib (componer) | no planificado |
| Imprimir con comentarios / sin | M | R | B | propio | it. 3 |
| Imprimir a PDF | O | R | B | del SO | del SO (it. 3) |
| Vista previa de impresión | M | R | M | propio | del diálogo del sistema (it. 3) |

## 8. Organizar páginas
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Girar páginas (y guardar) | I | P (Reader no) | B | pdf-lib | it. 5 |
| Eliminar, extraer, reordenar páginas | I | P | M | pdf-lib | it. 5 |
| Insertar páginas de otro PDF / combinar PDFs | I | P | M | pdf-lib (`copyPages`) | it. 5 |
| Dividir documento | M | P | M | pdf-lib | it. 5 |
| Recortar páginas, numeración Bates, encabezados/pies, marca de agua | O | P | M | pdf-lib | no planificado |
| Crear PDF desde imágenes | M | P | B | pdf-lib | it. 5 |
| Optimizar / comprimir | M | P | A | pdf-lib limitado; otro (ej. mupdf, AGPL, [npm](https://www.npmjs.com/package/mupdf) 1.28.1) | no planificado |

## 9. Seguridad y contraseña
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Abrir PDF con contraseña de usuario | I | R | M | pdf.js (callback de contraseña) | it. 4 ([[PDF-046-abrir-con-contrasena|PDF-046]]) |
| Guardar anotaciones en un PDF cifrado | I | R | A | pdf-lib original no descifra; usar fork [@cantoo/pdf-lib](https://www.npmjs.com/package/@cantoo/pdf-lib) 2.11.1 MIT (npm view) o reescribir | it. 4 ([[PDF-047-anotar-pdf-cifrado|PDF-047]]; cifrado propio, [[ADR-0022-pdf-cifrados]]) |
| Proteger con contraseña / permisos (cifrado AES-256) | M | P | A | pdf-lib original no cifra (ver Riesgos); fork o otro | it. 6 ([[PDF-060-proteger|PDF-060]]) |
| Respetar permisos (no copiar/imprimir) | M | R | B | pdf.js expone permisos | it. 4 ([[PDF-048-permisos|PDF-048]]); anotar y rellenar nunca se bloquean |
| Quitar seguridad (con contraseña conocida) | O | P | M | fork | it. 6 ([[PDF-060-proteger|PDF-060]]) |
| Aviso de enlaces/JS/adjuntos peligrosos | I | R | M | propio (PDF = entrada no confiable) | enlaces externos con confirmación y JS nunca ejecutado: hecho (it. 1) |
| Propiedades y metadatos, eliminar información oculta | O | P | M | pdf-lib | ver: it. 3; eliminar información oculta: no planificado |

## 10. Edición Pro
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Editar texto existente (reflujo, fuentes) | O | P | MA | ninguno; requiere motor de contenido propio. Fuera de alcance inicial | it. 6 (investigación, [[PDF-065-editar-texto|PDF-065]]) |
| Editar/mover imágenes, objetos | O | P | A | pdf-lib de bajo nivel | no planificado |
| Añadir texto / imagen nueva sobre la página | M | P | M | pdf-lib | it. 6 ([[PDF-059-anadir-texto-imagen|PDF-059]]) |
| Enlaces, fondo, encabezado/pie, Bates | O | P | M | pdf-lib | no planificado |
| Cumplimiento PDF/A, PDF/UA, accesibilidad | O | P | MA | otro | fuera de alcance |
| Etiquetado de accesibilidad | O | P | MA | no cubierto | fuera de alcance |

## 11. OCR
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Reconocer texto en escaneados y hacerlos buscables | M | P | A | [tesseract.js](https://www.npmjs.com/package/tesseract.js) 7.0.0 Apache-2.0 (npm view, local, Worker) + pdf-lib para capa de texto invisible | it. 6 ([[PDF-061-ocr|PDF-061]]) |
| Idiomas (español, inglés) sin red | M | P | M | traineddata local | it. 6 |

OCR es Pro según [hilo Adobe Community](https://community.adobe.com/t5/acrobat-discussions/adobe-reader-standard-and-pro-comparison/m-p/13525851) (fuente no oficial).

## 12. Redacción
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Marcar y aplicar redacción (eliminar de verdad el contenido bajo la caja) | O | P | MA | pdf-lib no puede borrar texto del content stream; requiere reescribir streams o rasterizar la página. Pro-only según hilo Community (no oficial). La barra flotante de Reader ya muestra "Redact text" | it. 6 ([[PDF-062-redactar|PDF-062]]) |
| Buscar y redactar patrones, borrar metadatos | O | P | MA | propio | it. 6 |

## 13. Comparar
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Comparar dos PDFs (texto y visual) | O | P | A | pdf.js extrae texto/render; diff propio (píxel + texto) | it. 6 ([[PDF-063-comparar|PDF-063]]) |

## 14. Exportar
| Función | Prio | Adobe | Dific. | pdf.js / pdf-lib | Estado |
|---|---|---|---|---|---|
| Exportar páginas a imagen (PNG/JPG) | M | P | B | pdf.js canvas | it. 6 ([[PDF-064-exportar|PDF-064]]) |
| Exportar texto plano | M | P | B | pdf.js | it. 6 |
| Exportar a Word/Excel/PowerPoint | O | P | MA | sin librería madura abierta; baja prioridad | no planificado |
| Guardar copia / guardar como (atómico) | I | R | B | pdf-lib / Tauri fs | hecho (it. 2) |
| Compartir por correo/nube | O | R | - | excluido (privacidad) | excluido |
| Exportar comentarios (resumen) | O | R | M | propio | no planificado |

## Resumen de imprescindibles (orden sugerido)
1. Visor virtualizado (cualquier nº de páginas), zoom, rotar, miniaturas, outline, selección, enlaces.
2. Búsqueda incremental con resaltado.
3. Resaltar/subrayar/tachar + notas adhesivas + comentario sobre resaltado, guardados como anotaciones estándar y con deshacer.
4. Rellenar formularios, firma visual.
5. Imprimir, guardar atómico, contraseña al abrir.
6. Organizar páginas (girar, borrar, extraer, combinar, reordenar): Pro en Adobe, importante para sustituirlo.

Estado a 2026-10-18: 1, 2 y 3 hechos (iteraciones 1 y 2 del Lector); 4 y la impresión en la it. 3; contraseña en la it. 4; 6 en la it. 5.

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
