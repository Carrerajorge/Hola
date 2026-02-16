# LLM Providers

The backend supports multiple LLM providers via `server/lib/llmGateway.ts`.

## Supported Providers

- xAI (Grok): `provider="xai"`
- Google Gemini: `provider="gemini"` (alias: `google`)
- OpenAI: `provider="openai"`
- Anthropic (Claude): `provider="anthropic"` (alias: `claude`)
- DeepSeek: `provider="deepseek"` (alias: `deepsep`)
- Auto selection: `provider="auto"`

## Environment Variables

Set at least one provider key:

- `XAI_API_KEY`
- `GEMINI_API_KEY` (or legacy `GOOGLE_API_KEY`)
- `OPENAI_API_KEY` (optional: `OPENAI_BASE_URL`)
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY` (optional: `DEEPSEEK_BASE_URL`, default `https://api.deepseek.com/v1`)

See `.env.example` for the full list.

## Request Routing (Provider/Model)

The chat endpoints accept:

- `provider`: one of the values above (or aliases)
- `model`: the target model name for that provider

When `provider="auto"`:

- If `model` clearly belongs to a provider (e.g. contains `gemini`, `gpt-`, `claude`, `deepseek`), the gateway selects that provider.
- Otherwise, the gateway selects the first configured provider in the fallback order.

When `provider` is explicitly set (not `auto`), `model` is treated as belonging to that provider only.

