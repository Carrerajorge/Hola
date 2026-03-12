import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

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
  flowProof: GeminiCliFlowProof;
  warning: string;
};

type GeminiCliCompleteResponse = GeminiCliStatusResponse & {
  selectedModelId: string;
};

type GeminiCliFlowProof = {
  verifier: string;
  oauthState: string;
  redirectUri: string;
  createdAt: number;
};

type GeminiCliResultMessage =
  | {
      type?: string;
      flowId?: string;
      status?: "success";
      result?: GeminiCliCompleteResponse;
    }
  | {
      type?: string;
      flowId?: string;
      status?: "error";
      error?: string;
      errorDescription?: string;
      callbackUrl?: string;
    };

const STATUS_QUERY_KEY = ["/api/oauth/google/gemini-cli/status"];
const FLOW_STORAGE_KEY = "iliagpt:gemini-cli-oauth-flow";
const FLOW_STORAGE_TTL_MS = 45 * 60 * 1000;

type StoredGeminiCliFlowDraft = {
  flowId: string;
  authUrl: string;
  redirectUri: string;
  callbackUrl: string;
  createdAt: number;
  updatedAt: number;
  flowProof: GeminiCliFlowProof;
};

function extractFlowIdFromCallbackValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const extractFromState = (state: string | null | undefined) => {
    const normalized = typeof state === "string" ? state.trim() : "";
    if (!normalized.startsWith("gemini-cli:")) return null;
    return normalized.slice("gemini-cli:".length).trim() || null;
  };

  try {
    const url = new URL(trimmed);
    return extractFromState(url.searchParams.get("state"));
  } catch {
    const normalized = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    return extractFromState(new URLSearchParams(normalized).get("state"));
  }
}

function readStoredFlowDraft(): StoredGeminiCliFlowDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGeminiCliFlowDraft>;
    if (
      typeof parsed.flowId !== "string" ||
      typeof parsed.authUrl !== "string" ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.flowProof?.verifier !== "string" ||
      typeof parsed.flowProof?.oauthState !== "string" ||
      typeof parsed.flowProof?.redirectUri !== "string" ||
      typeof parsed.flowProof?.createdAt !== "number"
    ) {
      window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
      return null;
    }
    const freshness =
      typeof parsed.updatedAt === "number"
        ? parsed.updatedAt
        : parsed.createdAt;
    if (Date.now() - freshness > FLOW_STORAGE_TTL_MS) {
      window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
      return null;
    }
    return {
      ...(parsed as StoredGeminiCliFlowDraft),
      callbackUrl:
        typeof parsed.callbackUrl === "string" ? parsed.callbackUrl : "",
      updatedAt: freshness,
    };
  } catch {
    return null;
  }
}

function writeStoredFlowDraft(flow: StoredGeminiCliFlowDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow));
  } catch {
    // Ignore storage quota/privacy mode failures.
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

function clearStoredFlowDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function resolveFlowForCallbackInput(params: {
  callbackUrl: string;
  currentFlowId: string | null;
  currentFlowProof: GeminiCliFlowProof | null;
  storedFlow: StoredGeminiCliFlowDraft | null;
}): {
  flowId: string;
  redirectUri: string;
  flowProof?: GeminiCliFlowProof;
} | null {
  const callbackFlowId = extractFlowIdFromCallbackValue(params.callbackUrl);
  const resolvedFlowId =
    callbackFlowId || params.currentFlowId || params.storedFlow?.flowId || "";

  if (!resolvedFlowId) {
    return null;
  }

  return {
    flowId: resolvedFlowId,
    redirectUri: (() => {
      if (params.storedFlow?.flowId === resolvedFlowId) {
        return params.storedFlow.redirectUri;
      }
      if (params.currentFlowId === resolvedFlowId) {
        return params.currentFlowProof?.redirectUri || "";
      }
      return "";
    })(),
    flowProof: (() => {
      if (params.storedFlow?.flowId === resolvedFlowId) {
        return params.storedFlow.flowProof;
      }
      if (params.currentFlowId === resolvedFlowId) {
        return params.currentFlowProof || undefined;
      }
      return undefined;
    })(),
  };
}

export function GeminiCliOAuthButton({
  onConnected,
}: GeminiCliOAuthButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [acceptedRisk, setAcceptedRisk] = React.useState(false);
  const [flowId, setFlowId] = React.useState<string | null>(null);
  const [authUrl, setAuthUrl] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [flowProof, setFlowProof] = React.useState<GeminiCliFlowProof | null>(
    null,
  );
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const popupRef = React.useRef<Window | null>(null);
  const lastAutoCompletedCallbackRef = React.useRef<string | null>(null);

  const { data: status, isLoading: isStatusLoading } =
    useQuery<GeminiCliStatusResponse>({
      queryKey: STATUS_QUERY_KEY,
      queryFn: async () => {
        const res = await apiFetch("/api/oauth/google/gemini-cli/status", {
          cache: "no-store",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(
            payload?.error || "No se pudo consultar Gemini CLI OAuth",
          );
        }
        return res.json();
      },
      enabled: open,
      staleTime: 0,
    });

  const startMutation = useMutation<GeminiCliStartResponse, Error>({
    mutationFn: async () => {
      const res = await apiFetch("/api/oauth/google/gemini-cli/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error || "No se pudo iniciar Gemini CLI OAuth",
        );
      }
      return payload;
    },
    onSuccess: (payload) => {
      setFlowId(payload.flowId);
      setAuthUrl(payload.authUrl);
      setRedirectUri(payload.redirectUri);
      setFlowProof(payload.flowProof);
      setCallbackUrl("");
      lastAutoCompletedCallbackRef.current = null;
      writeStoredFlowDraft({
        flowId: payload.flowId,
        authUrl: payload.authUrl,
        redirectUri: payload.redirectUri,
        callbackUrl: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        flowProof: payload.flowProof,
      });

      const popup = window.open(
        payload.authUrl,
        `gemini-cli-oauth-${payload.flowId}`,
        "popup=yes,width=640,height=820,resizable=yes,scrollbars=yes",
      );
      popupRef.current = popup;
      if (!popup) {
        toast({
          title: "Ventana bloqueada",
          description:
            "Abre manualmente la URL del flujo o habilita popups para continuar.",
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
    { flowId: string; callbackUrl: string; flowProof?: GeminiCliFlowProof }
  >({
    mutationFn: async ({ flowId, callbackUrl, flowProof }) => {
      const res = await apiFetch("/api/oauth/google/gemini-cli/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowId,
          callbackUrl,
          flowProof,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error || "No se pudo completar Gemini CLI OAuth",
        );
      }
      return payload;
    },
    onSuccess: async (payload) => {
      popupRef.current?.close();
      popupRef.current = null;
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ["/api/models/available"],
      });
      await Promise.resolve(onConnected?.(payload.selectedModelId));
      setOpen(false);
      setAcceptedRisk(false);
      setFlowId(null);
      setAuthUrl("");
      setRedirectUri("");
      setFlowProof(null);
      setCallbackUrl("");
      lastAutoCompletedCallbackRef.current = null;
      clearStoredFlowDraft();
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

  const finishConnectedState = React.useCallback(
    async (payload: GeminiCliCompleteResponse) => {
      popupRef.current?.close();
      popupRef.current = null;
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      await queryClient.invalidateQueries({
        queryKey: ["/api/models/available"],
      });
      await Promise.resolve(onConnected?.(payload.selectedModelId));
      setOpen(false);
      setAcceptedRisk(false);
      setFlowId(null);
      setAuthUrl("");
      setRedirectUri("");
      setFlowProof(null);
      setCallbackUrl("");
      lastAutoCompletedCallbackRef.current = null;
      clearStoredFlowDraft();
      toast({
        title: "Gemini CLI vinculado",
        description: payload.email
          ? `La cuenta ${payload.email} ya puede usar Gemini 3.1 Pro desde ILIAGPT.`
          : "Gemini 3.1 Pro ya puede usarse desde ILIAGPT.",
      });
    },
    [onConnected, queryClient, toast],
  );

  const getManualCallbackValidationError = React.useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "Pega la URL final que vuelve a ILIAGPT con ?code=...&state=....";
      }

      try {
        const url = new URL(trimmed);
        const isAuthorizationUrl =
          url.hostname === "accounts.google.com" &&
          (url.pathname === "/o/oauth2/v2/auth" ||
            url.pathname === "/o/oauth2/auth");
        if (isAuthorizationUrl) {
          return "Pegaste la URL de autorización de Google. Debes completar el login y usar la URL final que vuelve a ILIAGPT.";
        }
        if (!url.searchParams.get("code")) {
          return "La URL final debe incluir el parámetro code. Completa el login y copia la URL de regreso a ILIAGPT.";
        }
      } catch {
        const normalized = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
        const params = new URLSearchParams(normalized);
        const looksLikeAuthorizationUrl =
          params.has("response_type") ||
          params.has("code_challenge") ||
          params.has("code_challenge_method");
        if (looksLikeAuthorizationUrl && !params.has("code")) {
          return "Pegaste la URL de autorización de Google. Debes completar el login y usar la URL final que vuelve a ILIAGPT.";
        }
        if (!params.has("code")) {
          return "Pega la URL final que vuelve a ILIAGPT con ?code=...&state=....";
        }
      }

      return null;
    },
    [],
  );

  const handleManualComplete = React.useCallback(() => {
    const validationError = getManualCallbackValidationError(callbackUrl);
    if (validationError) {
      toast({
        title: "Callback inválido",
        description: validationError,
        variant: "destructive",
      });
      return;
    }
    const storedFlow = readStoredFlowDraft();
    const resolvedFlow = resolveFlowForCallbackInput({
      callbackUrl,
      currentFlowId: flowId,
      currentFlowProof: flowProof,
      storedFlow,
    });
    if (!resolvedFlow) {
      toast({
        title: "Sesion OAuth no encontrada",
        description: "Inicia nuevamente la vinculacion para continuar.",
        variant: "destructive",
      });
      return;
    }
    if (!flowId || flowId !== resolvedFlow.flowId) {
      setFlowId(resolvedFlow.flowId);
    }
    const normalizedCallbackUrl = normalizeCallbackInput(
      callbackUrl,
      resolvedFlow.redirectUri || redirectUri,
    );
    completeMutation.mutate({
      flowId: resolvedFlow.flowId,
      callbackUrl: normalizedCallbackUrl,
      flowProof: resolvedFlow.flowProof,
    });
  }, [
    callbackUrl,
    completeMutation,
    flowId,
    flowProof,
    getManualCallbackValidationError,
    redirectUri,
    toast,
  ]);

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
      toast({
        title: "Ventana bloqueada",
        description:
          "No se pudo abrir la URL automaticamente. Copiala manualmente.",
      });
      return;
    }
    popupRef.current = popup;
    popup.focus();
  }, [authUrl, flowId, toast]);

  const resetLocalState = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        popupRef.current?.close();
        popupRef.current = null;
        setAcceptedRisk(false);
        setFlowId(null);
        setAuthUrl("");
        setRedirectUri("");
        setFlowProof(null);
        setCallbackUrl("");
        lastAutoCompletedCallbackRef.current = null;
        startMutation.reset();
        completeMutation.reset();
      }
    },
    [completeMutation, startMutation],
  );

  React.useEffect(() => {
    if (
      !open ||
      flowId ||
      startMutation.isPending ||
      completeMutation.isPending
    ) {
      return;
    }
    const storedFlow = readStoredFlowDraft();
    if (!storedFlow) {
      return;
    }
    setFlowId(storedFlow.flowId);
    setAuthUrl(storedFlow.authUrl);
    setRedirectUri(storedFlow.redirectUri);
    setFlowProof(storedFlow.flowProof);
    setCallbackUrl(storedFlow.callbackUrl);
  }, [completeMutation.isPending, flowId, open, startMutation.isPending]);

  React.useEffect(() => {
    if (status?.connected) {
      clearStoredFlowDraft();
    }
  }, [status?.connected]);

  React.useEffect(() => {
    if (!open || !flowId) {
      return;
    }
    const storedFlow = readStoredFlowDraft();
    if (!storedFlow) {
      return;
    }
    writeStoredFlowDraft({
      ...storedFlow,
      flowId,
      authUrl,
      redirectUri,
      callbackUrl,
      flowProof: flowProof ?? storedFlow.flowProof,
      updatedAt: Date.now(),
    });
  }, [authUrl, callbackUrl, flowId, flowProof, open, redirectUri]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const payload = event.data as GeminiCliResultMessage | undefined;

      if (
        payload?.type !== "gemini-cli-oauth-callback" &&
        payload?.type !== "gemini-cli-oauth-result"
      ) {
        return;
      }
      const storedFlow = readStoredFlowDraft();
      const payloadCallbackUrl =
        "callbackUrl" in payload && typeof payload.callbackUrl === "string"
          ? payload.callbackUrl.trim()
          : "";
      const callbackFlowId = payloadCallbackUrl
        ? extractFlowIdFromCallbackValue(payloadCallbackUrl)
        : null;
      const payloadFlowId =
        (typeof payload.flowId === "string" ? payload.flowId.trim() : "") ||
        callbackFlowId ||
        "";

      if (!payloadFlowId) {
        return;
      }
      if (!flowId || flowId !== payloadFlowId) {
        setFlowId(payloadFlowId);
      }

      if (payload.type === "gemini-cli-oauth-result") {
        if (payload.status === "success" && payload.result) {
          void finishConnectedState(payload.result);
          return;
        }

        if (payload.status === "error") {
          if (payload.callbackUrl) {
            setCallbackUrl(payload.callbackUrl);
          }
          if (payload.error === "gemini_cli_invalid_state") {
            clearStoredFlowDraft();
          }
          lastAutoCompletedCallbackRef.current = null;
          toast({
            title: "No se pudo completar la vinculacion",
            description:
              payload.errorDescription ||
              payload.error ||
              "No se pudo completar Gemini CLI OAuth.",
            variant: "destructive",
          });
          return;
        }
      }

      if ("error" in payload && payload.error) {
        if (
          "callbackUrl" in payload &&
          typeof payload.callbackUrl === "string" &&
          payload.callbackUrl.trim()
        ) {
          setCallbackUrl(payload.callbackUrl.trim());
        }
        if (payload.error === "gemini_cli_invalid_state") {
          clearStoredFlowDraft();
        }
        lastAutoCompletedCallbackRef.current = null;
        toast({
          title: "Google devolvió un error",
          description: payload.errorDescription || payload.error,
          variant: "destructive",
        });
        return;
      }

      const nextCallbackUrl =
        "callbackUrl" in payload && typeof payload.callbackUrl === "string"
          ? payload.callbackUrl.trim()
          : "";
      if (!nextCallbackUrl || completeMutation.isPending) {
        return;
      }
      if (lastAutoCompletedCallbackRef.current === nextCallbackUrl) {
        return;
      }

      lastAutoCompletedCallbackRef.current = nextCallbackUrl;
      setCallbackUrl(nextCallbackUrl);
      const validationError = getManualCallbackValidationError(nextCallbackUrl);
      if (validationError) {
        lastAutoCompletedCallbackRef.current = null;
        toast({
          title: "Callback inválido",
          description: validationError,
          variant: "destructive",
        });
        return;
      }

      const resolvedFlow = resolveFlowForCallbackInput({
        callbackUrl: nextCallbackUrl,
        currentFlowId: payloadFlowId,
        currentFlowProof: flowProof,
        storedFlow,
      });
      if (!resolvedFlow) {
        lastAutoCompletedCallbackRef.current = null;
        toast({
          title: "Sesion OAuth no encontrada",
          description: "Inicia nuevamente la vinculacion para continuar.",
          variant: "destructive",
        });
        return;
      }

      const normalizedCallbackUrl = normalizeCallbackInput(
        nextCallbackUrl,
        resolvedFlow.redirectUri || redirectUri,
      );
      if (!normalizedCallbackUrl) {
        lastAutoCompletedCallbackRef.current = null;
        return;
      }

      completeMutation.mutate({
        flowId: resolvedFlow.flowId,
        callbackUrl: normalizedCallbackUrl,
        flowProof: resolvedFlow.flowProof,
      });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    completeMutation,
    finishConnectedState,
    flowId,
    flowProof,
    getManualCallbackValidationError,
    redirectUri,
    toast,
  ]);

  const isBusy = startMutation.isPending || completeMutation.isPending;
  const isConnected = Boolean(status?.connected);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full border-primary/25 bg-background/80"
        onClick={() => setOpen(true)}
        title={
          isConnected
            ? "Gemini CLI OAuth vinculado"
            : "Vincular Gemini CLI OAuth"
        }
        data-testid="button-gemini-cli-oauth"
      >
        {isConnected ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </Button>

      <Dialog open={open} onOpenChange={resetLocalState}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Google Gemini CLI OAuth</DialogTitle>
            <DialogDescription>
              Vincula tu cuenta de Google de pago para usar{" "}
              <strong>Gemini 3.1 Pro</strong> desde ILIAGPT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Advertencia de riesgo</p>
                  <p className="text-muted-foreground">
                    Este es un flujo <strong>no oficial</strong>. Google puede
                    limitar o restringir cuentas usadas con clientes Gemini CLI
                    de terceros. Usa una cuenta que controles y asume ese riesgo
                    antes de continuar.
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
                        : "Gemini CLI OAuth ya esta configurado en el gateway."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Puedes volver a vincular si deseas cambiar la cuenta
                      conectada.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Link2 className="mt-0.5 h-5 w-5 text-primary" />
                  <div className="space-y-1">
                    <p className="font-medium">Sin vinculacion activa</p>
                    <p className="text-muted-foreground">
                      Al completar este flujo se guardara un auth profile
                      oficial de OpenClaw y se expondra
                      <code className="ml-1 rounded bg-background px-1 py-0.5 text-xs">
                        google-gemini-cli/gemini-3.1-pro-preview
                      </code>
                      .
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
                Entiendo que este flujo es no oficial, que puede implicar riesgo
                para la cuenta y que el gateway guardara tokens OAuth para
                habilitar Gemini 3.1 Pro.
              </span>
            </label>

            {flowId ? (
              <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Sigue estos pasos</p>
                  <ol className="space-y-1 text-muted-foreground">
                    <li>
                      1. Abre la URL de autorizacion en una pestaña nueva.
                    </li>
                    <li>2. Inicia sesion con tu cuenta de Google de pago.</li>
                    <li>
                      3. Google volvera a{" "}
                      <code>
                        {redirectUri ||
                          "https://iliagpt.com/api/auth/google/callback"}
                      </code>{" "}
                      y la app intentara cerrar el popup automaticamente.
                    </li>
                    <li>
                      4. Si el popup no se cierra solo, copia esa URL final y
                      pegala aqui para terminar manualmente.
                    </li>
                  </ol>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    URL de autorizacion
                  </label>
                  <Textarea
                    readOnly
                    value={authUrl}
                    className="min-h-[88px] text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleOpenAuthUrl}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Abrir Google OAuth
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyUrl}
                    >
                      <Link2 className="h-4 w-4" />
                      Copiar URL
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="gemini-cli-callback"
                    className="text-sm font-medium"
                  >
                    Callback pegado desde el navegador
                  </label>
                  <Textarea
                    id="gemini-cli-callback"
                    placeholder="Pega aqui la URL que termina en /oauth2callback?code=...&state=..."
                    value={callbackUrl}
                    onChange={(event) => setCallbackUrl(event.target.value)}
                    className="min-h-[120px]"
                  />
                </div>
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
            {flowId ? (
              <Button
                type="button"
                onClick={handleManualComplete}
                disabled={!callbackUrl.trim() || isBusy}
              >
                {completeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Completar vinculacion
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => startMutation.mutate()}
                disabled={!acceptedRisk || isBusy}
              >
                {startMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Iniciar Gemini CLI OAuth
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default GeminiCliOAuthButton;
