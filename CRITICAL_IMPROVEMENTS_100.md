# 100 Mejoras Críticas para ILIAGPT

> Análisis exhaustivo del codebase — Generado 2026-03-05

---

## CATEGORÍA 1: SEGURIDAD (Mejoras 1–25)

### 1. **API Keys expuestas en `.env` commiteado al repositorio**
- **Archivo:** `.env` (líneas 20-65)
- **Severidad:** CRÍTICA
- **Detalle:** El archivo `.env` contiene claves reales de OpenAI, xAI, Gemini, Stripe (LIVE keys), Twilio, Telegram, Google OAuth, Figma, Scopus y más. Están en el historial de git.
- **Acción:** Rotar TODAS las claves inmediatamente. Eliminar `.env` del historial con `git filter-branch` o BFG. Usar un gestor de secretos (Vault, AWS Secrets Manager).

### 2. **Stripe LIVE keys en el archivo `.env`**
- **Archivo:** `.env:45-47`
- **Severidad:** CRÍTICA
- **Detalle:** `rk_live_*` y `pk_live_*` son claves de producción de Stripe. Un atacante podría realizar operaciones financieras.
- **Acción:** Rotar en dashboard de Stripe inmediatamente. Mover a secretos seguros.

### 3. **Credenciales SMTP de Gmail expuestas**
- **Archivo:** `.env:28-29`
- **Severidad:** CRÍTICA
- **Detalle:** Password de aplicación de Gmail (`xrhhkrbctxbwuefn`) expuesto en texto plano.
- **Acción:** Revocar app password y generar uno nuevo fuera del repositorio.

### 4. **Token de Telegram Bot expuesto**
- **Archivo:** `.env:63`
- **Severidad:** ALTA
- **Detalle:** `TELEGRAM_BOT_TOKEN` permite control total del bot.
- **Acción:** Revocar token con @BotFather y regenerar.

### 5. **Credenciales de Twilio (producción y test) expuestas**
- **Archivo:** `.env:50-60`
- **Severidad:** ALTA
- **Detalle:** Account SID, Auth Token, API Key y Secret de Twilio expuestos.
- **Acción:** Rotar todas las credenciales en consola de Twilio.

### 6. **`SESSION_SECRET` hardcodeado y expuesto**
- **Archivo:** `.env:5`
- **Severidad:** ALTA
- **Detalle:** Permite forjar cookies de sesión si es conocido por un atacante.
- **Acción:** Generar nuevo secret aleatorio, inyectar como variable de entorno en runtime.

### 7. **`TOKEN_ENCRYPTION_KEY` expuesto**
- **Archivo:** `.env:65`
- **Severidad:** ALTA
- **Detalle:** Clave de cifrado de tokens expuesta, permite descifrar tokens almacenados.
- **Acción:** Rotar y usar sistema de gestión de secretos.

### 8. **`ANON_TOKEN_SECRET` débil**
- **Archivo:** `.env:39`
- **Severidad:** MEDIA
- **Detalle:** Valor `a1b2c3d4e5f6` es trivialmente adivinable.
- **Acción:** Usar un valor criptográficamente aleatorio de al menos 32 bytes.

### 9. **26 archivos con `eval()` en el servidor**
- **Archivos:** `server/services/skillPlatform.ts`, `server/pipeline/deterministicChatPipeline.ts`, `server/routes/ragRouter.ts`, `server/services/spreadsheetLlmAgent.ts`, `server/agent/sandbox/taskPlanner.ts` y 21 más
- **Severidad:** CRÍTICA
- **Detalle:** `eval()` permite ejecución de código arbitrario. Si input no sanitizado llega a estos, es RCE (Remote Code Execution).
- **Acción:** Reemplazar con parsers seguros (JSON.parse, vm2/isolated-vm para sandboxing, o funciones específicas).

### 10. **11 archivos con `dangerouslySetInnerHTML` en el cliente**
- **Archivos:** `client/src/components/artifact-viewer.tsx`, `document-renderer.tsx`, `RawHtmlBlock.tsx`, `math-renderer.tsx`, etc.
- **Severidad:** ALTA
- **Detalle:** Potencial XSS si el contenido no está sanitizado adecuadamente.
- **Acción:** Verificar que TODO uso pase por DOMPurify antes de renderizar. Auditar `client/src/lib/sanitize.ts`.

### 11. **Shell access sin restricciones en desarrollo**
- **Archivo:** `.env:72-75`
- **Severidad:** ALTA
- **Detalle:** `ILIAGPT_LOCAL_FULL_SHELL=true` y `ILIAGPT_LOCAL_ALLOWED_ROOTS=/` da acceso root completo al sistema de archivos.
- **Acción:** Nunca habilitar en producción. Agregar validación server-side que bloquee estas variables si `NODE_ENV=production`.

### 12. **`trust proxy` configurado globalmente**
- **Archivo:** `server/index.ts:57`
- **Severidad:** MEDIA
- **Detalle:** `app.set("trust proxy", 1)` puede ser abusado para IP spoofing si no hay proxy real.
- **Acción:** Configurar solo cuando hay un reverse proxy verificado. Validar X-Forwarded-For.

### 13. **Rate limiting se puede evadir sin Redis**
- **Archivo:** `server/middleware/rateLimiter.ts`
- **Severidad:** MEDIA
- **Detalle:** Fallback a `RateLimiterMemory` si Redis falla. En cluster multi-proceso, cada worker tiene su propia memoria = rate limits no compartidos.
- **Acción:** Considerar rate limiting a nivel de nginx/load balancer como capa adicional.

### 14. **Falta validación de Content-Type en uploads**
- **Archivo:** `server/storage.ts`
- **Severidad:** ALTA
- **Detalle:** Archivo de 126KB+ sin validación estricta de tipos MIME. Permite potencialmente subir ejecutables disfrazados.
- **Acción:** Validar magic bytes (no solo extensión), limitar tipos MIME permitidos, escanear archivos.

### 15. **Docker Compose expone puertos internos**
- **Archivos:** `docker-compose.yml`, `docker-compose.infra.yml`
- **Severidad:** MEDIA
- **Detalle:** Servicios internos (Redis, PostgreSQL, Meilisearch) potencialmente expuestos en `0.0.0.0`.
- **Acción:** Bind a `127.0.0.1` para servicios internos. Usar redes Docker internas.

### 16. **Swagger UI expuesto en producción**
- **Archivo:** `server/routes.ts:15-17`
- **Severidad:** MEDIA
- **Detalle:** Swagger UI se importa sin verificar si estamos en producción, exponiendo documentación de API completa.
- **Acción:** Condicionar a `NODE_ENV !== 'production'` o proteger con autenticación.

### 17. **Falta CSP (Content Security Policy) estricta**
- **Archivo:** `server/middleware/securityHeaders.ts`
- **Severidad:** MEDIA
- **Detalle:** Con tantos componentes que renderizan HTML dinámico, una CSP estricta es esencial para prevenir XSS.
- **Acción:** Implementar CSP con nonces para scripts inline.

### 18. **Google OAuth Client Secret expuesto**
- **Archivo:** `.env:31-32`
- **Severidad:** ALTA
- **Detalle:** `GOCSPX-*` es el client secret de Google OAuth.
- **Acción:** Rotar en Google Cloud Console.

### 19. **Figma Client Secret expuesto**
- **Archivo:** `.env:35-36`
- **Severidad:** MEDIA
- **Detalle:** Credenciales de Figma API en texto plano.
- **Acción:** Rotar en dashboard de Figma.

### 20. **Falta sanitización en rutas de sistema de archivos**
- **Archivos:** `server/routes/localControlRouter.ts`, `server/routes/macosControlRouter.ts`, `server/routes/systemControlRouter.ts`
- **Severidad:** CRÍTICA
- **Detalle:** Routers de control local/macOS/sistema pueden ser vectores de path traversal.
- **Acción:** Validar y normalizar todas las rutas. Rechazar `../`, null bytes, y rutas absolutas fuera del workspace.

### 21. **Sandbox execution puede escapar**
- **Archivo:** `server/agent/sandbox/`
- **Severidad:** ALTA
- **Detalle:** El sistema de sandbox ejecuta código generado por IA. Si el aislamiento no es perfecto, es RCE.
- **Acción:** Usar contenedores Docker con seccomp, namespaces, y límites de recursos estrictos.

### 22. **Falta auditoría de dependencias**
- **Archivo:** `package.json` (323 dependencias directas)
- **Severidad:** MEDIA
- **Detalle:** Con 323+ dependencias, la superficie de ataque de supply chain es enorme.
- **Acción:** Ejecutar `npm audit` regularmente. Implementar Snyk o Dependabot con auto-merge para patches.

### 23. **`--legacy-peer-deps` en Dockerfile**
- **Archivo:** `Dockerfile:19`
- **Severidad:** MEDIA
- **Detalle:** Ignora conflictos de peer dependencies, puede instalar versiones vulnerables.
- **Acción:** Resolver conflictos de peer deps adecuadamente.

### 24. **Archivos `.orig` y `.rej` en producción**
- **Archivos:** `server/storage.ts.orig`, `server/storage.ts.rej`
- **Severidad:** BAJA
- **Detalle:** Artefactos de merge/patch que no deberían estar en el repositorio.
- **Acción:** Eliminar y agregar a `.gitignore`.

### 25. **Backup de `.env` en el repositorio**
- **Archivo:** `.env.backup-2026-02-23-1545`
- **Severidad:** ALTA
- **Detalle:** Backup con credenciales anteriores (potencialmente aún válidas).
- **Acción:** Eliminar del repositorio y del historial de git.

---

## CATEGORÍA 2: ARQUITECTURA Y CÓDIGO (Mejoras 26–50)

### 26. **`server/routes.ts` es un archivo monolítico de 1,981+ líneas**
- **Severidad:** ALTA
- **Detalle:** 100+ imports de routers, toda la lógica de WebSocket, registro de rutas y middleware en un solo archivo.
- **Acción:** Dividir en módulos: `routes/index.ts`, `websocket/index.ts`, `routes/registry.ts`.

### 27. **`server/storage.ts` tiene 126KB+**
- **Severidad:** ALTA
- **Detalle:** Archivo monolítico masivo mezclando lógica de storage, queries SQL, y business logic.
- **Acción:** Descomponer por dominio: `storage/chat.ts`, `storage/user.ts`, `storage/agent.ts`, etc.

### 28. **`server/services/skillPlatform.ts` tiene 129KB+**
- **Severidad:** ALTA
- **Detalle:** Un solo archivo para todo el sistema de skills es inmantenible.
- **Acción:** Dividir en: `skills/registry.ts`, `skills/executor.ts`, `skills/validator.ts`, `skills/types.ts`.

### 29. **`server/services/chatService.ts` es ~100KB**
- **Severidad:** ALTA
- **Detalle:** Toda la lógica de chat en un archivo gigante.
- **Acción:** Separar por responsabilidad: streaming, persistencia, routing, context management.

### 30. **34+ subdirectorios en `server/agent/` sin separación clara**
- **Severidad:** MEDIA
- **Detalle:** Carpetas con funcionalidad solapada: `orchestrator`, `langgraph`, `tools`, `mcp`, `sandbox`, `superAgent`.
- **Acción:** Definir boundaries claros. Documentar responsabilidades de cada módulo.

### 31. **Archivos temporales en la raíz del proyecto**
- **Archivos:** `temp_part1.ts`, `temp_part2.ts`, `test-api-keys.ts`, `test-sse.ts`, `test_db.ts`, `test_planner.js`, `test-openclaw-fix.js`, `test-openclaw-fix.ts`, `test-error.ts`, `test-eligibility-steps.ts`, `test-local-control.ts`, `verify_tokens.ts`, `tmp_repro_model_error.cjs`
- **Severidad:** MEDIA
- **Detalle:** 13+ archivos temporales/test en la raíz contaminan el proyecto.
- **Acción:** Eliminar o mover a `tests/` y `scripts/`.

### 32. **Logs y archivos de error en el repositorio**
- **Archivos:** `check_errors.log` (1MB), `filtered_errors.log` (761KB), `storage_errors2.log` (117KB), `run_log.txt` (415KB), `server_run.log` (472KB), `test-run-current.log` (88KB), `failures-current.txt` (103KB), `cache_err.log`, `kb_err.log`, `agentRunner_errors.log`, `ts_errors.log`, `check.log`
- **Severidad:** MEDIA
- **Detalle:** Megabytes de logs commiteados al repositorio.
- **Acción:** Eliminar todos y agregar `*.log` a `.gitignore` (ya está pero estos fueron commiteados antes).

### 33. **Archivo binario de 5.2MB commiteado**
- **Archivo:** `eng.traineddata` (5.2MB), `spa.traineddata` (3.4MB)
- **Severidad:** MEDIA
- **Detalle:** Datos de entrenamiento de Tesseract OCR en el repositorio engordan el clone.
- **Acción:** Usar Git LFS o descargar en build time.

### 34. **Imagen PNG commiteada**
- **Archivo:** `landing-luxe.png` (221KB)
- **Severidad:** BAJA
- **Detalle:** Assets binarios deberían estar en CDN o Git LFS.
- **Acción:** Mover a CDN o usar Git LFS.

### 35. **7 archivos docker-compose con solapamiento**
- **Archivos:** `docker-compose.yml`, `.prod.yml`, `.infra.yml`, `.agent-ecosystem.yml`, `.fusion.yml`, `.slot.yml`, `.ragflow.yml`, `.livekit.yml`
- **Severidad:** MEDIA
- **Detalle:** Configuraciones duplicadas y difíciles de mantener sincronizadas.
- **Acción:** Consolidar en 3 archivos: base, override-dev, override-prod. Usar `extends` o profiles.

### 36. **`node_modules` anidados en subdirectorios**
- **Archivos:** `server/openclaw/node_modules/`, `server/local-runner/node_modules/`
- **Severidad:** MEDIA
- **Detalle:** Sub-proyectos con sus propios node_modules generan duplicación masiva (42K+ archivos).
- **Acción:** Usar workspaces de npm/pnpm correctamente para hoisting.

### 37. **323 dependencias directas en package.json**
- **Archivo:** `package.json`
- **Severidad:** ALTA
- **Detalle:** Número excesivo de dependencias. Muchas son innecesarias o se solapan (ej: `xlsx` y `@e965/xlsx`, `exceljs`).
- **Acción:** Auditar dependencias, eliminar duplicadas y no utilizadas. `npx depcheck`.

### 38. **Dependencias de test como dependencies (no devDependencies)**
- **Archivo:** `package.json:154-174`
- **Detalle:** `@types/*` packages, `supertest`, `@vitest/coverage-*` están en `dependencies` en vez de `devDependencies`.
- **Acción:** Mover a `devDependencies` para reducir el bundle de producción.

### 39. **Múltiples sistemas de gestión de paquetes**
- **Archivos:** `package-lock.json` (npm), `pnpm-lock.yaml` (pnpm), `pnpm-workspace.yaml`
- **Severidad:** MEDIA
- **Detalle:** Ambigüedad sobre qué package manager usar.
- **Acción:** Elegir uno (npm o pnpm) y eliminar el otro lockfile.

### 40. **Scripts de deploy como shell scripts sueltos**
- **Archivos:** `deploy.sh`, `deploy_direct.sh`, `deploy_nginx.sh`, `deploy_update.sh`, `deploy_vps.sh`, `deploy_with_expect.sh`, `full_deploy.sh`, `fix_vps_env.sh`, `fix_pm2.sh`, `nuclear_repair.sh`, `aggressive_repair.sh`, `production_env_setup.sh`, `setup_optimized.sh`, `vps_fix_final.sh`, `start.sh`
- **Severidad:** MEDIA
- **Detalle:** 15+ scripts de deploy/fix sin organización, algunos con `expect` (inseguro).
- **Acción:** Consolidar en un directorio `scripts/deploy/`, eliminar scripts obsoletos, usar CI/CD.

### 41. **ESLint rules deshabilitadas masivamente**
- **Archivo:** `eslint.config.js`
- **Severidad:** ALTA
- **Detalle:** Reglas como `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any`, `no-unused-vars` están deshabilitadas.
- **Acción:** Rehabilitar gradualmente. Arreglar violaciones en vez de silenciarlas.

### 42. **TypeScript strict mode deshabilitado**
- **Archivo:** `tsconfig.json`
- **Severidad:** MEDIA
- **Detalle:** Sin `strict: true`, no se detectan errores de null/undefined, any implícito, etc.
- **Acción:** Habilitar `strict: true` gradualmente, empezando por `strictNullChecks`.

### 43. **Overrides excesivos en package.json**
- **Archivo:** `package.json:382-402`
- **Severidad:** MEDIA
- **Detalle:** 15+ overrides forzando versiones de dependencias transitivas indica problemas de compatibilidad profundos.
- **Acción:** Resolver los conflictos de versiones en la raíz, actualizar dependencias.

### 44. **Vitest coverage solo cubre `server/core/**`**
- **Archivo:** `vitest.config.ts`
- **Severidad:** ALTA
- **Detalle:** Thresholds de 90% solo aplican a `server/core/`. El 95%+ del código no tiene requisito de cobertura.
- **Acción:** Expandir coverage a `server/services/`, `server/middleware/`, `server/routes/`, `client/src/`.

### 45. **Múltiples tsconfig sin convención clara**
- **Archivos:** `tsconfig.json`, `tsconfig.base.json`, `tsconfig.check.json`, `tsconfig.ci.json`
- **Severidad:** BAJA
- **Detalle:** 4 configuraciones de TypeScript sin documentación de cuándo usar cada una.
- **Acción:** Documentar propósito de cada uno. Idealmente reducir a 2: base + ci.

### 46. **Archivos `.exp` (expect scripts) con credenciales**
- **Archivos:** `add_key.exp`, `check_pm2.exp`, `deploy_auto_final.exp`, `get_logs2.exp`, `get_vps_logs.exp`
- **Severidad:** ALTA
- **Detalle:** Scripts de `expect` son inseguros y pueden contener credenciales SSH.
- **Acción:** Reemplazar con SSH key-based auth y CI/CD pipelines.

### 47. **Directorio `Hola/` recursivo dentro del proyecto**
- **Archivos:** `Hola/`, `Hola_wt_github/`, `Hola_wt_pr/`, `Hola_wt_super_agent_100/`
- **Severidad:** MEDIA
- **Detalle:** Subdirectorios que parecen ser copias/worktrees del mismo proyecto.
- **Acción:** Eliminar del repositorio principal. Usar git worktrees fuera del repo.

### 48. **99+ TODO/FIXME/HACK en el código del servidor**
- **Archivos:** 30+ archivos en `server/`
- **Severidad:** MEDIA
- **Detalle:** Deuda técnica reconocida pero no gestionada.
- **Acción:** Crear issues en GitHub para cada TODO. Priorizar y resolver.

### 49. **Falta de monorepo tooling**
- **Severidad:** MEDIA
- **Detalle:** El proyecto tiene estructura de monorepo (`packages/`, `shared/`) pero no usa Turborepo, Nx, o similar.
- **Acción:** Implementar Turborepo para builds incrementales y caché.

### 50. **`vitest-baseline.json` y `vitest-current.json` commiteados (4.9MB)**
- **Archivos:** `vitest-baseline.json` (1.7MB), `vitest-current.json` (3.1MB)
- **Severidad:** BAJA
- **Detalle:** Archivos pesados de resultados de tests en el repositorio.
- **Acción:** Mover a artifacts de CI, no commitear.

---

## CATEGORÍA 3: RENDIMIENTO (Mejoras 51–65)

### 51. **Falta lazy loading en componentes del cliente**
- **Archivo:** `client/src/App.tsx`
- **Severidad:** ALTA
- **Detalle:** Con 307 componentes, si no hay code-splitting agresivo el bundle inicial será enorme.
- **Acción:** Usar `React.lazy()` + `Suspense` para todas las páginas y componentes pesados.

### 52. **307 componentes UI sin tree-shaking efectivo**
- **Directorio:** `client/src/components/`
- **Severidad:** MEDIA
- **Detalle:** Barrel exports (`index.ts`) pueden prevenir tree-shaking.
- **Acción:** Usar imports directos en lugar de barrel exports.

### 53. **Librerías pesadas importadas sin splitting**
- **Archivo:** `package.json`
- **Severidad:** ALTA
- **Detalle:** `three.js` (3D), `mermaid`, `echarts`, `monaco-editor`, `konva`, `handsontable` — son librerías de varios MB cada una.
- **Acción:** Dynamic import solo cuando se necesiten. No cargar en bundle principal.

### 54. **`max-old-space-size=8192` para type-checking**
- **Archivo:** `package.json:15-17`
- **Severidad:** MEDIA
- **Detalle:** Necesitar 8GB de RAM para el type-check indica un proyecto demasiado grande sin project references.
- **Acción:** Implementar TypeScript project references para compilación incremental.

### 55. **WebSocket sin heartbeat configurado**
- **Archivo:** `server/routes.ts`
- **Severidad:** MEDIA
- **Detalle:** Conexiones WebSocket zombi pueden acumularse sin mecanismo de heartbeat.
- **Acción:** Implementar ping/pong cada 30s y desconectar clientes que no respondan.

### 56. **Falta caché de queries de base de datos**
- **Severidad:** MEDIA
- **Detalle:** Queries frecuentes (permisos, configuración, skills) se ejecutan en cada request.
- **Acción:** Implementar caché con Redis o LRU para datos que no cambian frecuentemente.

### 57. **`keepAliveTimeout` excesivamente largo (605s)**
- **Archivo:** `server/index.ts:71`
- **Severidad:** MEDIA
- **Detalle:** 10 minutos de keep-alive agota file descriptors bajo carga.
- **Acción:** Reducir a 65-120 segundos. Usar connection pooling adecuado.

### 58. **`maxConnectionsPerIP: 300` muy permisivo**
- **Archivo:** `server/index.ts:73`
- **Severidad:** MEDIA
- **Detalle:** 300 conexiones por IP facilita DoS desde una sola fuente.
- **Acción:** Reducir a 50-100 y usar rate limiting por IP a nivel de nginx.

### 59. **Build de producción sin análisis de bundle**
- **Severidad:** MEDIA
- **Detalle:** Sin `rollup-plugin-visualizer` o similar, no se puede identificar qué agranda el bundle.
- **Acción:** Agregar análisis de bundle en CI para detectar regresiones de tamaño.

### 60. **Falta compresión de imágenes en pipeline de build**
- **Severidad:** BAJA
- **Detalle:** Assets estáticos no se optimizan durante el build.
- **Acción:** Agregar `vite-plugin-imagemin` o similar.

### 61. **Playwright Chromium descargado en imagen de producción**
- **Archivo:** `Dockerfile:106-109`
- **Severidad:** MEDIA
- **Detalle:** Chromium binario agrega ~400MB a la imagen Docker.
- **Acción:** Si browser automation no es necesario en todos los pods, usar una imagen separada para el browser worker.

### 62. **Sin connection pooling explícito para PostgreSQL**
- **Archivo:** `server/db.ts`
- **Severidad:** MEDIA
- **Detalle:** Pools de conexión no optimizados pueden saturar bajo carga.
- **Acción:** Configurar pool min/max basado en workers y carga esperada. Usar PgBouncer en producción.

### 63. **Falta paginación en endpoints de listado**
- **Severidad:** MEDIA
- **Detalle:** Endpoints que retornan listas (chats, documentos, agents) pueden retornar todos los registros.
- **Acción:** Implementar cursor-based pagination en todos los endpoints de listado.

### 64. **SSE streams sin timeout**
- **Severidad:** MEDIA
- **Detalle:** Server-Sent Events que no terminan consumen recursos indefinidamente.
- **Acción:** Implementar timeout máximo y reconexión graceful.

### 65. **Falta CDN para assets estáticos**
- **Severidad:** MEDIA
- **Detalle:** Servir assets desde el mismo servidor Express aumenta latencia y carga.
- **Acción:** Configurar CDN (CloudFlare, CloudFront) para assets estáticos.

---

## CATEGORÍA 4: TESTING Y CALIDAD (Mejoras 66–80)

### 66. **Cobertura de tests limitada a `server/core/`**
- **Severidad:** CRÍTICA
- **Detalle:** Solo ~5% del código tiene requisito de cobertura. Servicios críticos como `chatService`, `skillPlatform`, `storage` no están cubiertos.
- **Acción:** Expandir thresholds a todos los módulos críticos.

### 67. **Falta tests de integración para rutas API**
- **Severidad:** ALTA
- **Detalle:** Con 60+ routers, necesitan tests de integración con supertest.
- **Acción:** Crear suite de integration tests para cada router.

### 68. **E2E tests incompletos**
- **Directorio:** `e2e/`
- **Severidad:** MEDIA
- **Detalle:** Pocos specs E2E para una aplicación de esta complejidad.
- **Acción:** Agregar E2E para flujos críticos: login, chat, upload, billing.

### 69. **Tests de seguridad ausentes**
- **Severidad:** ALTA
- **Detalle:** No hay tests específicos para XSS, CSRF, injection, auth bypass.
- **Acción:** Agregar suite de security tests con OWASP ZAP o similar.

### 70. **`failures-current.txt` tiene 103KB de fallos**
- **Archivo:** `failures-current.txt`
- **Severidad:** ALTA
- **Detalle:** Archivo con miles de líneas de tests fallidos indica problemas sistémicos.
- **Acción:** Analizar y resolver los fallos. No ignorar test failures.

### 71. **Falta property-based testing**
- **Severidad:** MEDIA
- **Detalle:** `fast-check` está instalado pero no se ve uso extensivo.
- **Acción:** Usar para validación de schemas, parsers, y transformaciones de datos.

### 72. **Tests en el directorio raíz no organizados**
- **Archivos:** `test-*.ts`, `test_*.ts`, `test_*.cjs`, `test_*.mjs` en la raíz
- **Severidad:** BAJA
- **Detalle:** Tests ad-hoc sin organización.
- **Acción:** Mover a `tests/` con nomenclatura consistente.

### 73. **Falta linting de CSS/SCSS**
- **Severidad:** BAJA
- **Detalle:** No hay Stylelint configurado.
- **Acción:** Agregar Stylelint para mantener CSS consistente.

### 74. **Falta CI check para tipos TypeScript**
- **Archivo:** `.github/workflows/ci.yml`
- **Severidad:** MEDIA
- **Detalle:** `type-check` necesita 8GB RAM, puede estar deshabilitado en CI.
- **Acción:** Optimizar con project references y asegurar que corre en CI.

### 75. **Falta tests de accesibilidad (a11y)**
- **Severidad:** MEDIA
- **Detalle:** Con 307 componentes UI, no hay tests de accesibilidad automatizados.
- **Acción:** Agregar `jest-axe` o `@axe-core/playwright` en tests.

### 76. **Falta tests de rendimiento/carga**
- **Severidad:** MEDIA
- **Detalle:** Sin k6, Artillery, o similar para validar que el sistema aguanta carga.
- **Acción:** Crear suite de load tests para endpoints críticos.

### 77. **No hay smoke tests post-deploy**
- **Severidad:** MEDIA
- **Detalle:** Después del deploy no se valida que el sistema funcione.
- **Acción:** Implementar smoke tests automáticos post-deploy.

### 78. **Commit masivo de 10,000 commits en historial**
- **Git log:** `6c70a37fca Merge 10,000 commits: Auto-commit masivo sin ganchos pre-commit`
- **Severidad:** MEDIA
- **Detalle:** Un merge de 10K commits indica caos en el flujo de git.
- **Acción:** Establecer branch protection rules, required reviews, y CI gates.

### 79. **Falta pre-commit hooks efectivos**
- **Archivo:** `.husky/pre-commit`
- **Severidad:** MEDIA
- **Detalle:** El commit masivo "sin ganchos pre-commit" indica que se saltan regularmente.
- **Acción:** Hacer los hooks obligatorios. No permitir `--no-verify`.

### 80. **Sin snapshot testing para componentes UI**
- **Severidad:** BAJA
- **Detalle:** Con 307 componentes, regressions visuales pasan desapercibidas.
- **Acción:** Agregar snapshot tests o visual regression testing (Chromatic, Percy).

---

## CATEGORÍA 5: DEVOPS E INFRAESTRUCTURA (Mejoras 81–90)

### 81. **Imagen Docker demasiado grande**
- **Archivo:** `Dockerfile`
- **Severidad:** MEDIA
- **Detalle:** node_modules completos + Playwright Chromium + system libs = imagen de varios GB.
- **Acción:** Crear imágenes separadas para API y browser-worker. Usar alpine donde sea posible.

### 82. **Falta multi-stage caching en CI**
- **Severidad:** MEDIA
- **Detalle:** Cada build reconstruye todo desde cero.
- **Acción:** Usar Docker layer caching y GitHub Actions cache.

### 83. **`npm install --ignore-scripts` seguido de rebuild manual**
- **Archivo:** `Dockerfile:19-24`
- **Severidad:** BAJA
- **Detalle:** Proceso de build fragile con pasos manuales de rebuild.
- **Acción:** Resolver los scripts de postinstall para que funcionen correctamente.

### 84. **Falta health check granular**
- **Severidad:** MEDIA
- **Detalle:** Health check solo verifica que el servidor responde, no que DB, Redis, y servicios estén healthy.
- **Acción:** Implementar `/api/health/ready` (readiness) y `/api/health/live` (liveness) separados.

### 85. **Sin autoscaling configurado**
- **Severidad:** MEDIA
- **Detalle:** Solo PM2 para process management, sin Kubernetes o similar.
- **Acción:** Considerar K8s con HPA para autoscaling basado en CPU/memoria.

### 86. **Falta backup automatizado de base de datos**
- **Severidad:** ALTA
- **Detalle:** No hay evidencia de pg_dump automatizado o WAL archiving.
- **Acción:** Configurar backups incrementales diarios y WAL streaming.

### 87. **Nginx config sin rate limiting**
- **Archivo:** `nginx.conf`
- **Severidad:** MEDIA
- **Detalle:** Rate limiting solo a nivel de Express, no de nginx.
- **Acción:** Agregar `limit_req_zone` en nginx como primera línea de defensa.

### 88. **Falta blue/green o canary deployment**
- **Severidad:** MEDIA
- **Detalle:** Deploy directo sin estrategia de rollback automático.
- **Acción:** Implementar blue/green deployment con health check antes de switch.

### 89. **Monitoring/alerting incompleto**
- **Directorio:** `monitoring/`
- **Severidad:** MEDIA
- **Detalle:** Hay prom-client y OpenTelemetry, pero no se ve configuración completa de alertas.
- **Acción:** Configurar alertas para: error rate > 1%, latencia P99 > 5s, CPU > 80%, memoria > 85%.

### 90. **Sin disaster recovery plan documentado**
- **Severidad:** ALTA
- **Detalle:** No hay documentación de RTO/RPO ni procedimientos de DR.
- **Acción:** Documentar y practicar procedimientos de disaster recovery.

---

## CATEGORÍA 6: EXPERIENCIA DE DESARROLLO Y DOCUMENTACIÓN (Mejoras 91–100)

### 91. **README.md insuficiente (1.8KB)**
- **Archivo:** `README.md`
- **Severidad:** MEDIA
- **Detalle:** Para un proyecto de 42K+ archivos, el README es demasiado escueto.
- **Acción:** Expandir con: setup local, arquitectura, contribución, deploy, troubleshooting.

### 92. **Falta documentación de API**
- **Severidad:** ALTA
- **Detalle:** Swagger está configurado pero no se documenta si está completo.
- **Acción:** Documentar todos los endpoints con OpenAPI specs completas.

### 93. **No hay ADRs (Architecture Decision Records)**
- **Severidad:** MEDIA
- **Detalle:** Decisiones como "por qué LangGraph", "por qué Drizzle" no están documentadas.
- **Acción:** Crear directorio `docs/adr/` con decisiones clave.

### 94. **`.env.example` incompleto vs `.env` real**
- **Archivo:** `.env.example`
- **Severidad:** MEDIA
- **Detalle:** El `.env.example` puede no reflejar todas las variables necesarias.
- **Acción:** Sincronizar `.env.example` con todas las variables usadas en el código.

### 95. **Falta guía de onboarding para desarrolladores**
- **Severidad:** MEDIA
- **Detalle:** Con esta complejidad, un nuevo desarrollador tardará semanas en entender el sistema.
- **Acción:** Crear `docs/ONBOARDING.md` con pasos detallados y arquitectura visual.

### 96. **No hay CHANGELOG automatizado**
- **Archivo:** `CHANGELOG.md`
- **Severidad:** BAJA
- **Detalle:** CHANGELOG manual se desactualiza rápidamente.
- **Acción:** Usar `conventional-changelog` con commits semánticos (ya tienen commitlint).

### 97. **Múltiples MDs de mejoras sin consolidar**
- **Archivos:** `MEJORAS_CRITICAS.md`, `IMPROVEMENTS.md`, `IMPROVEMENT_PLAN.md`, `CONTINUOUS_IMPROVEMENT.md`, `AGENTIC_CONTROL_IMPROVEMENTS.md`, `PLAN_1000_CAPACIDADES.md`, `WORK_PLAN.md`, `PUNTO1-ESTADO.md`, `HANDOFF.md`
- **Severidad:** BAJA
- **Detalle:** 9+ documentos de mejoras/planes sin consolidar. No se sabe cuál es el actual.
- **Acción:** Consolidar en un solo documento vivo o usar GitHub Issues/Projects.

### 98. **Falta `.nvmrc` o `engines` en package.json**
- **Severidad:** BAJA
- **Detalle:** No se especifica la versión de Node.js requerida.
- **Acción:** Agregar `"engines": { "node": ">=22" }` y crear `.nvmrc`.

### 99. **Falta configuración de IDE consistente**
- **Archivo:** `.vscode/`
- **Severidad:** BAJA
- **Detalle:** Settings de VSCode incompletos para un equipo.
- **Acción:** Agregar `settings.json` y `extensions.json` recomendados.

### 100. **Sin contributor license agreement (CLA)**
- **Severidad:** BAJA
- **Detalle:** Proyecto con licencia MIT pero sin CLA para contribuidores externos.
- **Acción:** Agregar CLA bot si se acepta contribuciones externas.

---

## Resumen por Severidad

| Severidad | Cantidad | Ejemplo Principal |
|-----------|----------|-------------------|
| **CRÍTICA** | 8 | API keys expuestas, eval() en servidor, cobertura de tests |
| **ALTA** | 25 | Stripe live keys, credenciales expuestas, archivos monolíticos |
| **MEDIA** | 48 | Rate limiting, Docker, performance, documentación |
| **BAJA** | 19 | Assets, configs, convenciones |

## Top 10 Acciones Inmediatas

1. **ROTAR TODAS LAS API KEYS Y SECRETOS** (mejoras 1-8, 18-19, 25)
2. **Eliminar `.env` del historial de git** (BFG repo cleaner)
3. **Auditar y eliminar `eval()` del servidor** (mejora 9)
4. **Dividir archivos monolíticos** (mejoras 26-29)
5. **Expandir cobertura de tests** (mejora 66)
6. **Limpiar archivos temporales/logs del repositorio** (mejoras 31-34, 50)
7. **Habilitar ESLint rules y TypeScript strict** (mejoras 41-42)
8. **Reducir dependencias de 323 a las necesarias** (mejora 37)
9. **Implementar gestión de secretos** (Vault/AWS SM)
10. **Configurar backups de base de datos** (mejora 86)
