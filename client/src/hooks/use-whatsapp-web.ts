import { useCallback, useEffect, useState } from 'react';

type Status =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'qr'; qr: string }
  | { state: 'connected'; me?: { id?: string; name?: string } };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export function useWhatsAppWebStatus(enabled: boolean) {
  const [status, setStatus] = useState<Status>({ state: 'disconnected' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ success: true; status: Status }>(`/api/integrations/whatsapp/web/status`);
      setStatus(res.status);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => void refresh(), 1200);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { status, error, refresh };
}
