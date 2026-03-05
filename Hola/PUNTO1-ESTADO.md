# Punto 1 — Ejecutar comandos bash/powershell (estado)

Fuente: `requirements/super-agente-digital-100_2026-02-06.md` → Sección 1.

## ✅ Implementado (verde)
- **Ejecución de comandos (Linux/bash)**: `shell_command` ejecuta con `spawn("/usr/bin/bash", ["-lc", cmd])` dentro de `/tmp/agent-workspace/<runId>`.
- **Captura de stdout/stderr + exitCode**: se retorna en `ToolResult.output` (`stdout`, `stderr`, `exitCode`).
- **Streaming “near real-time”**:
  - `ToolContext.onStream` emite chunks de `stdout/stderr`.
  - `ToolContext.onExit` emite evento final con `exitCode`/`signal`/`durationMs`.
  - `AgentOrchestrator` publica `shell_output` vía **SSE** (EventBus) para UI/trace.
- **Timeout + abort**: timeout configurable (1s–60s) + kill en abort signal.
- **Seguridad (MVP)**:
  - **RBAC**: `shell_command` permitido solo para `userPlan=admin` (PolicyEngine).
  - **Confirmación explícita** para patrones peligrosos (ej. `rm -rf`, `mkfs`, `dd if=`, `sudo`, `curl|sh`, `reboot`).
  - **Auditoría best-effort**: trace events se persisten sin romper el flujo si la DB falla.

## 🟡 Parcial (amarillo)
- **“Tiempo real” full fidelity**: hoy el streaming emite chunks, pero en `shell_output` se manda `output_snippet` truncado (2k). No hay `chunk_sequence` ni garantía de orden/line buffering en UI.
- **WebSockets**: el doc menciona WebSockets; hoy usamos **SSE** (equivalente para streaming unidireccional).
- **Whitelist/blacklist de comandos peligrosos**: existe lista inicial (regex) pero no está completa ni parametrizada por config.

## ❌ Faltante (rojo)
- **Terminal interactiva/PTY** (node-pty): soporte de comandos interactivos (stdin, prompts, TTY, ctrl+c, etc.).
- **Shell remoto (SSH)**: ejecución en hosts remotos con credenciales/gestión de llaves, allowlists y auditoría.
- **Aislamiento fuerte con Docker**:
  - Ejecutar comandos dentro de un contenedor dedicado por run.
  - Límites CPU/RAM/IO (cgroups) + políticas de red (sin red por defecto / allowlist).
  - Perfiles **seccomp/AppArmor/namespaces**.
- **Soporte PowerShell/Windows** (si aplica al producto).
