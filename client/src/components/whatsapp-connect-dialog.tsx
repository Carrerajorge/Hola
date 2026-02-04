import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

export function WhatsAppConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>({ state: 'disconnected' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const refreshStatus = async () => {
    const res = await api<{ success: true; status: Status }>(`/api/integrations/whatsapp/web/status`);
    setStatus(res.status);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ success: true; status: Status }>(`/api/integrations/whatsapp/web/connect/start`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setStatus(res.status);
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar la conexión');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<{ success: true }>(`/api/integrations/whatsapp/web/connect/disconnect`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setStatus({ state: 'disconnected' });
    } catch (e: any) {
      setError(e?.message || 'No se pudo desconectar');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    const t = setInterval(() => {
      void refreshStatus().catch(() => null);
    }, 1200);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (status.state !== 'qr') {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(status.qr, { margin: 1, width: 260 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp (Web QR)</DialogTitle>
          <DialogDescription>
            Esto enlaza su WhatsApp mediante un QR que usted escanea desde su teléfono.
            No es una intrusión: requiere su aprobación explícita.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border p-3 bg-muted/20">
            <div className="text-sm">
              Estado: <span className="font-medium">{status.state}</span>
              {status.state === 'connected' && status.me?.id ? (
                <span className="text-muted-foreground"> — {status.me.id}</span>
              ) : null}
            </div>
          </div>

          {status.state === 'qr' && (
            <div className="flex flex-col items-center gap-3">
              <div className={cn('rounded-xl border bg-white p-3', 'w-fit')}>
                <img
                  src={qrDataUrl || ''}
                  alt="WhatsApp QR"
                  className="h-[260px] w-[260px]"
                />
              </div>
              <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
                <li>Abra WhatsApp en su teléfono</li>
                <li>Dispositivos vinculados → Vincular un dispositivo</li>
                <li>Escanee este QR</li>
              </ol>
            </div>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-2">
            {status.state === 'connected' ? (
              <Button variant="destructive" onClick={disconnect} disabled={busy}>
                Desconectar
              </Button>
            ) : (
              <Button onClick={start} disabled={busy}>
                Generar QR
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Nota: WhatsApp Web (no oficial) puede ser inestable. Si quiere algo 100% estable para producción,
            use WhatsApp Business Cloud API.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
