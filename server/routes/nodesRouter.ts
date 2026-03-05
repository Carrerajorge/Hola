import { Router } from "express"; import { z } from "zod"; import crypto from "crypto"; import { db } from "../db"; 
import { workspaceNodes, nodePairings, workspaceNodeJobs, users } from "@shared/schema";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm"; import { validateBody } from "../middleware/validateRequest"; import { getUserId } from "../types/express"; import { requireNodeAuth, 
getNode } from "../middleware/nodeAuth";

const PAIRING_TTL_MINUTES = 5;

function normalizeName(raw: unknown): string {
  const s = String(raw || "").trim();
  return s.slice(0, 64) || "Laptop";
}

function randomCode(len = 8): string {
  // Human-friendly: avoid ambiguous chars
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function newNodeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256Base64Url(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("base64url");
}

async function getActor(req: any): Promise<{ userId: string; orgId: string; roleKey: string; email: string } | null> {
  const userId = getUserId(req);
  if (!userId) return null;
  const [u] = await db.select({ id: users.id, orgId: users.orgId, role: users.role, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  return {
    userId: String(u.id),
    orgId: String((u as any).orgId || "default"),
    roleKey: String((u as any).role || "user"),
    email: String((u as any).email || ""),
  };
}

const pairSchema = z.object({ name: z.string().min(1).max(64).optional() });
const confirmSchema = z.object({
  code: z.string().min(4).max(20),
  name: z.string().min(1).max(64),
  platform: z.string().max(32).optional(),
  agentVersion: z.string().max(64).optional(),
  capabilities: z.record(z.any()).optional(),
});

const createJobSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.string().min(1).max(64),
  payload: z.record(z.any()).optional().default({}),
});

export function createNodesRouter(): Router {
  const router = Router();

  // =====================
  // UI: org/workspace scoped (session/cookie)
  // =====================

  // GET /api/workspace/nodes
  router.get("/api/workspace/nodes", async (req, res) => {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ success: false, error: "Debes iniciar sesión" });

    const rows = await db
      .select({
        id: workspaceNodes.id,
        name: workspaceNodes.name,
        platform: workspaceNodes.platform,
        agentVersion: workspaceNodes.agentVersion,
        capabilities: workspaceNodes.capabilities,
        policy: workspaceNodes.policy,
        lastSeenAt: workspaceNodes.lastSeenAt,
        revokedAt: workspaceNodes.revokedAt,
        ownerUserId: workspaceNodes.ownerUserId,
        createdAt: workspaceNodes.createdAt,
      })
      .from(workspaceNodes)
      .where(eq(workspaceNodes.orgId, actor.orgId))
      .orderBy(desc(workspaceNodes.createdAt));

    res.json({ success: true, orgId: actor.orgId, workspaceNodes: rows.map((n) => ({
      ...n,
      id: String(n.id),
      name: String(n.name),
      platform: n.platform ? String(n.platform) : null,
      agentVersion: n.agentVersion ? String(n.agentVersion) : null,
      lastSeenAt: n.lastSeenAt ? new Date(n.lastSeenAt as any).toISOString() : null,
      revokedAt: n.revokedAt ? new Date(n.revokedAt as any).toISOString() : null,
      createdAt: n.createdAt ? new Date(n.createdAt as any).toISOString() : null,
    })) });
  });

  // POST /api/workspace/nodes/pair
  router.post("/api/workspace/nodes/pair", validateBody(pairSchema), async (req, res) => {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ success: false, error: "Debes iniciar sesión" });

    const code = randomCode(8);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000);

    await db.insert(nodePairings).values({
      orgId: actor.orgId,
      createdByUserId: actor.userId,
      code,
      expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    } as any);

    res.json({ success: true, orgId: actor.orgId, code, expiresAt: expiresAt.toISOString() });
  });

  // POST /api/workspace/nodes/:nodeId/revoke
  router.post("/api/workspace/nodes/:nodeId/revoke", async (req, res) => {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ success: false, error: "Debes iniciar sesión" });

    const nodeId = String((req.params as any).nodeId || "").trim();
    if (!nodeId) return res.status(400).json({ success: false, error: "nodeId required" });

    const [updated] = await db
      .update(workspaceNodes)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.orgId, actor.orgId), isNull(workspaceNodes.revokedAt)))
      .returning();

    if (!updated) return res.status(404).json({ success: false, error: "Node not found" });
    res.json({ success: true });
  });

  // POST /api/workspace/nodes/jobs
  router.post("/api/workspace/nodes/jobs", validateBody(createJobSchema), async (req, res) => {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ success: false, error: "Debes iniciar sesión" });

    const { nodeId, kind, payload } = req.body as any;

    // Ensure node belongs to org and not revoked
    const [n] = await db.select({ id: workspaceNodes.id }).from(workspaceNodes).where(and(eq(workspaceNodes.id, String(nodeId)), eq(workspaceNodes.orgId, actor.orgId), isNull(workspaceNodes.revokedAt))).limit(1);
    if (!n) return res.status(404).json({ success: false, error: "Node not found" });

    const [job] = await db
      .insert(workspaceNodeJobs)
      .values({
        orgId: actor.orgId,
        nodeId: String(nodeId),
        requestedByUserId: actor.userId,
        kind: String(kind),
        payload: payload || {},
        status: "queued",
        createdAt: new Date(),
      } as any)
      .returning();

    res.json({ success: true, jobId: String(job.id) });
  });

  // GET /api/workspace/nodes/:nodeId/jobs
  router.get("/api/workspace/nodes/:nodeId/jobs", async (req, res) => {
    const actor = await getActor(req);
    if (!actor) return res.status(401).json({ success: false, error: "Debes iniciar sesión" });

    const nodeId = String((req.params as any).nodeId || "").trim();
    if (!nodeId) return res.status(400).json({ success: false, error: "nodeId required" });

    // Ensure node belongs to org
    const [n] = await db.select({ id: workspaceNodes.id }).from(workspaceNodes).where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.orgId, actor.orgId))).limit(1);
    if (!n) return res.status(404).json({ success: false, error: "Node not found" });

    const rows = await db
      .select()
      .from(workspaceNodeJobs)
      .where(and(eq(workspaceNodeJobs.orgId, actor.orgId), eq(workspaceNodeJobs.nodeId, nodeId)))
      .orderBy(desc(workspaceNodeJobs.createdAt))
      .limit(100);

    res.json({
      success: true,
      jobs: rows.map((j: any) => ({
        ...j,
        id: String(j.id),
        nodeId: String(j.nodeId),
        createdAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        startedAt: j.startedAt ? new Date(j.startedAt).toISOString() : null,
        finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null,
      })),
    });
  });

  // =====================
  // Node side
  // =====================

  // POST /api/nodes/pair/complete
  router.post("/api/nodes/pair/complete", validateBody(confirmSchema), async (req, res) => {
    const { code, name, platform, agentVersion, capabilities } = req.body as any;

    const now = new Date();
    const [pairing] = await db
      .select()
      .from(nodePairings)
      .where(and(eq(nodePairings.code, String(code)), isNull(nodePairings.consumedAt), gt(nodePairings.expiresAt, now)))
      .limit(1);

    if (!pairing) {
      return res.status(400).json({ success: false, error: "Invalid or expired pairing code", code: "PAIRING_INVALID" });
    }

    // Consume pairing code (atomic: only one request can consume it)
    const consumed = await db
      .update(nodePairings)
      .set({ consumedAt: now })
      .where(and(eq(nodePairings.id, (pairing as any).id), isNull(nodePairings.consumedAt)))
      .returning({ id: nodePairings.id });

    if (consumed.length === 0) {
      return res.status(409).json({ success: false, error: "Pairing code already consumed", code: "PAIRING_CONSUMED" });
    }


    const token = newNodeToken();
    const tokenHash = sha256Base64Url(token);

    const [created] = await db
      .insert(workspaceNodes)
      .values({
        orgId: String((pairing as any).orgId || "default"),
        ownerUserId: String((pairing as any).createdByUserId),
        name: normalizeName(name),
        platform: platform ? String(platform) : null,
        agentVersion: agentVersion ? String(agentVersion) : null,
        capabilities: capabilities && typeof capabilities === "object" ? capabilities : {},
        policy: {},
        tokenHash,
        createdAt: now,
        updatedAt: now,
      } as any)
      .returning();

    res.json({
      success: true,
      orgId: String((created as any).orgId || "default"),
      nodeId: String((created as any).id),
      nodeToken: token,
    });
  });

  // Backwards-compatible alias. Remove once device-agent uses /complete everywhere.
  router.post("/api/nodes/pair/confirm", validateBody(confirmSchema), async (req, res) => {
    return res.redirect(307, "/api/nodes/pair/complete");
  });

  // Node polls for queued jobs (MVP; WS comes next)
  // GET /api/nodes/jobs/poll
  router.get("/api/nodes/jobs/poll", requireNodeAuth, async (req, res) => {
    const node = getNode(req);
    if (!node) return res.status(401).json({ success: false, error: "Unauthorized" });

    // Update last seen
    await db.update(workspaceNodes).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(workspaceNodes.id, node.id));

    const [job] = await db
      .select()
      .from(workspaceNodeJobs)
      .where(and(eq(workspaceNodeJobs.nodeId, node.id), eq(workspaceNodeJobs.orgId, node.orgId), eq(workspaceNodeJobs.status, "queued")))
      .orderBy(desc(workspaceNodeJobs.createdAt))
      .limit(1);

    if (!job) return res.json({ success: true, job: null });

    // Mark delivered (lease) but not started yet
    await db
      .update(workspaceNodeJobs)
      .set({ status: "sent" })
      .where(and(eq(workspaceNodeJobs.id, (job as any).id), eq(workspaceNodeJobs.status, "queued")));
    
    res.json({ success: true, job: { ...job, id: String((job as any).id) } });
  });

  // Node acknowledges a job and marks it as running
  // POST /api/nodes/jobs/:jobId/ack
  router.post(
    "/api/nodes/jobs/:jobId/ack",
    requireNodeAuth,
    validateBody(z.object({})), // body vacío por ahora
    async (req, res) => {
      const node = getNode(req);
      if (!node) return res.status(401).json({ success: false, error: "Unauthorized" });

      const jobId = String((req.params as any).jobId || "").trim();
      if (!jobId) return res.status(400).json({ success: false, error: "jobId required" });

      // Only allow ack if the job belongs to this node and is not revoked
      const [job] = await db
        .select({ id: workspaceNodeJobs.id, status: workspaceNodeJobs.status })
        .from(workspaceNodeJobs)
        .where(and(eq(workspaceNodeJobs.id, jobId), eq(workspaceNodeJobs.nodeId, node.id), eq(workspaceNodeJobs.orgId, node.orgId)))
        .limit(1);

      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      // Move sent/queued -> running
      const [updated] = await db
        .update(workspaceNodeJobs)
        .set({ status: "running", startedAt: new Date() })
        .where(
          and(
            eq(workspaceNodeJobs.id, jobId),
            eq(workspaceNodeJobs.nodeId, node.id),
            eq(workspaceNodeJobs.orgId, node.orgId),
            // allow ack even if it was still queued (race)
            // and also if it was sent
            // (if already running/succeeded/failed, this update won't match)
            // @ts-ignore - drizzle doesn't have inArray imported here; keep simple OR
            // we'll do OR using SQL
            sql`${workspaceNodeJobs.status} IN ('queued','sent')`
          )
        )
        .returning({ id: workspaceNodeJobs.id });

      if (!updated) {
        return res.status(409).json({ success: false, error: `Job is not ackable (status=${String((job as any).status)})` });
      }

      return res.json({ success: true });
    }
  );

  // Node posts job result
  // POST /api/nodes/jobs/:jobId/result
  router.post(
    "/api/nodes/jobs/:jobId/result",
    // requireNodeAuth, // DEBUG: Temporarily disable auth for testing 404
    validateBody(z.object({ status: z.enum(["succeeded", "failed"]), result: z.any().optional(), error: z.string().optional() })),
    async (req, res) => {
      const requestId = (req as any).correlationId || (req as any).requestId || (req.headers["x-request-id"] as string) || null;
      try {
        const node = getNode(req);
        if (!node) return res.status(401).json({ success: false, error: "Unauthorized" });

        const jobId = String((req.params as any).jobId || "").trim();
        if (!jobId) return res.status(400).json({ success: false, error: "jobId required" });

        // Ensure job belongs to node
        const [job] = await db
          .select({ id: workspaceNodeJobs.id })
          .from(workspaceNodeJobs)
          .where(and(eq(workspaceNodeJobs.id, jobId), eq(workspaceNodeJobs.nodeId, node.id), eq(workspaceNodeJobs.orgId, node.orgId)))
          .limit(1);
        if (!job) return res.status(404).json({ success: false, error: "Job not found" });

        const { status, result, error } = req.body as any;

        const isTerminal = status === "succeeded" || status === "failed" || status === "cancelled";
        const isRunning = status === "running";

        await db
          .update(workspaceNodeJobs)
          .set({
            status,
            result: result ?? null,
            error: error ?? null,
            startedAt: isRunning ? sql`COALESCE(${workspaceNodeJobs.startedAt}, NOW())` : undefined,
            finishedAt: isTerminal ? new Date() : undefined,
          })
          .where(eq(workspaceNodeJobs.id, jobId));
        return res.json({ success: true });
      } catch (e: any) {
        // Some environments don't emit stack traces to container logs unless explicitly printed.
        console.error(
          `[nodes] job result failed requestId=${requestId || "unknown"} nodeId=${(getNode(req) as any)?.id || "unknown"} jobId=${(req.params as any)?.jobId || ""} error=${e?.message || e}`,
          e?.stack
        );
        return res.status(500).json({
          success: false,
          error: "Internal error",
          code: "NODES_JOB_RESULT_INTERNAL",
          requestId: requestId || undefined,
        });
      }
    }
  );

  return router;
}
