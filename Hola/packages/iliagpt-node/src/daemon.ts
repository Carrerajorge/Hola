import { loadConfig } from "./config.js";
import { httpJson } from "./http.js";

type PollResp = { success: boolean; job: any | null };

export async function runDaemon(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error("Not paired. Run: iliagpt-node pair --server <url> --code <CODE>");

  const server = cfg.serverUrl.replace(/\/$/, "");
  const pollUrl = `${server}/api/nodes/jobs/poll`;

  console.log(`[iliagpt-node] connected (polling) to ${server} as nodeId=${cfg.nodeId}`);

  // Simple polling loop.
  // Later we can add WS push + polling fallback.
  while (true) {
    try {
      const resp = await httpJson<PollResp>(pollUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${cfg.nodeToken}` },
        timeoutMs: 35_000,
      });

      if (!resp.job) {
        await sleep(1500);
        continue;
      }

      const job = resp.job;
      const jobId = String(job.id);
      const kind = String(job.kind || "");
      console.log(`[iliagpt-node] job ${jobId} kind=${kind}`);

      // MVP: just acknowledge (no actual execution yet)
      // Next PR: implement screen.snapshot etc.
      const resultUrl = `${server}/api/nodes/jobs/${encodeURIComponent(jobId)}/result`;
      await httpJson(resultUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.nodeToken}` },
        body: {
          status: "succeeded",
          result: { ok: true, note: "MVP node daemon: job received" },
        },
        timeoutMs: 35_000,
      });

      await sleep(250);
    } catch (e: any) {
      console.warn(`[iliagpt-node] poll error: ${e?.message || e}`);
      await sleep(2500);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
