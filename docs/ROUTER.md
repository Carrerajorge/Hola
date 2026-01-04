# Router System - Chat vs Agent Mode

Sistema de enrutamiento híbrido que decide automáticamente si una solicitud debe manejarse con chat simple o con el modo agente (con herramientas).

## Arquitectura

```
Usuario → Router → ┌─ Chat Simple (respuesta rápida)
                   └─ Agent Mode (herramientas + pasos)
```

## Decisión Híbrida

El router utiliza un enfoque en cascada:

1. **Heurísticas rápidas** - Patrones regex para detectar necesidades obvias
2. **Análisis de complejidad** - Evaluación multidimensional del prompt
3. **LLM Router** - Fallback a modelo de IA para casos ambiguos

## Configuración

### Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `ROUTER_CONFIDENCE_THRESHOLD` | `0.65` | Umbral mínimo de confianza para activar agente |
| `MAX_AGENT_STEPS` | `8` | Máximo de pasos que puede ejecutar el agente |
| `ENABLE_DYNAMIC_ESCALATION` | `true` | Permite escalar de chat a agente dinámicamente |

### Ejemplo de Configuración

```bash
export ROUTER_CONFIDENCE_THRESHOLD=0.7
export MAX_AGENT_STEPS=10
export ENABLE_DYNAMIC_ESCALATION=true
```

## API Endpoints

### POST /api/chat/route

Decide la ruta para un mensaje.

**Request:**
```json
{
  "message": "Busca el precio del bitcoin hoy",
  "hasAttachments": false
}
```

**Response:**
```json
{
  "route": "agent",
  "confidence": 0.9,
  "reasons": ["Requiere búsqueda web"],
  "tool_needs": ["web_search"],
  "plan_hint": ["Buscar información en la web", "Generar respuesta final"]
}
```

### POST /api/chat/agent-run

Ejecuta el agente con un objetivo.

**Request:**
```json
{
  "message": "Investiga el precio actual del bitcoin",
  "planHint": ["Buscar precio", "Extraer datos", "Responder"]
}
```

**Response:**
```json
{
  "success": true,
  "result": "El precio actual del bitcoin es...",
  "state": {
    "objective": "...",
    "plan": ["..."],
    "toolsUsed": ["web_search"],
    "stepsCompleted": 3,
    "status": "completed"
  }
}
```

### POST /api/chat/escalation-check

Verifica si una respuesta de chat necesita escalarse a agente.

**Request:**
```json
{
  "response": "Necesito buscar información actualizada para responder."
}
```

**Response:**
```json
{
  "shouldEscalate": true,
  "reason": "Necesita búsqueda web"
}
```

## Herramientas del Agente

| Herramienta | Descripción |
|-------------|-------------|
| `web_search(query)` | Busca información en la web |
| `open_url(url)` | Navega a una URL y extrae contenido |
| `extract_text(content)` | Procesa y limpia texto |
| `final_answer(answer)` | Devuelve la respuesta final |

## Patrones de Detección

### Rutas a Agent (alta confianza)

- `Busca en la web...` → `web_search`
- `Navega a https://...` → `open_url`
- `Genera un documento Excel...` → `generate_file`
- `Ejecuta este código...` → `execute_code`
- `Usa el agente...` → explicit_agent (100%)

### Rutas a Chat (alta confianza)

- `¿Qué es X?` → Definiciones simples
- `Explica...` → Explicaciones conceptuales
- `Resume...` → Resúmenes de texto
- Saludos y despedidas

## Escalamiento Dinámico

Si `ENABLE_DYNAMIC_ESCALATION=true`, el sistema detecta cuando una respuesta de chat indica necesidad de herramientas:

- "Necesito buscar..." → Escalar a agente
- "No tengo acceso a..." → Escalar a agente
- "Información actualizada..." → Escalar a agente

## Ejecutar Tests

```bash
npm test -- server/__tests__/router.test.ts
```

## Logs

El router genera logs estructurados:

```
[Router] Initialized with threshold=0.65, dynamicEscalation=true
[Router] Heuristic match: web_search → agent (confidence=0.9) (15ms)
[AgentRunner] Starting agent run for objective: "..."
[AgentRunner] Step 0: web_search({"query":"..."})
[AgentRunner] Step 0 completed: success=true, duration=1234ms
```

## Flujo de Integración

```typescript
import { decideRoute, checkDynamicEscalation } from "./services/router";
import { runAgent } from "./services/agentRunner";

async function handleMessage(userText: string) {
  const decision = await decideRoute(userText);
  
  if (decision.route === "agent" && decision.confidence >= 0.65) {
    const result = await runAgent(userText, decision.plan_hint);
    return result.result;
  }
  
  const chatResponse = await chatSimple(userText);
  
  const escalation = checkDynamicEscalation(chatResponse);
  if (escalation.shouldEscalate) {
    const result = await runAgent(userText);
    return result.result;
  }
  
  return chatResponse;
}
```
