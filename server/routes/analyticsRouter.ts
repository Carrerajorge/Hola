import { Router } from "express";
import { z } from "zod";
import { analyticsTracker } from "../services/analyticsTracker";
import { getSecureUserId } from "../lib/anonUserHelper";
import { storage } from "../storage";
import { validateBody } from "../middleware/validateRequest";

const metadataSchema = z.record(z.union([
  z.string().max(512),
  z.number(),
  z.boolean(),
  z.null(),
])).optional();

const trackSchema = z.object({
  eventType: z.enum(["page_view", "action", "chat_query"]),
  sessionId: z.string().min(1).max(128).optional(),
  page: z.string().min(1).max(512).optional(),
  action: z.string().min(1).max(128).optional(),
  metadata: metadataSchema,
}).superRefine((value, ctx) => {
  if (value.eventType === "page_view" && !value.page) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "page is required for page_view", path: ["page"] });
  }
  if (value.eventType === "action" && !value.action) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "action is required for action", path: ["action"] });
  }
});

export function createAnalyticsRouter(): Router {
  const router = Router();

  // Lightweight analytics collection (opt-out via privacySettings.analyticsTracking).
  router.post("/track", validateBody(trackSchema), async (req, res) => {
    try {
      const userId = getSecureUserId(req) || undefined;
      const { eventType, sessionId, page, action, metadata } = req.body as z.infer<typeof trackSchema>;

      // Respect browser privacy signals.
      const dnt = String(req.headers["dnt"] || "");
      const gpc = String(req.headers["sec-gpc"] || "");
      if (dnt === "1" || gpc === "1") {
        return res.json({ success: true, recorded: false, skipped: "do_not_track" });
      }

      // Default to enabled, but respect user opt-out.
      if (userId && !userId.startsWith("anon_")) {
        const settings = await storage.getUserSettings(userId);
        const allowed = settings?.privacySettings?.analyticsTracking !== false;
        if (!allowed) {
          return res.json({ success: true, recorded: false, skipped: "analytics_disabled" });
        }
      }

      const sid = sessionId || (req as any).sessionID || "unknown";

      if (eventType === "page_view") {
        analyticsTracker.trackPageView(userId, sid, page || "/", metadata);
      } else if (eventType === "action") {
        analyticsTracker.trackAction(userId, sid, action || "unknown", metadata);
      } else if (eventType === "chat_query") {
        analyticsTracker.trackChatQuery(userId, sid, metadata);
      }

      res.json({ success: true, recorded: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to track analytics" });
    }
  });

  return router;
}
