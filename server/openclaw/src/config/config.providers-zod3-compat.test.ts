import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider schema zod v3 compatibility", () => {
  it("keeps Discord config extension on the base object schema", () => {
    const source = readFileSync(new URL("./zod-schema.providers-core.ts", import.meta.url), "utf8");
    const start = source.indexOf("const DiscordAccountSchemaBase");
    const end = source.indexOf("export const GoogleChatDmSchema", start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("export const DiscordAccountSchema = DiscordAccountSchemaBase");
    expect(block).toContain("export const DiscordConfigSchema = DiscordAccountSchemaBase.extend({");
    expect(block).not.toContain("DiscordAccountSchema.extend(");
  });

  it("keeps Slack config extension on the base object schema", () => {
    const source = readFileSync(new URL("./zod-schema.providers-core.ts", import.meta.url), "utf8");
    const start = source.indexOf("const SlackAccountSchemaBase");
    const end = source.indexOf("const SignalGroupEntrySchema", start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("export const SlackAccountSchema = SlackAccountSchemaBase");
    expect(block).toContain("export const SlackConfigSchema = SlackAccountSchemaBase.extend({");
    expect(block).not.toContain("SlackAccountSchema.safeExtend(");
  });
});
