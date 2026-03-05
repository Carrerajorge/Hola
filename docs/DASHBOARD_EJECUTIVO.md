# HOLA ENTERPRISE - DASHBOARD EJECUTIVO Y GOBERNANZA

## 1. Definición de "Done" (DoD) Inquebrantable

Una historia de usuario o Feature **NO TERMINA** ni entra a Pull Request si no incluye:

- [ ] **Tests:** Cobertura de la lógica crítica (Unit y Integration).
- [ ] **Observabilidad:** Logs estructurados (con `req.correlationId`) y métricas RED.
- [ ] **Seguridad/Docs:** Riesgos anotados y schemas Zod probados con casos nulos/límite.
- [ ] **Plan de Rollback:** Pasos exactos si el feature quiebra `main`.

## 2. Registro de Deuda Técnica (Debt Ledger)

*Toda deuda técnica se prioriza con Impacto, Costo, y Fecha Objetivo, previniendo caos acumulado.*

| Descripción / ID | Owner | Impacto | Costo Estimado (Sprints) | Riesgo Operativo | Fecha Objetivo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEBT-001:** Mover uploads de disco local a S3 Bucket. | `@squad-backend` | ALTO (Bloquea autoscaling horizontal) | 1 Sprint | ALTO (Fallas de consistencia) | Finalización Q2 |
| **DEBT-002:** Abstraer Drizzle a Repo Pattern unificado. | `@architecture` | MEDIO (Código acoplado) | 3 Sprints | BAJO | Q3 |
| **DEBT-003:** Rate Limiter usando Redis distribuido. | `@security-eng` | ALTO (Protección DDoS Multi-Node) | 2 Sprints | MEDIO | Q2 |

## 3. Mapa de Arquitectura V1.0 (Vivo)

La estructura productiva y limpia del Repositorio Canónico sigue el modelo estratificado:

```text
/
├── .github/          # Platform Engineering (Workflows CI/CODEOWNERS)
├── server/           # Backend Node.js (Core, API, Inferencia, Express Web)
│   ├── agent/        # Cerebro Autónomo (Memoria, Zod Capabilities, FreeEnergy, MCTS)
│   ├── lib/          # Instrumentación, DB y Tracing
│   └── routes/       # Handlers Puros
├── client/           # Frontend React + Vite
├── extension/        # Chrome Manifest V3
├── native/           # Rust OS Hooks (macOS/Windows)
└── docs/             # SRE (Playbooks, Runbooks, SLOs)
```

Todo el código por fuera de este enrutado y carpetas se clasifica como *Backups* o *Mocks Temporales* y debe ser enviado al Storage Archive (S3) por el área Platform.
