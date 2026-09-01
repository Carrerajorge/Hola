# Code Review Checklist - IliaGPT

Lista de verificacion basada en el analisis real del codigo del proyecto.
Cada seccion incluye los hallazgos encontrados para que el equipo los priorice.

---

## 1. Seguridad Tipado TypeScript

**Estado actual: 140+ usos de `any` detectados**

- [ ] No se usa `any` — definir tipos o interfaces apropiados
- [ ] Los parametros de funciones callback tienen tipos explicitos (no `(err: any, user: any)`)
- [ ] Los `useRef<any>` en React tienen el tipo generico correcto

**Archivos criticos a corregir:**
| Archivo | Usos de `any` | Prioridad |
|---------|--------------|-----------|
| `server/routes.ts` | 40+ | Alta |
| `client/src/components/chat-interface.tsx` | 5+ | Alta |
| `client/src/pages/admin.tsx` | 20+ | Media |
| `server/db.ts` | 7 | Alta |
| `server/routes/userRouter.ts` | 3 | Media |
| `server/routes/stripeRouter.ts` | 1 | Baja |
| `client/src/services/runProgress.ts` | 4 | Media |
| `client/src/components/charts/smart-table.tsx` | 5 | Media |

---

## 2. Seguridad de Aplicacion

**Hallazgos criticos encontrados:**

### 2.1 SQL Injection
- [ ] Todas las queries SQL usan el tag `sql` de Drizzle (parametros preparados)
- [ ] No hay interpolacion de strings `${variable}` en queries raw

**Archivos a revisar:**
- `server/routes/webhooksRouter.ts` — lineas 108, 218, 235, 264
- `server/routes/templatesRouter.ts` — lineas 57, 62, 67, 72, 85, 142
- `server/routes/apiKeysRouter.ts` — lineas 185, 219, 290
- `server/replit_integrations/auth/storage.ts` — lineas 128-134, 142-143

### 2.2 XSS / HTML Injection
- [ ] Todo uso de `dangerouslySetInnerHTML` pasa por `DOMPurify.sanitize()`
- [ ] El contenido de usuario nunca se renderiza como HTML sin sanitizar

**13 usos de `dangerouslySetInnerHTML` detectados en:**
- `client/src/lib/content/components/blocks/RawHtmlBlock.tsx:30`
- `client/src/components/artifact-viewer.tsx:473, 586`
- `client/src/components/document-renderer.tsx:119`
- `client/src/components/document-preview-panel.tsx:96`
- `client/src/components/diagram-generator.tsx:264`
- `client/src/components/code-block-shell.tsx:258`
- `client/src/components/math-renderer.tsx:222, 235`
- `client/src/lib/content/components/blocks/MathBlock.tsx:64, 87`
- `client/src/lib/content/components/blocks/CodeBlock.tsx:241, 413`
- `client/src/components/ui/chart.tsx:79`

### 2.3 Credenciales
- [ ] No hay secrets hardcodeados en el codigo fuente
- [ ] Las variables de entorno nuevas se documentan en `.env.example`
- [ ] Los archivos `.env` no se commitean (verificar `.gitignore`)

**Hallazgo:** `.env` y `.env.backup-*` estan en el repositorio. Verificar que no contengan secretos reales.

### 2.4 Validacion de Input
- [ ] Los endpoints de Express validan body/params/query con Zod (patron: `validateBody()`)
- [ ] Los uploads validan tipo MIME y tamano

**Rutas sin validacion detectadas:**
- `server/routes/webhooksRouter.ts` — destructura `req.body` sin schema
- `server/routes/terminalControlRouter.ts` — `parseInt()` sin verificar NaN
- `server/routes/apiKeysRouter.ts` — validacion manual en vez de Zod
- `server/routes/agentRoutes.ts` — inyecta mock user en dev sin proteccion

**Buen ejemplo a seguir:** `server/routes/userRouter.ts:91` usa `validateBody(z.object(...))`

---

## 3. Manejo de Errores

**Hallazgos: bloques catch vacios y promesas sin manejar**

- [ ] No hay bloques `catch {}` vacios — al menos loguear el error
- [ ] Todas las promesas tienen `.catch()` o estan en `try/catch`
- [ ] No hay patrones fire-and-forget (`Promise.resolve().then(...)` sin catch)
- [ ] Los endpoints devuelven codigos HTTP apropiados en caso de error

**Archivos con catch vacios:**
- `server/replit_integrations/auth/storage.ts:422, 443, 444` — `try { ... } catch {}`
- `server/parsers/structured/pdfExtractor.ts:394, 397, 421`

**Promesas sin manejar:**
- `server/routes.ts:1290-1345` — cadena `.then()` sin `.catch()` final
- `server/migrate.ts:14-16` — `.then(() => process.exit(0))` sin catch (el proceso cuelga si falla)
- `server/routes/mcp/gmailMcpServer.ts:910`

---

## 4. Rendimiento React

- [ ] Los `.map()` usan keys unicos (NO `key={index}`)
- [ ] No hay re-renders innecesarios (memoizar donde aplique)
- [ ] Los componentes grandes estan divididos en subcomponentes

### 4.1 Keys basados en indice (40+ instancias)
Causan bugs de reconciliacion cuando las listas cambian:

- `client/src/components/suggested-replies.tsx:22`
- `client/src/components/editors/PptEditor.tsx:26`
- `client/src/components/virtual-computer.tsx:374`
- `client/src/components/prompt-suggestions.tsx:107`
- `client/src/components/upgrade-plan-dialog.tsx:334`
- `client/src/components/message-list.tsx:1461, 1799, 1865`

### 4.2 Componentes excesivamente grandes
| Componente | Lineas | Accion |
|-----------|--------|--------|
| `client/src/components/chat-interface.tsx` | **11,182** | Dividir urgente |
| `client/src/components/settings-dialog.tsx` | **3,830** | Extraer secciones |
| `client/src/components/message-list.tsx` | **2,801** | Separar logica de render |

---

## 5. Logging y Observabilidad

**Estado actual: 130+ console.log en produccion**

- [ ] Usar `Pino` (server) en vez de `console.log`
- [ ] Eliminar `console.log` de debug del cliente antes de merge
- [ ] Las operaciones criticas emiten trazas de OpenTelemetry

**Archivos del servidor con console.log (debe ser Pino):**
- `server/webhookHandlers.ts:59, 83`
- `server/memory/ContextOrchestrator.ts:178, 189`
- `server/memory/UserMemoryStore.ts:169, 206, 398`
- `server/memory/SemanticMemoryStore.ts:232, 327, 370, 549, 655`
- `server/routes/calendarOAuthRouter.ts:30, 44, 178, 248`
- `server/routes/outlookOAuthRouter.ts:145, 276, 364, 496`
- `server/routes/gmailOAuthRouter.ts:35, 49, 147, 197, 248`
- `server/routes/figmaRouter.ts:18, 26, 52, 75`
- `server/mcp/toolDiscovery.ts:131, 149, 366`
- `server/replit_integrations/auth/replitAuth.ts:73, 102, 107, 325, 371, 404`

**Archivos del cliente con console.log:**
- `client/src/components/chat-interface.tsx` — 13 instancias
- `client/src/lib/excelOrchestrator.ts` — 11 instancias
- `client/src/hooks/use-chats.ts` — 10 instancias
- `client/src/lib/polling-manager.ts` — 4 instancias

---

## 6. Testing

**Estado actual: gaps criticos de cobertura**

- [ ] Se incluyen tests para logica nueva
- [ ] Los tests validan comportamiento real (no solo mocks)
- [ ] Los tests cubren casos de error y edge cases

### 6.1 Gaps criticos de cobertura
| Area | Tests | Fuentes | Cobertura |
|------|-------|---------|-----------|
| `server/routes/` (114 routers) | 0 | 114 | **0%** |
| `client/src/components/` | 10 | 330 | **3%** |
| E2E flows | 9 specs | App completa | Minima |

### 6.2 Tests con assertions debiles
Tests que siempre pasan sin validar logica real:

```typescript
// MAL - tests/unit/chat.test.ts:75
const validRoles = ['user', 'assistant', 'system'];
expect(validRoles.includes('user')).toBe(true); // Siempre pasa

// BIEN
const result = await chatService.createMessage({ role: 'invalid' });
expect(result.error).toBe('Invalid role');
```

### 6.3 Cobertura solo en `server/core/`
El threshold de 90% en `vitest.config.ts` solo aplica a `server/core/**`, dejando `server/routes/`, `server/lib/` y `server/agent/` sin cobertura obligatoria.

---

## 7. Estilo y Consistencia

- [ ] El codigo pasa ESLint (`npm run lint`)
- [ ] Los tipos compilan sin errores (`npm run type-check`)
- [ ] Los commits siguen commitlint (`feat:`, `fix:`, `chore:`)
- [ ] Estilos con Tailwind CSS, no inline `style={{}}` cuando hay clase equivalente
- [ ] Los tipos compartidos estan en `shared/`, no duplicados entre client/server

---

## 8. Despliegue

- [ ] Las configuraciones de Docker estan actualizadas si aplica
- [ ] Los scripts de migracion de Drizzle se ejecutan sin errores
- [ ] No se rompe compatibilidad con el cliente desktop (Electron)
- [ ] Los jobs de BullMQ manejan reintentos y timeouts

---

## Como Usar esta Checklist

1. **Antes de abrir PR:** El autor verifica los items relevantes a sus cambios
2. **Durante review:** El revisor usa las secciones aplicables como guia
3. **Deuda tecnica:** Usar las tablas de archivos criticos para planificar sprints de limpieza
4. **CI/CD:** Considerar agregar reglas de ESLint para `no-explicit-any` y `no-console`

### Reglas sugeridas para ESLint
```javascript
// eslint.config.js - agregar:
"@typescript-eslint/no-explicit-any": "warn",
"no-console": ["warn", { allow: ["warn", "error"] }],
```

### Prioridades de remediacion
| Prioridad | Tarea | Impacto |
|-----------|-------|---------|
| P0 | Verificar `.env` no tenga secretos reales | Seguridad |
| P0 | Auditar queries SQL con interpolacion | Seguridad |
| P1 | Agregar validacion Zod a rutas sin proteger | Seguridad |
| P1 | Eliminar catch vacios en server | Estabilidad |
| P2 | Migrar console.log a Pino en server | Observabilidad |
| P2 | Reemplazar `key={index}` por keys unicos | UX/Bugs |
| P3 | Reducir uso de `any` (140+ instancias) | Mantenibilidad |
| P3 | Dividir componentes gigantes (chat-interface) | Mantenibilidad |
| P4 | Agregar tests a rutas del servidor (0%) | Calidad |
