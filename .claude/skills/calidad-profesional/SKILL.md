---
name: calidad-profesional
description: Definición de "terminado" a nivel profesional para la suite (lo que un usuario de Office o Adobe espera encontrar), con lista de comprobación de experiencia de uso, fiabilidad, rendimiento y seguridad. Úsala al planificar una app o funcionalidad, al escribir criterios de aceptación y al revisar o probar si algo está listo para entregar.
---

# Calidad profesional

El objetivo es que estas apps **sustituyan de verdad** a Word, Excel, PowerPoint y Adobe Reader en el día a día del usuario. Una función a medias es peor que no tenerla: se planifica completa o no entra en la iteración.

## Lista de "terminado" para toda funcionalidad visible
**Experiencia de uso**
- [ ] Se puede hacer con ratón y con teclado; tiene su atajo estándar si lo tiene en Office.
- [ ] Deshacer/rehacer funciona para la acción.
- [ ] Estados vacíos, de carga y de error diseñados (nunca pantalla en blanco ni error en inglés técnico).
- [ ] Textos en español claro; tooltips en botones de icono.
- [ ] Tema claro y oscuro; respeta el escalado del sistema (125 %, 150 %).

**Fiabilidad**
- [ ] No se pierden datos: autoguardado/recuperación tras cierre inesperado; aviso al cerrar con cambios.
- [ ] Guardar es atómico (escribir a temporal y renombrar) para no corromper el original.
- [ ] Ficheros dañados o no soportados: mensaje claro y, si es posible, recuperar lo legible.

**Rendimiento**
- [ ] Cumple los presupuestos de la skill `pruebas-calidad` con documentos grandes.
- [ ] Nada bloquea la interfaz más de 100 ms; tareas largas con progreso y cancelar.

**Compatibilidad**
- [ ] Ida y vuelta con ficheros de Microsoft Office/Adobe sin pérdida de lo soportado y conservando lo no soportado.

**Seguridad y privacidad**
- [ ] Ningún dato sale del ordenador (sin telemetría, sin servicios externos) salvo decisión explícita del usuario.
- [ ] Documentos tratados como entrada no confiable (ver `stack-tauri`).

## Cómo usar esta lista
- **Líder**: al escribir una ficha, copia los puntos que apliquen como criterios de aceptación concretos y comprobables.
- **Revisor**: rechaza si falta un punto que aplica y la ficha no lo excluye explícitamente en "Fuera de alcance".
- **Tester**: verifica cada punto aplicable con evidencia.

## Paridad con los programas de pago
Para cada app, el investigador mantiene en la bóveda una nota `Investigacion/<App> - paridad de funciones.md` con las funciones de la competencia (Office, Adobe, LibreOffice, OnlyOffice) clasificadas en **imprescindible / importante / opcional**. El líder planifica las iteraciones siguiendo ese orden y marca en la nota lo que ya está hecho.
