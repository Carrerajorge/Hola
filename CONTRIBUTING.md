# Contribuyendo a IliaGPT

Gracias por tu interés en mejorar IliaGPT. Seguimos estándares estrictos para mantener la confiabilidad "NASA-grade".

## 📐 Principios de Ingeniería

1.  **Seguridad Primero:** Ninguna herramienta nueva se aprueba sin su correspondiente entrada en el `RiskRegistry` y validación en `PolicyEngine`.
2.  **No Mocks en Producción:** Las herramientas deben hacer trabajo real. Si usas una API externa, implementa manejo de errores y retries.
3.  **Tipado Estricto:** Zod schemas obligatorios para todas las entradas y salidas de herramientas.

## 🔄 Flujo de Trabajo

1.  **Branching:** Usa `feature/nombre-funcionalidad`.
2.  **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`).
3.  **Testing:** Ejecuta `npm test` antes de subir. El "Smoke Test" del AgentOS debe pasar.

## 🧩 Añadir una Nueva Herramienta

1.  Definir la herramienta en `server/agentos/action_plane/tools/`.
2.  Asignar nivel de riesgo (`low`, `medium`, `high`, `critical`).
3.  Registrarla en `ActionPlane.initialize()`.
4.  Documentarla en `README.md`.

## 🐛 Reporte de Bugs

Usa el sistema de Issues de GitHub. Incluye el `runId` del log de auditoría si es posible para facilitar el trazado (Time Travel Debugging).
