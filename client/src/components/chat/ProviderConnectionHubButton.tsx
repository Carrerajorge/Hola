import * as React from "react";
import { CheckCircle2, Key, LockKeyhole, Loader2, Plus, Unplug } from "lucide-react";
import type { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { cn } from "@/lib/utils";
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
import { Input } from "@/components/ui/input";
import { GeminiCliOAuthButton } from "./GeminiCliOAuthButton";
import { OpenAICodexOAuthButton } from "./OpenAICodexOAuthButton";
import {
  AntigravityLogoIcon,
  ChatGptLogoIcon,
  ClaudeLogoIcon,
  GeminiLogoIcon,
} from "./OAuthProviderLogos";
import {
  useAllProvidersStatus,
  useAnthropicKeySubmit,
  useProviderDisconnect,
} from "@/hooks/use-provider-oauth";
import { useQueryClient } from "@tanstack/react-query";

type ProviderConnectionHubButtonProps = {
  availableModels: AvailableModel[];
  onConnected?: (modelId: string) => void | Promise<void>;
};

type ProviderCardProps = {
  title: string;
  description: string;
  meta: string;
  actionLabel: string;
  disabled?: boolean;
  highlighted?: boolean;
  icon: React.ReactNode;
  onClick?: () => void;
  isBusy?: boolean;
  isConnected?: boolean;
  testId?: string;
  onDisconnect?: () => void;
};

function countLabel(count: number): string {
  if (count <= 0) return "sin modelos visibles";
  return count === 1 ? "1 modelo visible" : `${count} modelos visibles`;
}

function getProviderModels(models: AvailableModel[], provider: string): AvailableModel[] {
  return models.filter((model) => model.provider === provider);
}

function ProviderCard({
  title,
  description,
  meta,
  actionLabel,
  disabled = false,
  highlighted = false,
  icon,
  onClick,
  isBusy = false,
  isConnected = false,
  testId,
  onDisconnect,
}: ProviderCardProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-3xl border transition-colors",
        highlighted
          ? "border-emerald-500/35 bg-emerald-500/5"
          : "border-border/70 bg-background",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-4 p-4 text-left transition-colors rounded-3xl",
          !disabled && "hover:bg-muted/35",
          disabled && "cursor-not-allowed opacity-70",
        )}
        onClick={disabled ? undefined : onClick}
        disabled={disabled || isBusy}
        data-testid={testId}
      >
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
            highlighted
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
              : "border-border/70 bg-muted/40 text-foreground",
          )}
        >
          {icon}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {isConnected ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Conectado
              </span>
            ) : null}
            {disabled ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <LockKeyhole className="h-3.5 w-3.5" />
                Manual
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{meta}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                disabled
                  ? "border border-border/70 bg-muted/50 text-muted-foreground"
                  : highlighted
                    ? "bg-emerald-600 text-white"
                    : "bg-primary text-primary-foreground",
              )}
            >
              {isBusy ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Conectando...
                </>
              ) : (
                actionLabel
              )}
            </span>
          </div>
        </div>
      </button>

      {isConnected && onDisconnect ? (
        <div className="border-t border-border/50 px-4 py-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
            onClick={onDisconnect}
          >
            <Unplug className="h-3 w-3" />
            Desconectar
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ProviderConnectionHubButton({
  availableModels,
  onConnected,
}: ProviderConnectionHubButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [anthropicKeyOpen, setAnthropicKeyOpen] = React.useState(false);
  const [anthropicKey, setAnthropicKey] = React.useState("");

  // Refs to auto-open specific provider dialogs after OAuth login redirect
  const geminiOpenDialogRef = React.useRef<(() => void) | null>(null);
  const openaiOpenDialogRef = React.useRef<(() => void) | null>(null);

  // Listen for auto-connect-provider events dispatched after OAuth login
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.provider) return;
      const provider = detail.provider;
      // Only act if the relevant dialog ref is ready
      if (provider === "gemini" && !geminiOpenDialogRef.current) return;
      if (provider === "openai" && !openaiOpenDialogRef.current) return;
      // Clear the pending hint from sessionStorage since we're handling it
      try { sessionStorage.removeItem("iliagpt:pending-provider-connect"); } catch {}
      // Open the hub dialog first
      setOpen(true);
      // Then auto-open the specific provider dialog after a small delay
      const timer = window.setTimeout(() => {
        if (provider === "gemini" && geminiOpenDialogRef.current) {
          geminiOpenDialogRef.current();
        } else if (provider === "openai" && openaiOpenDialogRef.current) {
          openaiOpenDialogRef.current();
        }
      }, 400);
      return () => window.clearTimeout(timer);
    };
    window.addEventListener("auto-connect-provider", handler);
    return () => window.removeEventListener("auto-connect-provider", handler);
  }, []);

  const { data: providerStatus, refetch: refetchStatus } = useAllProvidersStatus();
  const anthropicKeyMutation = useAnthropicKeySubmit();
  const anthropicDisconnect = useProviderDisconnect("anthropic");

  const openAiModels = React.useMemo(
    () => getProviderModels(availableModels, "openai-codex"),
    [availableModels],
  );
  const geminiModels = React.useMemo(
    () => getProviderModels(availableModels, "google-gemini-cli"),
    [availableModels],
  );
  const antigravityModels = React.useMemo(
    () => getProviderModels(availableModels, "google-antigravity"),
    [availableModels],
  );

  const anthropicConnected = providerStatus?.providers?.anthropic?.connected || false;
  const antigravityConnected = antigravityModels.length > 0;
  const defaultAntigravityModelId =
    antigravityModels[0]?.modelId || "claude-sonnet-4-5";

  const connectedProviders = React.useMemo(() => {
    let count = 0;
    if (openAiModels.length > 0) count += 1;
    if (geminiModels.length > 0) count += 1;
    if (antigravityModels.length > 0) count += 1;
    if (anthropicConnected) count += 1;
    return count;
  }, [openAiModels.length, geminiModels.length, antigravityModels.length, anthropicConnected]);

  const handleConnected = React.useCallback(
    async (modelId: string) => {
      setOpen(false);
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      await Promise.resolve(onConnected?.(modelId));
    },
    [onConnected, refetchStatus, queryClient],
  );

  const handleAnthropicSubmit = React.useCallback(async () => {
    if (!anthropicKey.trim()) return;
    try {
      await anthropicKeyMutation.mutateAsync({
        apiKey: anthropicKey.trim(),
        label: "ILIAGPT User Key",
      });
      setAnthropicKeyOpen(false);
      setAnthropicKey("");
      toast({ description: "Anthropic conectado exitosamente" });
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      handleConnected("claude-sonnet-4-6-20250514");
    } catch (err: any) {
      toast({
        title: "Error al validar la clave",
        description: err.message,
        variant: "destructive",
      });
    }
  }, [anthropicKey, anthropicKeyMutation, toast, queryClient, handleConnected]);

  const handleAnthropicDisconnect = React.useCallback(async () => {
    try {
      await anthropicDisconnect.mutateAsync({ isGlobal: false });
      toast({ description: "Anthropic desconectado" });
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }, [anthropicDisconnect, toast, refetchStatus, queryClient]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "h-8 w-8 rounded-full border-primary/25 bg-background/85 shadow-sm",
          connectedProviders > 0 && "border-emerald-500/35 text-emerald-700",
        )}
        onClick={() => setOpen(true)}
        title="Conectar proveedores"
        aria-label="Conectar proveedores"
        data-testid="button-provider-connection-hub"
      >
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conectar proveedores y traer modelos</DialogTitle>
            <DialogDescription>
              Vincula tus cuentas principales para usar sus modelos dentro de
              ILIAGPT. Cada conexión se maneja por usuario y los accesos se
              almacenan cifrados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conexiones principales
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              <OpenAICodexOAuthButton
                onConnected={handleConnected}
                renderTrigger={({ isBusy, isConnected, openDialog }) => {
                  openaiOpenDialogRef.current = openDialog;
                  return (
                    <ProviderCard
                      title="Loguear ChatGPT"
                      description="Conecta tu cuenta de ChatGPT para traer los modelos compatibles con OpenClaw al selector sin depender de callbacks locales."
                      meta={countLabel(openAiModels.length)}
                      actionLabel={isConnected ? "Revisar cuenta" : "Continuar con ChatGPT"}
                      highlighted={isConnected || openAiModels.length > 0}
                      icon={<ChatGptLogoIcon className="h-5 w-5" />}
                      onClick={openDialog}
                      isBusy={isBusy}
                      isConnected={isConnected}
                      testId="provider-card-openai-codex"
                    />
                  );
                }}
              />

              <GeminiCliOAuthButton
                onConnected={handleConnected}
                renderTrigger={({ isBusy, isConnected, openDialog }) => {
                  geminiOpenDialogRef.current = openDialog;
                  return (
                    <ProviderCard
                      title="Loguear con Gemini"
                      description="Vincula Google Gemini CLI OAuth y expone sus modelos compatibles dentro de ILIAGPT."
                      meta={countLabel(geminiModels.length)}
                      actionLabel={isConnected ? "Revisar cuenta" : "Continuar con Google"}
                      highlighted={isConnected || geminiModels.length > 0}
                      icon={<GeminiLogoIcon className="h-5 w-5" />}
                      onClick={openDialog}
                      isBusy={isBusy}
                      isConnected={isConnected}
                      testId="provider-card-gemini-cli"
                    />
                  );
                }}
              />

              <ProviderCard
                title="Loguear con Antigravity"
                description={
                  antigravityConnected
                    ? "Antigravity ya está detectado para este usuario y sus modelos ya aparecen en el selector."
                    : "Antigravity se activa automáticamente cuando el gateway detecta un perfil configurado para este usuario."
                }
                meta={countLabel(antigravityModels.length)}
                actionLabel={
                  antigravityConnected ? "Usar modelos" : "Pendiente en gateway"
                }
                highlighted={antigravityConnected}
                disabled={!antigravityConnected}
                isConnected={antigravityConnected}
                icon={<AntigravityLogoIcon className="h-5 w-5" />}
                onClick={
                  antigravityConnected
                    ? () => {
                        void handleConnected(defaultAntigravityModelId);
                      }
                    : undefined
                }
                testId="provider-card-antigravity"
              />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Integraciones avanzadas
            </h3>
            <div className="grid gap-3 md:grid-cols-1">
              <ProviderCard
                title="Claude (Anthropic)"
                description="Ingresa tu API Key de Anthropic para usar Claude Opus, Sonnet y Haiku."
                meta={anthropicConnected ? "API Key guardada" : "API Key manual"}
                actionLabel={anthropicConnected ? "Conectado" : "Agregar API Key"}
                highlighted={anthropicConnected}
                isConnected={anthropicConnected}
                icon={<ClaudeLogoIcon className="h-5 w-5" />}
                onClick={() => setAnthropicKeyOpen(true)}
                testId="provider-card-anthropic"
                onDisconnect={anthropicConnected ? handleAnthropicDisconnect : undefined}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Anthropic API Key Dialog */}
      <Dialog open={anthropicKeyOpen} onOpenChange={setAnthropicKeyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Clave API de Anthropic
            </DialogTitle>
            <DialogDescription>
              Ingresa tu clave API de Anthropic. Se validara con una llamada de
              prueba y se almacenara cifrada con AES-256-GCM.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              type="password"
              placeholder="sk-ant-api03-..."
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && anthropicKey.trim()) handleAnthropicSubmit();
              }}
              disabled={anthropicKeyMutation.isPending}
              autoFocus
            />
            {anthropicKeyMutation.error && (
              <p className="text-sm text-destructive">
                {anthropicKeyMutation.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAnthropicKeyOpen(false)}
              disabled={anthropicKeyMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAnthropicSubmit}
              disabled={anthropicKeyMutation.isPending || !anthropicKey.trim()}
            >
              {anthropicKeyMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validando...
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ProviderConnectionHubButton;
