# Agent Kernel

This directory is the native `Hola-live` execution kernel for long-running agent workflows.

It exists to absorb the best orchestration ideas from external agent systems without embedding a second full runtime into the app.

## Intended Responsibilities

- durable run lifecycle
- resumable jobs
- retries / waits / scheduling
- context assembly for agent runs
- workflow orchestration

## Architectural Rule

OpenClaw remains the channel and control-plane shell.

This kernel becomes the internal workflow engine that powers higher-level product behavior inside `Hola-live`.

## Planned Submodules

- `runs/`
- `scheduler/`
- `context/`
- `workflows/`
- `persistence/`

## Scope Boundary

Do not place channel-specific transport logic here.

Do not duplicate OpenClaw plugin or gateway internals here.

This layer should stay product-native and runtime-agnostic.
