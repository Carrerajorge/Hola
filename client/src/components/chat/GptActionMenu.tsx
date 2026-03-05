import React, { useMemo, useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronRight, Pencil, Info, Lock, Pin, Link, Star, Flag, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActiveGpt } from "@/types/chat";
import { useToast } from "@/hooks/use-toast";
import { AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { apiFetch } from "@/lib/apiClient";

interface GptActionMenuProps {
    activeGpt: ActiveGpt;
    modelsByProvider: Record<string, AvailableModel[]>;
    selectedModelId: string | null;
    setSelectedModelId: (id: string) => void;
    onModelChange?: (id: string) => void;
    modelChangeDisabled?: boolean;
    onNewChat?: (options?: { preserveGpt?: boolean }) => void;
    onAboutGpt?: (gpt: ActiveGpt) => void;
    onEditGpt?: (gpt: ActiveGpt) => void;
    onHideGptFromSidebar?: (id: string) => void;
    onPinGptToSidebar?: (id: string) => void;
    isGptPinned?: (id: string) => boolean;
}

type GptActionPanel = "model" | "newChat" | "privacy" | "pin" | "copy" | "rate" | "report" | null;

const safeText = (value: unknown, fallback = ""): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
};

export function GptActionMenu({
    activeGpt,
    modelsByProvider,
    selectedModelId,
    setSelectedModelId,
    onModelChange,
    modelChangeDisabled = false,
    onNewChat,
    onAboutGpt,
    onEditGpt,
    onHideGptFromSidebar,
    onPinGptToSidebar,
    isGptPinned
}: GptActionMenuProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [activePanel, setActivePanel] = useState<GptActionPanel>(null);
    const [rating, setRating] = useState(0);
    const [reportReason, setReportReason] = useState("");
    const [savingPrivacy, setSavingPrivacy] = useState(false);

    const allModels = useMemo(() => Object.values(modelsByProvider).flat(), [modelsByProvider]);
    const selectedModel = useMemo(
        () => allModels.find((model) => model.id === selectedModelId || model.modelId === selectedModelId) || null,
        [allModels, selectedModelId]
    );
    const gptLink = useMemo(() => {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const gptId = safeText(activeGpt?.id, "").trim();
        if (!origin || !gptId) return "";
        return `${origin}/gpts/${gptId}`;
    }, [activeGpt?.id]);
    const activeGptId = safeText(activeGpt?.id, "").trim();
    const activeGptName = safeText(activeGpt?.name, "GPT");
    const isPinnedInSidebar = !!(activeGptId && isGptPinned?.(activeGptId));

    const openPanel = (panel: Exclude<GptActionPanel, null>) => {
        setOpen(false);
        setActivePanel(panel);
    };

    const savePrivacy = async (visibility: "private" | "team" | "public") => {
        setSavingPrivacy(true);
        try {
            const response = await apiFetch(`/api/gpts/${activeGpt.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visibility }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || "No se pudo actualizar la privacidad");
            }
            toast({
                title: "Privacidad actualizada",
                description: visibility === "private" ? "Solo tú tienes acceso." : visibility === "team" ? "Disponible para tu equipo." : "Disponible por enlace público.",
            });
            setActivePanel(null);
        } catch (error: any) {
            toast({
                title: "Error",
                description: error.message || "No se pudo actualizar la privacidad",
                variant: "destructive",
            });
        } finally {
            setSavingPrivacy(false);
        }
    };

    return (
        <>
            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <div
                        className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                        data-testid="button-gpt-context-menu"
                    >
                        <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                            {activeGptName}
                        </span>
                        <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 max-h-96 overflow-y-auto" sideOffset={8}>
                    <DropdownMenuItem className="flex items-center gap-2" onSelect={(e) => {
                        e.preventDefault();
                        openPanel("model");
                    }}>
                        <span>Modelo</span>
                        <span className="ml-auto text-muted-foreground text-xs">{safeText(selectedModel?.name, "Predeterminado")}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        openPanel("newChat");
                    }} className="flex items-center gap-2">
                        <Pencil className="h-4 w-4" />
                        <span>Nuevo chat</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        setOpen(false);
                        onAboutGpt?.(activeGpt);
                    }} className="flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        <span>Acerca de</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        openPanel("privacy");
                    }} className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        <span>Configuración de privacidad</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        openPanel("pin");
                    }} className="flex items-center gap-2">
                        <Pin className="h-4 w-4" />
                        <span>Mantener en la barra lateral</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        openPanel("copy");
                    }} className="flex items-center gap-2">
                        <Link className="h-4 w-4" />
                        <span>Copiar enlace</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        openPanel("rate");
                    }} className="flex items-center gap-2">
                        <Star className="h-4 w-4" />
                        <span>Valorar GPT</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => {
                        e.preventDefault();
                        openPanel("report");
                    }} className="flex items-center gap-2 text-destructive">
                        <Flag className="h-4 w-4" />
                        <span>Denunciar GPT</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={activePanel === "model"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Seleccionar modelo</DialogTitle>
                        <DialogDescription>Cambia el modelo para este chat con {activeGptName}.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                        {Object.entries(modelsByProvider).map(([provider, models], providerIndex) => (
                            <div key={provider} className={cn(providerIndex > 0 && "pt-3 border-t")}>
                                <p className="text-xs font-medium text-muted-foreground mb-2">
                                    {provider === "xai" ? "xAI" : provider === "gemini" ? "Google Gemini" : safeText(provider, "provider")}
                                </p>
                                <div className="space-y-1">
                                    {models.map((model) => {
                                        const modelId = safeText(model.id, model.modelId).trim();
                                        const modelIdAlias = safeText(model.modelId, "").trim();
                                        const isSelected = selectedModelId === modelId || selectedModelId === modelIdAlias;
                                        return (
                                        <Button
                                            key={modelId}
                                            variant={isSelected ? "default" : "outline"}
                                            className="w-full justify-between"
                                            disabled={modelChangeDisabled}
                                            onClick={() => {
                                                if (modelChangeDisabled) return;
                                                const nextModelId = modelId;
                                                if (!nextModelId) return;
                                                const handler = onModelChange ?? setSelectedModelId;
                                                handler(nextModelId);
                                                setActivePanel(null);
                                            }}
                                        >
                                            <span>{safeText(model.name, model.modelId)}</span>
                                            {isSelected ? <Check className="h-4 w-4" /> : null}
                                        </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={activePanel === "newChat"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Nuevo chat de GPT</DialogTitle>
                        <DialogDescription>Se iniciará un chat nuevo manteniendo {activeGptName} seleccionado.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActivePanel(null)}>Cancelar</Button>
                        <Button onClick={() => {
                            onNewChat?.({ preserveGpt: true });
                            setActivePanel(null);
                        }}>
                            Continuar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={activePanel === "privacy"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Configuración de privacidad</DialogTitle>
                        <DialogDescription>Elige quién puede acceder a este GPT.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Button className="w-full justify-start" variant="outline" disabled={savingPrivacy} onClick={() => savePrivacy("private")}>
                            Privado
                        </Button>
                        <Button className="w-full justify-start" variant="outline" disabled={savingPrivacy} onClick={() => savePrivacy("team")}>
                            Equipo
                        </Button>
                        <Button className="w-full justify-start" variant="outline" disabled={savingPrivacy} onClick={() => savePrivacy("public")}>
                            Público por enlace
                        </Button>
                        <Button className="w-full justify-start" variant="ghost" onClick={() => {
                            setActivePanel(null);
                            onEditGpt?.(activeGpt);
                        }}>
                            Abrir editor completo de GPT
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={activePanel === "pin"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{isPinnedInSidebar ? "Quitar de barra lateral" : "Mantener en barra lateral"}</DialogTitle>
                        <DialogDescription>
                            {isPinnedInSidebar
                                ? "Este GPT ya está en la barra lateral. Puedes quitarlo."
                                : "Agrega este GPT a la barra lateral para abrirlo más rápido."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActivePanel(null)}>Cancelar</Button>
                        <Button onClick={() => {
                            if (isPinnedInSidebar) {
                                if (activeGptId) onHideGptFromSidebar?.(activeGptId);
                            } else {
                                if (activeGptId) onPinGptToSidebar?.(activeGptId);
                            }
                            setActivePanel(null);
                        }}>
                            {isPinnedInSidebar ? "Quitar" : "Mantener"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={activePanel === "copy"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Copiar enlace</DialogTitle>
                        <DialogDescription>Comparte este GPT usando este enlace.</DialogDescription>
                    </DialogHeader>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">{gptLink || "Enlace no disponible"}</div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActivePanel(null)}>Cerrar</Button>
                        <Button onClick={async () => {
                            if (!gptLink || typeof navigator === "undefined" || !navigator.clipboard) {
                                toast({ title: "No disponible", description: "No se pudo copiar el enlace en este entorno.", variant: "destructive" });
                                return;
                            }
                            await navigator.clipboard.writeText(gptLink);
                            toast({ title: "Enlace copiado", description: "Listo para compartir." });
                            setActivePanel(null);
                        }}>
                            Copiar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={activePanel === "rate"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Valorar GPT</DialogTitle>
                        <DialogDescription>Selecciona una valoración para {activeGptName}.</DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-center gap-2 py-2">
                        {[1, 2, 3, 4, 5].map((value) => (
                            <Button
                                key={value}
                                variant={value <= rating ? "default" : "outline"}
                                size="sm"
                                onClick={() => setRating(value)}
                            >
                                {value}
                            </Button>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActivePanel(null)}>Cancelar</Button>
                        <Button onClick={() => {
                            toast({
                                title: "Gracias por tu valoración",
                                description: rating > 0 ? `Valor enviado: ${rating}/5` : "Puedes seleccionar una calificación cuando quieras.",
                            });
                            setActivePanel(null);
                        }}>
                            Enviar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={activePanel === "report"} onOpenChange={(next) => !next && setActivePanel(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Denunciar GPT</DialogTitle>
                        <DialogDescription>Describe brevemente el problema que deseas reportar.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="gpt-report-reason">Motivo</Label>
                        <Textarea
                            id="gpt-report-reason"
                            placeholder="Escribe aquí el motivo del reporte..."
                            value={reportReason}
                            onChange={(event) => setReportReason(event.target.value)}
                            className="min-h-[120px]"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActivePanel(null)}>Cancelar</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                toast({
                                    title: "Reporte enviado",
                                    description: reportReason.trim() ? "Tu reporte fue registrado para revisión." : "Reporte enviado sin detalle adicional.",
                                });
                                setReportReason("");
                                setActivePanel(null);
                            }}
                        >
                            Enviar reporte
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default GptActionMenu;
