import { describe, expect, it } from "vitest";

import { SandboxBrowserSchema } from "../../server/services/superIntelligence/config/zod-schema.agent-runtime";

describe("superIntelligence sandbox browser schema", () => {
  it("accepts bridge network mode", () => {
    const parsed = SandboxBrowserSchema.safeParse({ network: "bridge" });

    expect(parsed.success).toBe(true);
  });

  it('rejects network mode "host" with a validation error', () => {
    const parsed = SandboxBrowserSchema.safeParse({ network: "host" });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }

    expect(parsed.error.issues[0]?.message).toContain('browser network mode "host" is blocked');
  });
});
