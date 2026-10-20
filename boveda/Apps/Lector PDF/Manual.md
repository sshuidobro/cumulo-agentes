---
tipo: manual
app: pdf
estado: vigente
creado: 2026-10-18
actualizado: 2026-10-20
tags: [manual, pdf]
---

# Manual · Lector PDF

Plan: [[Apps/Lector PDF/Plan|Plan]] · Paridad: [[Paridad Adobe Acrobat]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0009-anotaciones-escritor-incremental]]

Estado: iteraciones 1 (visor) y 2 (anotaciones) terminadas el 2026-10-18. Funciona como app de escritorio (Tauri) y en el navegador (Chrome o Edge recomendados). Ningún documento sale del ordenador.

## Arrancar
- Escritorio: `pnpm --filter lector-pdf tauri dev` (desarrollo) o el instalador de `pnpm --filter lector-pdf tauri build`. Al instalarlo, los `.pdf` se pueden abrir con «Abrir con › Lector PDF»; si la app ya está abierta, el fichero se abre en la misma ventana.
- Navegador: `pnpm --filter lector-pdf dev` y abrir http://localhost:5173.

## Abrir un documento
- Botón «Abrir…» de la pantalla de inicio o de la barra, **Ctrl+O**, o arrastrar un PDF a la ventana.
- Los PDF se leen por partes: uno de 100 000 páginas o de cientos de MB abre en segundos y la barra de progreso permite «Cancelar».
- Al volver a abrir un documento se recupera la última página, el zoom y el giro con que se dejó.
- Abrir otro documento sustituye al actual (preguntando si hay cambios sin guardar). Varias pestañas: iteración 4.
- PDF con contraseña: hoy muestra «Este PDF está protegido con contraseña» y no se abre (llega en la iteración 4).

## Leer y moverse
- Desplazamiento continuo con la rueda o la barra; solo se dibujan las páginas visibles, así que el tamaño del documento no importa.
- Cuadro de página de la barra: escribir el número (o la etiqueta, p. ej. «iv») e Intro. Ctrl+Mayús+N lleva al cuadro.
- **Zoom:** botones Ampliar/Reducir, lista (Automático, Ajustar al ancho, Ajustar a la página, Tamaño real, porcentajes), escribir un porcentaje (10-800 %) o Ctrl+rueda.
- **Girar la vista** (no cambia el fichero): botones o Ctrl+Mayús+→/←.
- **Herramientas:** selección (V) para seleccionar y copiar texto; mano (H) para arrastrar la página.
- **Enlaces:** los internos llevan al destino; «Vista anterior/siguiente» (Alt+←/→) deshace los saltos. Los externos piden confirmación antes de abrir el navegador; los que intentan ejecutar acciones se bloquean.
- **Panel lateral** (F4): pestañas «Miniaturas», «Marcadores» (índice del PDF, con Expandir/Contraer todo) y «Comentarios».

## Buscar
- **Ctrl+F** abre la barra de búsqueda; los resultados aparecen mientras se escribe, con el contador «3 de 120».
- Intro o F3 va al siguiente; Mayús+Intro o Mayús+F3 al anterior. Opciones: «Coincidir mayúsculas», «Palabras completas», «Distinguir tildes».
- En documentos grandes se ve «Buscando… N de M páginas» y se puede «Detener»; la app sigue respondiendo.

## Comentar
Botón **«Comentar»** de la barra: abre la segunda barra con las herramientas, el color, el grosor y el tamaño de letra. Las anotaciones se pueden poner en **cualquier** PDF, aunque su autor no habilitara los comentarios.
- **Resaltar, Subrayar, Tachar:** con la herramienta elegida, seleccionar el texto. También seleccionando texto con la herramienta de selección: la barra flotante ofrece Resaltar, Subrayar, Tachar y Copiar.
- **Nota:** clic donde se quiera la nota y escribir el comentario. Con el teclado: elegir «Nota», Intro la coloca en la página actual; después Esc y las flechas la mueven.
- **Comentario sobre un marcado:** clic en un resaltado/subrayado/tachado para abrir su comentario y escribir.
- **Texto:** clic o arrastrar para crear el cuadro y escribir; se cambia de tamaño con el tirador.
- **Dibujar:** trazos a mano alzada con el color y grosor elegidos.
- **Polígono:** un clic por cada vértice; doble clic (o Intro, con tres vértices o más) lo cierra. Clic cerca del primer vértice también lo cierra. Esc lo descarta y Retroceso quita el último vértice.
- **Sello:** el menú «Sello» elige uno de los catorce sellos (APROBADO, BORRADOR…); un clic en la página lo coloca. Con el teclado, Intro en el sello lo coloca en la página actual. Se arrastra su tirador para cambiar el tamaño, que mantiene la proporción.
- **Seleccionar, mover y borrar:** clic sobre una anotación (o Tab hasta ella); flechas para mover notas, textos y dibujos; **Supr** para borrar. Esc deja la herramienta actual.
- **Deshacer/Rehacer:** Ctrl+Z y Ctrl+Y (o Ctrl+Mayús+Z), también con los botones de la barra, que dicen qué deshacen («Deshacer añadir resaltado»).
- **Panel «Comentarios»:** lista todas las anotaciones (también las de otros programas) con autor, página y texto; se puede buscar, filtrar por tipo y autor, ir a una con clic e Intro y borrarla. «Tu nombre» fija el autor de las anotaciones nuevas.

## Guardar
- **Ctrl+S** guarda las anotaciones **dentro del PDF** (como anotaciones estándar, visibles en Adobe Reader y otros lectores) añadiéndolas al final del fichero: rápido incluso en PDFs enormes y sin tocar el contenido original. El guardado es atómico: un corte a medias no estropea el fichero.
- **Ctrl+Mayús+S** guarda una copia con otro nombre.
- En el navegador: Chrome y Edge guardan en el mismo fichero (piden permiso la primera vez); Firefox y Safari descargan una copia con las anotaciones.
- El título de la ventana lleva «• » mientras hay cambios sin guardar; al cerrar la ventana, abrir otro documento o cerrar el actual se pregunta «¿Guardar los cambios…?».
- **Recuperación:** los cambios sin guardar se copian cada pocos segundos en el almacenamiento local. Si la app se cierra de golpe, al reabrir ese PDF se ofrece «Recuperar» o «Descartar».

## Apariencia
- Menú «Apariencia»: tema Sistema, Claro u Oscuro, y «Modo noche de las páginas» (invierte los colores de las páginas sin tocar las fotos).

## Atajos de teclado
En macOS, Ctrl es ⌘.

| Acción | Atajo |
|---|---|
| Abrir | Ctrl+O |
| Guardar · Guardar como | Ctrl+S · Ctrl+Mayús+S |
| Deshacer · Rehacer | Ctrl+Z · Ctrl+Y o Ctrl+Mayús+Z |
| Dejar la herramienta de anotación | Esc |
| Ampliar · Reducir | Ctrl++ (o Ctrl+= y + del teclado numérico) · Ctrl+- |
| Ajustar a la página · Tamaño real · Ajustar al ancho | Ctrl+0 · Ctrl+1 · Ctrl+2 |
| Girar a la derecha · a la izquierda | Ctrl+Mayús+→ · Ctrl+Mayús+← |
| Página siguiente · anterior | → o Ctrl+Av Pág · ← o Ctrl+Re Pág |
| Primera · última página | Inicio o Ctrl+Mayús+Re Pág · Fin o Ctrl+Mayús+Av Pág |
| Ir a la página | Ctrl+Mayús+N |
| Herramienta de selección · mano | V · H |
| Seleccionar todo el texto de la página | Ctrl+A |
| Vista anterior · siguiente (enlaces) | Alt+← · Alt+→ |
| Mostrar u ocultar el panel lateral | F4 |
| Buscar · siguiente · anterior | Ctrl+F · F3 (o Intro) · Mayús+F3 (o Mayús+Intro) |
| Borrar la anotación seleccionada | Supr |
| Mover la anotación seleccionada | Flechas |
| Colocar una nota con la herramienta «Nota» | Intro |

## Limitaciones actuales
- PDFs con contraseña: iteración 4. Formularios: se ven, pero no se rellenan (iteración 3). Imprimir: iteración 3.
- Tras guardar no se puede deshacer lo anterior (el historial empieza de nuevo).
- El texto libre con caracteres no latinos (chino, árabe…) se guarda como «?» (falta incrustar una fuente).
- Los resaltados, subrayados y tachados no se mueven ni cambian de tamaño (se borran y se rehacen).
- No hay formas, sellos, respuestas a comentarios ni XFDF (iteración 6).

## Comprobación manual en Adobe Acrobat Reader
Para confirmar que lo guardado se ve igual en Adobe (pendiente de hacer por el usuario):
1. Generar las muestras: `pnpm --filter lector-pdf interop:samples` (quedan en `apps/lector-pdf/interop-samples/`, fuera de git).
2. Abrir con Adobe `estandar-basic-5.pdf`, `estandar-annotated.pdf` y `estandar-form.pdf`.
3. En la página 1 deben verse seis marcas: resaltado amarillo, subrayado azul, tachado rojo, nota con icono de comentario verde, texto libre y trazo cian.
4. El panel de comentarios de Adobe lista las seis con autor «Prueba» y el texto con acentos y «€».
5. Responder a una nota en Adobe y guardar (Ctrl+S) sin mensajes de error.
6. Reabrir el fichero en el Lector PDF: las anotaciones siguen ahí; en `estandar-annotated.pdf` también las que ya traía el fichero y en `estandar-form.pdf` el formulario.
7. Con el Lector PDF, en una copia de `estandar-basic-5.pdf`: dibujar un polígono y colocar los sellos «APROBADO» y «NO APROBADO», guardar (Ctrl+S) y abrir el fichero con Adobe. El panel de comentarios de Adobe debe listar el sello como «Sello» y el polígono como «Polígono», y el sello «APROBADO» debe verse con su texto.
