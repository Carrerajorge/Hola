/**
 * Channels Hub Dialog
 *
 * Multi-channel messaging management dialog (OpenClaw-style).
 * Allows users to connect and manage messaging channels:
 * WhatsApp, Telegram, Discord, Slack, Signal, Matrix, Google Chat, Webhooks.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";

interface ChannelInfo {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  status: "disconnected" | "connecting" | "connected" | "error";
  lastActivity: number | null;
  messageCount: number;
  error: string | null;
}

interface SupportedType {
  type: string;
  label: string;
  icon: string;
  requiredCredentials: string[];
  description: string;
}

interface ChannelsHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_ICONS: Record<string, JSX.Element> = {
  connected: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  connecting: <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />,
  disconnected: <WifiOff className="h-4 w-4 text-muted-foreground" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
};

const CHANNEL_ICONS: Record<string, string> = {
  telegram: "T",
  discord: "D",
  slack: "S",
  signal: "Si",
  matrix: "M",
  whatsapp: "W",
  google_chat: "G",
  webhook: "H",
};

export function ChannelsHubDialog({ open, onOpenChange }: ChannelsHubDialogProps) {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [supportedTypes, setSupportedTypes] = useState<SupportedType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannelType, setNewChannelType] = useState("");
  const [newChannelLabel, setNewChannelLabel] = useState("");
  const [newChannelCreds, setNewChannelCreds] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const fetchChannels = useCallback(async () => {
    try {
      const res = await apiFetch("/api/messaging-gateway/channels");
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  const fetchSupportedTypes = useCallback(async () => {
    try {
      const res = await apiFetch("/api/messaging-gateway/supported-types");
      if (res.ok) {
        const data = await res.json();
        setSupportedTypes(data.types || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchChannels();
      fetchSupportedTypes();
    }
  }, [open, fetchChannels, fetchSupportedTypes]);

  const handleAddChannel = async () => {
    if (!newChannelType || !newChannelLabel) {
      setError("Tipo y nombre del canal son requeridos.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/messaging-gateway/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newChannelType,
          label: newChannelLabel,
          credentials: newChannelCreds,
          enabled: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowAddForm(false);
        setNewChannelType("");
        setNewChannelLabel("");
        setNewChannelCreds({});
        await fetchChannels();
      } else {
        setError(data.error || "Error al agregar canal.");
      }
    } catch {
      setError("Error de conexion.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async (channelId: string) => {
    try {
      await apiFetch(`/api/messaging-gateway/channels/${channelId}/connect`, { method: "POST" });
      await fetchChannels();
    } catch {
      // Ignore
    }
  };

  const handleDisconnect = async (channelId: string) => {
    try {
      await apiFetch(`/api/messaging-gateway/channels/${channelId}/disconnect`, { method: "POST" });
      await fetchChannels();
    } catch {
      // Ignore
    }
  };

  const handleRemove = async (channelId: string) => {
    try {
      await apiFetch(`/api/messaging-gateway/channels/${channelId}`, { method: "DELETE" });
      await fetchChannels();
    } catch {
      // Ignore
    }
  };

  const selectedType = supportedTypes.find((t) => t.type === newChannelType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Canales de Mensajeria
          </DialogTitle>
          <DialogDescription>
            Conecta canales de mensajeria para interactuar con ILIAGPT desde cualquier plataforma.
          </DialogDescription>
        </DialogHeader>

        {/* Channel List */}
        <div className="space-y-2 mt-4">
          {channels.length === 0 && !showAddForm && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No hay canales configurados. Agrega uno para empezar.
            </div>
          )}

          {channels.map((ch) => (
            <div
              key={ch.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted text-sm font-bold text-foreground">
                {CHANNEL_ICONS[ch.type] || ch.type[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground truncate">{ch.label}</span>
                  {STATUS_ICONS[ch.status]}
                </div>
                <div className="text-xs text-muted-foreground">
                  {ch.type} &middot; {ch.messageCount} mensajes
                  {ch.error && <span className="text-red-500 ml-1">({ch.error})</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {ch.status === "connected" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleDisconnect(ch.id)}
                    title="Desconectar"
                  >
                    <WifiOff className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleConnect(ch.id)}
                    title="Conectar"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-500 hover:text-red-600"
                  onClick={() => handleRemove(ch.id)}
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Channel Form */}
        {showAddForm ? (
          <div className="space-y-3 mt-4 p-4 rounded-xl border border-border bg-muted/20">
            <h4 className="text-sm font-semibold text-foreground">Agregar canal</h4>

            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              {supportedTypes.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  className={`p-2 rounded-lg border text-left text-xs transition-colors ${
                    newChannelType === t.type
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                  }`}
                  onClick={() => {
                    setNewChannelType(t.type);
                    setNewChannelCreds({});
                  }}
                >
                  <span className="font-semibold">{t.label}</span>
                  <p className="text-[10px] mt-0.5 opacity-70 line-clamp-2">{t.description}</p>
                </button>
              ))}
            </div>

            {selectedType && (
              <>
                <Input
                  placeholder="Nombre del canal (ej: Mi Bot Telegram)"
                  value={newChannelLabel}
                  onChange={(e) => setNewChannelLabel(e.target.value)}
                  className="h-10 text-sm rounded-lg"
                />
                {selectedType.requiredCredentials.map((cred) => (
                  <Input
                    key={cred}
                    placeholder={cred.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={newChannelCreds[cred] || ""}
                    onChange={(e) => setNewChannelCreds((prev) => ({ ...prev, [cred]: e.target.value }))}
                    className="h-10 text-sm rounded-lg font-mono"
                    type="password"
                  />
                ))}
              </>
            )}

            {error && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1 h-9 text-sm rounded-lg"
                onClick={handleAddChannel}
                disabled={isLoading || !newChannelType || !newChannelLabel}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Agregar"}
              </Button>
              <Button
                variant="outline"
                className="h-9 text-sm rounded-lg"
                onClick={() => {
                  setShowAddForm(false);
                  setError("");
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full mt-4 h-10 rounded-xl gap-2"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4" />
            Agregar canal
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
