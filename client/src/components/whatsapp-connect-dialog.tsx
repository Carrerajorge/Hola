import { useEffect, useState, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/apiClient';
import { whatsappWebEventStream, type WhatsAppWebStatus } from '@/lib/whatsapp-web-events';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Error del servidor (${res.status})`);
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
  const [status, setStatus] = useState<WhatsAppWebStatus>({ state: 'disconnected' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState('+51');
  const [phoneNumber, setPhoneNumber] = useState('');
  const lastQrRef = useRef<string | null>(null);

  // Subscribe to SSE events for real-time status updates
  useEffect(() => {
    if (!open) return;

    const unsub = whatsappWebEventStream.subscribe({
      onStatus: (s) => {
        setStatus(s);
        setError(null);
        // Clear busy when we get a real state
        if (s.state === 'qr' || s.state === 'connected' || s.state === 'pairing_code') {
          setBusy(false);
        }
        if (s.state === 'disconnected' && 'reason' in s && s.reason) {
          setBusy(false);
        }
      },
      onError: (msg) => {
        // SSE stream error - not critical, it auto-reconnects
      },
    });

    // Also fetch status via HTTP as fallback
    void refreshStatus();

    // Polling fallback every 2s in case SSE is delayed
    const t = setInterval(() => {
      void refreshStatus().catch(() => null);
    }, 2000);

    return () => {
      unsub();
      clearInterval(t);
    };
  }, [open]);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api<{ success: true; status: WhatsAppWebStatus }>('/api/integrations/whatsapp/web/status');
      setStatus(res.status);
    } catch {
      // ignore - SSE will provide updates
    }
  }, []);

  // Generate QR data URL when status changes to 'qr'
  useEffect(() => {
    if (status.state !== 'qr') {
      if (status.state !== 'connecting') {
        setQrDataUrl(null);
        lastQrRef.current = null;
      }
      return;
    }

    // Avoid re-rendering same QR
    if (lastQrRef.current === status.qr) return;
    lastQrRef.current = status.qr;

    let cancelled = false;
    void QRCode.toDataURL(status.qr, { margin: 2, width: 280, errorCorrectionLevel: 'M' })
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

  const start = async () => {
    setBusy(true);
    setError(null);
    setQrDataUrl(null);
    lastQrRef.current = null;
    try {
      const res = await api<{ success: true; status: WhatsAppWebStatus }>('/api/integrations/whatsapp/web/connect/start', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setStatus(res.status);
      // If the response already contains QR, busy will be cleared by SSE listener
      if (res.status.state !== 'qr' && res.status.state !== 'connected') {
        // Still waiting — keep busy, SSE will update
      } else {
        setBusy(false);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar la conexión');
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    setError(null);
    setQrDataUrl(null);
    lastQrRef.current = null;
    try {
      const res = await api<{ success: true; status: WhatsAppWebStatus }>('/api/integrations/whatsapp/web/connect/restart', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setStatus(res.status);
      if (res.status.state === 'qr' || res.status.state === 'connected') {
        setBusy(false);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo reiniciar la conexión');
      setBusy(false);
    }
  };

  const generatePairingCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const cc = countryCode.trim().replace(/\s+/g, '');
      const num = phoneNumber.trim().replace(/\s+/g, '');
      if (!num || num.length < 6) {
        throw new Error('Ingrese un número de teléfono válido');
      }
      const phone = `${cc}${num}`;

      const res = await api<{ success: true; status: WhatsAppWebStatus }>('/api/integrations/whatsapp/web/connect/pairing-code', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setStatus(res.status);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el código');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<{ success: true }>('/api/integrations/whatsapp/web/connect/disconnect', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setStatus({ state: 'disconnected' });
      setQrDataUrl(null);
      lastQrRef.current = null;
    } catch (e: any) {
      setError(e?.message || 'No se pudo desconectar');
    } finally {
      setBusy(false);
    }
  };

  const statusColorMap: Record<string, string> = {
    disconnected: 'bg-red-500',
    connecting: 'bg-amber-500 animate-pulse',
    qr: 'bg-amber-500',
    pairing_code: 'bg-amber-500',
    connected: 'bg-green-500',
  };
  const statusColor = statusColorMap[status.state] || 'bg-gray-500';

  const statusLabelMap: Record<string, string> = {
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    qr: 'Esperando escaneo',
    pairing_code: 'Esperando vinculación',
    connected: 'Conectado',
  };
  const statusLabel = statusLabelMap[status.state] || status.state;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp (Web QR)</DialogTitle>
          <DialogDescription>
            Enlace su WhatsApp escaneando un QR desde su teléfono.
            Requiere su aprobación explícita — no es una intrusión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status bar */}
          <div className="rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center gap-2 text-sm">
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', statusColor)} />
              <span className="font-medium">{statusLabel}</span>
              {status.state === 'connected' && status.me?.name && (
                <span className="text-muted-foreground truncate">— {status.me.name}</span>
              )}
              {status.state === 'connected' && !status.me?.name && status.me?.id && (
                <span className="text-muted-foreground truncate">— {status.me.id}</span>
              )}
            </div>
            {status.state === 'disconnected' && 'reason' in status && status.reason && (
              <div className="text-xs text-muted-foreground mt-1">{status.reason}</div>
            )}
          </div>

          {/* Connected success */}
          {status.state === 'connected' && (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 p-4 text-center space-y-2">
              <div className="text-green-700 dark:text-green-400 font-medium">WhatsApp conectado exitosamente</div>
              <div className="text-xs text-muted-foreground">
                Los mensajes entrantes aparecerán en su bandeja automáticamente.
                Las respuestas se envían de forma automática por IA.
              </div>
            </div>
          )}

          {/* QR Code display */}
          {status.state === 'qr' && (
            <div className="flex flex-col items-center gap-3">
              <div className={cn('rounded-xl border-2 border-green-500/30 bg-white p-3', 'w-fit shadow-sm')}>
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="WhatsApp QR"
                    className="h-[280px] w-[280px]"
                  />
                ) : (
                  <div className="h-[280px] w-[280px] flex items-center justify-center">
                    <div className="animate-spin h-8 w-8 border-2 border-green-500 border-t-transparent rounded-full" />
                  </div>
                )}
              </div>
              <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
                <li>Abra <strong>WhatsApp</strong> en su teléfono</li>
                <li>Vaya a <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong></li>
                <li>Apunte la cámara hacia este QR</li>
              </ol>
              <div className="text-xs text-muted-foreground">
                El QR se actualiza automáticamente. Si expira, haga clic en "Nuevo QR".
              </div>
            </div>
          )}

          {/* Connecting spinner */}
          {status.state === 'connecting' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="animate-spin h-10 w-10 border-3 border-green-500 border-t-transparent rounded-full" />
              <div className="text-sm text-muted-foreground">Estableciendo conexión con WhatsApp...</div>
            </div>
          )}

          {/* Pairing code display */}
          {status.state === 'pairing_code' && (
            <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
              <div className="text-sm">
                Número: <span className="font-medium">{status.phone}</span>
              </div>
              <div className="text-center py-2">
                <span className="text-3xl font-mono font-bold tracking-widest text-green-600 dark:text-green-400">
                  {status.code}
                </span>
              </div>
              <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
                <li>Abra <strong>WhatsApp</strong> en su teléfono</li>
                <li>Vaya a <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong></li>
                <li>Elija <strong>"Vincular con número de teléfono"</strong></li>
                <li>Ingrese el código: <strong>{status.code}</strong></li>
              </ol>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Phone number input — only shown when disconnected */}
          {(status.state === 'disconnected') && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground font-medium">
                Vincular por número (alternativa al QR)
              </div>
              <div className="flex gap-2">
                <input
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  placeholder="+51"
                  className="h-9 w-20 rounded-md border bg-background px-2 text-sm"
                  disabled={busy}
                />
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="918714054"
                  className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) {
                      void generatePairingCode();
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {status.state === 'connected' ? (
              <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
                {busy ? 'Desconectando...' : 'Desconectar'}
              </Button>
            ) : status.state === 'qr' ? (
              <>
                <Button variant="outline" size="sm" onClick={restart} disabled={busy}>
                  {busy ? 'Generando...' : 'Nuevo QR'}
                </Button>
                <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
                  Cancelar
                </Button>
              </>
            ) : status.state === 'pairing_code' ? (
              <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
                Cancelar
              </Button>
            ) : status.state === 'connecting' ? (
              <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
                Cancelar
              </Button>
            ) : (
              <>
                <Button
                  onClick={start}
                  disabled={busy}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  size="sm"
                >
                  {busy ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                      Generando QR...
                    </span>
                  ) : (
                    'Generar QR'
                  )}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={generatePairingCode}
                  disabled={busy || !phoneNumber.trim()}
                >
                  {busy ? 'Generando...' : 'Vincular por código'}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>

          <div className="text-xs text-muted-foreground leading-relaxed">
            WhatsApp Web (no oficial) puede ser inestable. Para producción estable,
            use WhatsApp Business Cloud API.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
