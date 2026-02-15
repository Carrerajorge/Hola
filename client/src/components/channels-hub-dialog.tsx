import { useState, lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWhatsAppWebStatus } from "@/hooks/use-whatsapp-web";
import { ArrowLeft, ExternalLink } from "lucide-react";

const WhatsAppConnectDialogInner = lazy(() =>
  import("@/components/whatsapp-connect-dialog").then((m) => ({
    default: m.WhatsAppConnectDialog,
  }))
);

/* ─── Channel definitions ─────────────────────────── */

type ChannelId = "whatsapp" | "telegram" | "messenger" | "wechat";

interface ChannelDef {
  id: ChannelId;
  name: string;
  description: string;
  color: string;         // tailwind accent
  bgHover: string;
  borderColor: string;
  logo: string;          // svg component rendered inline
  available: boolean;    // false = "Próximamente"
}

const CHANNELS: ChannelDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Conecta tu WhatsApp personal o Business escaneando un QR",
    color: "text-green-600",
    bgHover: "hover:bg-green-50 dark:hover:bg-green-950/20",
    borderColor: "border-green-200 dark:border-green-800",
    logo: "whatsapp",
    available: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Vincula un bot de Telegram con tu token de BotFather",
    color: "text-blue-500",
    bgHover: "hover:bg-blue-50 dark:hover:bg-blue-950/20",
    borderColor: "border-blue-200 dark:border-blue-800",
    logo: "telegram",
    available: true,
  },
  {
    id: "messenger",
    name: "Messenger",
    description: "Conecta tu página de Facebook para recibir mensajes",
    color: "text-purple-600",
    bgHover: "hover:bg-purple-50 dark:hover:bg-purple-950/20",
    borderColor: "border-purple-200 dark:border-purple-800",
    logo: "messenger",
    available: true,
  },
  {
    id: "wechat",
    name: "WeChat",
    description: "Integra tu cuenta oficial de WeChat para el mercado chino",
    color: "text-emerald-600",
    bgHover: "hover:bg-emerald-50 dark:hover:bg-emerald-950/20",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    logo: "wechat",
    available: true,
  },
];

/* ─── SVG Logos ───────────────────────────────────── */

function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <path
        d="M24 4C12.954 4 4 12.954 4 24c0 3.53.922 6.84 2.533 9.71L4 44l10.59-2.47A19.9 19.9 0 0 0 24 44c11.046 0 20-8.954 20-20S35.046 4 24 4Z"
        fill="#25D366"
      />
      <path
        d="M34.6 28.4c-.6-.3-3.5-1.7-4-1.9-.6-.2-.9-.3-1.3.3-.4.6-1.5 1.9-1.8 2.3-.3.4-.7.4-1.3.1-.6-.3-2.5-.9-4.7-2.9-1.7-1.6-2.9-3.5-3.2-4.1-.3-.6 0-.9.3-1.2.2-.3.6-.7.8-1 .3-.3.3-.6.5-1 .2-.4.1-.7 0-1-.2-.3-1.3-3.1-1.8-4.3-.5-1.1-.9-1-1.3-1h-1.1c-.4 0-1 .1-1.5.7-.6.6-2 2-2 4.8s2.1 5.6 2.4 6c.3.4 4.1 6.3 10 8.8 1.4.6 2.5 1 3.3 1.2 1.4.4 2.7.4 3.7.2 1.1-.2 3.5-1.4 4-2.8.5-1.4.5-2.5.3-2.8-.1-.3-.5-.4-1.1-.7Z"
        fill="#fff"
      />
    </svg>
  );
}

function TelegramLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <circle cx="24" cy="24" r="20" fill="#2AABEE" />
      <path
        d="M10.9 23.3c6.4-2.8 10.7-4.6 12.8-5.5 6.1-2.5 7.4-3 8.2-3 .2 0 .6 0 .9.3.2.2.3.5.3.7 0 .2 0 .5-.1.7-.5 5.4-2.7 18.4-3.8 24.4-.5 2.5-1.4 3.4-2.3 3.5-2 .2-3.5-1.3-5.4-2.6-3-2-4.7-3.3-7.6-5.2-3.4-2.3-.1-3.5 2.3-5.6.4-.4 7.5-6.9 7.6-7.5 0-.1 0-.3-.1-.4-.1-.1-.3-.1-.5 0-.2.1-4.1 2.6-11.5 7.6-1.1.7-2.1 1.1-3 1.1-1 0-2.9-.6-4.3-1-1.7-.6-3.1-.9-3-1.9.1-.5.8-1.1 2.2-1.6Z"
        fill="#fff"
      />
    </svg>
  );
}

function MessengerLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <defs>
        <linearGradient id="msg-grad" x1="24" y1="2" x2="24" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00B2FF" />
          <stop offset="1" stopColor="#006AFF" />
        </linearGradient>
      </defs>
      <path
        d="M24 2C11.85 2 2 11.32 2 23.16c0 6.35 2.6 11.76 6.83 15.56V46l7.19-3.95c2.49.69 5.15 1.07 7.98 1.07 12.15 0 22-9.32 22-21.16S36.15 2 24 2Z"
        fill="url(#msg-grad)"
      />
      <path
        d="m10.5 28.8 6.63-10.53a3.3 3.3 0 0 1 4.77-.88l5.27 3.95a1.32 1.32 0 0 0 1.59 0l7.12-5.4c.95-.72 2.19.44 1.37 1.29l-6.63 10.53a3.3 3.3 0 0 1-4.77.88l-5.27-3.95a1.32 1.32 0 0 0-1.59 0l-7.12 5.4c-.95.72-2.19-.44-1.37-1.29Z"
        fill="#fff"
      />
    </svg>
  );
}

function WeChatLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none">
      <ellipse cx="19" cy="21" rx="14" ry="12" fill="#7BB32E" />
      <circle cx="14" cy="19" r="1.5" fill="#fff" />
      <circle cx="23" cy="19" r="1.5" fill="#fff" />
      <ellipse cx="29" cy="28" rx="12" ry="10" fill="#25D366" />
      <circle cx="25" cy="27" r="1.2" fill="#fff" />
      <circle cx="33" cy="27" r="1.2" fill="#fff" />
    </svg>
  );
}

function ChannelLogo({ id, className }: { id: ChannelId; className?: string }) {
  switch (id) {
    case "whatsapp":
      return <WhatsAppLogo className={className} />;
    case "telegram":
      return <TelegramLogo className={className} />;
    case "messenger":
      return <MessengerLogo className={className} />;
    case "wechat":
      return <WeChatLogo className={className} />;
  }
}

/* ─── Telegram Config Panel ───────────────────────── */

function TelegramConfigPanel({ onBack }: { onBack: () => void }) {
  const [botToken, setBotToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const save = async () => {
    if (!botToken.trim()) {
      setError("Ingresa el token del bot");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/integrations/telegram/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: botToken.trim(), webhookUrl: webhookUrl.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a canales
      </button>

      <div className="flex items-center gap-3">
        <TelegramLogo className="h-10 w-10" />
        <div>
          <h3 className="font-semibold text-lg">Telegram</h3>
          <p className="text-xs text-muted-foreground">Configura tu bot de Telegram</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">Bot Token</label>
          <input
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456789:ABCdefGHIjklMNOpqrSTUVwxyz"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            type="password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Obtén tu token en{" "}
            <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-blue-500 hover:underline">
              @BotFather
            </a>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Webhook URL (opcional)</label>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://tudominio.com/webhooks/telegram"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Si no lo configuras, se usará la URL del servidor automáticamente
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
            {error}
          </div>
        )}

        {status === "saved" && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
            ✓ Configuración guardada. Tu bot está activo.
          </div>
        )}

        <Button onClick={save} disabled={status === "saving"} className="w-full bg-blue-500 hover:bg-blue-600 text-white">
          {status === "saving" ? "Guardando..." : "Conectar Bot"}
        </Button>
      </div>
    </div>
  );
}

/* ─── Messenger Config Panel ──────────────────────── */

function MessengerConfigPanel({ onBack }: { onBack: () => void }) {
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const connectFacebook = () => {
    // In production, this would redirect to Facebook OAuth
    window.open(
      "https://developers.facebook.com/apps/",
      "_blank",
      "noopener,noreferrer"
    );
  };

  const save = async () => {
    if (!pageId.trim() || !accessToken.trim()) {
      setError("Completa todos los campos");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/integrations/messenger/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: pageId.trim(), accessToken: accessToken.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a canales
      </button>

      <div className="flex items-center gap-3">
        <MessengerLogo className="h-10 w-10" />
        <div>
          <h3 className="font-semibold text-lg">Messenger</h3>
          <p className="text-xs text-muted-foreground">Conecta tu página de Facebook</p>
        </div>
      </div>

      <div className="space-y-3">
        <Button
          variant="outline"
          onClick={connectFacebook}
          className="w-full gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir Facebook Developers
        </Button>

        <div>
          <label className="text-sm font-medium block mb-1">Page ID</label>
          <input
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="123456789012345"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Page Access Token</label>
          <input
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="EAAx..."
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            type="password"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
            {error}
          </div>
        )}

        {status === "saved" && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
            ✓ Messenger conectado exitosamente.
          </div>
        )}

        <Button onClick={save} disabled={status === "saving"} className="w-full bg-purple-600 hover:bg-purple-700 text-white">
          {status === "saving" ? "Guardando..." : "Conectar Messenger"}
        </Button>
      </div>
    </div>
  );
}

/* ─── WeChat Config Panel ─────────────────────────── */

function WeChatConfigPanel({ onBack }: { onBack: () => void }) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const save = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setError("Completa todos los campos");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/integrations/wechat/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a canales
      </button>

      <div className="flex items-center gap-3">
        <WeChatLogo className="h-10 w-10" />
        <div>
          <h3 className="font-semibold text-lg">WeChat</h3>
          <p className="text-xs text-muted-foreground">Conecta tu cuenta oficial de WeChat</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">App ID</label>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="wx1234567890abcdef"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Desde tu{" "}
            <a href="https://mp.weixin.qq.com/" target="_blank" rel="noopener" className="text-emerald-600 hover:underline">
              WeChat Official Account
            </a>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">App Secret</label>
          <input
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="••••••••••••••••"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm font-mono"
            type="password"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md p-2">
            {error}
          </div>
        )}

        {status === "saved" && (
          <div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md p-2">
            ✓ WeChat conectado exitosamente.
          </div>
        )}

        <Button onClick={save} disabled={status === "saving"} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
          {status === "saving" ? "Guardando..." : "Conectar WeChat"}
        </Button>
      </div>
    </div>
  );
}

/* ─── Main Hub Dialog ─────────────────────────────── */

export function ChannelsHubDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeChannel, setActiveChannel] = useState<ChannelId | null>(null);
  const [showWhatsAppDialog, setShowWhatsAppDialog] = useState(false);
  const { status: waStatus } = useWhatsAppWebStatus(open);

  // Reset when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setActiveChannel(null);
      setShowWhatsAppDialog(false);
    }
    onOpenChange(isOpen);
  };

  const handleChannelClick = (channelId: ChannelId) => {
    if (channelId === "whatsapp") {
      setShowWhatsAppDialog(true);
    } else {
      setActiveChannel(channelId);
    }
  };

  const getStatusDot = (channelId: ChannelId) => {
    if (channelId === "whatsapp") {
      return (
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full shrink-0",
            waStatus.state === "connected" && "bg-green-500",
            (waStatus.state === "connecting" || waStatus.state === "qr" || waStatus.state === "pairing_code") && "bg-amber-500 animate-pulse",
            waStatus.state === "disconnected" && "bg-gray-300 dark:bg-gray-600"
          )}
        />
      );
    }
    // Other channels: gray (not configured)
    return <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-gray-300 dark:bg-gray-600" />;
  };

  // WhatsApp opens its own dialog (reuses existing component)
  if (showWhatsAppDialog) {
    return (
      <Suspense fallback={null}>
        <WhatsAppConnectDialogInner
          open={open}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setShowWhatsAppDialog(false);
              // Keep hub open
            } else {
              onOpenChange(isOpen);
            }
          }}
        />
      </Suspense>
    );
  }

  // Channel detail panels
  if (activeChannel === "telegram") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <TelegramConfigPanel onBack={() => setActiveChannel(null)} />
        </DialogContent>
      </Dialog>
    );
  }

  if (activeChannel === "messenger") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <MessengerConfigPanel onBack={() => setActiveChannel(null)} />
        </DialogContent>
      </Dialog>
    );
  }

  if (activeChannel === "wechat") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <WeChatConfigPanel onBack={() => setActiveChannel(null)} />
        </DialogContent>
      </Dialog>
    );
  }

  // Main hub: channel cards grid
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
            </svg>
            AppsWebChat
          </DialogTitle>
          <DialogDescription>
            Conecta tus canales de mensajería para enviar y recibir mensajes con IA
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 mt-1">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => handleChannelClick(ch.id)}
              className={cn(
                "relative rounded-xl border p-4 text-left transition-all duration-200",
                "hover:shadow-md hover:scale-[1.02] active:scale-[0.98]",
                ch.bgHover,
                ch.borderColor,
                "group cursor-pointer"
              )}
            >
              {/* Status dot */}
              <div className="absolute top-3 right-3">
                {getStatusDot(ch.id)}
              </div>

              {/* Logo */}
              <div className="mb-3">
                <ChannelLogo id={ch.id} className="h-12 w-12" />
              </div>

              {/* Name & description */}
              <div className={cn("font-semibold text-sm", ch.color)}>
                {ch.name}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                {ch.description}
              </p>

              {/* Connect hint */}
              <div className="mt-3 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                {ch.id === "whatsapp" && waStatus.state === "connected"
                  ? "Conectado"
                  : "Configurar →"}
              </div>
            </button>
          ))}
        </div>

        <div className="text-xs text-muted-foreground text-center mt-2">
          Todos los mensajes entrantes se procesan con IA y aparecen en tu bandeja
        </div>
      </DialogContent>
    </Dialog>
  );
}
