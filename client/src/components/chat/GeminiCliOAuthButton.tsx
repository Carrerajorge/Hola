import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GeminiLogoIcon } from "./OAuthProviderLogos";
import {
  clearGeminiCliBridgePayload,
  parseGeminiCliBridgePayload,
  readGeminiCliBridgePayload,
  type GeminiCliBridgePayload,
} from "./geminiCliOAuthBridge";

type GeminiCliOAuthButtonProps = {
  onConnected?: (modelId: string) => void | Promise<void>;
};

type GeminiCliStatusResponse = {
  connected: boolean;
  email: string | null;
  profileId: string | null;
  defaultModelId: string;
};

type GeminiCliStartResponse = {
  flowId: string;
  authUrl: string;
  redirectUri: string;
  warning: string;
};

type GeminiCliCompleteResponse = GeminiCliStatusResponse & {
  selectedModelId: string;
};

const STATUS_QUERY_KEY = ["/api/oauth/google/gemini-cli/status"];
const FLOW_DRAFT_STORAGE_KEY = "iliagpt:gemini-cli-oauth-flow";
const FLOW_DRAFT_TTL_MS = 30 * 60 * 1000;

type StoredFlowDraft = {
  flowId: string;
  authUrl: string;
  redirectUri: string;
  callbackUrl: string;
  updatedAt: number;
};

function readStoredFlowDraft(): StoredFlowDraft | null {
  try {
    const raw = window.sessionStorage.getItem(FLOW_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredFlowDraft>;
    if (
      !parsed ||
      typeof parsed.flowId !== "string" ||
      typeof parsed.authUrl !== "string" ||
      typeof parsed.redirectUri !== "string"
    ) {
      window.sessionStorage.removeItem(FLOW_DRAFT_STORAGE_KEY);
      return null;
    }
    if (Date.now() - Number(parsed.updatedAt || 0) > FLOW_DRAFT_TTL_MS) {
      window.sessionStorage.removeItem(FLOW_DRAFT_STORAGE_KEY);
      return null;
    }
    return {
      flowId: parsed.flowId,
      authUrl: parsed.authUrl,
      redirectUri: parsed.redirectUri,
      callbackUrl: typeof parsed.callbackUrl === "string" ? parsed.callbackUrl : "",
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

function clearStoredFlowDraft(): void {
  try {
    window.sessionStorage.removeItem(FLOW_DRAFT_STORAGE_KEY);
  } catch {
    // ignore sessionStorage failures
  }
}

function persistStoredFlowDraft(draft: StoredFlowDraft): void {
  try {
    window.sessionStorage.setItem(FLOW_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // ignore sessionStorage failures
  }
}

function normalizeCallbackInput(input: string, redirectUri: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("?")) {
    return `${redirectUri}${trimmed}`;
  }
  if (trimmed.includes("=") && !trimmed.includes("://")) {
    return `${redirectUri}?${trimmed.replace(/^\?/, "")}`;
  }
  return trimmed;
}

function isGoogleAuthorizationUrl(input: string): boolean {
  return /accounts\.google\.com\/o\/oauth2/i.test(input);
}

function normalizeLoginHint(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : "";
}

export function GeminiCliOAuthButton({ onConnected }: GeminiCliOAuthButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [acceptedRisk, setAcceptedRisk] = React.useState(false);
  const [flowId, setFlowId] = React.useState<string | null>(null);
  const [authUrl, setAuthUrl] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const [loginHint, setLoginHint] = React.useState("");
  const [showManualFallback, setShowManualFallback] = React.useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const lastAutoCompletedCallbackRef = React.useRef<string | null>(null);

  const { data: status, isLoading: isStatusLoading } = useQuery<GeminiCliStatusResponse>({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/oauth/google/gemini-cli/status", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "No se pudo consultar Gemini CLI OAuth");
      }
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const startMutation = useMutation<GeminiCliStartResponse, Error, { loginHint?: string }>({
    mutationFn: async (variables) => {
      const res = await apiFetch("/api/oauth/google/gemini-cli/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loginHint: variables?.loginHint,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "No se pudo iniciar Gemini CLI OAuth");
      }
      return payload;
    },
    onSuccess: (payload) => {
      clearGeminiCliBridgePayload();
      setFlowId(payload.flowId);
      setAuthUrl(payload.authUrl);
      setRedirectUri(payload.redirectUri);
      setCallbackUrl("");
      setShowManualFallback(false);
      lastAutoCompletedCallbackRef.current = null;

      const popup = window.open(
        payload.authUrl,
        `gemini-cli-oauth-${payload.flowId}`,
        "popup=yes,width=640,height=820,resizable=yes,scrollbars=yes",
      );
      popupRef.current = popup;
      if (!popup) {
        setShowManualFallback(true);
        toast({
          title: "Ventana bloqueada",
          description: "Abre manualmente la URL del flujo o habilita popups para continuar.",
        });
        return;
      }
      popup.focus();
    },
    onError: (error) => {
      toast({
        title: "No se pudo iniciar Gemini CLI OAuth",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const completeMutation = useMutation<
    GeminiCliCompleteResponse,
    Error,
    { flowId: string; callbackUrl: string }
  >({
    mutationFn: async ({ flowId, callbackUrl }) => {
      const res = await apiFetch("/api/oauth/google/gemini-cli/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId,
          callbackUrl,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "No se pudo completar Gemini CLI OAuth");
      }
      return payload;
    },
    onSuccess: async (payload) => {
      popupRef.current?.close();
      popupRef.current = null;
      clearStoredFlowDraft();
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      await Promise.resolve(onConnected?.(payload.selectedModelId));
      setOpen(false);
      setAcceptedRisk(false);
      setFlowId(null);
      setAuthUrl("");
      setRedirectUri("");
      setCallbackUrl("");
      lastAutoCompletedCallbackRef.current = null;
      toast({
        title: "Gemini CLI vinculado",
        description: payload.email
          ? `La cuenta ${payload.email} ya puede usar Gemini 3.1 Pro desde ILIAGPT.`
          : "Gemini 3.1 Pro ya puede usarse desde ILIAGPT.",
      });
    },
    onError: (error) => {
      lastAutoCompletedCallbackRef.current = null;
      toast({
        title: "No se pudo completar la vinculacion",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCopyUrl = React.useCallback(async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      toast({ description: "URL copiada al portapapeles." });
    } catch {
      toast({
        title: "No se pudo copiar",
        description: "Copia la URL manualmente desde el cuadro de texto.",
        variant: "destructive",
      });
    }
  }, [authUrl, toast]);

  const handleOpenAuthUrl = React.useCallback(() => {
    if (!authUrl) return;
    const popup = window.open(
      authUrl,
      flowId ? `gemini-cli-oauth-${flowId}` : "_blank",
      "popup=yes,width=640,height=820,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      setShowManualFallback(true);
      toast({
        title: "Ventana bloqueada",
        description: "No se pudo abrir la URL automaticamente. Copiala manualmente.",
      });
      return;
    }
    popupRef.current = popup;
    popup.focus();
  }, [authUrl, flowId, toast]);

  const resetLocalState = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      popupRef.current?.close();
      popupRef.current = null;
      setAcceptedRisk(false);
      setFlowId(null);
      setAuthUrl("");
      setRedirectUri("");
      setCallbackUrl("");
      setLoginHint("");
      setShowManualFallback(false);
      lastAutoCompletedCallbackRef.current = null;
      startMutation.reset();
      completeMutation.reset();
    }
  }, [completeMutation, startMutation]);

  React.useEffect(() => {
    if (!open || flowId) return;
    const draft = readStoredFlowDraft();
    if (!draft) return;
    setFlowId(draft.flowId);
    setAuthUrl(draft.authUrl);
    setRedirectUri(draft.redirectUri);
    setCallbackUrl(draft.callbackUrl);
    setShowManualFallback(Boolean(draft.callbackUrl));
  }, [flowId, open]);

  React.useEffect(() => {
    if (!open || loginHint || !status?.email) return;
    setLoginHint(status.email);
  }, [loginHint, open, status?.email]);

  React.useEffect(() => {
    if (!flowId || !open) return;
    persistStoredFlowDraft({
      flowId,
      authUrl,
      redirectUri,
      callbackUrl,
      updatedAt: Date.now(),
    });
  }, [authUrl, callbackUrl, flowId, open, redirectUri]);

  const handleBridgePayload = React.useCallback((payload: GeminiCliBridgePayload | null): boolean => {
    if (!payload || !payload.flowId || !flowId || payload.flowId !== flowId) {
      return false;
    }

    clearGeminiCliBridgePayload();

    if (payload.error || payload.status === "error") {
      setShowManualFallback(true);
      toast({
        title: "Google devolvió un error",
        description: payload.errorDescription || payload.error || "No se pudo finalizar la autenticación.",
        variant: "destructive",
      });
      return true;
    }

    const nextCallbackUrl = typeof payload.callbackUrl === "string" ? payload.callbackUrl.trim() : "";
    if (!nextCallbackUrl || completeMutation.isPending) {
      return false;
    }
    if (lastAutoCompletedCallbackRef.current === nextCallbackUrl) {
      return true;
    }

    lastAutoCompletedCallbackRef.current = nextCallbackUrl;
    setCallbackUrl(nextCallbackUrl);
    setShowManualFallback(false);
    completeMutation.mutate({
      flowId: payload.flowId,
      callbackUrl: nextCallbackUrl,
    });
    return true;
  }, [completeMutation, flowId, toast]);

  React.useEffect(() => {
    if (!flowId || !open) return;
    handleBridgePayload(readGeminiCliBridgePayload());
  }, [flowId, handleBridgePayload, open]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const payload = event.data as
        | {
            type?: string;
            flowId?: string;
            callbackUrl?: string;
            status?: string;
            error?: string;
            errorDescription?: string;
          }
        | undefined;

      if (
        payload?.type !== "gemini-cli-oauth-callback" &&
        payload?.type !== "gemini-cli-oauth-result"
      ) {
        return;
      }

      handleBridgePayload({
        type: payload.type,
        flowId: payload.flowId || "",
        callbackUrl: payload.callbackUrl,
        status: payload.status,
        error: payload.error,
        errorDescription: payload.errorDescription,
        createdAt: Date.now(),
      });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleBridgePayload]);

  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== "iliagpt:gemini-cli-oauth-bridge-result") {
        return;
      }
      handleBridgePayload(parseGeminiCliBridgePayload(event.newValue));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [handleBridgePayload]);

  const handleStartFlow = React.useCallback(() => {
    const normalizedLoginHint = normalizeLoginHint(loginHint);
    if (loginHint.trim() && !normalizedLoginHint) {
      toast({
        title: "Correo inválido",
        description: "Ingresa un correo Gmail válido para sugerir la cuenta en Google.",
        variant: "destructive",
      });
      return;
    }

    startMutation.mutate({
      loginHint: normalizedLoginHint || undefined,
    });
  }, [loginHint, startMutation, toast]);

  const isBusy = startMutation.isPending || completeMutation.isPending;
  const isConnected = Boolean(status?.connected);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full p-0 hover:bg-muted/60"
        onClick={() => setOpen(true)}
        title={isConnected ? "Gemini conectado" : "Conectar Gemini"}
        aria-label={isConnected ? "Gemini conectado" : "Conectar Gemini"}
        data-testid="button-gemini-cli-oauth"
      >
        <GeminiLogoIcon className={isConnected ? "text-violet-600" : "text-foreground"} />
      </Button>

      <Dialog open={open} onOpenChange={resetLocalState}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Conectar Gemini</DialogTitle>
            <DialogDescription>
              Vincula tu cuenta de Google de pago para usar <strong>Gemini 3.1 Pro</strong> desde ILIAGPT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Advertencia de riesgo</p>
                  <p className="text-muted-foreground">
                    Este es un flujo <strong>no oficial</strong>. Google puede limitar o restringir cuentas usadas
                    con clientes Gemini CLI de terceros. Usa una cuenta que controles y asume ese riesgo antes de continuar.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
              {isStatusLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando estado de la vinculacion...
                </div>
              ) : isConnected ? (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                  <div className="space-y-1">
                    <p className="font-medium">Cuenta ya vinculada</p>
                    <p className="text-muted-foreground">
                      {status?.email
                        ? `Perfil activo: ${status.email}`
                        : "Gemini ya está configurado en el gateway."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Puedes volver a vincular si deseas cambiar la cuenta conectada.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Link2 className="mt-0.5 h-5 w-5 text-primary" />
                  <div className="space-y-1">
                    <p className="font-medium">Sin vinculacion activa</p>
                    <p className="text-muted-foreground">
                      Al completar este flujo se guardara un auth profile oficial de OpenClaw y se expondra
                      <code className="ml-1 rounded bg-background px-1 py-0.5 text-xs">google-gemini-cli/gemini-3.1-pro-preview</code>.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-border/70 p-4 text-sm">
              <Checkbox
                checked={acceptedRisk}
                onCheckedChange={(checked) => setAcceptedRisk(Boolean(checked))}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                Entiendo que este flujo es no oficial, que puede implicar riesgo para la cuenta y que el gateway
                guardara tokens OAuth para habilitar Gemini 3.1 Pro.
              </span>
            </label>

            {!flowId ? (
              <div className="space-y-2">
                <label htmlFor="gemini-cli-login-hint" className="text-sm font-medium">
                  Correo Gmail a vincular (opcional)
                </label>
                <Input
                  id="gemini-cli-login-hint"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="tu-cuenta@gmail.com"
                  value={loginHint}
                  onChange={(event) => setLoginHint(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Si lo indicas, Google intentará abrir directamente con esa cuenta.
                </p>
              </div>
            ) : null}

            {flowId ? (
              <div className="space-y-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Sigue estos pasos</p>
                  <ol className="space-y-1 text-muted-foreground">
                    <li>1. Abre la URL de autorizacion en una pestaña nueva.</li>
                    <li>
                      2. Inicia sesion con tu cuenta de Google de pago
                      {normalizeLoginHint(loginHint) ? ` (${normalizeLoginHint(loginHint)})` : ""}.
                    </li>
                    <li>3. Google volvera a <code>{redirectUri || "https://iliagpt.com/api/auth/google/callback"}</code> y la app intentara cerrar el popup automaticamente.</li>
                    <li>4. Solo si falla el autocierre, abre la recuperacion manual y pega la URL final.</li>
                  </ol>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleOpenAuthUrl}>
                    <ExternalLink className="h-4 w-4" />
                    Abrir Google OAuth
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopyUrl}>
                    <Link2 className="h-4 w-4" />
                    Copiar URL
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManualFallback((current) => !current)}
                  >
                    {showManualFallback ? "Ocultar recuperacion manual" : "Mostrar recuperacion manual"}
                  </Button>
                </div>

                {showManualFallback ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">URL de autorizacion</label>
                      <Textarea readOnly value={authUrl} className="min-h-[88px] text-xs" />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="gemini-cli-callback" className="text-sm font-medium">
                        Callback pegado desde el navegador
                      </label>
                      <Textarea
                        id="gemini-cli-callback"
                        placeholder="Pega aqui la URL final que vuelve a ILIAGPT con code=...&state=..."
                        value={callbackUrl}
                        onChange={(event) => setCallbackUrl(event.target.value)}
                        className="min-h-[120px]"
                      />
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground">
                    Esperando el regreso automático desde Google. Si no se completa, usa la recuperacion manual.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => resetLocalState(false)}>
              Cancelar
            </Button>
            {flowId ? (
              showManualFallback ? (
                <Button
                  type="button"
                  onClick={() => {
                    if (!flowId) return;
                    const normalizedCallbackUrl = normalizeCallbackInput(callbackUrl, redirectUri);
                    if (isGoogleAuthorizationUrl(normalizedCallbackUrl)) {
                      toast({
                        title: "URL incorrecta",
                        description: "Pega la URL final que vuelve a ILIAGPT, no la URL inicial de Google.",
                        variant: "destructive",
                      });
                      return;
                    }
                    completeMutation.mutate({
                      flowId,
                      callbackUrl: normalizedCallbackUrl,
                    });
                  }}
                  disabled={!callbackUrl.trim() || isBusy}
                >
                  {completeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Completar vinculacion
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => setShowManualFallback(true)}>
                  Mostrar recuperacion manual
                </Button>
              )
            ) : (
              <Button
                type="button"
                onClick={handleStartFlow}
                disabled={!acceptedRisk || isBusy}
              >
                {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continuar con Google
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default GeminiCliOAuthButton;
