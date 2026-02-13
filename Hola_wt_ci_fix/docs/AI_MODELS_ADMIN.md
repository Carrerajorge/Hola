# Admin: AI Models

## Objetivo
- El panel debe exponer y permitir habilitar solo modelos realmente utilizables: `enabled + active + integrated + chat-capable`.
- Evitar estados invalidos (por ejemplo: `inactive` pero `isEnabled=true`).

## Definiciones
- `Status`: `active` / `inactive` (operativo). Si es `inactive`, el modelo no puede estar habilitado.
- `Activo` (`isEnabled`): controla si el modelo aparece en el selector publico (`/api/models/available`).
- `Integrado`: provider soportado por el runtime y con API key configurada.
- `Chat-capable`: `modelType` en `TEXT|MULTIMODAL` y `modelId` compatible (`gemini*` / `grok*`).

## API Keys (integracion)
- Gemini: `GEMINI_API_KEY` o `GOOGLE_API_KEY`
- xAI: `XAI_API_KEY` o `GROK_API_KEY` o `ILIAGPT_API_KEY`

## Endpoints clave
- Admin GET `/api/admin/models/filtered?scope=integrated|supported|all`
- Admin GET `/api/admin/models/stats?scope=integrated|supported|all`
- Admin GET `/api/admin/models/providers/list?scope=integrated|supported|all`
- Admin POST `/api/admin/models/sync?scope=integrated|supported|all`
- Admin PATCH `/api/admin/models/:id` (si `status` pasa a `inactive`, fuerza `isEnabled=false`)
- Admin PATCH `/api/admin/models/:id/toggle` (habilitar/deshabilitar con validacion dura)
- Admin POST `/api/admin/models/:id/test`
- Admin GET `/api/admin/models/health`
- Public GET `/api/models/available` (solo modelos elegibles)

## Operacion (checklist)
1. Configurar API keys (Gemini/xAI).
2. Admin -> AI Models: `Scope = Integrados`.
3. `Sincronizar Todo`.
4. Poner `Status = Activo` en el/los modelos deseados.
5. Habilitar `Activo` (si falla, el backend devuelve `409` con el motivo).
6. `Acciones -> Test` para validar latencia/errores.

## 10 mejoras criticas implementadas
1. `scope=integrated` como default operativo (solo providers con keys presentes).
2. `/api/models/available` filtra por elegibilidad real: `enabled + active + integrated + chat-capable`.
3. Toggle `Activo` via `/toggle` con validaciones server-side (no se habilita "algo roto").
4. `Sincronizar Todo` respeta `scope` para evitar poblar BD con providers no integrados.
5. UI muestra estado real por modelo: `UNSUPPORTED / NO KEY / NO CHAT / OK`.
6. Switches bloqueados con `title` explicando el por que (menos confusion, menos soporte).
7. `Acciones` agrega `Test` por modelo y `Salud` por provider (latencia + error).
8. Optimistic UI + rollback para updates (sensacion instantanea sin mentir si falla).
9. Compatibilidad legacy de keys: xAI (`XAI_API_KEY|GROK_API_KEY|ILIAGPT_API_KEY`) y Gemini (`GEMINI_API_KEY|GOOGLE_API_KEY`).
10. Integridad de datos: al pasar `Status` a `inactive`, el modelo se deshabilita automaticamente.

