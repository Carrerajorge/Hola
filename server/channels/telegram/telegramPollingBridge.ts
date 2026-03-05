import { submitChannelIngest } from "../channelIngestQueue";
import { env } from "../../config/env";
import { Logger } from "../../lib/logger";
import { normalizeChannelText } from "../channelTransport";

const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{35,}$/;
const DEFAULT_LONG_POLL_TIMEOUT_SECONDS = 45;
const POLL_RETRY_DELAY_MS = 2_500;
const WEBHOOK_CONFLICT_DELAY_MS = 30_000;
const MAX_RUN_ID_LENGTH = 64;
const STARTUP_WEBHOOK_RESET_TIMEOUT_MS = 15_000;

type TelegramGetUpdatesResponse = {
  ok?: boolean;
  description?: string;
  result?: unknown[];
};

function normalizeToken(raw: unknown): string {
  const token = normalizeChannelText(raw, 256).replace(/\s+/g, "");
  if (!TELEGRAM_TOKEN_RE.test(token)) return "";
  return token;
}

function isPollingEnabledInCurrentRuntime(): boolean {
  if (env.NODE_ENV === "production") return false;
  const raw = String(process.env.TELEGRAM_DEV_POLLING ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
}

function toRunId(updateId: unknown): string {
  const numeric = Number(updateId);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return `tg_poll_${Date.now()}`.slice(0, MAX_RUN_ID_LENGTH);
  }
  return `tg_poll_${Math.trunc(numeric)}`.slice(0, MAX_RUN_ID_LENGTH);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function resetWebhookForPolling(apiBase: string, signal: AbortSignal): Promise<void> {
  try {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort("telegram_webhook_reset_timeout"), STARTUP_WEBHOOK_RESET_TIMEOUT_MS);
    const onAbort = () => timeoutController.abort("telegram_poll_bridge_aborted");
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(`${apiBase}/deleteWebhook?drop_pending_updates=false`, {
        method: "GET",
        signal: timeoutController.signal,
      });
      const payload = (await response.json().catch(() => null)) as TelegramGetUpdatesResponse | null;
      if (response.ok && payload?.ok) {
        Logger.info("[Telegram] Polling bridge cleared webhook for long polling mode");
      } else {
        Logger.warn("[Telegram] Polling bridge could not clear webhook", {
          status: response.status,
          description: payload?.description || response.statusText || "unknown",
        });
      }
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    if (signal.aborted) return;
    Logger.warn("[Telegram] Polling bridge webhook reset failed", {
      reason: String((error as Error)?.message || error || "unknown"),
    });
  }
}

export function startTelegramPollingBridge(): () => void {
  const token = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!token) {
    Logger.info("[Telegram] Polling bridge skipped (missing TELEGRAM_BOT_TOKEN)");
    return () => {};
  }

  if (!isPollingEnabledInCurrentRuntime()) {
    Logger.info("[Telegram] Polling bridge disabled via TELEGRAM_DEV_POLLING");
    return () => {};
  }

  const controller = new AbortController();
  const signal = controller.signal;
  const apiBase = `https://api.telegram.org/bot${token}`;
  let offset = 0;
  let loopStartedAt = Date.now();

  const loop = async () => {
    Logger.info("[Telegram] Polling bridge started (dev mode)");
    await resetWebhookForPolling(apiBase, signal);

    while (!signal.aborted) {
      try {
        const params = new URLSearchParams();
        params.set("timeout", String(DEFAULT_LONG_POLL_TIMEOUT_SECONDS));
        if (offset > 0) {
          params.set("offset", String(offset));
        }

        const response = await fetch(`${apiBase}/getUpdates?${params.toString()}`, {
          method: "GET",
          signal,
        });

        const payload = (await response.json().catch(() => null)) as TelegramGetUpdatesResponse | null;
        const ok = Boolean(response.ok && payload?.ok);
        if (!ok) {
          const description = normalizeChannelText(payload?.description, 500).toLowerCase();
          if (description.includes("webhook")) {
            const elapsedSec = Math.floor((Date.now() - loopStartedAt) / 1000);
            Logger.info("[Telegram] Polling paused because a webhook is configured", {
              elapsedSec,
            });
            await delay(WEBHOOK_CONFLICT_DELAY_MS, signal);
            continue;
          }
          Logger.warn("[Telegram] getUpdates failed", {
            status: response.status,
            description: payload?.description || response.statusText || "unknown",
          });
          await delay(POLL_RETRY_DELAY_MS, signal);
          continue;
        }

        const updates = Array.isArray(payload?.result) ? payload!.result! : [];
        if (updates.length === 0) {
          continue;
        }

        for (const rawUpdate of updates) {
          const updateObj = rawUpdate as Record<string, unknown>;
          const updateIdRaw = updateObj?.update_id;
          const updateId = Number(updateIdRaw);
          if (Number.isFinite(updateId)) {
            offset = Math.max(offset, Math.trunc(updateId) + 1);
          }

          await submitChannelIngest({
            channel: "telegram",
            update: updateObj,
            receivedAt: new Date().toISOString(),
            runId: toRunId(updateIdRaw),
          });
        }
      } catch (error) {
        if (signal.aborted) break;
        Logger.warn("[Telegram] Polling bridge loop error", {
          reason: String((error as Error)?.message || error || "unknown"),
        });
        await delay(POLL_RETRY_DELAY_MS, signal);
      }
    }

    Logger.info("[Telegram] Polling bridge stopped");
  };

  void loop();

  return () => {
    controller.abort();
  };
}
