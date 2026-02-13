# 40 MEJORAS CRÍTICAS EN FUNCIONES AGÉNTICAS - ILIAGPT

## Plan de Trabajo: 4 Horas Intensivas

**Fecha**: 2026-02-08
**Plataforma**: ILIAGPT - Motor Agéntico v3
**Alcance**: Orquestación, Planificación, Memoria, Seguridad, Calidad, Aprendizaje

---

## RESUMEN EJECUTIVO

Se han identificado **40 mejoras críticas** distribuidas en 8 subsistemas agénticos del software ILIAGPT. Cada mejora incluye: diagnóstico del problema, archivo afectado, líneas de código, impacto en producción y solución propuesta. El plan de trabajo está diseñado para ejecutarse en **4 horas** con priorización por severidad e impacto.

---

## DISTRIBUCIÓN DEL PLAN DE 4 HORAS

| Bloque | Tiempo | Foco | Mejoras |
|--------|--------|------|---------|
| **HORA 1** | 00:00 - 01:00 | Motor de Intención + Decisión Autónoma | #1 - #10 |
| **HORA 2** | 01:00 - 02:00 | Planificador HTN + Pipeline Agéntico | #11 - #20 |
| **HORA 3** | 02:00 - 03:00 | Memoria + Compresión + Cache | #21 - #30 |
| **HORA 4** | 03:00 - 04:00 | Guardrails + Calidad + Aprendizaje | #31 - #40 |

---

## HORA 1: MOTOR DE INTENCIÓN + DECISIÓN AUTÓNOMA (00:00 - 01:00)

---

### MEJORA #1 — Eliminar Scoring Aleatorio en Intent Router
- **Severidad**: CRÍTICA
- **Archivo**: `server/services/intent-engine/intentPlanner.ts` (líneas 528-535)
- **Problema**: Los intents no reconocidos reciben `Math.random() * 0.1` como score. Esto genera comportamiento no-determinístico: la misma consulta del usuario puede ser enrutada a diferentes agentes en cada ejecución.
- **Impacto en producción**: Usuarios reportan respuestas inconsistentes. Imposible depurar errores de enrutamiento. Los tests pasan y fallan intermitentemente.
- **Solución**:
  ```typescript
  // ANTES (no-determinístico)
  intentScores[intent] = Math.random() * 0.1;

  // DESPUÉS (determinístico con decay por distancia)
  intentScores[intent] = Math.max(0, 0.05 - (index * 0.005));
  ```
- **Tiempo estimado**: 8 min

---

### MEJORA #2 — Race Condition en Feedback Loop del Intent Engine
- **Severidad**: CRÍTICA
- **Archivo**: `server/services/intent-engine/feedbackLoop.ts` (línea 241)
- **Problema**: `processFeedbackBatch()` elimina registros de feedback mientras los procesadores aún están ejecutándose. No hay atomicidad — las correcciones del usuario pueden perderse entre la lectura y el borrado.
- **Impacto en producción**: El sistema "olvida" correcciones del usuario. El modelo de intención no mejora con el uso real. Pérdida silenciosa de datos de entrenamiento.
- **Solución**: Envolver lectura → procesamiento → borrado en una transacción de base de datos. Usar `SELECT ... FOR UPDATE SKIP LOCKED` para evitar contención.
- **Tiempo estimado**: 10 min

---

### MEJORA #3 — Bloqueo en Inicialización de Embeddings Semánticos
- **Severidad**: ALTA
- **Archivo**: `server/services/intent-engine/index.ts` (línea 340)
- **Problema**: El índice de embeddings semánticos se carga de forma lazy pero bloquea el router durante la carga. Si el servicio de embeddings falla, no hay mecanismo de cancelación — el router queda bloqueado indefinidamente.
- **Impacto en producción**: Primera consulta después de reinicio tarda 5-15 segundos. Si embeddings están caídos, todo el enrutamiento se congela.
- **Solución**: Implementar inicialización asíncrona con timeout de 3 segundos y fallback a clasificación por reglas mientras se cargan los embeddings.
- **Tiempo estimado**: 8 min

---

### MEJORA #4 — Conformal Prediction Recalculado en Cada Request
- **Severidad**: ALTA
- **Archivo**: `server/services/intent-engine/intentPlanner.ts` (línea 574)
- **Problema**: El conjunto de predicción conformal se reconstruye en cada solicitud, a pesar de ser computacionalmente costoso y que los datos de calibración cambian infrecuentemente.
- **Impacto en producción**: Latencia añadida de 50-200ms por request. Consumo excesivo de CPU en alta concurrencia.
- **Solución**: Cachear el conjunto conformal con invalidación temporal (TTL 5 minutos) o por evento (cuando se agregan nuevos datos de calibración).
- **Tiempo estimado**: 6 min

---

### MEJORA #5 — Fallback LLM sin Exponential Backoff
- **Severidad**: ALTA
- **Archivo**: `server/services/intent-engine/intentPlanner.ts` (línea 620)
- **Problema**: Cuando los clasificadores primarios (reglas + KNN) fallan, el fallback a LLM no implementa backoff exponencial. Reintenta inmediatamente, amplificando la carga en un proveedor que probablemente ya está saturado.
- **Impacto en producción**: Cascada de fallos cuando xAI/Gemini están degradados. Rate limiting agresivo por parte del proveedor. Costos innecesarios por reintentos fallidos.
- **Solución**: Implementar retry con backoff exponencial (1s, 2s, 4s) + jitter aleatorio. Máximo 3 reintentos con circuit breaker compartido con llmGateway.
- **Tiempo estimado**: 6 min

---

### MEJORA #6 — Degradación Fallback Asigna CHAT_GENERAL sin Ajuste de Confianza
- **Severidad**: ALTA
- **Archivo**: `server/services/intent-engine/intentPlanner.ts` (línea 638)
- **Problema**: Cuando TODOS los clasificadores fallan, se asigna "CHAT_GENERAL" con la confianza original sin ajustar. El sistema downstream cree que la clasificación es confiable cuando en realidad es un fallback ciego.
- **Impacto en producción**: Agentes especializados nunca se activan para queries que merecen tratamiento especial. Experiencia de usuario degradada silenciosamente.
- **Solución**: Asignar `confidence: 0.15` al fallback y marcar `isFallback: true` en el resultado para que el orquestador pueda pedir confirmación al usuario.
- **Tiempo estimado**: 4 min

---

### MEJORA #7 — Cálculo de Confianza Oversimplificado en Decision Engine
- **Severidad**: ALTA
- **Archivo**: `server/agent/autonomousDecisionEngine.ts` (líneas 442-479)
- **Problema**: La confianza se calcula con bonos fijos (+0.2, +0.1) sumados linealmente y acotados entre 0.1 y 0.99. No hay normalización — los bonos no consideran interacciones. La penalización por complejidad es estática (-0.05, -0.15) sin importar la complejidad real de la tarea.
- **Impacto en producción**: Decisiones autónomas incorrectas — el agente aprueba acciones que debería escalar al usuario, o pide confirmación para tareas triviales.
- **Solución**: Implementar cálculo bayesiano de confianza que combine: (1) probabilidad prior del intent, (2) verosimilitud basada en historial de éxito del agente, (3) factor de complejidad dinámico medido por profundidad del plan.
- **Tiempo estimado**: 10 min

---

### MEJORA #8 — Selección de Agente sin Validación de Disponibilidad
- **Severidad**: ALTA
- **Archivo**: `server/agent/autonomousDecisionEngine.ts` (líneas 481-530)
- **Problema**: Cuando `suggestedAgents` está vacío, se asigna "orchestrator" sin justificación. No se valida si los agentes sugeridos están realmente disponibles o tienen capacidad. Las herramientas de formato de output se agregan sin resolver dependencias.
- **Impacto en producción**: Tareas asignadas a agentes no disponibles fallan silenciosamente. El orchestrator recibe tareas que no puede delegar.
- **Solución**: Consultar `agentRegistry.getAvailableAgents()` antes de asignar. Implementar fallback ordenado: agente preferido → agente compatible → orchestrator con plan explícito.
- **Tiempo estimado**: 6 min

---

### MEJORA #9 — Plan de Ejecución sin Detección de Loops
- **Severidad**: ALTA
- **Archivo**: `server/agent/autonomousDecisionEngine.ts` (líneas ~540-570)
- **Problema**: `generateExecutionPlan()` no detecta loops. Si el agente A necesita output del agente B, y B necesita output de A, se genera un plan infinito. Las herramientas se agregan sin verificar disponibilidad real.
- **Impacto en producción**: Planes de ejecución que nunca terminan. Consumo infinito de tokens y tiempo de computación.
- **Solución**: Implementar detección de ciclos con grafo dirigido (DFS + visited set). Rechazar planes con ciclos y solicitar reformulación.
- **Tiempo estimado**: 8 min

---

### MEJORA #10 — Preferencias de Usuario sin Decaimiento Temporal
- **Severidad**: MEDIA
- **Archivo**: `server/agent/autonomousDecisionEngine.ts` (línea 672)
- **Problema**: Las preferencias solo se actualizan con llamada explícita a `updatePreferences()`. No hay aprendizaje automático de resultados de ejecución. No hay decay de preferencias obsoletas. Los scores se limitan a [0,1] — no pueden representar patrones negativos fuertes.
- **Impacto en producción**: El sistema no se adapta al comportamiento cambiante del usuario. Preferencias de hace meses tienen el mismo peso que las de hoy.
- **Solución**: Aplicar decay exponencial con `λ = 0.98` por día. Auto-actualizar preferencias basándose en acciones completadas vs canceladas.
- **Tiempo estimado**: 6 min

---

## HORA 2: PLANIFICADOR HTN + PIPELINE AGÉNTICO (01:00 - 02:00)

---

### MEJORA #11 — Deadlock no Resuelto en Ejecución de Tareas HTN
- **Severidad**: CRÍTICA
- **Archivo**: `server/agent/htnPlanner.ts` (líneas 671-697)
- **Problema**: La detección de deadlock está rota. Cuando se detectan tareas pendientes sin progreso, todas se marcan como fallidas sin intentar resolver dependencias circulares. No hay replanificación dinámica.
- **Impacto en producción**: Planes complejos con dependencias se cuelgan. El agente no puede completar flujos multi-step como "investigar → analizar → generar reporte".
- **Solución**: Implementar detección de ciclos con algoritmo de Kahn. Al detectar ciclo, romper la dependencia más débil (menor prioridad) y reintentar. Agregar timeout de 30s por tarea con fallback.
- **Tiempo estimado**: 12 min

---

### MEJORA #12 — Retry Logic Incompleto en HTN
- **Severidad**: CRÍTICA
- **Archivo**: `server/agent/htnPlanner.ts` (líneas 723-744)
- **Problema**: Los reintentos ocurren DENTRO de la ejecución paralela pero las tareas re-agregadas no se encolan correctamente. No hay backoff exponencial — se re-ejecuta inmediatamente. El propio código comenta que esto es "tricky" y no está implementado.
- **Impacto en producción**: Tareas fallidas por errores transitorios (timeout API, rate limit) nunca se recuperan. El plan entero falla por un error temporal.
- **Solución**: Implementar cola de reintentos separada con backoff: 1s → 2s → 4s. Máximo 3 reintentos por tarea. Marcar como fallo permanente solo después de agotar reintentos.
- **Tiempo estimado**: 10 min

---

### MEJORA #13 — Race Condition en Aplicación de Efectos del Mundo
- **Severidad**: CRÍTICA
- **Archivo**: `server/agent/htnPlanner.ts` (línea 717)
- **Problema**: `applyAllEffects()` modifica el estado del mundo durante ejecución paralela. Múltiples tareas actualizando los mismos hechos sin locking. No hay rollback de transacción si una tarea falla. Los efectos se aplican incluso si tareas dependientes fallan.
- **Impacto en producción**: Estado del mundo corrupto. Tareas posteriores toman decisiones basadas en estado incorrecto. Resultados impredecibles en ejecución paralela.
- **Solución**: Implementar Copy-on-Write para el estado del mundo. Cada tarea trabaja con snapshot. Merge de efectos solo al completar con éxito, usando locking optimista.
- **Tiempo estimado**: 10 min

---

### MEJORA #14 — Métricas y Estadísticas Dummy en HTN
- **Severidad**: MEDIA
- **Archivo**: `server/agent/htnPlanner.ts` (líneas 864-865)
- **Problema**: `getStats()` retorna valores dummy. No hay tracking de latencia por tarea, consumo de recursos, ni monitoreo de progreso real.
- **Impacto en producción**: Imposible diagnosticar planes lentos. No se puede optimizar sin datos. Dashboard de admin muestra datos falsos.
- **Solución**: Instrumentar con timestamps reales: `taskStartTime`, `taskEndTime`, `retryCount`, `resourceUsage`. Exponer via endpoint `/api/agent/stats`.
- **Tiempo estimado**: 6 min

---

### MEJORA #15 — Persistencia de Runs con Errores Silenciosos
- **Severidad**: CRÍTICA
- **Archivo**: `server/agent/agentPipeline.ts` (líneas 82-176)
- **Problema**: `persistRun()` captura errores silenciosamente sin reintentar. `updateRunStatus()` no maneja actualizaciones concurrentes. `persistStep()` usa `onConflictDoNothing` — pierde datos ante claves duplicadas. No hay agrupación transaccional.
- **Impacto en producción**: Ejecuciones de agentes se pierden de la base de datos. El historial del usuario tiene huecos. Imposible auditar qué hizo el agente.
- **Solución**: Implementar retry con backoff para persistencia. Usar `onConflictDoUpdate` en vez de `DoNothing`. Agrupar operaciones en transacciones.
- **Tiempo estimado**: 8 min

---

### MEJORA #16 — Emisión de Eventos Silenciosa en Pipeline
- **Severidad**: CRÍTICA
- **Archivo**: `server/agent/agentPipeline.ts` (líneas 716-738)
- **Problema**: Los errores de emisión de eventos solo se loguean con `console.error` y se continúa. Los consumidores nunca saben que un plan fue creado hasta que un step comienza. No hay cola de eventos ni mecanismo de reintento.
- **Impacto en producción**: Trazas de ejecución incompletas. Debugging imposible en producción. El frontend no recibe actualizaciones de estado.
- **Solución**: Implementar cola de eventos en memoria con flush a Redis. Eventos críticos (plan_created, step_failed, run_completed) deben reintentar 3 veces antes de silenciarse.
- **Tiempo estimado**: 8 min

---

### MEJORA #17 — Retry de Steps NO Re-ejecuta el Step
- **Severidad**: CRÍTICA
- **Archivo**: `server/agent/agentPipeline.ts` (líneas 564-571)
- **Problema**: El bloque de retry contiene `continue` que SALTA al siguiente step en vez de re-ejecutar el step fallido. La flag `critical` está indefinida para la mayoría de steps. Max retries está hardcodeado.
- **Impacto en producción**: Ningún step se reintenta realmente. Los fallos transitorios (timeout de API) fallan permanentemente. El plan reporta éxito parcial cuando debería reintentar.
- **Solución**:
  ```typescript
  // ANTES (salta al siguiente step)
  retryCount++;
  continue;

  // DESPUÉS (re-ejecuta el step actual)
  retryCount++;
  i--; // Decrementar para volver al mismo step
  await sleep(1000 * Math.pow(2, retryCount)); // Backoff
  continue;
  ```
- **Tiempo estimado**: 6 min

---

### MEJORA #18 — Verificación de Resultado Débil
- **Severidad**: ALTA
- **Archivo**: `server/agent/agentPipeline.ts` (líneas 672-680)
- **Problema**: Captura TODOS los errores de verificación y retorna éxito parcial. Asume que >80% de éxito es suficiente sin analizar qué falló. No hay intento de recuperación ni análisis detallado de fallos.
- **Impacto en producción**: Resultados parcialmente incorrectos se entregan al usuario como "exitosos". Errores de calidad no detectados.
- **Solución**: Clasificar fallos de verificación en recuperables (reintentar step) y no-recuperables (informar al usuario). Threshold configurable por tipo de tarea.
- **Tiempo estimado**: 6 min

---

### MEJORA #19 — Memory Leak en activeRuns
- **Severidad**: ALTA
- **Archivo**: `server/agent/agentPipeline.ts` (línea 395)
- **Problema**: `activeRuns.delete()` solo está en el bloque `finally`, pero si se lanza una excepción antes de llegar ahí, el run permanece en memoria indefinidamente. No hay TTL para runs atascados.
- **Impacto en producción**: Acumulación progresiva de memoria. Después de días sin reinicio, el proceso consume GBs de RAM. Eventual OOM kill.
- **Solución**: Implementar TTL de 10 minutos para activeRuns con cleanup periódico via `setInterval`. Registrar runs huérfanos como fallidos.
- **Tiempo estimado**: 5 min

---

### MEJORA #20 — Pipeline sin Señal de Cancelación
- **Severidad**: ALTA
- **Archivo**: `server/agent/agentPipeline.ts`
- **Problema**: No existe mecanismo para cancelar un pipeline en ejecución. Si el usuario cierra el chat o cancela, los steps siguen ejecutándose hasta completar (consumiendo tokens y recursos).
- **Impacto en producción**: Desperdicio de recursos y costos de API. Usuarios frustrados ven actividad después de cancelar. Posibles side-effects no deseados.
- **Solución**: Implementar `AbortController` propagado a cada step. El frontend envía señal de cancelación via WebSocket. Cada step verifica `signal.aborted` antes de ejecutar.
- **Tiempo estimado**: 8 min

---

## HORA 3: MEMORIA + COMPRESIÓN + CACHE (02:00 - 03:00)

---

### MEJORA #21 — N Llamadas Paralelas a Embedding API
- **Severidad**: CRÍTICA
- **Archivo**: `server/services/conversationMemory.ts` (líneas 153-159)
- **Problema**: Para cada mensaje que se descarta, se solicita un embedding individual. Con 100 mensajes, se realizan 100 llamadas paralelas a la API de embeddings. Cada llamada cuesta dinero y agrega latencia.
- **Impacto en producción**: Costos de embedding 10-50x mayores a lo necesario. Latencia de 2-5 segundos en compresión de contexto. Rate limiting del proveedor de embeddings.
- **Solución**: Usar API de batch embeddings: agrupar hasta 100 textos en una sola llamada. Cachear embeddings por hash de contenido para evitar recálculo.
- **Tiempo estimado**: 8 min

---

### MEJORA #22 — Hash de Deduplicación con Riesgo de Colisión
- **Severidad**: MEDIA
- **Archivo**: `server/services/conversationMemory.ts` (líneas 47-49)
- **Problema**: Se usa MD5 truncado a 12 caracteres para deduplicación. `trim().toLowerCase()` pierde contexto importante (mayúsculas en nombres propios, formateo). 12 caracteres = 48 bits = colisión probable con >250K mensajes.
- **Impacto en producción**: Mensajes diferentes tratados como duplicados. Pérdida de contexto en conversaciones largas.
- **Solución**: Usar SHA-256 truncado a 16 caracteres (64 bits). No aplicar `toLowerCase()` — usar normalización Unicode NFKC en su lugar.
- **Tiempo estimado**: 4 min

---

### MEJORA #23 — Knowledge Graph Fire-and-Forget
- **Severidad**: ALTA
- **Archivo**: `server/services/conversationMemory.ts` (líneas 111-135)
- **Problema**: La ingesta al Knowledge Graph es fire-and-forget con `.catch()` que solo loguea warning. No se verifica si el KG está disponible antes de intentar. La extracción de resumen asume que el KG existe.
- **Impacto en producción**: Resúmenes de KG vacíos sin error visible. El sistema pierde contexto semántico sin saberlo. Fallos silenciosos degradan calidad de respuestas.
- **Solución**: Verificar `knowledgeGraph.isReady()` antes de ingestar. Implementar retry con 2 intentos. Si KG no disponible, usar fallback a resumen extractivo local.
- **Tiempo estimado**: 6 min

---

### MEJORA #24 — Budget de Tokens No Considera Tokens de Respuesta
- **Severidad**: ALTA
- **Archivo**: `server/services/conversationMemory.ts` (líneas 171-218)
- **Problema**: Si el 80% del contexto se reserva para historial, no queda espacio suficiente para la respuesta del modelo. La sumarización puede no ahorrar suficientes tokens (sin loop iterativo). Se carga todo el historial de golpe en memoria.
- **Impacto en producción**: Respuestas truncadas porque el modelo se queda sin tokens de output. Out-of-memory con historiales largos.
- **Solución**: Reservar mínimo 25% del contexto para respuesta. Implementar loop iterativo: comprimir → verificar budget → comprimir más si necesario. Streaming de historial con paginación.
- **Tiempo estimado**: 8 min

---

### MEJORA #25 — Query de DB Ineficiente con Reverse
- **Severidad**: MEDIA
- **Archivo**: `server/services/conversationMemory.ts` (líneas 241-246)
- **Problema**: Se obtienen los mensajes más recientes en orden descendente y luego se revierten con `.reverse()`. Esto es innecesario — se puede pedir orden ascendente directamente. Potencial problema N+1 si el storage no hace batch.
- **Impacto en producción**: Doble procesamiento innecesario. Latencia adicional en chats con muchos mensajes.
- **Solución**: Cambiar query a `orderBy: "asc"` con `offset: totalMessages - limit`. Eliminar `.reverse()`.
- **Tiempo estimado**: 3 min

---

### MEJORA #26 — Estimación de Tokens Agnóstica al Idioma
- **Severidad**: ALTA
- **Archivo**: `server/services/contextCompressor.ts` (líneas 64-75)
- **Problema**: Se usa `CHARS_PER_TOKEN = 4` fijo para todos los idiomas. Chino/japonés usa 1-2 chars por token, español ~5, código ~3. Esto causa sobre-compresión en algunos idiomas y sub-compresión en otros.
- **Impacto en producción**: Contexto truncado prematuramente en español/inglés. Contexto excesivo en chino/japonés causando errores de longitud.
- **Solución**: Detectar idioma principal con heurística simple (rango Unicode) y usar ratios por idioma: `{latin: 4.5, cjk: 1.5, cyrillic: 3.5, code: 3.0}`.
- **Tiempo estimado**: 6 min

---

### MEJORA #27 — Deduplicación por Jaccard Rompe Significado
- **Severidad**: ALTA
- **Archivo**: `server/services/contextCompressor.ts` (líneas 132-148)
- **Problema**: `calculateSimilarity()` usa similitud Jaccard (overlap de palabras). "El gato comió al ratón" vs "El ratón comió al gato" = alta similitud pero significado opuesto. Threshold 0.8 es arbitrario.
- **Impacto en producción**: Mensajes con significado opuesto se eliminan como "duplicados". Pérdida de información crítica en conversaciones.
- **Solución**: Usar embeddings semánticos para deduplicación cuando estén disponibles. Fallback a Jaccard solo con threshold 0.95. Nunca deduplicar mensajes del usuario (solo asistente).
- **Tiempo estimado**: 8 min

---

### MEJORA #28 — Sumarización Extractiva sin LLM
- **Severidad**: ALTA
- **Archivo**: `server/services/contextCompressor.ts` (líneas 112-129)
- **Problema**: La sumarización solo extrae entidades clave — no usa LLM para generar resúmenes reales. Crea marcadores artificiales `[Summary of N messages]` que rompen el parsing downstream. La extracción de entidades usa regex frágiles.
- **Impacto en producción**: Resúmenes de baja calidad que pierden contexto importante. Marcadores artificiales confunden al modelo principal.
- **Solución**: Usar LLM ligero (Haiku/Flash) para generar resúmenes de 2-3 oraciones. Formatear como mensaje de sistema válido, no como marcador artificial.
- **Tiempo estimado**: 8 min

---

### MEJORA #29 — Evicción FIFO en Cache L0 (Debería ser LRU)
- **Severidad**: ALTA
- **Archivo**: `server/services/cacheOrchestrator.ts` (línea 63)
- **Problema**: El cache en memoria usa FIFO — el primer elemento insertado se elimina primero, independientemente de cuánto se acceda. Elementos hot (frecuentemente accedidos) se eliminan igual que elementos fríos.
- **Impacto en producción**: Hit rate de cache 30-40% menor que con LRU. Queries frecuentes (dashboard, chats activos) constantemente se re-computan.
- **Solución**: Reemplazar `Map` con implementación LRU. Mover elemento al final en cada acceso. O usar librería `lru-cache` que ya está en dependencias.
- **Tiempo estimado**: 5 min

---

### MEJORA #30 — Redis Offline Permanente tras Error de Conexión
- **Severidad**: ALTA
- **Archivo**: `server/services/cacheOrchestrator.ts` (líneas 118-136)
- **Problema**: Un error de conexión a Redis desactiva el cache L1 permanentemente para todo el ciclo de vida del proceso. No hay reconexión automática. Un problema de red temporal de 1 segundo desactiva Redis hasta el próximo reinicio del servidor.
- **Impacto en producción**: Después de cualquier glitch de red, el cache L1 deja de funcionar. Todas las queries van directamente a PostgreSQL. Latencia aumenta 3-5x hasta reinicio manual.
- **Solución**: Implementar reconexión con backoff exponencial: 1s → 2s → 4s → 8s → max 30s. Verificar conexión cada 30 segundos. Restaurar L1 automáticamente cuando Redis vuelva.
- **Tiempo estimado**: 6 min

---

## HORA 4: GUARDRAILS + CALIDAD + APRENDIZAJE (03:00 - 04:00)

---

### MEJORA #31 — PII Detection con Falsos Positivos Excesivos
- **Severidad**: ALTA
- **Archivo**: `server/agent/guardrails.ts` (líneas 59-90)
- **Problema**: Los patrones regex para PII son demasiado amplios. El patrón de SSN acepta formatos inválidos. El regex de email no valida TLD. El de teléfono captura secuencias numéricas aleatorias. Tarjetas de crédito sin validación Luhn.
- **Impacto en producción**: Sobre-redacción de contenido legítimo. Números de referencia, IDs de producto y datos técnicos se censuran incorrectamente. Usuarios se quejan de respuestas con [REDACTED].
- **Solución**: Agregar validación Luhn para tarjetas. Restringir SSN a formatos válidos (no 000, 666, 9xx). Validar TLD de emails contra lista conocida. Usar libphonenumber para teléfonos.
- **Tiempo estimado**: 10 min

---

### MEJORA #32 — Validación de Descargas Incompleta
- **Severidad**: ALTA
- **Archivo**: `server/agent/guardrails.ts` (líneas 150-201)
- **Problema**: La verificación de MIME type solo emite warning pero no bloquea tipos desconocidos. La verificación de extensión es case-sensitive (".exe" pasa pero ".EXE" no se detecta). No hay protección contra bombas de descompresión. Sin rate limiting por URL.
- **Impacto en producción**: Archivos potencialmente maliciosos pasan validación. Zip bombs pueden crashear el servidor. Un actor malicioso puede abusar del agente como proxy de descarga.
- **Solución**: Bloquear MIME types no reconocidos por defecto (whitelist). Comparación case-insensitive. Límite de 100MB descomprimido. Rate limit: 10 descargas/minuto por usuario.
- **Tiempo estimado**: 8 min

---

### MEJORA #33 — Audit Log sin Persistencia ni Rotación
- **Severidad**: ALTA
- **Archivo**: `server/agent/guardrails.ts` (líneas 224-227)
- **Problema**: El log de auditoría es un array en memoria con splice simple al llegar a 10,000 entradas. Se pierde completamente al reiniciar. No hay rotación ni archivado. No hay batching de eventos similares.
- **Impacto en producción**: Imposible auditar acciones del agente después de reinicio. Compliance y debugging limitados a la sesión actual. Memoria creciente hasta el splice.
- **Solución**: Persistir audit log a tabla dedicada en PostgreSQL con particionamiento por fecha. Flush cada 100 eventos o 30 segundos. Retención configurable (30/60/90 días).
- **Tiempo estimado**: 8 min

---

### MEJORA #34 — URL Sanitization sin Validación Completa
- **Severidad**: ALTA
- **Archivo**: `server/agent/guardrails.ts` (líneas 253-254)
- **Problema**: `sanitizeUrl()` se invoca pero su comportamiento no está completamente definido. `checkDomainPolicy()` es async pero puede ser llamado sincrónicamente en otros contextos. No hay rate limit que prevenga DoS via múltiples requests.
- **Impacto en producción**: Posible SSRF (Server-Side Request Forgery). URLs internas podrían ser accedidas por el agente. Sin rate limit, un usuario puede generar miles de requests externos.
- **Solución**: Validar contra lista de dominios internos bloqueados (127.0.0.1, 10.x, 169.254.x). Implementar rate limit de 30 URLs/minuto por usuario. Asegurar que `checkDomainPolicy` siempre se espera con await.
- **Tiempo estimado**: 6 min

---

### MEJORA #35 — Quality Scoring Basado en Regex/Heurísticas
- **Severidad**: ALTA
- **Archivo**: `server/services/qualityScoring.ts` (líneas 57-138)
- **Problema**: Detección de truncación frágil ("..." aparece en muchas respuestas válidas). Patrones de error con falsos positivos ("I'm sorry" no siempre es error). Detección de oraciones incompletas rota ("Please..." es válido). Patrones de contenido desactualizados.
- **Impacto en producción**: Respuestas perfectamente válidas marcadas como "baja calidad". Respuestas realmente truncadas pasan sin detección. Métricas de calidad poco confiables.
- **Solución**: Usar LLM ligero para evaluación de calidad en muestreo (10% de respuestas). Calibrar thresholds con datos reales. Agregar patrones específicos al dominio.
- **Tiempo estimado**: 8 min

---

### MEJORA #36 — Métricas de Calidad con Pesos Arbitrarios
- **Severidad**: MEDIA
- **Archivo**: `server/services/qualityScoring.ts` (líneas 69-78)
- **Problema**: Los pesos (relevance: 0.2, accuracy: 0.2, coherence: 0.15, helpfulness: 0.15) son fijos y arbitrarios. Los mismos pesos para coding, escritura creativa e investigación académica. No hay aprendizaje online para ajustar pesos. Score final 0-1 pero UI espera 0-100.
- **Impacto en producción**: Calidad percibida no correlaciona con score calculado. Métricas inútiles para tomar decisiones de mejora.
- **Solución**: Pesos por categoría de tarea: `{coding: {accuracy: 0.4}, writing: {coherence: 0.3}, research: {relevance: 0.35}}`. Normalizar output a 0-100. Ajustar pesos mensualmente con feedback acumulado.
- **Tiempo estimado**: 6 min

---

### MEJORA #37 — Feedback de Usuario No Retroalimenta el Scoring
- **Severidad**: ALTA
- **Archivo**: `server/services/qualityScoring.ts` (líneas 256-274)
- **Problema**: El feedback del usuario se almacena pero nunca se usa para mejorar el scoring. No se analizan discrepancias (usuario califica 2 estrellas, algoritmo califica 0.9). No se agregan patrones de feedback.
- **Impacto en producción**: El sistema de calidad nunca mejora. Mismos errores de evaluación se repiten indefinidamente.
- **Solución**: Implementar pipeline de calibración: (1) Recopilar discrepancias, (2) Analizar patrones comunes, (3) Ajustar thresholds trimestralmente. Crear alerta cuando discrepancia promedio > 0.3.
- **Tiempo estimado**: 6 min

---

### MEJORA #38 — Learning System con Patrones de Topics Fijos
- **Severidad**: ALTA
- **Archivo**: `server/services/learningSystem.ts` (líneas 163-182)
- **Problema**: Solo reconoce 6 topics fijos vía regex (`research`, `code`, `writing`, etc.). No puede generalizar a nuevos topics. No hay entendimiento semántico de las consultas del usuario. Imposible agregar topics sin cambiar código.
- **Impacto en producción**: Usuarios con patrones fuera de los 6 topics predefinidos no reciben personalización. El sistema no escala a nuevos dominios.
- **Solución**: Reemplazar regex con clustering de embeddings. Agrupar queries similares automáticamente. Nombrar clusters con LLM. Permitir topics dinámicos via configuración.
- **Tiempo estimado**: 8 min

---

### MEJORA #39 — Decay Uniforme sin Distinción Temporal
- **Severidad**: MEDIA
- **Archivo**: `server/services/learningSystem.ts` (líneas 292-314)
- **Problema**: Todas las preferencias decaen uniformemente (factor 0.95). No distingue entre preferencias recientes y antiguas. No diferencia entre feedback positivo y frecuencia de uso. Valores < 0.1 se eliminan — pierde patrones negativos importantes.
- **Impacto en producción**: Preferencias recientes y fuertes se diluyen igual que preferencias antiguas y débiles. Sistema pierde patrones que el usuario estableció recientemente.
- **Solución**: Decay basado en tiempo desde última interacción: `decay = 0.99^(días_desde_último_uso)`. Preservar patrones negativos con score mínimo de -0.5 en vez de eliminar.
- **Tiempo estimado**: 5 min

---

### MEJORA #40 — Datos de Aprendizaje No Persistidos
- **Severidad**: CRÍTICA
- **Archivo**: `server/services/learningSystem.ts` (líneas 74-84)
- **Problema**: Se mantienen las últimas 500 interacciones por usuario EN MEMORIA. No se persisten a base de datos. Se pierden completamente al reiniciar el servidor. No hay límite de tamaño en objetos de metadata.
- **Impacto en producción**: Todo el aprendizaje del sistema se pierde con cada deploy o reinicio. Los usuarios experimentan "reset de personalización" regularmente. Imposible construir perfiles de uso a largo plazo.
- **Solución**: Persistir interacciones a tabla `user_learning_data` en PostgreSQL. Cargar al iniciar sesión (lazy load). Snapshot cada 50 interacciones. Límite de 10KB por objeto metadata.
- **Tiempo estimado**: 8 min

---

## RESUMEN DE IMPACTO

### Por Severidad

| Severidad | Cantidad | % del Total |
|-----------|----------|-------------|
| **CRÍTICA** | 12 | 30% |
| **ALTA** | 23 | 57.5% |
| **MEDIA** | 5 | 12.5% |

### Por Subsistema

| Subsistema | Mejoras | Severidad Promedio |
|------------|---------|-------------------|
| Intent Engine | 6 | ALTA-CRÍTICA |
| Decision Engine | 4 | ALTA |
| HTN Planner | 4 | CRÍTICA |
| Agent Pipeline | 6 | CRÍTICA-ALTA |
| Conversation Memory | 5 | ALTA |
| Context Compressor | 3 | ALTA |
| Cache Orchestrator | 2 | ALTA |
| Guardrails | 4 | ALTA |
| Quality Scoring | 3 | ALTA-MEDIA |
| Learning System | 3 | ALTA-MEDIA |

### Distribución del Plan de 4 Horas

```
HORA 1 [00:00-01:00] ████████████████████████████████ Motor Intención + Decisión
  ├─ #1  CRÍTICA  Scoring aleatorio ................. 8 min
  ├─ #2  CRÍTICA  Race condition feedback ........... 10 min
  ├─ #3  ALTA     Bloqueo embeddings ................ 8 min
  ├─ #4  ALTA     Conformal prediction cache ........ 6 min
  ├─ #5  ALTA     Backoff en fallback LLM ........... 6 min
  ├─ #6  ALTA     Fallback sin confianza ............ 4 min
  ├─ #7  ALTA     Confianza oversimplificada ........ 10 min
  ├─ #8  ALTA     Agente sin disponibilidad ......... 6 min
  ├─ #9  ALTA     Plan sin detección loops .......... 8 min
  └─ #10 MEDIA    Preferencias sin decay ............ 6 min
                                            Total: 72 min → Buffer incluido

HORA 2 [01:00-02:00] ████████████████████████████████ HTN + Pipeline
  ├─ #11 CRÍTICA  Deadlock HTN ...................... 12 min
  ├─ #12 CRÍTICA  Retry incompleto HTN .............. 10 min
  ├─ #13 CRÍTICA  Race condition efectos ............ 10 min
  ├─ #14 MEDIA    Métricas dummy .................... 6 min
  ├─ #15 CRÍTICA  Persistencia silenciosa ........... 8 min
  ├─ #16 CRÍTICA  Eventos silenciosos ............... 8 min
  ├─ #17 CRÍTICA  Retry no re-ejecuta ............... 6 min
  ├─ #18 ALTA     Verificación débil ................ 6 min
  ├─ #19 ALTA     Memory leak activeRuns ............ 5 min
  └─ #20 ALTA     Sin señal cancelación ............. 8 min
                                            Total: 79 min → Buffer incluido

HORA 3 [02:00-03:00] ████████████████████████████████ Memoria + Cache
  ├─ #21 CRÍTICA  N llamadas embedding .............. 8 min
  ├─ #22 MEDIA    Hash colisión ..................... 4 min
  ├─ #23 ALTA     KG fire-and-forget ................ 6 min
  ├─ #24 ALTA     Budget sin respuesta .............. 8 min
  ├─ #25 MEDIA    Query con reverse ................. 3 min
  ├─ #26 ALTA     Tokens agnóstico idioma ........... 6 min
  ├─ #27 ALTA     Jaccard rompe significado ......... 8 min
  ├─ #28 ALTA     Sumarización sin LLM .............. 8 min
  ├─ #29 ALTA     Cache FIFO vs LRU ................. 5 min
  └─ #30 ALTA     Redis offline permanente .......... 6 min
                                            Total: 62 min → Buffer incluido

HORA 4 [03:00-04:00] ████████████████████████████████ Guardrails + Calidad + Aprendizaje
  ├─ #31 ALTA     PII falsos positivos .............. 10 min
  ├─ #32 ALTA     Descargas incompletas ............. 8 min
  ├─ #33 ALTA     Audit log volátil ................. 8 min
  ├─ #34 ALTA     URL sin sanitización completa ..... 6 min
  ├─ #35 ALTA     Quality scoring regex ............. 8 min
  ├─ #36 MEDIA    Pesos arbitrarios ................. 6 min
  ├─ #37 ALTA     Feedback no retroalimenta ......... 6 min
  ├─ #38 ALTA     Topics fijos learning ............. 8 min
  ├─ #39 MEDIA    Decay uniforme .................... 5 min
  └─ #40 CRÍTICA  Aprendizaje no persistido ......... 8 min
                                            Total: 73 min → Buffer incluido
```

---

## ORDEN DE EJECUCIÓN RECOMENDADO (Priorizado por ROI)

### Tier 1 — Quick Wins de Alto Impacto (Primeros 30 min)
1. **#1** Eliminar `Math.random()` → Determinismo inmediato
2. **#17** Fix retry `continue` → Steps se reintentan realmente
3. **#29** FIFO → LRU → Cache hit rate +30%
4. **#25** Eliminar `.reverse()` → Optimización trivial
5. **#6** Fallback con `isFallback: true` → Transparencia

### Tier 2 — Estabilidad Crítica (30 min - 1.5 horas)
6. **#11** Deadlock HTN → Planes complejos funcionan
7. **#13** Copy-on-Write estado → Ejecución paralela segura
8. **#15** Persistencia con retry → Historial completo
9. **#19** TTL en activeRuns → Sin memory leaks
10. **#40** Persistir aprendizaje → Personalización sobrevive deploys

### Tier 3 — Calidad y Rendimiento (1.5 - 3 horas)
11-25. Mejoras de calidad, embeddings batch, LLM summarization...

### Tier 4 — Mejoras Progresivas (3 - 4 horas)
26-40. Learning dinámico, feedback loops, métricas avanzadas...

---

## MÉTRICAS DE ÉXITO POST-IMPLEMENTACIÓN

| Métrica | Antes | Después Esperado |
|---------|-------|------------------|
| Consistencia de routing | ~85% | >99% |
| Tasa de retry exitoso | 0% (roto) | >70% |
| Cache hit rate L0 | ~40% | >70% |
| Latencia compresión contexto | 2-5s | <500ms |
| Costo embeddings/mes | $X | $X * 0.15 |
| Persistencia de learning | 0% (volátil) | 100% |
| Falsos positivos PII | ~15% | <3% |
| Plans con deadlock | ~5% | <0.1% |
| Memory leaks (runs/día) | ~50 | 0 |
| Quality score correlation | 0.3 | >0.7 |

---

*Documento generado el 2026-02-08 — Análisis de 40 mejoras críticas en funciones agénticas de ILIAGPT*
