export async function httpJson<T>(url: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
} = {}): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(opts.headers || {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.error || data?.message || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data as T;
  } finally {
    clearTimeout(t);
  }
}
