# IliaGPT (Powered by AgentOS-ASI)

![Status](https://img.shields.io/badge/Status-Production-green) ![Architecture](https://img.shields.io/badge/Architecture-AgentOS-blue) ![License](https://img.shields.io/badge/License-Proprietary-red)

**IliaGPT** no es un simple chatbot. Es un Sistema Operativo Agéntico (AgentOS) diseñado para la autonomía, la seguridad "NASA-grade" y la ejecución de tareas complejas en el mundo real.

## 🧠 Arquitectura: AgentOS-ASI Kernel

El sistema opera bajo una arquitectura de **8 Planos Estancos** para garantizar gobernanza y estabilidad:

1.  **Model Plane (Cerebro):** Enrutamiento inteligente (Cascading) entre modelos (Claude, GPT-4, Grok) con gestión de presupuesto.
2.  **Knowledge Plane (Memoria):** RAG avanzado, integración con YouTube, CSV, Crawling web y auto-organización vectorial.
3.  **Action Plane (Manos):** Ejecución segura de herramientas con validación de riesgos.
4.  **Control Plane (Conciencia):** Motor de políticas, detección de PII, Jailbreak y Rate Limiting.
5.  **Computer Plane (Sistema):** Control nativo del host (Shell, Archivos, Docker).
6.  **Voice Plane (Voz):** Interfaz de audio bidireccional.
7.  **Data Plane (Historial):** Auditoría forense inmutable (Event Sourcing).
8.  **Media Plane (Ojos):** Generación y procesamiento de Imagen/Video.

## 🚀 Capacidades Clave

*   **Deep Research:** Agentes autónomos que navegan la web profunda y generan reportes HTML citados.
*   **Artifacts:** Generación de UI (React/HTML) en tiempo real.
*   **Business Ops:** Envío de emails (.eml), generación de PDFs y comparación de precios.
*   **Self-Healing:** El sistema detecta fallos en herramientas y reintenta con estrategias exponenciales.

## 🛠️ Instalación y Uso

### Requisitos
*   Node.js v20+
*   PostgreSQL (o Docker)
*   API Keys (OpenAI, Anthropic, Google) en `.env`

### Desarrollo Local

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar entorno
cp .env.example .env

# 3. Arrancar en modo dev
npm run dev
```

### SDK para Clientes

IliaGPT incluye un SDK "drop-in" para integrar el agente en cualquier web existente:

```html
<script src="https://api.iliagpt.com/sdk/agentos-client.js"></script>
<script>
  const ilia = new IliaGPTClient();
  ilia.streamChat("Analiza mis ventas", (chunk) => console.log(chunk));
</script>
```

## 🔒 Seguridad

*   **PII Redaction:** Los datos sensibles se eliminan antes de salir del servidor.
*   **Sandboxing:** Las herramientas de terminal corren bajo supervisión estricta.
*   **Audit Log:** Cada acción queda registrada criptográficamente.

---
© 2026 IliaGPT Inc. Todos los derechos reservados.
