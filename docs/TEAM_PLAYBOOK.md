# TEAM_PLAYBOOK — IliaGPT (OpenClaw + CI + Memoria del Spec)

Este documento define el flujo estándar para que cualquier persona del equipo haga cambios sin depender de “memoria del chat” y minimizando errores humanos.

## Objetivo
- Flujo estable: **branch → cambios mínimos → verify → PR**.
- “Memoria” persistente dentro del repo:
  - `docs/SPEC_PROGRESS.md` (progreso del spec)
  - `docs/WORKLOG.md` (bitácora de cambios)

## Requisitos
- Git + Node/npm
- GitHub CLI (`gh`) autenticado (HTTPS)
- OpenClaw instalado y funcionando

## Setup inicial (una vez por persona)
```bash
gh auth login
gh auth setup-git
cd /home/<user>/.openclaw/workspace/Hola
git checkout main
git pull
