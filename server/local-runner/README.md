# iliagpt-run (Local Restricted Runner)

`iliagpt-run` ejecuta planes JSON en una carpeta de trabajo controlada con politica estricta:

- workspace obligatorio
- bloqueo de path traversal y symlinks
- denylist de rutas sensibles (`~/.ssh`, `.aws`, credenciales)
- comandos solo por allowlist (`configs/allowlist.json`)
- confirmacion humana para acciones riesgosas (`--yes` solo CI)
- timeout y max output por paso
- idempotencia por `runId + stepId`
- lock por `runId`
- auditoria JSONL y stream JSONL opcional

## Estructura

- `src/cli.ts`: entrada CLI
- `src/steps/runner.ts`: orquestador y handlers de pasos
- `src/policy.ts`: controles de seguridad de rutas/comandos
- `src/utils/idempotency.ts`: lock + resultados por run
- `src/utils/logger.ts`: auditoria estructurada
- `src/utils/telemetry.ts`: telemetria opcional
- `configs/allowlist.json`: comandos permitidos/peligrosos
- `examples/plan.min.json`: plan de ejemplo
- `test/integration.test.ts`: flujo e2e con spawn de CLI

## Contrato JSON del plan

```json
{
  "runId": "run-123",
  "workspace": "./workspace",
  "steps": [
    {
      "id": "step-1",
      "type": "read_file",
      "args": { "path": "docs/file.txt" },
      "retries": 1,
      "confirm": false
    }
  ]
}
```

### Tipos de `type`

- `read_file`: `args.path`
- `write_file`: `args.path`, `args.content`
- `list_dir`: `args.path`
- `run_command_allowlisted`: `args.command`, opcional `args.timeoutMs`, `args.maxOutputBytes`
- `upload_artifact`: `args.path`, opcional `args.name`, opcional `args.url` (presigned URL)
- `download_artifact`: `args.path`, opcional `args.name`, opcional `args.url` (presigned URL)

## Salida y estado

- resultados idempotentes: `workspace/.iliagpt/runs/<runId>/results.json`
- lock de ejecucion: `workspace/.iliagpt/runs/<runId>/lock`
- logs: `workspace/.iliagpt/logs/<runId>.jsonl` (o `--log`)
- artefactos locales: `workspace/.iliagpt/artifacts/`

## Comandos

```bash
npm i
npm run build
npx iliagpt-run --plan ./examples/plan.min.json --workspace ./workspace --stream --yes
```

Reproduccion rapida:

```bash
npm run iliagpt-run:repro
```

Tests de integracion:

```bash
npm test
```

## Flags principales

- `--plan <file>`: plan JSON
- `--workspace <dir>`: raiz sandbox (obligatorio si no viene en plan)
- `--allowlist <file>`: allowlist custom
- `--stream`: eventos JSONL por stdout
- `--dry-run`: no muta nada
- `--yes`: auto-confirmacion
- `--timeout-ms <n>`: timeout por comando
- `--max-output-bytes <n>`: salida maxima por paso
- `--log <file>`: ruta de auditoria
- `--otel-endpoint <url>`: telemetria opcional
