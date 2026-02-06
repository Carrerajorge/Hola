import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { workspaces, users, libraryFiles } from "@shared/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { validateBody } from "../middleware/validateRequest";
import { getUserId } from "../types/express";
import { isValidWorkspaceName, normalizeWorkspaceName } from "../services/workspaceValidation";

const DEFAULT_ORG_ID = "default";

async function ensureWorkspace(orgId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.orgId, orgId)).limit(1);
  if (ws) return ws;

  const [created] = await db
    .insert(workspaces)
    .values({ orgId, name: "Espacio de trabajo" })
    .returning();

  return created;
}

export function createWorkspaceRouter() {
  const router = Router();

  router.get("/api/workspace/me", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const orgId = (u as any)?.orgId || DEFAULT_ORG_ID;

      const ws = await ensureWorkspace(orgId);

      const [{ count: memberCountRaw } = { count: 0 }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(users)
        .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
      const memberCount = typeof memberCountRaw === "number" ? memberCountRaw : Number(memberCountRaw || 0);

      res.json({
        orgId,
        workspaceId: ws.id,
        name: ws.name,
        logoFileUuid: ws.logoFileUuid || null,
        memberCount,
      });
    } catch (e: any) {
      console.error("[Workspace] GET /me error:", e);
      res.status(500).json({ error: "Failed to load workspace" });
    }
  });

  router.put(
    "/api/workspace/me",
    validateBody(
      z
        .object({
          name: z.string().optional(),
          logoFileUuid: z.string().nullable().optional(),
        })
        .refine((v) => v.name !== undefined || v.logoFileUuid !== undefined, {
          message: "At least one field must be provided",
        })
    ),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

        const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        const orgId = (u as any)?.orgId || DEFAULT_ORG_ID;
        const role = String((u as any)?.role || "guest").toLowerCase().trim();
        const userEmail = String((u as any)?.email || "").toLowerCase().trim();
        const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
        const canManage = ['admin', 'superadmin', 'team_admin'].includes(role) || (adminEmail && userEmail === adminEmail);

        if (!canManage) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const ws = await ensureWorkspace(orgId);

        const patch: any = { updatedAt: new Date() };

        if (req.body.name !== undefined) {
          const normalized = normalizeWorkspaceName(req.body.name);
          if (!isValidWorkspaceName(normalized)) {
            return res.status(400).json({ error: "Nombre inválido", code: "INVALID_WORKSPACE_NAME" });
          }
          patch.name = normalized;
        }

        if (req.body.logoFileUuid !== undefined) {
          const uuid = req.body.logoFileUuid;
          if (uuid) {
            // ensure the file belongs to the admin user and is not deleted
            const [file] = await db
              .select()
              .from(libraryFiles)
              .where(and(eq(libraryFiles.uuid, uuid), eq(libraryFiles.userId, userId), isNull(libraryFiles.deletedAt)))
              .limit(1);
            if (!file) {
              return res.status(400).json({ error: "Logo file not found", code: "LOGO_FILE_NOT_FOUND" });
            }
            patch.logoFileUuid = uuid;
          } else {
            patch.logoFileUuid = null;
          }
        }

        const [updated] = await db
          .update(workspaces)
          .set(patch)
          .where(eq(workspaces.id, ws.id))
          .returning();

        res.json({
          orgId,
          workspaceId: updated.id,
          name: updated.name,
          logoFileUuid: updated.logoFileUuid || null,
        });
      } catch (e: any) {
        console.error("[Workspace] PUT /me error:", e);
        res.status(500).json({ error: "Failed to update workspace" });
      }
    }
  );

  return router;
}
