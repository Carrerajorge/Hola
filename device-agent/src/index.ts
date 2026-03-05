
import fs from "node:fs/promises";

import os from "node:os";

import path from "node:path";



type AgentState = {

  iliagptUrl: string;

  nodeId: string;

  nodeToken: string;

  pairedAt: string;

};



const DATA_DIR = process.env.DATA_DIR || "/data";

const STATE_PATH = process.env.STATE_PATH || path.join(DATA_DIR, "agent.json");



function env(name: string, fallback?: string): string {

  const v = process.env[name] ?? fallback;

  if (!v) throw new Error(`Missing env ${name}`);

  return String(v);

}



function sleep(ms: number) {

  return new Promise((r) => setTimeout(r, ms));

}



async function readState(): Promise<AgentState | null> {

  try {

    const raw = await fs.readFile(STATE_PATH, "utf8");

    return JSON.parse(raw) as AgentState;

  } catch {

    return null;

  }

}



async function writeState(state: AgentState) {

  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });

  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");

}



function normalizeBaseUrl(u: string) {

  return u.replace(/\/+$/, "");

}



async function postJson(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status} POST ${url}`);
  }
  return json;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status} GET ${url}`);
  }
  return json;
}


async function pairIfNeeded(): Promise<AgentState> {

  const existing = await readState();

  if (existing?.nodeToken && existing?.nodeId) {

    console.log(`[agent] loaded state nodeId=${existing.nodeId} iliagptUrl=${existing.iliagptUrl}`);

    return existing;

  }



  const iliagptUrl = normalizeBaseUrl(env("ILIAGPT_URL"));

  const code = env("PAIR_CODE");

  const nodeName = process.env.NODE_NAME || os.hostname();

  const platform = process.env.PLATFORM || process.platform;

  const agentVersion = process.env.AGENT_VERSION || "0.0.1";



  console.log(`[agent] pairing with code=${code} name="${nodeName}" url=${iliagptUrl}`);

  let r: any;
  try {
    r = await postJson(`${iliagptUrl}/api/nodes/pair/complete`, {
      code,
      name: nodeName,
      platform,
      agentVersion,
      capabilities: {
        agent: true,
        hostname: os.hostname(),
        arch: process.arch,
        platform: process.platform,
        release: os.release(),
      },
    });
  } catch (e: any) {
    if (String(e?.message || e).includes("HTTP 404")) {
      console.log("[agent] /pair/complete not available, falling back to /pair/confirm");
      r = await postJson(`${iliagptUrl}/api/nodes/pair/confirm`, {
        code,
        name: nodeName,
        platform,
        agentVersion,
        capabilities: {
          agent: true,
          hostname: os.hostname(),
          arch: process.arch,
          platform: process.platform,
          release: os.release(),
        },
      });
    } else {
      throw e;
    }
  }

  const nodeId = String(r.nodeId);

  const nodeToken = String(r.nodeToken);



  const state: AgentState = {

    iliagptUrl,

    nodeId,

    nodeToken,

    pairedAt: new Date().toISOString(),

  };



  await writeState(state);

  console.log(`[agent] paired OK nodeId=${nodeId} (token saved to ${STATE_PATH})`);

  return state;

}



async function main() {

  const pollEveryMs = Number(process.env.POLL_EVERY_MS || 1500);

  const state = await pairIfNeeded();



  while (true) {

    try {

      const json = await getJson(`${state.iliagptUrl}/api/nodes/jobs/poll`, {

        Authorization: `Bearer ${state.nodeToken}`,

      });



      const job = json?.job;

      if (!job) {

        await sleep(pollEveryMs);

        continue;

      }



      const jobId = String(job.id);

      const kind = String(job.kind || "");

      console.log(`[agent] got job id=${jobId} kind=${kind}`);


      console.log(`[agent] ack job ${jobId}`);
      await postJson(`${state.iliagptUrl}/api/nodes/jobs/${encodeURIComponent(jobId)}/ack`, {}, {

        Authorization: `Bearer ${state.nodeToken}`,

      });



      // MVP execution: only "ping"

      if (kind === "ping") {

        await postJson(`${state.iliagptUrl}/api/nodes/jobs/${encodeURIComponent(jobId)}/result`, {

          status: "succeeded",

          result: { ok: true, receivedAt: new Date().toISOString(), payload: job.payload ?? null },

        }, {

          Authorization: `Bearer ${state.nodeToken}`,

        });

        console.log(`[agent] job ${jobId} succeeded`);

      } else {

        await postJson(`${state.iliagptUrl}/api/nodes/jobs/${encodeURIComponent(jobId)}/result`, {

          status: "failed",

          error: `Unsupported job kind: ${kind}`,

        }, {

          Authorization: `Bearer ${state.nodeToken}`,

        });

        console.log(`[agent] job ${jobId} failed (unsupported kind)`);

      }

    } catch (e: any) {
      console.error("[agent] loop error:", e?.message || e);
      // Print stack if present
      if (e?.stack) console.error(e.stack);
      await sleep(2000);
    }

  }

}



main().catch((e) => {

  console.error("[agent] fatal:", e?.message || e);

  process.exit(1);

});

