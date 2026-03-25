import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import {
  SandboxBrowserSchema as OpenClawSandboxBrowserSchema,
} from "../../server/openclaw/src/config/zod-schema.agent-runtime";
import {
  DiscordConfigSchema as OpenClawDiscordConfigSchema,
  SlackConfigSchema as OpenClawSlackConfigSchema,
  TelegramConfigSchema as OpenClawTelegramConfigSchema,
} from "../../server/openclaw/src/config/zod-schema.providers-core";
import { sensitive as openClawSensitive } from "../../server/openclaw/src/config/zod-schema.sensitive";
import {
  SandboxBrowserSchema as NativeSandboxBrowserSchema,
} from "../../server/services/superIntelligence/config/zod-schema.agent-runtime";
import {
  DiscordConfigSchema as NativeDiscordConfigSchema,
  SlackConfigSchema as NativeSlackConfigSchema,
  TelegramConfigSchema as NativeTelegramConfigSchema,
} from "../../server/services/superIntelligence/config/zod-schema.providers-core";
import { sensitive as nativeSensitive } from "../../server/services/superIntelligence/config/zod-schema.sensitive";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function expectSandboxBrowserContract(schema: typeof OpenClawSandboxBrowserSchema) {
  const bridge = schema.safeParse({ network: "bridge" });
  expect(bridge.success).toBe(true);

  const host = schema.safeParse({ network: "host" });
  expect(host.success).toBe(false);
  if (host.success) {
    return;
  }

  expect(host.error.issues[0]?.message).toContain('browser network mode "host" is blocked');
}

describe("OpenClaw native integration parity", () => {
  it("keeps bundled, client, and service release tags aligned", () => {
    const packageJson = JSON.parse(readRepoFile("server/openclaw/package.json")) as {
      version?: string;
    };
    const expectedVersion = packageJson.version;
    const expectedTag = expectedVersion ? `v${expectedVersion}` : null;
    const codexSource = readRepoFile("client/src/pages/codex.tsx");
    const releaseServiceSource = readRepoFile("server/services/openClawReleaseService.ts");
    const clientUsesSharedRelease = codexSource.includes('from "@shared/openclawRelease"');
    const serviceUsesSharedRelease = releaseServiceSource.includes('from "@shared/openclawRelease"');

    expect(expectedVersion).toBe("2026.3.22");
    expect(expectedTag).toBe("v2026.3.22");
    expect(
      codexSource.includes(`const OPENCLAW_RELEASE_TAG = "${expectedTag}";`) ||
      (
        clientUsesSharedRelease &&
        codexSource.includes("const OPENCLAW_RELEASE_TAG = DEFAULT_OPENCLAW_RELEASE_TAG;")
      ),
    ).toBe(true);
    expect(
      releaseServiceSource.includes(`export const DEFAULT_OPENCLAW_RELEASE_TAG = "${expectedTag}";`) ||
      (
        serviceUsesSharedRelease &&
        releaseServiceSource.includes("export { DEFAULT_OPENCLAW_RELEASE_TAG };")
      ),
    ).toBe(true);

    if (clientUsesSharedRelease || serviceUsesSharedRelease) {
      const sharedReleaseSource = readRepoFile("shared/openclawRelease.ts");
      expect(sharedReleaseSource).toContain(`OPENCLAW_RELEASE_VERSION = "${expectedVersion}"`);
    }
  });

  it("keeps zod registry compatibility on both bundled and native runtimes", () => {
    const openClawSchema = z.string().register(openClawSensitive);
    const nativeSchema = z.string().register(nativeSensitive);

    expect(openClawSensitive.has(openClawSchema)).toBe(true);
    expect(nativeSensitive.has(nativeSchema)).toBe(true);
  });

  it("enforces the sandbox browser network policy in both runtimes", () => {
    expectSandboxBrowserContract(OpenClawSandboxBrowserSchema);
    expectSandboxBrowserContract(NativeSandboxBrowserSchema);
  });

  it("normalizes telegram custom commands in both runtimes", () => {
    const config = {
      dmPolicy: "open" as const,
      allowFrom: ["*"],
      customCommands: [{ command: " /Hola-Mundo ", description: "  Saluda  " }],
    };

    const bundled = OpenClawTelegramConfigSchema.safeParse(config);
    const native = NativeTelegramConfigSchema.safeParse(config);

    expect(bundled.success).toBe(true);
    expect(native.success).toBe(true);

    if (!bundled.success || !native.success) {
      return;
    }

    expect(bundled.data.customCommands?.[0]).toEqual({
      command: "hola_mundo",
      description: "Saluda",
    });
    expect(native.data.customCommands?.[0]).toEqual({
      command: "hola_mundo",
      description: "Saluda",
    });
  });

  it("accepts discord account-level configs in both runtimes", () => {
    const config = {
      accounts: {
        ops: {
          activity: "OpenClaw Live",
          activityType: 1,
          activityUrl: "https://twitch.tv/openclaw",
        },
      },
    };

    expect(OpenClawDiscordConfigSchema.safeParse(config).success).toBe(true);
    expect(NativeDiscordConfigSchema.safeParse(config).success).toBe(true);
  });

  it("accepts slack account configs with streaming normalization in both runtimes", () => {
    const config = {
      accounts: {
        ops: {
          mode: "socket" as const,
          streamMode: "append" as const,
        },
      },
    };

    const bundled = OpenClawSlackConfigSchema.safeParse(config);
    const native = NativeSlackConfigSchema.safeParse(config);

    expect(bundled.success).toBe(true);
    expect(native.success).toBe(true);

    if (!bundled.success || !native.success) {
      return;
    }

    expect(bundled.data.accounts?.ops?.streamMode).toBeUndefined();
    expect(native.data.accounts?.ops?.streamMode).toBeUndefined();
  });
});
