const WECHAT_API_BASE = "https://api.weixin.qq.com";
const WECHAT_MAX_TEXT_LEN = 600;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function chunkText(text: string, maxLen = WECHAT_MAX_TEXT_LEN): string[] {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) parts.push(cleaned.slice(i, i + maxLen));
  return parts;
}

export async function getWeChatAccessToken(input: {
  appId: string;
  appSecret: string;
}): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token;
  }

  const url = `${WECHAT_API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(input.appId)}&secret=${encodeURIComponent(input.appSecret)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`WeChat token request failed: HTTP ${resp.status}`);
  }

  const json = (await resp.json()) as any;
  if (json.errcode) {
    throw new Error(`WeChat token error: ${json.errcode} ${json.errmsg}`);
  }

  const token = json.access_token as string;
  const expiresIn = (json.expires_in as number) || 7200;
  cachedAccessToken = {
    token,
    expiresAt: Date.now() + (expiresIn - 300) * 1000, // refresh 5min early
  };

  return token;
}

export async function wechatSendText(input: {
  openId: string;
  text: string;
  appId: string;
  appSecret: string;
}): Promise<void> {
  const parts = chunkText(input.text);
  if (parts.length === 0) return;

  const accessToken = await getWeChatAccessToken({ appId: input.appId, appSecret: input.appSecret });

  for (const part of parts) {
    const url = `${WECHAT_API_BASE}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: input.openId,
          msgtype: "text",
          text: { content: part },
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        lastError = new Error(`WeChat send failed: HTTP ${resp.status} ${body}`);
        if (!isRetryable(resp.status)) break;
        continue;
      }

      const result = (await resp.json()) as any;
      if (result.errcode && result.errcode !== 0) {
        lastError = new Error(`WeChat send error: ${result.errcode} ${result.errmsg}`);
        break; // WeChat app-level errors are not retryable
      }

      lastError = null;
      break;
    }

    if (lastError) throw lastError;
  }
}

export async function wechatSendDocument(input: {
  openId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  appId: string;
  appSecret: string;
}): Promise<void> {
  const accessToken = await getWeChatAccessToken({ appId: input.appId, appSecret: input.appSecret });

  // Step 1: Upload media (with retry)
  const uploadUrl = `${WECHAT_API_BASE}/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=file`;
  let mediaId: string | null = null;
  {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

      const form = new FormData();
      form.append("media", new Blob([new Uint8Array(input.fileBuffer)], { type: input.mimeType }), input.fileName);

      const uploadResp = await fetch(uploadUrl, { method: "POST", body: form });
      if (!uploadResp.ok) {
        const body = await uploadResp.text().catch(() => "");
        lastError = new Error(`WeChat media upload failed: HTTP ${uploadResp.status} ${body}`);
        if (!isRetryable(uploadResp.status)) break;
        continue;
      }

      const uploadJson = (await uploadResp.json()) as any;
      if (uploadJson.errcode) {
        lastError = new Error(`WeChat media upload error: ${uploadJson.errcode} ${uploadJson.errmsg}`);
        break;
      }

      mediaId = uploadJson.media_id as string;
      if (!mediaId) {
        lastError = new Error("WeChat media upload returned no media_id");
        break;
      }

      lastError = null;
      break;
    }
    if (lastError) throw lastError;
  }

  // Step 2: Send file message (with retry)
  const sendUrl = `${WECHAT_API_BASE}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`;
  {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

      const sendResp = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: input.openId,
          msgtype: "file",
          file: { media_id: mediaId },
        }),
      });

      if (!sendResp.ok) {
        const body = await sendResp.text().catch(() => "");
        lastError = new Error(`WeChat document send failed: HTTP ${sendResp.status} ${body}`);
        if (!isRetryable(sendResp.status)) break;
        continue;
      }

      const result = (await sendResp.json()) as any;
      if (result.errcode && result.errcode !== 0) {
        lastError = new Error(`WeChat document send error: ${result.errcode} ${result.errmsg}`);
        break;
      }

      lastError = null;
      break;
    }
    if (lastError) throw lastError;
  }
}

/** Parse WeChat's flat XML message into a plain object. */
export function parseWeChatXml(raw: string): Record<string, string> | null {
  if (!raw || typeof raw !== "string") return null;
  const result: Record<string, string> = {};
  const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(\d+)<\/\3>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(raw)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] ?? match[4];
    if (key && value !== undefined) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}
