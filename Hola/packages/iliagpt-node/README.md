# iliagpt-node

Laptop/Desktop node agent for **ILIAGPT**.

## Install (npm)

```bash
npm i -g @carrerajorge/iliagpt-node
```

## Pair

1) In ILIAGPT web UI, generate a pairing code (Workspace → Nodes → Pair).
2) On your laptop:

```bash
iliagpt-node pair --server https://iliagpt.com --code ABCD1234 --name "My Laptop"
```

## Run

```bash
iliagpt-node run
```

> Note: This is an MVP polling daemon. WebSocket + more capabilities will be added next.
