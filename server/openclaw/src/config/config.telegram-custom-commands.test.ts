import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("telegram custom commands schema", () => {
  it("uses zod v3-compatible transforms for telegram custom commands", () => {
    const source = readFileSync(new URL("./zod-schema.providers-core.ts", import.meta.url), "utf8");
    const start = source.indexOf("const TelegramCustomCommandSchema");
    const end = source.indexOf("const validateTelegramCustomCommands", start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain(".transform(normalizeTelegramCommandName)");
    expect(block).toContain(".transform(normalizeTelegramCommandDescription)");
    expect(block).not.toContain(".overwrite(");
  });

  it("normalizes custom commands", () => {
    const res = OpenClawSchema.safeParse({
      channels: {
        telegram: {
          customCommands: [{ command: "/Backup", description: "  Git backup  " }],
        },
      },
    });

    expect(res.success).toBe(true);
    if (!res.success) {
      return;
    }

    expect(res.data.channels?.telegram?.customCommands).toEqual([
      { command: "backup", description: "Git backup" },
    ]);
  });

  it("normalizes hyphens in custom command names", () => {
    const res = OpenClawSchema.safeParse({
      channels: {
        telegram: {
          customCommands: [{ command: "Bad-Name", description: "Override status" }],
        },
      },
    });

    expect(res.success).toBe(true);
    if (!res.success) {
      return;
    }

    expect(res.data.channels?.telegram?.customCommands).toEqual([
      { command: "bad_name", description: "Override status" },
    ]);
  });
});
