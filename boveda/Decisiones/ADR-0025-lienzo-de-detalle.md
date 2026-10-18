---
tipo: decision
id: ADR-0025
app: pdf
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, pdf, visor, rendimiento]
---

# ADR-0025 · Zoom hasta 6 400 % con un lienzo de detalle de la zona visible

## Contexto
El lienzo de cada página está limitado a 33 554 432 píxeles ([[ADR-0007-motor-y-visor-pdf]]): por encima de ~300 % en A4 (según la densidad de pantalla) la página se ve borrosa. Adobe llega a 6 400 %. El visor de pdf.js resuelve lo mismo con `enableDetailCanvas` (segundo lienzo solo de la zona visible), ver [[Librerias y arquitectura PDF]] §2.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **A. Un lienzo de detalle por página visible**, del tamaño de la intersección página ∩ visor (+ 25 % de margen), dibujado con `viewport` desplazado | Sencillo; memoria acotada (≤ tamaño del visor × densidad) | Se redibuja al desplazar fuera del margen |
| B. Teselas (mosaico de 512 px con caché) | Desplazamiento muy fluido | Mucho más código (caché, prioridades, costuras) |
| C. Subir el límite de lienzo | Trivial | Agota la memoria en móviles y webviews |

## Decisión
**Opción A.**
- `MAX_ZOOM` pasa a 64 (6 400 %); pasos nuevos `…, 8, 12, 16, 24, 32, 48, 64`; el campo de zoom admite 10-6 400.
- Si `planCanvas(...).capped` es `true`, la página lleva además un lienzo de detalle: zona = intersección del marco con el visor ampliada 25 % por lado y recortada a la página, a densidad completa (`devicePixelRatio`), dibujada con `page.getViewport({ scale, rotation, offsetX: −x, offsetY: −y })` en un lienzo de ese tamaño, posicionado con `left/top` absolutos sobre el lienzo base. Se redibuja (cola de render, prioridad visible, cancelable) cuando la zona visible sale de la zona dibujada, con un retardo de 150 ms tras el último scroll.
- El lienzo base sigue dibujándose (capado) para que nunca haya hueco en blanco; el de detalle se libera al salir la página del visor o al bajar el zoom.
- Modo noche: se aplica igual al lienzo de detalle.
- Presupuesto: lienzos vivos ≤ 12 base + 1 de detalle por página visible.

## Consecuencias
- A 3 200 % el texto se ve nítido; el desplazamiento rápido muestra el lienzo base estirado durante ≤ 150 ms + render.
- La capa de texto y la de anotaciones no cambian (son CSS/SVG escalables).
