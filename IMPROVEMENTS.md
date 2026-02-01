# IliaGPT Improvements Checklist

## A) Admin Panel - Botones funcionales

### Dashboard
- [x] `/api/admin/dashboard` - Responde con datos completos
- [x] Health check de servicios (xAI, Gemini)
- [ ] Retry automático en UI

### Users
- [x] Endpoint lista con paginación/búsqueda: `GET /api/admin/users`
- [x] Ver perfil: `GET /api/admin/users/:id`
- [x] Bloquear: `POST /api/admin/users/:id/block`
- [x] Editar rol: `PUT /api/admin/users/:id`

### Conversations
- [x] Listado con filtros: `GET /api/admin/conversations`
- [x] Ver: `GET /api/admin/conversations/:id`
- [ ] Exportar conversación
- [x] Archivar: `PUT /api/admin/conversations/:id/archive`

### AI Models
- [x] Activar/desactivar: `PUT /api/admin/models/:id`
- [ ] Health check real de cada modelo

### Payments/Finance
- [x] Listado: `GET /api/admin/finance/payments`
- [ ] Exportación CSV/Excel

### Invoices
- [x] Listado: `GET /api/admin/finance/invoices`
- [ ] Resend invoice
- [ ] Mark paid

### Analytics
- [x] Datos: `GET /api/admin/analytics`
- [ ] Filtros por fecha en UI
- [x] Cache TTL

### Database
- [x] Backup: `POST /api/admin/database/backup`
- [x] Restore: `POST /api/admin/database/restore`
- [x] Verificación de permisos admin

### Security
- [x] Toggles CSP/CSRF/rate limit: `GET/PUT /api/admin/security/config`

### Reports
- [x] Listado: `GET /api/admin/reports`
- [ ] Exportar PDF/Excel

### Settings
- [x] Guardar: `PUT /api/admin/settings`
- [x] Diff de cambios

## B) Workspace - Botones usuario
- [x] New Chat - createChat en use-chats.ts
- [x] Send - validación en chat-interface.tsx
- [x] Sidebar Toggle - estado persistido
- [x] Pines/carpetas/archivar - use-chat-folders.ts

## C) Chat Interface
- [x] Send/Stop/Retry - implementado
- [x] Upload files - validación
- [x] Mic/Voice - voice-chat-mode.tsx
- [x] Share - share-chat-dialog.tsx
- [x] Download - export-chat-dialog.tsx
- [x] Thumbs Up/Down - feedbackRouter.ts

## D) Mejoras Backend
- [x] CSP headers - securityHeaders.ts
- [x] CSRF - csrf.ts
- [x] Rate limit - userRateLimiter.ts
- [x] Error handler - errorHandler.ts
- [x] Idempotency - idempotency.ts
- [x] Circuit breaker - circuitBreaker.ts
- [x] Cache - responseCache.ts

## E) LLM Funcionando
- [x] Gemini API key configurada
- [x] OpenAI API key configurada
- [x] xAI API key configurada
- [ ] Health check real (actualmente disabled)

## F) Responsive/Mobile
- [x] iPhone styles - mobile.css
- [x] Safe areas iOS
- [x] Touch targets 44px
- [x] RTL support
- [x] International fonts

## G) Limpieza
- [ ] Eliminar duplicados en test_results/
- [ ] Eliminar duplicados en artifacts/

---

## Pending Tasks
1. Implementar exportación CSV/Excel en Payments
2. Implementar exportación PDF en Reports
3. Habilitar health check real de LLMs
4. Limpiar archivos duplicados
