---
tipo: tarea
id: PDF-000
titulo: Título corto en imperativo
app: pdf
estado: pendiente   # pendiente | en-curso | en-revision | en-test | cambios-pedidos | hecha | bloqueada | sustituida
depende_de: []      # p. ej. [PDF-001, PDF-002]
intentos: 0         # rondas rechazadas por revisor o tester; a las 3 se escala al líder
skills: []          # skills extra que el programador debe leer, p. ej. [formatos-ofimatica, stack-tauri]
creado: AAAA-MM-DD
actualizado: AAAA-MM-DD
tags: [tarea]
---

# {{id}} · {{titulo}}

Plan: [[Plan]] · Decisiones: [[ADR-NNNN-...]] · Investigación: [[...]]

## Objetivo
Una o dos frases: qué tiene que existir o funcionar cuando la tarea esté hecha.

## Contexto
- Ficheros que hay que leer antes de empezar: `ruta/a/fichero`
- Decisiones ya tomadas que afectan a esta tarea.

## Qué hay que hacer
1. Paso concreto (ficheros, nombres de funciones, firmas, tipos, formatos).

## Criterios de aceptación
- [ ] Comprobable: `comando` produce `salida esperada`.
- [ ] Hay un test automático que cubre ...
- [ ] Puntos aplicables de calidad profesional (teclado, deshacer, errores, rendimiento...).
- [ ] Lint, typecheck y todos los tests pasan.

## Fuera de alcance
- Lo que NO hay que tocar ni hacer en esta tarea.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
