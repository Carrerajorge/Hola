import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface FigmaConnectorProps {
  onConnectionChange?: (connected: boolean) => void;
}

export function FigmaConnector({ onConnectionChange }: FigmaConnectorProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    checkConnectionStatus();
  }, []);

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch("/api/figma/status");
      const data = await response.json();
      setIsConnected(data.connected);
      onConnectionChange?.(data.connected);
    } catch (error) {
      console.error("Error checking Figma status:", error);
    }
  };

  const handleConnect = async () => {
    if (!showTokenInput) {
      setShowTokenInput(true);
      return;
    }

    if (!accessToken.trim()) {
      toast({
        title: "Error",
        description: "Por favor ingresa tu token de acceso de Figma",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/figma/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: accessToken.trim() }),
      });

      if (!response.ok) {
        throw new Error("No se pudo conectar a Figma");
      }

      setIsConnected(true);
      setShowTokenInput(false);
      setAccessToken("");
      onConnectionChange?.(true);
      toast({
        title: "Conectado",
        description: "Conexión con Figma establecida",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo conectar",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      await fetch("/api/figma/disconnect", { method: "POST" });
      setIsConnected(false);
      onConnectionChange?.(false);
      toast({
        title: "Desconectado",
        description: "Sesión de Figma cerrada",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo desconectar",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-4 bg-card border rounded-xl" data-testid="figma-connector">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-gray-100 rounded-xl flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
          </svg>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Figma</h3>
          <p className="text-sm text-muted-foreground">
            {isConnected ? "Conectado" : "Crea diagramas, slides y assets"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {showTokenInput && !isConnected && (
          <Input
            type="password"
            placeholder="Token de acceso..."
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="w-48"
            data-testid="input-figma-token"
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
        )}
        
        <Button
          variant={isConnected ? "outline" : "default"}
          onClick={isConnected ? handleDisconnect : handleConnect}
          disabled={isLoading}
          className={isConnected ? "" : "bg-black text-white hover:bg-gray-800 rounded-full px-6"}
          data-testid={isConnected ? "button-disconnect-figma" : "button-connect-figma"}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isConnected ? (
            "Desconectar"
          ) : (
            "Conectar"
          )}
        </Button>
      </div>
    </div>
  );
}
