import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { gpts, workspaces, users, libraryFiles, workspaceInvitations, magicLinks } from "@shared/schema";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { validateBody } from "../middleware/validateRequest";
import { getUserId } from "../types/express";
import { isValidWorkspaceName, normalizeWorkspaceName } from "../services/workspaceValidation";
import { createMagicLink, getMagicLinkUrl } from "../services/magicLink";
import { sendMagicLinkEmail } from "../services/genericEmailService";

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

  function canManageWorkspaceForDbUser(dbUser: any): boolean {
    const role = String(dbUser?.role || "guest").toLowerCase().trim();
    const userEmail = String(dbUser?.email || "").toLowerCase().trim();
    const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
    return ["admin", "superadmin", "team_admin"].includes(role) || (!!adminEmail && userEmail === adminEmail);
  }

	  router.get("/api/workspace/me", async (req, res) => {
	    try {
	      const userId = getUserId(req);
	      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });
	
	      const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
	      const orgId = (u as any)?.orgId || DEFAULT_ORG_ID;
	      const canManage = u ? canManageWorkspaceForDbUser(u) : false;
	
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
	        canManage,
	      });
	    } catch (e: any) {
	      console.error("[Workspace] GET /me error:", e);
	      res.status(500).json({ error: "Failed to load workspace" });
	    }
	  });

  router.get("/api/workspace/members", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!dbUser) return res.status(404).json({ error: "User not found" });
      const orgId = (dbUser as any)?.orgId || DEFAULT_ORG_ID;

      const members = await db
        .select()
        .from(users)
        .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)))
        .orderBy(desc(users.createdAt));

      // Join "added at" from accepted invitations if available (preferred over account creation date).
      const acceptedInvites = await db
        .select({
          email: workspaceInvitations.email,
          acceptedAt: workspaceInvitations.acceptedAt,
        })
        .from(workspaceInvitations)
        .where(and(eq(workspaceInvitations.orgId, orgId), eq(workspaceInvitations.status, "accepted")));

      const acceptedAtByEmail = new Map<string, Date>();
      for (const row of acceptedInvites) {
        const email = String(row.email || "").toLowerCase().trim();
        if (!email) continue;
        if (row.acceptedAt instanceof Date && !Number.isNaN(row.acceptedAt.getTime())) {
          acceptedAtByEmail.set(email, row.acceptedAt);
        }
      }

      res.json({
        orgId,
        memberCount: members.length,
        members: members.map((m: any) => {
          const email = String(m.email || "").toLowerCase().trim();
          const effectivePlan =
            m.subscriptionStatus === "active" && m.subscriptionPlan ? m.subscriptionPlan : m.plan;
          const addedAt: Date | null =
            acceptedAtByEmail.get(email) || (m.createdAt instanceof Date ? m.createdAt : null) || null;

          return {
            id: m.id,
            email: m.email || "",
            fullName: m.fullName || "",
            firstName: m.firstName || "",
            lastName: m.lastName || "",
            username: m.username || "",
            role: m.role || "user",
            plan: effectivePlan || "free",
            addedAt: addedAt ? addedAt.toISOString() : null,
          };
        }),
      });
    } catch (e: any) {
      console.error("[Workspace] GET /members error:", e);
      res.status(500).json({ error: "Failed to load members" });
    }
  });

  router.get("/api/workspace/gpts", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!dbUser) return res.status(404).json({ error: "User not found" });

      const orgId = (dbUser as any)?.orgId || DEFAULT_ORG_ID;
      const canManage = canManageWorkspaceForDbUser(dbUser);

      if (!canManage) {
        // Non-admins: only return what they created themselves.
        const rows = await db.select().from(gpts).where(eq(gpts.creatorId, userId)).orderBy(desc(gpts.createdAt));
        return res.json({ orgId, canManage, gpts: rows });
      }

      const memberRows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
      const memberIds = memberRows.map((r) => r.id).filter(Boolean) as string[];

      let rows: any[] = [];
      if (memberIds.length > 0) {
        rows = await db
          .select()
          .from(gpts)
          .where(or(inArray(gpts.creatorId, memberIds), isNull(gpts.creatorId)))
          .orderBy(desc(gpts.createdAt));
      } else {
        rows = await db.select().from(gpts).where(isNull(gpts.creatorId)).orderBy(desc(gpts.createdAt));
      }

      res.json({ orgId, canManage, gpts: rows });
    } catch (e: any) {
      console.error("[Workspace] GET /gpts error:", e);
      res.status(500).json({ error: "Failed to load workspace GPTs" });
    }
  });

  router.get("/api/workspace/invitations", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!dbUser) return res.status(404).json({ error: "User not found" });
      const orgId = (dbUser as any)?.orgId || DEFAULT_ORG_ID;

      if (!canManageWorkspaceForDbUser(dbUser)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const status = z
        .enum(["pending", "accepted", "revoked", "all"])
        .default("pending")
        .parse(String((req.query as any)?.status || "pending"));

      const whereClause =
        status === "all"
          ? eq(workspaceInvitations.orgId, orgId)
          : and(eq(workspaceInvitations.orgId, orgId), eq(workspaceInvitations.status, status));

      const invitations = await db
        .select()
        .from(workspaceInvitations)
        .where(whereClause)
        .orderBy(desc(workspaceInvitations.createdAt));

      res.json({
        orgId,
        invitations: invitations.map((inv: any) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          status: inv.status,
          createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : null,
          lastSentAt: inv.lastSentAt instanceof Date ? inv.lastSentAt.toISOString() : null,
          acceptedAt: inv.acceptedAt instanceof Date ? inv.acceptedAt.toISOString() : null,
          revokedAt: inv.revokedAt instanceof Date ? inv.revokedAt.toISOString() : null,
        })),
      });
    } catch (e: any) {
      console.error("[Workspace] GET /invitations error:", e);
      res.status(500).json({ error: "Failed to load invitations" });
    }
  });

  router.post(
    "/api/workspace/invitations",
    validateBody(
      z.object({
        emails: z
          .array(
            z.preprocess(
              (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
              z.string().email()
            )
          )
          .min(1)
          .max(50),
        role: z.string().trim().min(1).max(64).optional().default("team_member"),
      })
    ),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

        const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!dbUser) return res.status(404).json({ error: "User not found" });
        const orgId = (dbUser as any)?.orgId || DEFAULT_ORG_ID;

        if (!canManageWorkspaceForDbUser(dbUser)) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const inviterEmail = String((dbUser as any)?.email || "").toLowerCase().trim();
        const role = String((req.body as any).role || "team_member").trim();

	        const deduped = Array.from(
	          new Set(
	            ((req.body as any).emails as string[])
	              .map((e) => String(e || "").trim().toLowerCase())
	              .filter(Boolean)
	          )
	        );

	        const existingUsers = await db
	          .select({ email: users.email, orgId: users.orgId })
	          .from(users)
	          .where(inArray(users.email, deduped));
	        const existingUserOrgByEmail = new Map<string, string>();
	        for (const row of existingUsers) {
	          const email = String(row.email || "").toLowerCase().trim();
	          if (!email) continue;
	          const org = String((row as any).orgId || "").trim();
	          existingUserOrgByEmail.set(email, org || DEFAULT_ORG_ID);
	        }

	        const existingMembers = await db
	          .select({ email: users.email })
	          .from(users)
	          .where(and(eq(users.orgId, orgId), inArray(users.email, deduped), isNull(users.deletedAt)));
	        const existingMemberEmails = new Set(
          existingMembers.map((r) => String(r.email || "").toLowerCase().trim()).filter(Boolean)
        );

        const existingInvites = await db
          .select({ email: workspaceInvitations.email, status: workspaceInvitations.status })
          .from(workspaceInvitations)
          .where(and(eq(workspaceInvitations.orgId, orgId), inArray(workspaceInvitations.email, deduped)));
        const inviteStatusByEmail = new Map<string, string>();
        for (const row of existingInvites) {
          const email = String(row.email || "").toLowerCase().trim();
          if (email) inviteStatusByEmail.set(email, String(row.status || ""));
        }

        const now = new Date();
        const results: Array<{
          email: string;
          status: "sent" | "skipped" | "error";
          reason?: string;
          magicLinkUrl?: string;
        }> = [];

	        for (const email of deduped) {
	          if (email && inviterEmail && email === inviterEmail) {
	            results.push({ email, status: "skipped", reason: "No puedes invitarte a ti mismo" });
	            continue;
	          }
	          const existingOrgId = existingUserOrgByEmail.get(email);
	          if (existingOrgId && existingOrgId !== DEFAULT_ORG_ID && existingOrgId !== orgId) {
	            results.push({ email, status: "skipped", reason: "Este usuario ya pertenece a otro espacio de trabajo" });
	            continue;
	          }
	          if (existingMemberEmails.has(email)) {
	            results.push({ email, status: "skipped", reason: "Ya es miembro del espacio de trabajo" });
	            continue;
	          }
	          if (inviteStatusByEmail.get(email) === "accepted") {
	            results.push({ email, status: "skipped", reason: "La invitación ya fue aceptada" });
	            continue;
	          }

	          // Upsert the invitation record.
	          await db
	            .insert(workspaceInvitations)
	            .values({
	              orgId,
	              email,
	              invitedByUserId: userId,
	              role,
	              status: "pending",
	              createdAt: now,
	              lastSentAt: null,
	              acceptedAt: null,
	              revokedAt: null,
	            } as any)
	            .onConflictDoUpdate({
	              target: [workspaceInvitations.orgId, workspaceInvitations.email],
	              set: {
	                invitedByUserId: userId,
	                role,
	                status: "pending",
	                acceptedAt: null,
	                revokedAt: null,
	              },
	            });

          try {
            const magic = await createMagicLink(email);
            if (!magic.success || !magic.token) {
              throw new Error(magic.error || "No se pudo generar el enlace mágico");
            }
	            const magicLinkUrl = getMagicLinkUrl(magic.token);

	            if (process.env.NODE_ENV === "production") {
	              const emailResult = await sendMagicLinkEmail(email, magicLinkUrl);
	              if (!emailResult.success) {
	                throw new Error(emailResult.error || "No se pudo enviar el correo de invitación");
	              }
	            }

	            await db
	              .update(workspaceInvitations)
	              .set({ lastSentAt: now } as any)
	              .where(and(eq(workspaceInvitations.orgId, orgId), eq(workspaceInvitations.email, email)));

	            if (process.env.NODE_ENV === "production") {
	              results.push({ email, status: "sent" });
	            } else {
	              results.push({ email, status: "sent", magicLinkUrl });
	            }
	          } catch (sendErr: any) {
	            results.push({ email, status: "error", reason: sendErr?.message || "No se pudo enviar" });
	          }
	        }

        res.json({
          orgId,
          results,
        });
      } catch (e: any) {
        console.error("[Workspace] POST /invitations error:", e);
        res.status(500).json({ error: "Failed to create invitations" });
      }
    }
  );

  router.post("/api/workspace/invitations/:id/resend", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!dbUser) return res.status(404).json({ error: "User not found" });
      const orgId = (dbUser as any)?.orgId || DEFAULT_ORG_ID;

      if (!canManageWorkspaceForDbUser(dbUser)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const invitationId = String((req.params as any)?.id || "").trim();
      if (!invitationId) return res.status(400).json({ error: "Invitation id required" });

      const [inv] = await db
        .select()
        .from(workspaceInvitations)
        .where(and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.orgId, orgId)))
        .limit(1);
      if (!inv) return res.status(404).json({ error: "Invitation not found" });
      if (String((inv as any).status || "") !== "pending") {
        return res.status(400).json({ error: "Solo se pueden reenviar invitaciones pendientes" });
      }

      const email = String((inv as any).email || "").toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "Invitation missing email" });

      const magic = await createMagicLink(email);
      if (!magic.success || !magic.token) {
        return res.status(500).json({ error: magic.error || "No se pudo generar el enlace mágico" });
      }
	      const magicLinkUrl = getMagicLinkUrl(magic.token);

	      if (process.env.NODE_ENV === "production") {
	        const emailResult = await sendMagicLinkEmail(email, magicLinkUrl);
	        if (!emailResult.success) {
	          return res.status(500).json({ error: emailResult.error || "No se pudo reenviar la invitación" });
	        }
	      }

	      const now = new Date();
	      await db
	        .update(workspaceInvitations)
	        .set({ lastSentAt: now } as any)
	        .where(eq(workspaceInvitations.id, invitationId));

	      if (process.env.NODE_ENV === "production") {
	        return res.json({ success: true });
	      }

	      res.json({ success: true, magicLinkUrl });
	    } catch (e: any) {
      console.error("[Workspace] POST /invitations/:id/resend error:", e);
      res.status(500).json({ error: "Failed to resend invitation" });
    }
  });

  router.post("/api/workspace/invitations/:id/revoke", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!dbUser) return res.status(404).json({ error: "User not found" });
      const orgId = (dbUser as any)?.orgId || DEFAULT_ORG_ID;

      if (!canManageWorkspaceForDbUser(dbUser)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const invitationId = String((req.params as any)?.id || "").trim();
      if (!invitationId) return res.status(400).json({ error: "Invitation id required" });

	      const now = new Date();
	      const [updated] = await db
	        .update(workspaceInvitations)
	        .set({ status: "revoked", revokedAt: now, acceptedAt: null } as any)
	        .where(and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.orgId, orgId)))
	        .returning();

	      if (!updated) return res.status(404).json({ error: "Invitation not found" });
	
	      // Best-effort: invalidate outstanding magic links for the invited email.
	      try {
	        const email = String((updated as any)?.email || "").toLowerCase().trim();
	        if (email) {
	          const [targetUser] = await db
	            .select({ id: users.id })
	            .from(users)
	            .where(eq(users.email, email))
	            .limit(1);
	          if (targetUser?.id) {
	            await db.delete(magicLinks).where(eq(magicLinks.userId, targetUser.id));
	          }
	        }
	      } catch (cleanupErr) {
	        console.warn("[Workspace] Failed to cleanup magic links after revoke:", cleanupErr);
	      }

	      res.json({ success: true });
	    } catch (e: any) {
	      console.error("[Workspace] POST /invitations/:id/revoke error:", e);
	      res.status(500).json({ error: "Failed to revoke invitation" });
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
