# IliaGPT - Plan de Mejoras Completo

## Estado: EN PROGRESO
**Fecha inicio:** 2026-02-01
**Última actualización:** 2026-02-01

---

## FASE 1: Crítico (Prioridad Alta)

### 1.1 LLMs Respondiendo Correctamente
- [x] Verificar configuración xAI (Grok)
- [x] Verificar configuración Gemini
- [ ] Health check de LLMs en dashboard
- [ ] Fallback automático entre proveedores
- [ ] Logs claros de errores de LLM

### 1.2 Responsive Design (Móviles)
- [x] CSS mobile.css existe con optimizaciones iPhone
- [ ] Verificar viewport meta tag
- [ ] Touch targets mínimo 44px
- [ ] Safe area insets para notch/Dynamic Island
- [ ] Testear en diferentes breakpoints

### 1.3 Compatibilidad Global
- [ ] Verificar charset UTF-8
- [ ] Internacionalización de fechas
- [ ] Soporte RTL (árabe, hebreo)
- [ ] Fallback de fuentes

---

## FASE 2: Admin Panel Endpoints

### 2.1 Dashboard (/api/admin/dashboard)
- [x] Endpoint existe y devuelve datos
- [ ] Agregar métricas de LLM (latencia, errores)
- [ ] Estado de servicios externos

### 2.2 Users (/api/admin/users)
- [ ] Lista + paginación + búsqueda
- [ ] Bloquear usuario
- [ ] Editar rol
- [ ] Auditoría de acciones

### 2.3 Conversations (/api/admin/conversations)
- [ ] Listado con filtros
- [ ] Ver conversación
- [ ] Exportar
- [ ] Archivar

### 2.4 AI Models (/api/admin/models)
- [ ] Activar/desactivar con confirmación
- [ ] Health check real

### 2.5 Payments (/api/admin/finance/payments)
- [ ] Exportación CSV/Excel

### 2.6 Invoices (/api/admin/finance/invoices)
- [ ] Resend invoice
- [ ] Mark as paid

### 2.7 Analytics (/api/admin/analytics)
- [ ] Filtros por fecha
- [ ] Cache con TTL

### 2.8 Database (/api/admin/database)
- [ ] Backup con permisos
- [ ] Restore con permisos

### 2.9 Security (/api/admin/security)
- [ ] Toggles de CSP/CSRF/rate limit

### 2.10 Reports (/api/admin/reports)
- [ ] Exportar PDF/Excel

### 2.11 Settings (/api/admin/settings)
- [ ] Guardar solo cambios (diff)

### 2.12 Agent Engine (/api/admin/agent)
- [ ] Health check
- [ ] Preview

### 2.13 Excel Manager (/api/admin/excel)
- [ ] Health check
- [ ] Preview

---

## FASE 3: Workspace/Chat

### 3.1 New Chat
- [x] Crea conversación correctamente
- [x] No pierde mensajes en background (pendingFlushResolvers fix)

### 3.2 Send Message
- [ ] Validar input vacío
- [ ] Deshabilitar mientras envía
- [ ] Indicador de estado

### 3.3 Sidebar
- [ ] Persistir estado (localStorage)
- [ ] Transiciones suaves

### 3.4 AI Steps Rail
- [ ] Colapsar/expandir mantiene estado

### 3.5 Document View
- [ ] Abrir editor correcto según tipo

### 3.6 Acciones de Chat
- [ ] Pin sincronizado
- [ ] Archive sincronizado
- [ ] Folder sincronizado

---

## FASE 4: Backend - Seguridad y Performance

### 4.1 Validaciones
- [ ] Variables de entorno al iniciar
- [ ] CSP por entorno
- [ ] CORS por entorno
- [ ] CSRF efectivo

### 4.2 Resiliencia
- [ ] Idempotencia en mutaciones
- [ ] Rate limit por usuario+IP
- [ ] Circuit breaker + bulkhead
- [ ] Reconexión WS/SSE

### 4.3 Observabilidad
- [ ] Error handler unificado
- [ ] Métricas por tool
- [ ] Feature flags

---

## FASE 5: Limpieza

### 5.1 Duplicados Detectados
- [ ] test_results/agent_certification_report.md vs agent_certification_2026-01-19T16-47-38-148Z.txt
- [ ] artifacts/E2E_Test_Document_1767720517700.txt vs E2E_Test_Document_1767720541572.txt

---

## Archivos Clave Modificados
- `client/src/hooks/use-chats.ts` - Queue fix
- `client/src/styles/mobile.css` - Responsive
- `server/routes/admin/*` - Admin endpoints
- `server/lib/llmGateway.ts` - LLM gateway

---

## Comandos Útiles
```bash
# Desarrollo local
npm run dev

# Build
npm run build

# Deploy a VPS
git push origin main
ssh -p 8022 root@69.62.98.126 "cd /var/www/michat && git pull && npm install && npm run build && pm2 restart michat --update-env"
```
