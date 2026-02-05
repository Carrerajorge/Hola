import { Router } from "express";
import { z } from "zod";
import { generateSkillFromPrompt } from "../services/skillGenerator";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";

const generateSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

export function createSkillsRouter(): Router {
  const router = Router();

  // POST /api/skills/generate
  // Generates a Skill spec (name/description/instructions/etc.) from a single prompt.
  router.post("/generate", async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const userId = getOrCreateSecureUserId(req);

    try {
      const skill = await generateSkillFromPrompt(parsed.data.prompt, { userId });
      return res.json({ skill });
    } catch (error: any) {
      console.error("[SkillsRouter] generate error:", error);
      return res.status(500).json({ error: error?.message || "Failed to generate skill" });
    }
  });

  return router;
}

