import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, ExternalLink, Link2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ChatGptLogoIcon } from "./OAuthProviderLogos";

type OpenAICodexOAuthButtonProps = {
  onConnected?: (modelId: string) => void | Promise<void>;
  /** When true, auto-start the OAuth flow immediately on open */
  autoStart?: boolean;
  renderTrigger?: (state: {
    isBusy: boolean;
    isConnected: boolean;
    openDialog: () => void;
  }) => React.ReactNode;
};

type OpenAICodexStatusResponse = {
  connected: boolean;
  profileId: string | null;
  accountId: string | null;
  defaultModelId: string;
};

type OpenAICodexAuthMode = "device_code" | "browser";

type OpenAICodexStartResponse = {
  flowId: string;
  authMode: OpenAICodexAuthMode;
  authUrl: string;
  redirectUri: string;
  userCode: string | null;
  expiresAt: string | null;
  instructions: string;
};

type OpenAICodexFlowResponse = {
  flowId: string;
  authMode: OpenAICodexAuthMode;
  status: "pending" | "completed" | "failed";
  authUrl: string;
  redirectUri: string;
  userCode: string | null;
  expiresAt: string | null;
  error: string | null;
  result: OpenAICodexStatusResponse | null;
};

const STATUS_QUERY_KEY = ["/api/oauth/openai/codex/status"];

function normalizeManualInput(input: string): string {
  return input.trim();
}

function isOpenAIAuthorizationUrl(input: string): boolean {
  return /auth\.openai\.com\/oauth\/authorize/i.test(input);
}

export function OpenAICodexOAuthButton({
  onConnected,
  autoStart = false,
  renderTrigger,
}: OpenAICodexOAuthButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [flowId, setFlowId] = React.useState<string | null>(null);
  const [authUrl, setAuthUrl] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [authMode, setAuthMode] =
    React.useState<OpenAICodexAuthMode>("device_code");
  const [userCode, setUserCode] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [manualInput, setManualInput] = React.useState("");
  const [showManualFallback, setShowManualFallback] = React.useState(false);
  const popupRef = React.useRef<Window | null>(null);
  const autoStartTriggeredRef = React.useRef(false);
  const lastHandledFlowStateRef = React.useRef<"completed" | "failed" | null>(
    null,
  );

  const { data: status, isLoading: isStatusLoading } =
    useQuery<OpenAICodexStatusResponse>({
      queryKey: STATUS_QUERY_KEY,
      queryFn: async () => {
        const res = await apiFetch("/api/oauth/openai/codex/status", {
          cache: "no-store",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || "No se pudo consultar ChatGPT OAuth");
        }
        return res.json();
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    });

  const flowQuery = useQuery<OpenAICodexFlowResponse>({
    queryKey: ["/api/oauth/openai/codex/flow", flowId],
    queryFn: async () => {
      const res = await apiFetch(`/api/oauth/openai/codex/flow/${flowId}`, {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error || "No se pudo consultar el flujo ChatGPT OAuth",
        );
      }
      return payload;
    },
    enabled: open && Boolean(flowId),
    refetchInterval: ({ state }) => {
      const payload = state.data as OpenAICodexFlowResponse | undefined;
      return payload?.status === "pending" ? 1500 : false;
    },
    staleTime: 0,
  });

  const startMutation = useMutation<OpenAICodexStartResponse, Error>({
    mutationFn: async () => {
      const res = await apiFetch("/api/oauth/openai/codex/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "No se pudo iniciar ChatGPT OAuth");
      }
      return payload;
    },
    onSuccess: (payload) => {
      setFlowId(payload.flowId);
      setAuthUrl(payload.authUrl);
      setRedirectUri(payload.redirectUri);
      setAuthMode(payload.authMode);
      setUserCode(payload.userCode || "");
      setExpiresAt(payload.expiresAt);
      setManualInput("");
      setShowManualFallback(false);
      lastHandledFlowStateRef.current = null;

      const popup = window.open(
        payload.authUrl,
        `openai-codex-oauth-${payload.flowId}`,
        "popup=yes,width=720,height=860,resizable=yes,scrollbars=yes",
      );
      popupRef.current = popup;
      if (!popup) {
        setShowManualFallback(true);
        toast({
          title: "Ventana bloqueada",
          description:
            "Abre manualmente la URL de ChatGPT o habilita popups para continuar.",
        });
        return;
      }
      popup.focus();
    },
    onError: (error) => {
      toast({
        title: "No se pudo iniciar ChatGPT OAuth",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const completeMutation = useMutation<
    void,
    Error,
    { flowId: string; input: string }
  >({
    mutationFn: async ({ flowId, input }) => {
      const res = await apiFetch("/api/oauth/openai/codex/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowId, input }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "No se pudo completar ChatGPT OAuth");
      }
    },
    onSuccess: () => {
      toast({
        description: "Código recibido. Terminando la vinculación...",
      });
    },
    onError: (error) => {
      toast({
        title: "No se pudo completar ChatGPT OAuth",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetLocalState = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        popupRef.current?.close();
        popupRef.current = null;
        setFlowId(null);
        setAuthUrl("");
        setRedirectUri("");
        setAuthMode("device_code");
        setUserCode("");
        setExpiresAt(null);
        setManualInput("");
        setShowManualFallback(false);
        lastHandledFlowStateRef.current = null;
        startMutation.reset();
        completeMutation.reset();
      }
    },
    [completeMutation, startMutation],
  );

  // Auto-start: when triggered from login flow, start immediately
  React.useEffect(() => {
    if (
      !autoStart ||
      autoStartTriggeredRef.current ||
      !open ||
      isStatusLoading ||
      status?.connected ||
      flowId ||
      startMutation.isPending ||
      completeMutation.isPending
    ) {
      return;
    }
    autoStartTriggeredRef.current = true;
    const timer = window.setTimeout(() => {
      startMutation.mutate();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [autoStart, open, isStatusLoading, status?.connected, flowId, startMutation, completeMutation.isPending]);

  React.useEffect(() => {
    if (!flowQuery.data) {
      return;
    }
    setAuthMode(flowQuery.data.authMode);
    setAuthUrl(flowQuery.data.authUrl);
    setRedirectUri(flowQuery.data.redirectUri);
    setUserCode(flowQuery.data.userCode || "");
    setExpiresAt(flowQuery.data.expiresAt);
  }, [flowQuery.data]);

  React.useEffect(() => {
    const flowState = flowQuery.data;
    if (!flowState || !flowId || flowState.flowId !== flowId) {
      return;
    }
    if (flowState.status === "pending") {
      return;
    }
    if (lastHandledFlowStateRef.current === flowState.status) {
      return;
    }

    lastHandledFlowStateRef.current = flowState.status;

    if (flowState.status === "failed") {
      setShowManualFallback(true);
      toast({
        title: "ChatGPT OAuth no se completó",
        description:
          flowState.error || "No se pudo finalizar la autenticación.",
        variant: "destructive",
      });
      return;
    }

    popupRef.current?.close();
    popupRef.current = null;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ["/api/models/available"],
      });
      await Promise.resolve(
        onConnected?.(flowState.result?.defaultModelId || "gpt-5.3-codex"),
      );
      toast({
        title: "ChatGPT conectado",
        description: flowState.result?.accountId
          ? `Cuenta ${flowState.result.accountId} lista para usar OpenClaw.`
          : "Tu cuenta de ChatGPT ya puede usar OpenClaw.",
      });
      resetLocalState(false);
    })();
  }, [flowId, flowQuery.data, onConnected, queryClient, resetLocalState, toast]);

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

  const handleCopyUserCode = React.useCallback(async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      toast({ description: "Codigo copiado al portapapeles." });
    } catch {
      toast({
        title: "No se pudo copiar",
        description: "Copia el codigo manualmente desde el modal.",
        variant: "destructive",
      });
    }
  }, [toast, userCode]);

  const handleOpenAuthUrl = React.useCallback(() => {
    if (!authUrl) return;
    const popup = window.open(
      authUrl,
      flowId ? `openai-codex-oauth-${flowId}` : "_blank",
      "popup=yes,width=720,height=860,resizable=yes,scrollbars=yes",
    );
    if (!popup) {
      setShowManualFallback(true);
      toast({
        title: "Ventana bloqueada",
        description:
          "No se pudo abrir ChatGPT automáticamente. Usa la recuperación manual.",
      });
      return;
    }
    popupRef.current = popup;
    popup.focus();
  }, [authUrl, flowId, toast]);

  const isBusy = startMutation.isPending || completeMutation.isPending;
  const isConnected = Boolean(status?.connected);
  const isDeviceCodeFlow = authMode === "device_code";
  const openDialog = React.useCallback(() => {
    setOpen(true);
  }, []);

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ isBusy, isConnected, openDialog })
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full p-0 hover:bg-muted/60"
          onClick={openDialog}
          title={isConnected ? "ChatGPT conectado" : "Conectar ChatGPT"}
          aria-label={isConnected ? "ChatGPT conectado" : "Conectar ChatGPT"}
          data-testid="button-openai-codex-oauth"
        >
          <ChatGptLogoIcon
            className={isConnected ? "text-emerald-600" : "text-foreground"}
          />
        </Button>
      )}

      <Dialog open={open} onOpenChange={resetLocalState}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Conectar ChatGPT</DialogTitle>
            <DialogDescription>
              Usa tu cuenta de <strong>ChatGPT Plus/Pro</strong> para habilitar
              OpenClaw en ILIAGPT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
              {isStatusLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando estado de ChatGPT OAuth...
                </div>
              ) : isConnected ? (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                  <div className="space-y-1">
                    <p className="font-medium">Cuenta ya conectada</p>
                    <p className="text-muted-foreground">
                      {status?.accountId
                        ? `Cuenta activa: ${status.accountId}`
                        : "ChatGPT OAuth ya está configurado para este gateway."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium">Sin conexión activa</p>
                  <p className="text-muted-foreground">
                    Al terminar este flujo se habilitará{" "}
                    <code className="rounded bg-background px-1 py-0.5 text-xs">
                      openai-codex/gpt-5.3-codex
                    </code>
                    .
                  </p>
                </div>
              )}
            </div>

            {flowId ? (
              <div className="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Sigue estos pasos</p>
                  {isDeviceCodeFlow ? (
                    <ol className="space-y-1 text-muted-foreground">
                      <li>1. Abre la ventana de ChatGPT.</li>
                      <li>
                        2. Ingresa el codigo de un solo uso{" "}
                        <code>{userCode || "..."}</code>.
                      </li>
                      <li>
                        3. Vuelve a ILIAGPT y espera unos segundos. La
                        vinculacion se completara automaticamente cuando OpenAI
                        confirme el codigo.
                      </li>
                    </ol>
                  ) : (
                    <ol className="space-y-1 text-muted-foreground">
                      <li>1. Abre la ventana de ChatGPT y completa el login.</li>
                      <li>
                        2. Al regresar a ILIAGPT, la vinculacion se completara
                        y la ventana se cerrara sola.
                      </li>
                      <li>
                        3. Si no vuelve automaticamente, pega la URL final que
                        termina en <code>{redirectUri || "localhost"}</code> o
                        solo el <code>code</code>.
                      </li>
                    </ol>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenAuthUrl}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir ChatGPT OAuth
                  </Button>
                  {isDeviceCodeFlow && userCode ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyUserCode}
                    >
                      <Copy className="h-4 w-4" />
                      Copiar codigo
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyUrl}
                  >
                    <Link2 className="h-4 w-4" />
                    Copiar URL
                  </Button>
                  {!isDeviceCodeFlow ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowManualFallback((current) => !current)}
                    >
                      {showManualFallback
                        ? "Ocultar recuperacion manual"
                        : "Mostrar recuperacion manual"}
                    </Button>
                  ) : null}
                </div>

                {isDeviceCodeFlow ? (
                  <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                    <p className="text-sm font-medium">Codigo de un solo uso</p>
                    <p className="mt-2 rounded-lg bg-muted px-3 py-3 text-center font-mono text-xl tracking-[0.2em]">
                      {userCode || "Cargando..."}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Abre <code>{authUrl || "https://auth.openai.com/codex/device"}</code>,
                      inicia sesion y escribe este codigo.
                    </p>
                    {expiresAt ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Expira: {new Date(expiresAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                ) : showManualFallback ? (
                  <div className="space-y-2">
                    <label
                      htmlFor="openai-codex-manual"
                      className="text-sm font-medium"
                    >
                      URL final del callback o código
                    </label>
                    <Textarea
                      id="openai-codex-manual"
                      placeholder="Pega aquí https://iliagpt.com/api/oauth/openai/codex/callback?code=...&state=... o solo el code"
                      value={manualInput}
                      onChange={(event) => setManualInput(event.target.value)}
                      className="min-h-[120px]"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground">
                    Esperando la confirmación de ChatGPT. Si no se completa,
                    abre la recuperación manual.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => resetLocalState(false)}
            >
              Cancelar
            </Button>
            {flowId && isDeviceCodeFlow ? (
              <Button type="button" variant="outline" onClick={handleOpenAuthUrl}>
                Abrir ChatGPT
              </Button>
            ) : flowId ? (
              showManualFallback ? (
                <Button
                  type="button"
                  onClick={() => {
                    if (!flowId) return;
                    const normalizedInput = normalizeManualInput(manualInput);
                    if (isOpenAIAuthorizationUrl(normalizedInput)) {
                      toast({
                        title: "URL incorrecta",
                        description:
                          "Pega la URL final de localhost o solo el code, no la URL inicial de OpenAI.",
                        variant: "destructive",
                      });
                      return;
                    }
                    completeMutation.mutate({
                      flowId,
                      input: normalizedInput,
                    });
                  }}
                  disabled={!manualInput.trim() || isBusy}
                >
                  {completeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Completar manualmente
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowManualFallback(true)}
                >
                  Mostrar recuperación manual
                </Button>
              )
            ) : (
              <Button
                type="button"
                onClick={() => startMutation.mutate()}
                disabled={isBusy}
              >
                {startMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Continuar con ChatGPT
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default OpenAICodexOAuthButton;
