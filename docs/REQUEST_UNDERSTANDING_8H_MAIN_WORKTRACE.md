# Request Understanding Layer - 8h Worktrace (main)

Date: 2026-02-13
Branch: main
Goal: implementar y estabilizar una capa obligatoria de User Intent & Requirement Analysis antes de ejecutar acciones.

## Scope
- Brief estructurado obligatorio: objetivo, alcance, supuestos, entradas necesarias, salida esperada, validaciones, definition of done.
- Planner LLM con function calling y routing de herramientas.
- Orquestacion por estado multi-paso (memory -> rag -> planner -> guardrails -> critic).
- Memoria persistente vector + key-value para preferencias/decisiones.
- Guardrails de politicas, privacidad/PII y seguridad.
- Self-check/critic para cumplimiento del brief.
- Trazas y pruebas unitarias para iteracion segura.

## 8-Hour Timeline

### H1 (00:00-01:00) - Baseline and Interface Contract
- Levantar estado actual de request understanding en `server/agent/requestUnderstanding`.
- Definir contrato de brief v2 con campos obligatorios de requerimientos.
- Entregable: schema final y lista de campos mapeados a ejecucion.
- Validacion: schema parsea casos validos y rechaza campos faltantes.

### H2 (01:00-02:00) - Planner Core
- Implementar planner prompt con salida estructurada.
- Agregar llamada principal con function calling y fallback JSON.
- Entregable: planner devuelve brief canonical en 1 paso.
- Validacion: parse robusto + retry en salidas invalidas.

### H3 (02:00-03:00) - Graph/State Orchestration
- Implementar pipeline por etapas: memory -> rag -> planner -> guardrails -> critic.
- Registrar tiempos y estado por etapa para trazabilidad.
- Entregable: estado unico del planner con stage traces.
- Validacion: cada etapa reporta status y duracion.

### H4 (03:00-04:00) - Memory (Vector + KV)
- Recuperar memoria semantica por embedding y memoria key-value de decisiones previas.
- Inyectar contexto de memoria al planner.
- Entregable: hydration de contexto en brief generation.
- Validacion: preferencias y decisiones previas impactan routing.

### H5 (04:00-05:00) - Guardrails
- Integrar validacion de policy engine por herramientas sugeridas.
- Integrar chequeos de privacidad/PII y banderas de seguridad.
- Entregable: bloqueos seguros y aclaracion si aplica.
- Validacion: tool bloqueada no llega a ejecucion.

### H6 (05:00-06:00) - Critic/Self-Check
- Implementar evaluador de completitud del brief.
- Agregar score + issues + gate por quality threshold.
- Entregable: self_check estructurado en brief.
- Validacion: brief incompleto dispara blocker con pregunta.

### H7 (06:00-07:00) - Integration in Executors
- Forzar gate previo en `executeAgentLoop` y `superAgent`.
- Emitir evento `brief` y detener ejecucion cuando hay blocker.
- Entregable: pre-action gate obligatorio en runtime.
- Validacion: no se ejecutan tools si faltan inputs criticos.

### H8 (07:00-08:00) - Observability + Tests + Hardening
- Agregar pruebas unitarias del contrato y guardrails.
- Ejecutar type-check + tests focalizados.
- Cerrar riesgos, documentar limitaciones y siguientes pasos.
- Entregable: evidencia de calidad y salida estable.
- Validacion: pruebas en verde y sin errores de tipo.

## Success Criteria
- 100% de ejecuciones pasan por brief obligatorio antes de acciones.
- Brief incluye campos de requerimientos y DoD en todas las respuestas del planner.
- Guardrails bloquean rutas no permitidas y exponen razon.
- Self-check detecta incompletitud antes de ejecutar.
- Tests focalizados y type-check en verde.

## Definition of Done
- Gate activo en rutas de ejecucion principales.
- Planner con function calling operativo (fallback funcional).
- Memoria vector + KV usada en planning.
- Politicas/PII/security evaluadas previo a tool execution.
- Trazas de etapa y pruebas de regresion listas.
