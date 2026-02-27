import { saveConfig } from "./config.js";
import { httpJson } from "./http.js";
import { runDaemon } from "./daemon.js";

function usage(exitCode = 0): never {
  console.log(`iliagpt-node (MVP)\n\nCommands:\n  pair --server <url> --code <CODE> [--name <NAME>]\n  run\n\nExamples:\n  iliagpt-node pair --server https://iliagpt.com --code ABCD1234 --name \"My Laptop\"\n  iliagpt-node run\n`);
  process.exit(exitCode);
}

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] ? String(process.argv[i + 1]) : null;
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) usage(1);

  if (cmd === "pair") {
    const serverUrl = getArg("--server");
    const code = getArg("--code");
    const name = getArg("--name") || "Laptop";
    if (!serverUrl || !code) usage(1);

    const url = serverUrl.replace(/\/$/, "") + "/api/nodes/pair/confirm";
    const resp = await httpJson<any>(url, {
      method: "POST",
      body: {
        code,
        name,
        platform: process.platform,
        agentVersion: "0.1.0",
        capabilities: { polling: true },
      },
    });

    if (!resp?.nodeToken || !resp?.nodeId) {
      throw new Error("Pair failed: missing nodeToken/nodeId");
    }

    await saveConfig({
      serverUrl: serverUrl,
      nodeId: String(resp.nodeId),
      nodeToken: String(resp.nodeToken),
      allowedRoots: [],
      deviceName: name,
    });

    console.log(`[iliagpt-node] paired ok nodeId=${resp.nodeId} orgId=${resp.orgId}`);
    return;
  }

  if (cmd === "run") {
    await runDaemon();
    return;
  }

  usage(1);
}

main().catch((e) => {
  console.error(`[iliagpt-node] error: ${e?.message || e}`);
  process.exit(1);
});
