export const SILENT_QUERY_META = { suppressGlobalErrorToast: true } as const;

export function withStatusPrefix(status: number, message: string): string {
  const normalized = message.trim();
  if (!normalized) return `${status}: Request failed`;
  return /^\d{3}\s*:/.test(normalized) ? normalized : `${status}: ${normalized}`;
}

export async function getResponseErrorMessage(res: Response, fallback: string): Promise<string> {
  const raw = (await res.text().catch(() => "")).trim();
  if (!raw) return `${res.status}: ${fallback}`;

  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return withStatusPrefix(res.status, parsed.error);
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return withStatusPrefix(res.status, parsed.message);
    }
  } catch {
    // Fall back to raw text below.
  }

  return withStatusPrefix(res.status, raw);
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
