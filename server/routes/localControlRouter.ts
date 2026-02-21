import { Router } from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";

const router = Router();

function extractFolderName(input: string): string | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const patterns = [
    /(?:crea|crear|creame|haz|genera)\s+(?:una\s+)?carpeta(?:\s+en\s+mi\s+escritorio)?(?:\s+(?:llamada|con\s+nombre))?\s+["']?([^"'\n]{1,120})["']?/i,
    /^(?:\/)?mkdir\s+["']?([^"'\n]{1,120})["']?$/i,
  ];

  for (const re of patterns) {
    const m = prompt.match(re);
    const candidate = m?.[1]?.trim().replace(/[.,;:!?]+$/g, "").trim();
    if (candidate) return candidate;
  }
  return null;
}

router.post("/local/create-folder", async (req, res) => {
  try {
    const bodyName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const bodyPrompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const name = bodyName || extractFolderName(bodyPrompt);

    if (!name) {
      return res.status(400).json({ success: false, error: "Folder name is required" });
    }

    const invalid = /[\\/:*?"<>|]/.test(name) || name.includes("..");
    if (invalid) {
      return res.status(400).json({ success: false, error: "Invalid folder name" });
    }

    const folderPath = path.join(os.homedir(), "Desktop", name);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.appendFile(
      path.join(os.homedir(), ".iliagpt-control-audit.log"),
      `${new Date().toISOString()} local_control_router mkdir path=${folderPath}\n`,
      "utf-8"
    );

    return res.json({
      success: true,
      name,
      path: folderPath,
      message: `Listo. Carpeta creada en tu escritorio: ${folderPath}`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to create folder" });
  }
});

export function createLocalControlRouter() {
  return router;
}
