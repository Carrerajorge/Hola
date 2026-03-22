import * as React from "react";
import { CheckCircle2, Key, LockKeyhole, Plus } from "lucide-react";
import type { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
};

function countLabel(count: number): string {
  if (count <= 0) {
    return "sin modelos visibles";
  }
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
}: ProviderCardProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-4 rounded-3xl border p-4 text-left transition-colors",
        highlighted
          ? "border-emerald-500/35 bg-emerald-500/5"
          : "border-border/70 bg-background hover:bg-muted/35",
        disabled && "cursor-not-allowed opacity-70 hover:bg-background",
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
            {isBusy ? "Abriendo..." : actionLabel}
          </span>
        </div>
      </div>
    </button>
  );
}

export function ProviderConnectionHubButton({
  availableModels,
  onConnected,
}: ProviderConnectionHubButtonProps) {
  const [open, setOpen] = React.useState(false);

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
  // DB-backed multi-provider models
  const oauthOpenaiModels = React.useMemo(
    () => getProviderModels(availableModels, "openai"),
    [availableModels],
  );
  const oauthGeminiModels = React.useMemo(
    () => getProviderModels(availableModels, "gemini"),
    [availableModels],
  );
  const anthropicModels = React.useMemo(
    () => getProviderModels(availableModels, "anthropic"),
    [availableModels],
  );

  const connectedProviders = React.useMemo(() => {
    let count = 0;
    if (openAiModels.length > 0 || oauthOpenaiModels.length > 0) count += 1;
    if (geminiModels.length > 0 || oauthGeminiModels.length > 0) count += 1;
    if (antigravityModels.length > 0) count += 1;
    if (anthropicModels.length > 0) count += 1;
    return count;
  }, [antigravityModels.length, geminiModels.length, openAiModels.length, oauthOpenaiModels.length, oauthGeminiModels.length, anthropicModels.length]);

  // Anthropic API key state
  const [anthropicKeyOpen, setAnthropicKeyOpen] = React.useState(false);
  const [anthropicKey, setAnthropicKey] = React.useState("");
  const [anthropicLoading, setAnthropicLoading] = React.useState(false);
  const [anthropicError, setAnthropicError] = React.useState<string | null>(null);
  const [anthropicConnected, setAnthropicConnected] = React.useState(false);

  // Check Anthropic status on mount
  React.useEffect(() => {
    fetch("/api/oauth/providers/anthropic/status")
      .then((r) => r.json())
      .then((data: any) => setAnthropicConnected(data?.connected || false))
      .catch(() => {});
  }, []);

  const handleAnthropicSubmit = React.useCallback(async () => {
    if (!anthropicKey.trim()) return;
    setAnthropicLoading(true);
    setAnthropicError(null);
    try {
      const res = await fetch("/api/oauth/providers/anthropic/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: anthropicKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnthropicError(data.error || "Error al validar la clave");
        return;
      }
      setAnthropicConnected(true);
      setAnthropicKeyOpen(false);
      setAnthropicKey("");
      // Invalidate model cache
      const { queryClient } = await import("@/lib/queryClient");
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      handleConnected("claude-sonnet-4-6-20250514");
    } catch (err: any) {
      setAnthropicError(err.message || "Error de red");
    } finally {
      setAnthropicLoading(false);
    }
  }, [anthropicKey, handleConnected]);

  const handleConnected = React.useCallback(
    async (modelId: string) => {
      setOpen(false);
      await Promise.resolve(onConnected?.(modelId));
    },
    [onConnected],
  );

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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Conectar proveedores y traer modelos</DialogTitle>
            <DialogDescription>
              Vincula tus cuentas para usar sus modelos desde ILIAGPT. ChatGPT
              y Gemini ya tienen OAuth directo en esta plataforma; Antigravity
              solo aparece si el gateway ya fue configurado manualmente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-3">
            <OpenAICodexOAuthButton
              onConnected={handleConnected}
              renderTrigger={({ isBusy, isConnected, openDialog }) => (
                <ProviderCard
                  title="Loguear ChatGPT"
                  description="Conecta tu cuenta de ChatGPT para traer los modelos compatibles con OpenClaw al selector."
                  meta={countLabel(openAiModels.length)}
                  actionLabel={isConnected ? "Revisar cuenta" : "Continuar con ChatGPT"}
                  highlighted={isConnected || openAiModels.length > 0}
                  icon={<ChatGptLogoIcon className="h-5 w-5" />}
                  onClick={openDialog}
                  isBusy={isBusy}
                  isConnected={isConnected}
                  testId="provider-card-openai-codex"
                />
              )}
            />

            <GeminiCliOAuthButton
              onConnected={handleConnected}
              renderTrigger={({ isBusy, isConnected, openDialog }) => (
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
              )}
            />

            {/* Anthropic API Key */}
            <ProviderCard
              title="Conectar Claude (Anthropic)"
              description="Ingresa tu API Key de Anthropic para usar los modelos Claude directamente desde ILIAGPT."
              meta={countLabel(anthropicModels.length)}
              actionLabel={anthropicConnected ? "Conectado" : "Agregar API Key"}
              highlighted={anthropicConnected || anthropicModels.length > 0}
              isConnected={anthropicConnected}
              icon={<ClaudeLogoIcon className="h-5 w-5" />}
              onClick={() => setAnthropicKeyOpen(true)}
              testId="provider-card-anthropic"
            />
          </div>

          {/* Anthropic API Key Dialog */}
          <Dialog open={anthropicKeyOpen} onOpenChange={setAnthropicKeyOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Clave API de Anthropic
                </DialogTitle>
                <DialogDescription>
                  Ingresa tu clave API de Anthropic. Se validara con una llamada de prueba y se almacenara cifrada con AES-256.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Input
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  disabled={anthropicLoading}
                />
                {anthropicError && (
                  <p className="text-sm text-destructive">{anthropicError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAnthropicKeyOpen(false)}
                    disabled={anthropicLoading}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleAnthropicSubmit}
                    disabled={anthropicLoading || !anthropicKey.trim()}
                  >
                    {anthropicLoading ? "Validando..." : "Guardar"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ProviderConnectionHubButton;
