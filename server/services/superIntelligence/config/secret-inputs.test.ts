import { describe, expect, it } from "vitest";
import { getCustomProviderApiKey } from "../agents/model-auth.js";
import { OpenClawSchema } from "./zod-schema.js";

describe("config secret inputs", () => {
  it("accepts SecretRef values in high-impact config surfaces", () => {
    const result = OpenClawSchema.safeParse({
      secrets: {
        providers: {
          default: {
            source: "env",
            allowlist: [
              "OPENAI_API_KEY",
              "BRAVE_API_KEY",
              "FIRECRAWL_API_KEY",
              "CRON_WEBHOOK_TOKEN",
              "HOOK_TOKEN",
              "OPENCLAW_GATEWAY_TOKEN",
              "OPENCLAW_GATEWAY_PASSWORD",
              "ELEVENLABS_API_KEY",
              "SKILL_API_KEY",
              "GOOGLECHAT_SERVICE_ACCOUNT",
              "MSTEAMS_APP_PASSWORD",
            ],
          },
        },
      },
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: {
              source: "env",
              provider: "default",
              id: "OPENAI_API_KEY",
            },
            models: [{ id: "gpt-5", name: "GPT-5" }],
          },
        },
      },
      tools: {
        web: {
          search: {
            apiKey: {
              source: "env",
              provider: "default",
              id: "BRAVE_API_KEY",
            },
          },
        },
      },
      cron: {
        webhookToken: {
          source: "env",
          provider: "default",
          id: "CRON_WEBHOOK_TOKEN",
        },
      },
      hooks: {
        token: {
          source: "env",
          provider: "default",
          id: "HOOK_TOKEN",
        },
      },
      talk: {
        apiKey: {
          source: "env",
          provider: "default",
          id: "ELEVENLABS_API_KEY",
        },
        providers: {
          elevenlabs: {
            apiKey: {
              source: "env",
              provider: "default",
              id: "ELEVENLABS_API_KEY",
            },
          },
        },
      },
      gateway: {
        auth: {
          token: {
            source: "env",
            provider: "default",
            id: "OPENCLAW_GATEWAY_TOKEN",
          },
          password: {
            source: "env",
            provider: "default",
            id: "OPENCLAW_GATEWAY_PASSWORD",
          },
        },
        remote: {
          token: {
            source: "env",
            provider: "default",
            id: "OPENCLAW_GATEWAY_TOKEN",
          },
          password: {
            source: "env",
            provider: "default",
            id: "OPENCLAW_GATEWAY_PASSWORD",
          },
        },
      },
      skills: {
        entries: {
          research: {
            apiKey: {
              source: "env",
              provider: "default",
              id: "SKILL_API_KEY",
            },
          },
        },
      },
      channels: {
        googlechat: {
          serviceAccountRef: {
            source: "env",
            provider: "default",
            id: "GOOGLECHAT_SERVICE_ACCOUNT",
          },
        },
        msteams: {
          appPassword: {
            source: "env",
            provider: "default",
            id: "MSTEAMS_APP_PASSWORD",
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("throws when model auth reads an unresolved SecretRef", () => {
    expect(() =>
      getCustomProviderApiKey(
        {
          models: {
            providers: {
              openai: {
                baseUrl: "https://api.openai.com/v1",
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "OPENAI_API_KEY",
                },
                models: [{ id: "gpt-5", name: "GPT-5" }],
              },
            },
          },
        },
        "openai",
      ),
    ).toThrow(
      'models.providers.openai.apiKey: unresolved SecretRef "env:default:OPENAI_API_KEY"',
    );
  });
});
