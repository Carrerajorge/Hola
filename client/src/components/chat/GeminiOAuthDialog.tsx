import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogOut,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";

interface GeminiOAuthStatus {
  available: boolean;
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
}

interface GeminiOAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GeminiOAuthDialog({ open, onOpenChange }: GeminiOAuthDialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<GeminiOAuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/gemini-cli-oauth/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error("[GeminiOAuth] Failed to fetch status:", err);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatus();
    }
  }, [open, fetchStatus]);

  // Listen for OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("gemini_oauth_success");
    const error = params.get("gemini_oauth_error");
    const email = params.get("gemini_email");

    if (success === "true") {
      toast({
        title: "Gemini CLI OAuth conectado",
        description: email
          ? `Autenticado como ${email}. Modelo gemini-3.1-pro disponible.`
          : "Autenticación exitosa. Modelo gemini-3.1-pro disponible.",
      });
      // Clean up URL params
      const url = new URL(window.location.href);
      url.searchParams.delete("gemini_oauth_success");
      url.searchParams.delete("gemini_email");
      window.history.replaceState({}, "", url.toString());
      fetchStatus();
    } else if (error) {
      toast({
        title: "Error de autenticación Gemini",
        description: `Error: ${decodeURIComponent(error)}`,
        variant: "destructive",
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("gemini_oauth_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [toast, fetchStatus]);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/gemini-cli-oauth/initiate", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to initiate OAuth");
      }

      const { authUrl } = await res.json();
      // Redirect to Google OAuth
      window.location.href = authUrl;
    } catch (err: any) {
      toast({
        title: "Error al iniciar OAuth",
        description: err.message || "No se pudo iniciar el flujo de autenticación.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const res = await apiFetch("/api/gemini-cli-oauth/disconnect", {
        method: "POST",
      });

      if (res.ok) {
        setStatus((prev) => (prev ? { ...prev, connected: false, email: null, expiresAt: null } : null));
        toast({
          title: "Desconectado",
          description: "Se desconectó la cuenta de Gemini CLI OAuth.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: "No se pudo desconectar.",
        variant: "destructive",
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            Gemini CLI OAuth
          </DialogTitle>
          <DialogDescription>
            Vincula tu cuenta de Google para usar Gemini 3.1 Pro con tus propios
            créditos de Google Cloud.
          </DialogDescription>
        </DialogHeader>

        {/* Warning Banner */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3">
          <div className="flex gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <p className="font-medium mb-1">Flujo no oficial</p>
              <p className="text-xs leading-relaxed">
                Este es un flujo OAuth no oficial que usa las credenciales del Gemini CLI.
                Algunos usuarios han reportado restricciones en sus cuentas. Revisa los
                términos de servicio de Google antes de continuar.
              </p>
            </div>
          </div>
        </div>

        {/* Connection Status */}
        <div className="space-y-3">
          {status?.connected ? (
            <div className="rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-300 text-sm">
                      Conectado
                    </p>
                    {status.email && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        {status.email}
                      </p>
                    )}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="border-green-300 dark:border-green-700 text-green-700 dark:text-green-400"
                >
                  gemini-3.1-pro
                </Badge>
              </div>
              {status.expiresAt && (
                <p className="text-xs text-green-600 dark:text-green-500 mt-2">
                  Token expira:{" "}
                  {new Date(status.expiresAt).toLocaleString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-muted p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">No conectado</p>
                  <p className="text-xs text-muted-foreground">
                    Conecta tu cuenta de Google para acceder a Gemini 3.1 Pro.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Features */}
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Al conectar tu cuenta podrás:</p>
            <ul className="text-xs text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                Usar Gemini 3.1 Pro con tus propios créditos
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                Acceso a modelos avanzados de Google AI
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                Programar directamente desde IliaGPT
              </li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {status?.connected ? (
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              {isDisconnecting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4 mr-2" />
              )}
              Desconectar
            </Button>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={isLoading || !status?.available}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-2" />
              )}
              Conectar con Google
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
