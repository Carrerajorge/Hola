import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageSquare, Phone, Send, Hash, Radio } from "lucide-react";

interface ChannelsHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHANNELS = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Conecta tu cuenta de WhatsApp para enviar y recibir mensajes.",
    icon: Phone,
    color: "text-green-500",
    status: "available" as const,
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Integra un bot de Telegram para mensajeria automatizada.",
    icon: Send,
    color: "text-blue-500",
    status: "available" as const,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Conecta un workspace de Slack para colaboracion en equipo.",
    icon: Hash,
    color: "text-purple-500",
    status: "available" as const,
  },
  {
    id: "discord",
    name: "Discord",
    description: "Integra un bot de Discord para comunidades.",
    icon: MessageSquare,
    color: "text-indigo-500",
    status: "available" as const,
  },
  {
    id: "signal",
    name: "Signal",
    description: "Mensajeria cifrada de extremo a extremo via Signal.",
    icon: Radio,
    color: "text-sky-500",
    status: "coming_soon" as const,
  },
];

export function ChannelsHubDialog({ open, onOpenChange }: ChannelsHubDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Canales de Comunicacion</DialogTitle>
          <DialogDescription>
            Conecta tus plataformas de mensajeria favoritas para una experiencia unificada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-4">
          {CHANNELS.map((channel) => {
            const Icon = channel.icon;
            return (
              <div
                key={channel.id}
                className="flex items-center gap-4 p-3 rounded-xl border border-border hover:bg-muted/40 transition-colors"
              >
                <div className={`p-2 rounded-lg bg-muted ${channel.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{channel.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{channel.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-lg"
                  disabled={channel.status === "coming_soon"}
                >
                  {channel.status === "coming_soon" ? "Pronto" : "Conectar"}
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
