# cumulo-agentes · suite ofimática personal

Proyecto de uso personal (no comercial): procesador de texto, lector de PDF, presentaciones y hoja de cálculo que sustituyan de verdad a Word, Adobe Reader, PowerPoint y Excel. Calidad profesional y completa.

## Tecnología (ADR-0001, decidida por el usuario)
TypeScript + React (Vite), empaquetado como escritorio con Tauri 2 y funcionando también en el navegador. Monorepo pnpm: `apps/<app>/`, `packages/`.

## Cómo se trabaja aquí
- Equipo de agentes en `.claude/agents/`: `investigador`, `lider`, `programador`, `revisor`, `tester`. Skills de experto en `.claude/skills/`.
- Para arrancar un objetivo: `/dirigir-equipo <objetivo>`.
- **Toda la documentación va en la bóveda de Obsidian `boveda/`** según la skill `documentar-obsidian`: planes en `boveda/Apps/<App>/Plan.md`, fichas en `boveda/Apps/<App>/Tareas/`, decisiones en `boveda/Decisiones/`, investigación en `boveda/Investigacion/`, bitácora diaria en `boveda/Bitacora/`.
- Flujo de una ficha: pendiente → en-curso → en-revision → en-test → hecha. Rechazo → `cambios-pedidos`; a los 3 rechazos se escala al líder.

## Normas para todos los agentes
- Documentación y textos de la interfaz en español; código e identificadores en inglés.
- Nunca desactivar ni saltar tests para que pasen.
- No añadir dependencias que no estén decididas en un Plan o ADR.
- Ningún dato del usuario sale del ordenador; nunca subir documentos personales al repositorio.
