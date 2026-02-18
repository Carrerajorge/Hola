/**
 * GPT Product Router
 *
 * API endpoints for the full GPT Product Framework:
 *  - Version management (create, rollback, diff, history)
 *  - Knowledge ingestion and retrieval
 *  - Action validation and management
 *  - Permissions (grant, revoke, check)
 *  - Publication lifecycle
 *  - Evaluation (golden conversations, run evaluations)
 *  - Observability (traces, metrics, quality)
 *  - Orchestrator turn execution
 */

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { createLogger } from "../lib/structuredLogger";

// Services
import {
  gptVersionManager,
  gptPermissionManager,
  gptPublicationManager,
  gptAuditService,
  gptObservabilityService,
} from "../services/gptGovernance";
import {
  knowledgeIngestionPipeline,
  knowledgeRetrievalEngine,
} from "../services/gptKnowledgeEngine";
import {
  validateActionSchema,
  actionToToolSpec,
} from "../services/gptActionValidator";
import {
  goldenConversationManager,
  gptEvaluationEngine,
} from "../services/gptEvaluation";
import { safeErrorMessage } from "../lib/safeError";

const logger = createLogger("gpt-product-router");

const IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,140}$/;

function normalizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return IDENTIFIER_RE.test(trimmed) ? trimmed : null;
}

function getUserId(req: Request): string {
  return getOrCreateSecureUserId(req);
}

export function createGptProductRouter(): Router {
  const router = Router();

  // ─── Version Management ─────────────────────────────────────────────

  /** GET /api/gpt-product/:gptId/versions — Version history */
  router.get("/:gptId/versions", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const versions = await gptVersionManager.getVersionHistory(gptId, limit);
      res.json({ versions });
    } catch (err) {
      logger.error("Failed to get version history", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/versions — Create new version */
  router.post("/:gptId/versions", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const gpt = await storage.getGpt(gptId);
      if (!gpt) return res.status(404).json({ error: "GPT not found" });

      const { changeNotes } = req.body;
      if (!changeNotes || typeof changeNotes !== "string") {
        return res.status(400).json({ error: "changeNotes is required" });
      }

      const userId = getUserId(req);
      const version = await gptVersionManager.createVersion(gptId, gpt, changeNotes, userId);
      res.status(201).json({ version });
    } catch (err) {
      logger.error("Failed to create version", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/rollback — Rollback to a version */
  router.post("/:gptId/rollback", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { targetVersion } = req.body;
      if (!targetVersion || typeof targetVersion !== "number") {
        return res.status(400).json({ error: "targetVersion (number) is required" });
      }

      const userId = getUserId(req);
      const version = await gptVersionManager.rollback(gptId, targetVersion, userId);
      res.json({ version, message: `Rolled back to v${targetVersion}` });
    } catch (err) {
      logger.error("Failed to rollback", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/versions/diff — Compare two versions */
  router.get("/:gptId/versions/diff", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const versionA = parseInt(req.query.a as string);
      const versionB = parseInt(req.query.b as string);
      if (!versionA || !versionB) {
        return res.status(400).json({ error: "Query params a and b (version numbers) are required" });
      }

      const diff = await gptVersionManager.diffVersions(gptId, versionA, versionB);
      res.json(diff);
    } catch (err) {
      logger.error("Failed to diff versions", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Knowledge Management ───────────────────────────────────────────

  /** POST /api/gpt-product/:gptId/knowledge/ingest — Ingest a knowledge document */
  router.post("/:gptId/knowledge/ingest", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { knowledgeId, rawText, fileName } = req.body;
      if (!knowledgeId || !rawText || !fileName) {
        return res.status(400).json({
          error: "knowledgeId, rawText, and fileName are required",
        });
      }

      const result = await knowledgeIngestionPipeline.ingest(gptId, knowledgeId, rawText, fileName);
      res.status(result.status === "completed" ? 200 : 500).json(result);
    } catch (err) {
      logger.error("Knowledge ingestion failed", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/knowledge/retrieve — Retrieve knowledge snippets */
  router.post("/:gptId/knowledge/retrieve", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { query, mode, maxChunks, minScore, knowledgeIds } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query is required" });
      }

      const snippets = await knowledgeRetrievalEngine.retrieve({
        query,
        gptId,
        mode: mode || "auto",
        maxChunks,
        minScore,
        knowledgeIds,
      });

      res.json({ snippets, count: snippets.length, mode: mode || "auto" });
    } catch (err) {
      logger.error("Knowledge retrieval failed", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Action Validation ──────────────────────────────────────────────

  /** POST /api/gpt-product/actions/validate — Validate an OpenAPI/JSON Schema */
  router.post("/actions/validate", async (req: Request, res: Response) => {
    try {
      const { schema } = req.body;
      if (!schema) {
        return res.status(400).json({ error: "schema is required" });
      }

      const result = validateActionSchema(schema);
      res.json(result);
    } catch (err) {
      logger.error("Schema validation failed", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/actions/to-tool-spec — Convert action to tool spec */
  router.post("/actions/to-tool-spec", async (req: Request, res: Response) => {
    try {
      const { action } = req.body;
      if (!action) {
        return res.status(400).json({ error: "action is required" });
      }

      const toolSpec = actionToToolSpec(action);
      res.json(toolSpec);
    } catch (err) {
      logger.error("Action to tool spec conversion failed", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Permissions ────────────────────────────────────────────────────

  /** GET /api/gpt-product/:gptId/permissions — List permissions */
  router.get("/:gptId/permissions", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const permissions = await gptPermissionManager.listPermissions(gptId);
      res.json({ permissions });
    } catch (err) {
      logger.error("Failed to list permissions", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/permissions — Grant permission */
  router.post("/:gptId/permissions", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { granteeType, granteeId, role, expiresAt } = req.body;
      if (!granteeId || !role) {
        return res.status(400).json({ error: "granteeId and role are required" });
      }

      const userId = getUserId(req);
      const permission = await gptPermissionManager.grant(
        gptId,
        granteeType || "user",
        granteeId,
        role,
        userId,
        expiresAt ? new Date(expiresAt) : undefined
      );
      res.status(201).json({ permission });
    } catch (err) {
      logger.error("Failed to grant permission", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** DELETE /api/gpt-product/:gptId/permissions/:granteeId — Revoke permission */
  router.delete("/:gptId/permissions/:granteeId", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      const granteeId = normalizeId(req.params.granteeId);
      if (!gptId || !granteeId) return res.status(400).json({ error: "Invalid IDs" });

      await gptPermissionManager.revoke(gptId, granteeId);
      res.json({ success: true });
    } catch (err) {
      logger.error("Failed to revoke permission", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/permissions/check — Check permission */
  router.get("/:gptId/permissions/check", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const userId = (req.query.userId as string) || getUserId(req);
      const role = (req.query.role as string) || "user";

      const hasPermission = await gptPermissionManager.hasPermission(
        gptId,
        userId,
        role as any
      );
      res.json({ hasPermission, gptId, userId, role });
    } catch (err) {
      logger.error("Failed to check permission", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Publication ────────────────────────────────────────────────────

  /** POST /api/gpt-product/:gptId/publish — Publish a GPT version */
  router.post("/:gptId/publish", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { versionNumber, scope, releaseNotes, approvedBy } = req.body;
      if (!versionNumber || !scope) {
        return res.status(400).json({ error: "versionNumber and scope are required" });
      }

      const userId = getUserId(req);
      const publication = await gptPublicationManager.publish(
        gptId,
        versionNumber,
        scope,
        userId,
        releaseNotes,
        approvedBy
      );
      res.status(201).json({ publication });
    } catch (err) {
      logger.error("Failed to publish GPT", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/unpublish — Unpublish a GPT */
  router.post("/:gptId/unpublish", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { scope } = req.body;
      if (!scope) return res.status(400).json({ error: "scope is required" });

      await gptPublicationManager.unpublish(gptId, scope);
      res.json({ success: true });
    } catch (err) {
      logger.error("Failed to unpublish GPT", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/publications — Publication history */
  router.get("/:gptId/publications", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const publications = await gptPublicationManager.getPublicationHistory(gptId);
      res.json({ publications });
    } catch (err) {
      logger.error("Failed to get publications", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Audit Trail ───────────────────────────────────────────────────

  /** GET /api/gpt-product/:gptId/audit — Audit trail */
  router.get("/:gptId/audit", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;
      const action = req.query.action as string | undefined;

      const trail = await gptAuditService.getAuditTrail(gptId, { limit, offset, action });
      res.json({ audit: trail, count: trail.length });
    } catch (err) {
      logger.error("Failed to get audit trail", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Golden Conversations & Evaluations ─────────────────────────────

  /** GET /api/gpt-product/:gptId/golden — List golden conversations */
  router.get("/:gptId/golden", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const conversations = await goldenConversationManager.list(gptId);
      res.json({ conversations });
    } catch (err) {
      logger.error("Failed to list golden conversations", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/golden — Create golden conversation */
  router.post("/:gptId/golden", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const { name, description, turns, expectedBehaviors, tags } = req.body;
      if (!name || !turns || !Array.isArray(turns)) {
        return res.status(400).json({ error: "name and turns (array) are required" });
      }

      const userId = getUserId(req);
      const conversation = await goldenConversationManager.create(
        gptId,
        { name, description, turns, expectedBehaviors, tags },
        userId
      );
      res.status(201).json({ conversation });
    } catch (err) {
      logger.error("Failed to create golden conversation", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** PUT /api/gpt-product/golden/:id — Update golden conversation */
  router.put("/golden/:id", async (req: Request, res: Response) => {
    try {
      const id = normalizeId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ID" });

      const updated = await goldenConversationManager.update(id, req.body);
      res.json({ conversation: updated });
    } catch (err) {
      logger.error("Failed to update golden conversation", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** DELETE /api/gpt-product/golden/:id — Delete golden conversation */
  router.delete("/golden/:id", async (req: Request, res: Response) => {
    try {
      const id = normalizeId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ID" });

      await goldenConversationManager.delete(id);
      res.json({ success: true });
    } catch (err) {
      logger.error("Failed to delete golden conversation", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** POST /api/gpt-product/:gptId/evaluate — Run evaluation suite */
  router.post("/:gptId/evaluate", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const gpt = await storage.getGpt(gptId);
      if (!gpt) return res.status(404).json({ error: "GPT not found" });

      const versionNumber = gpt.version || 1;
      const userId = getUserId(req);
      const triggerReason = (req.body.reason as string) || "manual";

      const run = await gptEvaluationEngine.runEvaluation(
        gptId,
        versionNumber,
        userId,
        triggerReason
      );
      res.json({ evaluation: run });
    } catch (err) {
      logger.error("Evaluation failed", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/evaluations — Evaluation history */
  router.get("/:gptId/evaluations", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const evaluations = await gptEvaluationEngine.getEvaluationHistory(gptId, limit);
      res.json({ evaluations });
    } catch (err) {
      logger.error("Failed to get evaluations", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // ─── Observability ──────────────────────────────────────────────────

  /** GET /api/gpt-product/:gptId/traces — Get traces for a GPT */
  router.get("/:gptId/traces", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const conversationId = req.query.conversationId as string;
      const requestId = req.query.requestId as string;

      if (requestId) {
        const traces = await gptObservabilityService.getRequestTraces(requestId);
        return res.json({ traces });
      }

      if (conversationId) {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const traces = await gptObservabilityService.getConversationTraces(conversationId, limit);
        return res.json({ traces });
      }

      return res.status(400).json({ error: "conversationId or requestId query param is required" });
    } catch (err) {
      logger.error("Failed to get traces", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/runs — Conversation run history */
  router.get("/:gptId/runs", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const state = req.query.state as string | undefined;
      const runs = await gptObservabilityService.getRunHistory(gptId, { limit, state });
      res.json({ runs, count: runs.length });
    } catch (err) {
      logger.error("Failed to get run history", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/quality — Quality metrics */
  router.get("/:gptId/quality", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const hoursBack = parseInt(req.query.hours as string) || 24;
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - hoursBack * 3600_000);

      const metrics = await gptObservabilityService.computeQualityMetrics(gptId, fromDate, toDate);
      res.json({ metrics, period: { from: fromDate.toISOString(), to: toDate.toISOString() } });
    } catch (err) {
      logger.error("Failed to compute quality metrics", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /** GET /api/gpt-product/:gptId/metrics/hourly — Hourly metrics for dashboard */
  router.get("/:gptId/metrics/hourly", async (req: Request, res: Response) => {
    try {
      const gptId = normalizeId(req.params.gptId);
      if (!gptId) return res.status(400).json({ error: "Invalid GPT ID" });

      const hoursBack = parseInt(req.query.hours as string) || 168; // 7 days default
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - hoursBack * 3600_000);

      const metrics = await gptObservabilityService.getHourlyMetrics(gptId, fromDate, toDate);
      res.json({ metrics });
    } catch (err) {
      logger.error("Failed to get hourly metrics", { err });
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  return router;
}
