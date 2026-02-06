import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { workspaces, users, libraryFiles, workspaceInvitations } from "@shared/schema";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { validateBody } from "../middleware/validateRequest";
import { getUserId } from "../types/express";
import { isValidWorkspaceName, normalizeWorkspaceName } from "../services/workspaceValidation";
import { createMagicLink, getMagicLinkUrl } from "../services/magicLink";

const DEFAULT_ORG_ID = "default";
const DEFAULT_SEAT_PRICE_CENTS = 3000; // $30 / participante (UI)

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

  async function getOrgContext(userId: string): Promise<{ orgId: string; role: string; email: string | null } | null> {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return null;
    return {
      orgId: (u as any)?.orgId || DEFAULT_ORG_ID,
      role: (u as any)?.role || "guest",
      email: (u as any)?.email || null,
    };
  }

  function isWorkspaceAdminRole(role: string): boolean {
    return ["admin", "superadmin", "team_admin"].includes(role);
  }

  async function getSeatCounts(orgId: string): Promise<{
    activeMembers: number;
    pendingInvites: number;
    billedSeats: number;
    seatPriceCents: number;
    currency: string;
    totalCents: number;
  }> {
    const [membersAgg] = await db
      .select({ c: count() })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.status, "active"), isNull(users.deletedAt)));

    const [invitesAgg] = await db
      .select({ c: count() })
      .from(workspaceInvitations)
      .leftJoin(
        users,
        and(
          eq(users.email, workspaceInvitations.email),
          eq(users.orgId, workspaceInvitations.orgId),
          eq(users.status, "active"),
          isNull(users.deletedAt)
        )
      )
      // Exclude "pending" invitations for emails that are already active members to avoid double-billing.
      .where(
        and(
          eq(workspaceInvitations.orgId, orgId),
          eq(workspaceInvitations.status, "pending"),
          isNull(users.id)
        )
      );

    const activeMembers = Number(membersAgg?.c) || 0;
    const pendingInvites = Number(invitesAgg?.c) || 0;
    const billedSeats = activeMembers + pendingInvites;
    const seatPriceCents = DEFAULT_SEAT_PRICE_CENTS;
    const currency = "USD";
    const totalCents = billedSeats * seatPriceCents;

    return { activeMembers, pendingInvites, billedSeats, seatPriceCents, currency, totalCents };
  }

  router.get("/api/workspace/me", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const orgId = (u as any)?.orgId || DEFAULT_ORG_ID;

      const ws = await ensureWorkspace(orgId);

      res.json({
        orgId,
        workspaceId: ws.id,
        name: ws.name,
        logoFileUuid: ws.logoFileUuid || null,
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
        const role = (u as any)?.role || "guest";
        if (!['admin', 'superadmin', 'team_admin'].includes(role)) {
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

  // List active members in the current workspace/org.
  router.get("/api/workspace/members", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const ctx = await getOrgContext(userId);
      if (!ctx) return res.status(401).json({ error: "Debes iniciar sesión" });

      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          fullName: users.fullName,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(eq(users.orgId, ctx.orgId), eq(users.status, "active"), isNull(users.deletedAt)))
        .orderBy(desc(users.createdAt));

      res.json({ orgId: ctx.orgId, members: rows });
    } catch (e: any) {
      console.error("[Workspace] GET /members error:", e);
      res.status(500).json({ error: "Failed to load members" });
    }
  });

  // Seat-based billing info for the current workspace/org.
  router.get("/api/workspace/billing", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const ctx = await getOrgContext(userId);
      if (!ctx) return res.status(401).json({ error: "Debes iniciar sesión" });

      const counts = await getSeatCounts(ctx.orgId);
      res.json({ orgId: ctx.orgId, ...counts });
    } catch (e: any) {
      console.error("[Workspace] GET /billing error:", e);
      res.status(500).json({ error: "Failed to load workspace billing" });
    }
  });

  // List pending invitations (admin-only).
  router.get("/api/workspace/invitations", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const ctx = await getOrgContext(userId);
      if (!ctx) return res.status(401).json({ error: "Debes iniciar sesión" });
      if (!isWorkspaceAdminRole(ctx.role)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const invites = await db
        .select({
          id: workspaceInvitations.id,
          email: workspaceInvitations.email,
          role: workspaceInvitations.role,
          status: workspaceInvitations.status,
          createdAt: workspaceInvitations.createdAt,
          lastSentAt: workspaceInvitations.lastSentAt,
        })
        .from(workspaceInvitations)
        .leftJoin(
          users,
          and(
            eq(users.email, workspaceInvitations.email),
            eq(users.orgId, workspaceInvitations.orgId),
            eq(users.status, "active"),
            isNull(users.deletedAt)
          )
        )
        // Hide stale "pending" invites for users who are already active members.
        .where(and(eq(workspaceInvitations.orgId, ctx.orgId), eq(workspaceInvitations.status, "pending"), isNull(users.id)))
        .orderBy(desc(workspaceInvitations.createdAt));

      res.json({ orgId: ctx.orgId, invitations: invites });
    } catch (e: any) {
      console.error("[Workspace] GET /invitations error:", e);
      res.status(500).json({ error: "Failed to load invitations" });
    }
  });

  // Invite a member by email (admin-only). Creates/refreshes a magic link and records a pending invitation.
  router.post(
    "/api/workspace/invitations",
    validateBody(
      z.object({
        email: z.string().email(),
        role: z.enum(["team_member", "team_admin"]).optional(),
      })
    ),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

        const ctx = await getOrgContext(userId);
        if (!ctx) return res.status(401).json({ error: "Debes iniciar sesión" });
        if (!isWorkspaceAdminRole(ctx.role)) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const email = req.body.email.trim().toLowerCase();
        const inviteRole = req.body.role || "team_member";

        if (ctx.email && ctx.email.toLowerCase() === email) {
          return res.status(400).json({ error: "No puedes invitarte a ti mismo", code: "CANNOT_INVITE_SELF" });
        }

        const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const existingOrgId = (existingUser as any)?.orgId || DEFAULT_ORG_ID;
        const existingStatus = (existingUser as any)?.status || null;

        if (existingUser && existingStatus === "active" && existingOrgId === ctx.orgId) {
          return res.status(409).json({ error: "Este usuario ya es miembro del espacio de trabajo", code: "ALREADY_MEMBER" });
        }

        if (existingUser && existingStatus === "active" && existingOrgId !== ctx.orgId) {
          return res.status(400).json({ error: "El usuario ya pertenece a otro espacio de trabajo", code: "USER_IN_OTHER_WORKSPACE" });
        }

        const [existingInvite] = await db
          .select()
          .from(workspaceInvitations)
          .where(and(eq(workspaceInvitations.orgId, ctx.orgId), eq(workspaceInvitations.email, email)))
          .limit(1);

        // Always refresh magic link token when (re)inviting.
        const magic = await createMagicLink(email);
        if (!magic.success || !magic.token) {
          return res.status(500).json({ error: magic.error || "No se pudo generar el enlace de invitación" });
        }
        const inviteLink = getMagicLinkUrl(magic.token);

        // If user exists but is pending, bind them to this org so they appear in the right workspace once activated.
        const [invitedUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (invitedUser) {
          const invitedStatus = (invitedUser as any)?.status || null;
          const invitedOrgId = (invitedUser as any)?.orgId || DEFAULT_ORG_ID;
          if (invitedStatus !== "active" && invitedOrgId !== ctx.orgId) {
            await db
              .update(users)
              .set({ orgId: ctx.orgId, role: inviteRole, updatedAt: new Date() })
              .where(eq(users.id, invitedUser.id));
          } else if (invitedStatus !== "active") {
            await db
              .update(users)
              .set({ role: inviteRole, updatedAt: new Date() })
              .where(eq(users.id, invitedUser.id));
          }
        }

        const now = new Date();
        let invitation: any = null;

        if (existingInvite) {
          const [updated] = await db
            .update(workspaceInvitations)
            .set({
              status: "pending",
              lastSentAt: now,
              invitedByUserId: userId,
              role: inviteRole,
              acceptedAt: null,
              revokedAt: null,
            })
            .where(eq(workspaceInvitations.id, existingInvite.id))
            .returning();
          invitation = updated || existingInvite;
        } else {
          const [created] = await db
            .insert(workspaceInvitations)
            .values({
              orgId: ctx.orgId,
              email,
              invitedByUserId: userId,
              role: inviteRole,
              status: "pending",
              lastSentAt: now,
            })
            .returning();
          invitation = created;
        }

        const counts = await getSeatCounts(ctx.orgId);

        res.json({
          success: true,
          invitation: {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            createdAt: invitation.createdAt,
            lastSentAt: invitation.lastSentAt,
          },
          inviteLink,
          billing: counts,
        });
      } catch (e: any) {
        console.error("[Workspace] POST /invitations error:", e);
        res.status(500).json({ error: "Failed to invite member" });
      }
    }
  );

  // Revoke a pending invitation (admin-only).
  router.delete("/api/workspace/invitations/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

      const ctx = await getOrgContext(userId);
      if (!ctx) return res.status(401).json({ error: "Debes iniciar sesión" });
      if (!isWorkspaceAdminRole(ctx.role)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const invitationId = req.params.id;
      const [inv] = await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, invitationId)).limit(1);
      if (!inv || (inv as any).orgId !== ctx.orgId) {
        return res.status(404).json({ error: "Invitación no encontrada" });
      }

      if ((inv as any).status !== "pending") {
        return res.status(400).json({ error: "La invitación ya no está pendiente" });
      }

      const [updated] = await db
        .update(workspaceInvitations)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(workspaceInvitations.id, invitationId))
        .returning();

      const counts = await getSeatCounts(ctx.orgId);

      res.json({ success: true, invitation: updated, billing: counts });
    } catch (e: any) {
      console.error("[Workspace] DELETE /invitations/:id error:", e);
      res.status(500).json({ error: "Failed to revoke invitation" });
    }
  });

  return router;
}
