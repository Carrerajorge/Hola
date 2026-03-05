# OpenClaw Skills Integration Audit (ILIACODEX)

Fecha: 2026-02-16

## 1) Estado actual (antes y después de esta implementación)

### Lo que ya existía
- **UI de skills** en cliente (explorer/selector y persistencia de skill activa vía backend).
- **API de skills** en backend:
  - `GET /api/skills`
  - `GET /api/skills/active`
  - `PUT /api/skills/active`
  - CRUD/import/ensure/generate en `server/routes/skillsRouter.ts`.
- **Resolver técnico** de skill context: `server/services/skillContextResolver.ts`.
  - Resolvía `skillId` + fallback legado `skill` (objeto cliente).

### Qué estaba desconectado
- El resolver (`resolveSkillContextFromRequest`) **no estaba conectado al flujo real de chat** (`/api/chat` y `/api/chat/stream`).
- La skill activa (`users.preferences.skills.activeSkillId`) no participaba automáticamente en la resolución del chat.
- No había endpoint backend para estado/listado runtime de skills OpenClaw (solo skills de app).
- No había trazas específicas en chat para confirmar cuándo se aplicó skill.

## 2) Mapa de rutas críticas

### Entrada de chat real
- `POST /api/chat` (router AI): `server/routes/chatAiRouter.ts`
- `POST /api/chat/stream` (SSE): `server/routes/chatAiRouter.ts`

### Gestión de skills de usuario
- `GET /api/skills` → lista skills persistidas usuario
- `GET /api/skills/active` → skill activa en `users.preferences.skills.activeSkillId`
- `PUT /api/skills/active` → set/clear skill activa
- Nuevo: `GET /api/skills/openclaw/runtime` → snapshot runtime OpenClaw (con fallback)

### Montaje de rutas
- `app.use("/api", createChatAiRouter(...))` en `server/routes.ts`
- `app.use("/api/skills", createSkillsRouter())` en `server/routes.ts`

## 3) Cambios implementados en esta entrega

### Integración funcional del resolver en chat real
- Se integró `resolveSkillContextFromRequest` en:
  - `POST /api/chat`
  - `POST /api/chat/stream`
- Se añadió soporte de resolución por prioridad:
  1. `skillId` explícito por request (también si `skill` llega como string/id)
  2. fallback a `activeSkillId` de `users.preferences`
  3. fallback legado a `skill` objeto cliente

### Inyección segura al system prompt
- Nuevo helper: `buildSkillSystemPromptSection(skillContext)`.
- Sanitización y límites:
  - remoción de caracteres de control
  - normalización de saltos de línea
  - límite estricto de instrucciones para inyección (4000 chars)
- En `/api/chat`: se inyecta como mensaje `system` prependido al arreglo de mensajes enviado al chat service.
- En `/api/chat/stream`:
  - se inyecta en fast-path (`llmGateway.chat`)
  - se añade al `systemContent` principal del flujo stream

### Endpoint runtime OpenClaw (adapter + fallback explícito)
- Nuevo servicio: `server/services/openclawSkillsRuntimeAdapter.ts`.
- Nuevo endpoint: `GET /api/skills/openclaw/runtime`.
- Comportamiento:
  - si `OPENCLAW_SKILLS_RUNTIME_URL` existe y responde JSON válido, devuelve snapshot runtime.
  - si no existe/falla/timeout, retorna fallback explícito (`runtimeAvailable:false`, `fallback:true`, `skills:[]`) sin romper contrato.

### Trazas / observabilidad
- Logs en aplicación de skill:
  - `[SkillContext] Applied to /api/chat`
  - `[SkillContext] Applied to /api/chat/stream`
- Incluyen `source`, `skillId`, `skillName`, `requestId` (stream).

## 4) Compatibilidad y riesgos

### Compatibilidad
- Cambios backward-compatible:
  - se mantiene soporte de `skill` objeto legado
  - no se elimina ningún endpoint previo
  - no se rompe contrato existente de `/api/chat` y `/api/chat/stream`

### Riesgos pendientes
- El runtime OpenClaw depende de integración externa (`OPENCLAW_SKILLS_RUNTIME_URL`); por defecto opera en fallback explícito.
- Inyectar skill en system prompt aumenta tokens de prompt; mitigado con límite y sanitización.
- El stream tiene múltiples ramas rápidas; se cubrieron fast-path + flujo principal, pero nuevas ramas futuras deberán mantener la misma política de inyección.
