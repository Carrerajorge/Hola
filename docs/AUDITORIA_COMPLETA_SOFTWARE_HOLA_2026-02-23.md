# Auditoría Arquitectónica y Mapa Global ILIAGPT (Febrero 2026) 🌎🤖

## 1. Resumen Ejecutivo y Propósito del Sistema

**ILIAGPT** es una "Plataforma de IA Autónoma" de grado Enterprise (V2.1.0). Su misión es ser un ecosistema centralizado donde los usuarios pueden interactuar con capacidades avanzadas de modelos de lenguaje (Anthropic, OpenAI, Gemini, DeepSeek), administrar y ejecutar *skills/tools* (herramientas complejas como extracción de hojas de cálculo, generación de artículos científicos, búsqueda web profunda) y donde los directivos tienen control granular sobre los costos (FinOps) y la escalabilidad (SRE).

Es una aplicación robusta Full-Stack TypeScript que incluso puede compilarse hacia Desktop (Electrón) y Extensión de Navegador.

---

## 2. Stack Tecnológico Base 🛠️

| Capa | Tecnología Principal | Propósito en la Arquitectura |
| :--- | :--- | :--- |
| **Frontend UI** | **React 19 + Vite** | SPA ultra reactiva construida con componentes modulares de Radix-UI y estilizada con TailwindCSS V4. |
| **Estado Cliente** | **Zustand + React Query** | Zustand maneja el estado global del UI, mientras que Tanstack React Query gestiona la obtención y caché asíncrona (SWR) de las APIs. |
| **Backend API** | **Node.js (Express)** | Servidor monolítico avanzado (con instrumentación tsx/esbuild), sirviendo REST, tRPC simulado, Server-Sent-Events (SSE) para el chat iterativo y Webhooks. |
| **Persistencia** | **PostgreSQL (Drizzle ORM)** | Base de datos relacional para guardar Usuarios, Workspaces, Mensajes, Artefactos y ledgers inmutables de facturación. *(pgvector para embeddings).* |
| **Caché / Jobs** | **Redis (Upstash/BullMQ)** | Almacena configuraciones en caché, tokens de limitación (Rate Limiting) y orquesta procesamiento de colas en segundo plano (Workers). |
| **Almacenamiento** | **Object Storage (S3 / GCS)** | Repositorio definitivo para documentos subidos (Document Parse) y artefactos generados por los Agentes (PDFs, Excel, Docx). |

---

## 3. Radiografía del Backend (`/server`) 🧠

El backend es el centro de control de ILIAGPT, diseñado con patrones de observabilidad y resiliencia SRE.

### Componentes Core

1. **`llmGateway.ts` (El Router Cognitivo):**
   Es el "motor lógico" que decide hacia dónde va un Prompt. Evalúa el peso del contexto, enruta inteligentemente basándose en el saldo disponible, la latencia P95 y el costo por token a través de fallbacks y Smart Routing.
2. **`costEngine.ts` (Motor FinOps en `/services/finops`):**
   Impide la facturación desmedida. Antes de dejar salir un request a OpenAI/Anthropic, valida la cuota (`enforceGuardrails`). Si se aprueba, al terminar la petición asienta un registro inmutable en PostgreSQL (`token_ledger_usage`).
3. **`secretManager.ts` (Seguridad Zero-Secrets):**
   Vela por aislar las cadenas y APIs sensibles (LLM API Keys) de las zonas públicas (process.env y logs).
4. **`routes.ts` + Carpeta `/routes` (Controladores HTTP/SSE):**
   Más de 100 archivos enrutadores y controladores que soportan desde CRUD de usuarios hasta endpoints complejos de `agentic/` y `telemetry/`.
5. **Observabilidad Distribuida Estricta:**
   `Pino` como logger. Todas las transacciones cruzan con `x-correlation-id` emitidas por OpenTelemetry (`otel.ts`), enlazándose desde el click en el navegador UI hasta la ejecución de la consulta de base de datos (`metrics/`).
6. **ToolRunner & Agentic Systems (`/toolRunner`, `/agent`):**
   Sub-módulos que permiten a los "OpenClaw 1000 Skills" ejecutar código, buscar en la web, conectar APIs externas (MCP/Gmail) o fabricar documentos Word/Excel bajo demanda.

---

## 4. Radiografía del Frontend (`/client/src`) 🖥️

La interfaz persigue una estética ultra premium "Glassmorphism" con dark modes modernos implementados.

### Componentes Clave

1. **Arquitectura de Carpeta:**
   - `/pages`: Separación lógica de pantallas, como el Chat (Workspace principal), Login, Panel E2E Admin `OpenClaw Control` y métricas.
   - `/components`: Colección masiva (+300) de componentes reutilizables como Botones, Modales, Sliders, Dropdowns y Gráficos (`Recharts`/`Echarts` para Telemetría de costos).
   - `/lib/apiClient.ts`: Capa de Fetch/Axios estandarizada con interceptores para inyectar Cookies Seguras y trazas distribuidas FinOps (`X-Correlation-Id`).
2. **Plataforma Modular de Chat:**
   Renderiza markdown avanzado (Tiptap / mathjax para mates), gráficos embebidos y parsea la respuesta "en Streaming" para la ilusión de tipeo instantáneo de la IA.
3. **Dashboards Ejecutivos:**
   Consumen métricas agregadas desde `/api/finops` ilustrando en la UI a los dueños del workspace el dinero quemado vs. ahorrado.

---

## 5. Modelos de Datos Compartidos (`/shared/schema`) 🗄️

Las definiciones están escritas en Drizzle Zod-Schemas garantizando *End-to-End Type Safety* (los errores de tipología se atrapan al compilar).

- **Core:** `users`, `workspaces` (gestión de Tenants SaaS).
- **Cognitivo:** `chat_sessions`, `messages` (historial iterativo contextual).
- **Herramientas:** `skills`, `artifacts` (archivos renderizados).
- **Finanzas y SRE:** `pricing_catalog` (catálogo maestro de costos MD) y `token_ledger_usage` (registro perpetuo de transacciones API).

---

## 6. Estado Actual de Madurez: "Nivel Escala Producción" 🚀

A fecha de Hoy (23 Feb 2026), tras los Mega-Sprints implementados:

- **Seguridad (Zero-Secrets):** Sellado totalmente.
- **FinOps & Billing:** Probados matemáticamente al 100% de precisión bajo Contract Tests (`Vitest`). Multi-Tenant activo.
- **SRE y Trazabilidad:** Las peticiones desde el navegador son observadas E2E.
- **Enrutamiento Inteligente:** ILIAGPT toma decisiones de milisegundos para optimizar P&L utilizando los proveedores más rápidos y baratos de IA.

**Conclusión:** El sistema consta de una base monolítica altamente ingenierizada lista para recibir **miles** de ingenieros y usuarios recurrentes ("Massive Scale") sin colapsar por costos impensados ni fugas de seguridad.
