import { Router } from "express";
import * as codeInterpreter from "../services/codeInterpreterService";
import * as pistonService from "../services/pistonService";

export function createCodeRouter() {
  const router = Router();

  router.post("/api/code-interpreter/run", async (req, res) => {
    try {
      const { code, conversationId, language } = req.body;
      
      if (!code || typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ error: "Code is required" });
      }

      const user = (req as any).user;
      const userId = user?.claims?.sub;

      const result = await codeInterpreter.executeCode(code, {
        conversationId,
        userId,
        language: language || "python",
      });

      res.json({
        run: result.run,
        artifacts: result.artifacts,
      });
    } catch (error: any) {
      console.error("Error executing code:", error);
      res.status(500).json({ error: "Failed to execute code" });
    }
  });

  router.get("/api/code-interpreter/run/:id", async (req, res) => {
    try {
      const run = await codeInterpreter.getRun(req.params.id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      const artifacts = await codeInterpreter.getRunArtifacts(req.params.id);
      res.json({ run, artifacts });
    } catch (error: any) {
      console.error("Error getting run:", error);
      res.status(500).json({ error: "Failed to get run" });
    }
  });

  router.get("/api/sandbox/runtimes", async (req, res) => {
    try {
      const runtimes = await pistonService.getSupportedRuntimes();
      const languages = pistonService.getSupportedLanguages();
      const aliases = pistonService.getLanguageAliases();
      
      res.json({
        runtimes,
        supportedLanguages: languages,
        aliases,
      });
    } catch (error: any) {
      console.error("Error fetching runtimes:", error);
      res.status(500).json({ error: "Failed to fetch available runtimes" });
    }
  });

  router.post("/api/sandbox/execute", async (req, res) => {
    try {
      const { code, language, stdin, args } = req.body;

      if (!code || typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ error: "Code is required" });
      }

      if (!language || typeof language !== "string") {
        return res.status(400).json({ error: "Language is required" });
      }

      const langInfo = await pistonService.getLanguageInfo(language);
      if (!langInfo.supported) {
        const supportedLangs = pistonService.getSupportedLanguages();
        return res.status(400).json({
          error: `Unsupported language: ${language}`,
          supportedLanguages: supportedLangs,
        });
      }

      const result = await pistonService.executeCode(
        language,
        code,
        stdin,
        args
      );

      res.json({
        run: result.run,
        compile: result.compile,
        errorLines: result.errorLines,
        language: result.language,
        version: result.version,
        usedFallback: result.usedFallback || false,
        artifacts: result.artifacts || [],
      });
    } catch (error: any) {
      console.error("Sandbox execution error:", error);
      res.status(500).json({
        error: "Failed to execute code",
        details: error.message,
      });
    }
  });

  return router;
}
