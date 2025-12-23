import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader,
  DialogTitle 
} from "@/components/ui/dialog";
import { ExternalLink, Loader2, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AppMetadata {
  id: string;
  name: string;
  shortDescription: string;
  longDescription?: string;
  icon: React.ReactNode;
  category: string;
  developer?: string;
  websiteUrl?: string;
  privacyUrl?: string;
  connectionEndpoint?: string;
  statusEndpoint?: string;
  disconnectEndpoint?: string;
}

interface AppDetailDialogProps {
  app: AppMetadata | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectionChange?: (appId: string, connected: boolean) => void;
}

export function AppDetailDialog({ 
  app, 
  open, 
  onOpenChange,
  onConnectionChange 
}: AppDetailDialogProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionEmail, setConnectionEmail] = useState<string>("");

  useEffect(() => {
    if (open && app?.statusEndpoint) {
      checkConnectionStatus();
    } else if (open && !app?.statusEndpoint) {
      setIsLoading(false);
      setIsConnected(false);
    }
  }, [open, app?.id]);

  const checkConnectionStatus = async () => {
    if (!app?.statusEndpoint) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(app.statusEndpoint, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setIsConnected(data.connected === true);
        setConnectionEmail(data.email || "");
      } else {
        setIsConnected(false);
      }
    } catch (error) {
      console.error("Error checking connection:", error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!app?.connectionEndpoint) return;
    
    setIsConnecting(true);
    window.location.href = app.connectionEndpoint;
  };

  const handleDisconnect = async () => {
    if (!app?.disconnectEndpoint) return;
    
    setIsConnecting(true);
    try {
      const res = await fetch(app.disconnectEndpoint, {
        method: "POST",
        credentials: "include"
      });
      
      if (res.ok) {
        setIsConnected(false);
        setConnectionEmail("");
        onConnectionChange?.(app.id, false);
      }
    } catch (error) {
      console.error("Error disconnecting:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  if (!app) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <button 
              onClick={() => onOpenChange(false)}
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Aplicaciones
            </button>
            <span>/</span>
            <span>{app.name}</span>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center bg-muted">
              {app.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogTitle className="text-xl font-semibold">{app.name}</DialogTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {app.shortDescription}
                  </p>
                </div>
                <Button
                  onClick={isConnected ? handleDisconnect : handleConnect}
                  disabled={isLoading || isConnecting || !app.connectionEndpoint}
                  variant={isConnected ? "outline" : "default"}
                  className={cn(
                    "min-w-[100px]",
                    isConnected && "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  )}
                  data-testid={`button-${isConnected ? 'disconnect' : 'connect'}-${app.id}`}
                >
                  {isLoading || isConnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isConnected ? (
                    "Desconectar"
                  ) : (
                    "Conectar"
                  )}
                </Button>
              </div>
            </div>
          </div>

          {isConnected && connectionEmail && (
            <div className="mb-6 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-sm text-green-700 dark:text-green-400">
                  Conectado como <strong>{connectionEmail}</strong>
                </span>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground mb-6">
            {app.longDescription || app.shortDescription}
          </p>

          <div className="border-t pt-4">
            <h3 className="font-medium mb-4">Información</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Categoría</span>
                <span className="font-medium capitalize">{app.category}</span>
              </div>
              
              {app.developer && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Desarrollador</span>
                  <span className="font-medium">{app.developer}</span>
                </div>
              )}
              
              {app.websiteUrl && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sitio web</span>
                  <a 
                    href={app.websiteUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              
              {app.privacyUrl && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Política de privacidad</span>
                  <a 
                    href={app.privacyUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
