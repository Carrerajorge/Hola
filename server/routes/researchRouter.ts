import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { academicSearchServiceSSE } from "../services/academicSearchServiceSSE";
import type { Response } from "express";

const router = Router();

/**
 * Dedicated endpoint for academic/research search with SSE streaming
 * POST /api/research/stream
 * Body: { query: string }
 */
router.post("/stream", async (req, res: Response) => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== "string") {
            return res.status(400).json({ error: "Query parameter required" });
        }

        const runId = uuidv4();
        const userId = (req as any).user?.claims?.sub || "anonymous";

        // Set SSE headers
        res.setHeader("X-Run-ID", runId);
        res.setHeader("X-Session-ID", `research-${Date.now()}`);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Content-Type", "text/event-stream");
        res.flushHeaders();

        // Process with SSE
        await academicSearchServiceSSE.processResearchRequestWithSSE(
            query,
            res,
            runId,
            { userId }
        );

    } catch (error) {
        console.error("[Research Stream] Error:", error);
        try {
            res.write(`event: run_failed\n`);
            res.write(`data: ${JSON.stringify({
                run_id: uuidv4(),
                error: "Error durante la búsqueda académica"
            })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } catch (writeError) {
            console.error("[Research Stream] Failed to send error:", writeError);
        }
    }
});

export default router;
