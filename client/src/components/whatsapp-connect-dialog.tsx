import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/apiClient';
import { whatsappWebEventStream, type WhatsAppWebStatus } from '@/lib/whatsapp-web-events';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
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
  const [status, setStatus] = useState<WhatsAppWebStatus>({ state: 'disconnected' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  type SecuritySettings = {
    autoReplyEnabled: boolean;
    controllersOnly: boolean;
    allowAgenticTools: boolean;
    controllers: Array<{ jid: string; masked: string }>;
    pairingActive: boolean;
    pairingExpiresAt: number | null;
    updatedAt: number;
  };

  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: number } | null>(null);

  const refreshStatus = async () => {
    const res = await api<{ success: true; status: WhatsAppWebStatus }>(`/api/integrations/whatsapp/web/status`);
    setStatus(res.status);
  };

  const refreshSecurity = async () => {
    const res = await api<{ success: true; settings: SecuritySettings }>(`/api/integrations/whatsapp/web/security/settings`);
    setSecurity(res.settings);
  };

  const updateSecurity = async (patch: Partial<Pick<SecuritySettings, 'autoReplyEnabled' | 'controllersOnly' | 'allowAgenticTools'>>) => {
    setSecurityBusy(true);
    setError(null);
    try {
      const res = await api<{ success: true; settings: SecuritySettings }>(`/api/integrations/whatsapp/web/security/settings`, {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      setSecurity(res.settings);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron guardar los ajustes');
    } finally {
      setSecurityBusy(false);
    }
  };

  const generatePairingCode = async () => {
    setSecurityBusy(true);
    setError(null);
    try {
      const res = await api<{ success: true; code: string; expiresAt: number }>(`/api/integrations/whatsapp/web/security/pairing-code`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPairingCode({ code: res.code, expiresAt: res.expiresAt });
      // Also refresh settings so UI shows pairingActive/expiresAt.
      void refreshSecurity().catch(() => null);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el código');
    } finally {
      setSecurityBusy(false);
    }
  };

  const revokeController = async (jid: string) => {
    setSecurityBusy(true);
    setError(null);
    try {
      const res = await api<{ success: true; settings: SecuritySettings }>(`/api/integrations/whatsapp/web/security/controllers/remove`, {
        method: 'POST',
        body: JSON.stringify({ jid }),
      });
      setSecurity(res.settings);
    } catch (e: any) {
      setError(e?.message || 'No se pudo revocar el contacto');
    } finally {
      setSecurityBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ success: true; status: WhatsAppWebStatus }>(`/api/integrations/whatsapp/web/connect/start`, {
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
    const unsub = whatsappWebEventStream.subscribe({
      onStatus: (s) => {
        setStatus(s);
        setError(null);
      },
      onError: (msg) => setError(msg),
    });
    void refreshStatus().catch(() => null);
    void refreshSecurity().catch(() => null);
    return unsub;
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

          <div className="rounded-lg border p-3 space-y-3">
            <div>
              <div className="text-sm font-medium">Seguridad</div>
              <div className="text-xs text-muted-foreground">
                Por defecto ILIA no responde automáticamente. Para habilitar control desde WhatsApp, empareje un contacto.
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                Auto-reply (solo emparejados)
                <div className="text-xs text-muted-foreground">Recomendado para evitar abuso por terceros.</div>
              </div>
              <Switch
                checked={!!security?.autoReplyEnabled}
                disabled={securityBusy}
                onCheckedChange={(checked) => updateSecurity({ autoReplyEnabled: checked, controllersOnly: true })}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                Herramientas / Agent (`!agent`)
                <div className="text-xs text-muted-foreground">
                  Riesgoso. Solo para su número emparejado. Deje apagado si no lo necesita.
                </div>
              </div>
              <Switch
                checked={!!security?.allowAgenticTools}
                disabled={securityBusy || !security?.autoReplyEnabled}
                onCheckedChange={(checked) => updateSecurity({ allowAgenticTools: checked })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm">
                  Emparejar controlador
                  <div className="text-xs text-muted-foreground">
                    Genere un código y envíe desde WhatsApp: <span className="font-mono">PAIR ABCD1234EF56</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={generatePairingCode} disabled={securityBusy}>
                  Generar código
                </Button>
              </div>

              {(pairingCode || security?.pairingActive) ? (
                <div className="rounded-md bg-muted/30 border px-3 py-2">
                  <div className="text-xs text-muted-foreground">Código</div>
                  <div className="font-mono text-lg tracking-widest">
                    {pairingCode?.code || '******'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Expira: {new Date((pairingCode?.expiresAt || security?.pairingExpiresAt || Date.now())).toLocaleString()}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-sm">Controladores emparejados</div>
              {security?.controllers?.length ? (
                <div className="space-y-1">
                  {security.controllers.map((c) => (
                    <div key={c.jid} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-mono">{c.masked}</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={securityBusy}
                        onClick={() => revokeController(c.jid)}
                      >
                        Revocar
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Ninguno.</div>
              )}
            </div>
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
