# HOLA ENTERPRISE - Runbooks & Incident Playbooks (V1.0)

Este documento define la respuesta estructurada a incidentes en producción, asegurando que el MTTR (Mean Time to Recovery) sea inferior a 30 minutos para desastres P1.

## Nivel de Severidad (SEV)

- **P1 (Bloqueante Crítico):** Sistema core caído. Múltiples tenants inoperables. Data breach.
- **P2 (Degradado Mayor):** Latencia severa (>2000ms), un subsistema no funciona (ej. Base de Datos Vectorial desconectada).
- **P3 (Degradado Menor / Bug):** Errores no bloqueantes para la experiencia de usuario general.

## Playbook: Incidencia P1 (Cerebro IA / Database Down)

1. **Detección:** Alertas de Grafana/Prometheus (Latencia Error Rate >1%) disparan PagerDuty al Ingeniero On-Call.
2. **Mitigación Inmediata (MTTR Focus):**
   - Ejecutar el comando de estabilización: `npm run infra:restart_core`
   - Si es un deploy anómalo, efectuar rollback azul/verde: `git revert origin/main && npm run deploy`
3. **Comunicación:** Enviar mensaje al canal `#incidents-p1` en Slack con el estado "INVESTIGANDO".
4. **Análisis de Causa Raíz (Post-Recuperación):**
   - Extraer Logs estructurados a través del `request-id` de la falla.
   - Revisar `metrics RED` (Rate, Error, Duration).

## Cultura Blameless Postmortem

Tras cada incidente P1 o P2, el Engineering Manager del Domain Squad liderará una reunión en 48 horas laborales documentando:

1. Qué pasó (Línea de tiempo objetiva).
2. Qué mitigó el error temporalmente.
3. Qué Ticket / Acción de Deuda Técnica se debe crear para evitar que *el sistema* permita este error humano/técnico nuevamente.
   *La culpa es del proceso, nunca del humano.*
