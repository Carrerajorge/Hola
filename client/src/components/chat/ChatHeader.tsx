
import React from 'react';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ShareChatDialog, ShareIcon } from "@/components/share-chat-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { useModelAvailability, type AvailableModel } from "@/contexts/ModelAvailabilityContext";
import {
    ChevronDown,
    Pencil,
    Info,
    Settings,
    EyeOff,
    Pin,
    Link,
    Star,
    Flag,
    Sparkles,
    MoreHorizontal,
    Folder,
    FolderPlus,
    Download,
    Archive,
    Trash2,
    Check,
    X,
    PanelLeftOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActiveGpt } from "@/types/chat";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';

interface ChatHeaderProps {
    chatId: string | null;
    activeGpt: ActiveGpt;
    messages: any[]; // Use specific message type
    folders?: any[]; // Use specific folder type
    currentFolderId?: string | null;
    isPinned?: boolean;
    isArchived?: boolean;
    isSidebarOpen: boolean;
    onToggleSidebar: () => void;
    // Callback props for actions
    onNewChat?: () => void;
    onEditGpt?: (gpt: ActiveGpt) => void;
    onHideGptFromSidebar?: (id: string) => void;
    onPinGptToSidebar?: (id: string) => void;
    isGptPinned?: (id: string) => boolean;
    onAboutGpt?: (gpt: ActiveGpt) => void;
    onPinChat?: (id: string, e: React.MouseEvent) => void;
    onArchiveChat?: (id: string, e: React.MouseEvent) => void;
    onHideChat?: (id: string, e: React.MouseEvent) => void;
    onDeleteChat?: (id: string, e: React.MouseEvent) => void;
    onDownloadChat?: (id: string, e: React.MouseEvent) => void;
    onEditChatTitle?: (id: string, newTitle: string) => void;
    onMoveToFolder?: (chatId: string, folderId: string | null) => void;
    onCreateFolder?: (name: string) => void;
    userPlanInfo?: { plan: string; isAdmin?: boolean; isPaid?: boolean } | null;
}

export function ChatHeader({
    chatId,
    activeGpt,
    messages,
    folders = [],
    currentFolderId,
    isPinned = false,
    isArchived = false,
    isSidebarOpen,
    onToggleSidebar,
    onNewChat,
    onEditGpt,
    onHideGptFromSidebar,
    onPinGptToSidebar,
    isGptPinned,
    onAboutGpt,
    onPinChat,
    onArchiveChat,
    onHideChat,
    onDeleteChat,
    onDownloadChat,
    onEditChatTitle,
    onMoveToFolder,
    onCreateFolder,
    userPlanInfo
}: ChatHeaderProps) {
    const { toast } = useToast();
    const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
    const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
    const { availableModels, isAnyModelAvailable, selectedModelId, setSelectedModelId } = useModelAvailability();

    // Model grouping logic
    const modelsByProvider = useMemo(() => {
        const grouped: Record<string, AvailableModel[]> = {};
        availableModels.forEach(model => {
            if (!grouped[model.provider]) {
                grouped[model.provider] = [];
            }
            grouped[model.provider].push(model);
        });
        return grouped;
    }, [availableModels]);

    const selectedModelData = useMemo(() => {
        if (!selectedModelId) return availableModels[0] || null;
        return availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId) || availableModels[0] || null;
    }, [selectedModelId, availableModels]);


    return (
        <header className="sticky top-0 z-20 flex items-center justify-between px-3 md:px-4 py-2 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-14">
            <div className="flex items-center gap-2">
                {!isSidebarOpen && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="-ml-2 h-9 w-9">
                                    <PanelLeftOpen className="h-5 w-5 text-muted-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                <p>Mostrar barra lateral</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                {activeGpt ? (
                    <DropdownMenu open={isModelSelectorOpen} onOpenChange={setIsModelSelectorOpen}>
                        <DropdownMenuTrigger asChild>
                            <div
                                className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                                data-testid="button-model-selector"
                            >
                                <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                                    {selectedModelData?.name || activeGpt.name || "Seleccionar modelo"}
                                </span>
                                <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto">
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                    <span>Modelos</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent className="w-56">
                                        {Object.entries(modelsByProvider).map(([provider, models], providerIndex) => (
                                            <React.Fragment key={provider}>
                                                {providerIndex > 0 && <DropdownMenuSeparator />}
                                                <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                                                    {provider === "xai" ? "xAI" : provider === "gemini" ? "Google Gemini" : provider}
                                                </div>
                                                {models.map((model) => (
                                                    <DropdownMenuItem
                                                        key={model.id}
                                                        className={cn("flex items-center gap-2", selectedModelData?.id === model.id && "bg-muted")}
                                                        onClick={() => {
                                                            setSelectedModelId(model.id);
                                                            setIsModelSelectorOpen(false);
                                                        }}
                                                    >
                                                        {selectedModelData?.id === model.id && <Check className="h-4 w-4" />}
                                                        <span className={cn(selectedModelData?.id !== model.id && "pl-6")}>{model.name}</span>
                                                    </DropdownMenuItem>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>

                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onNewChat} className="flex items-center gap-2">
                                <Pencil className="h-4 w-4" />
                                <span>Nuevo chat</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAboutGpt?.(activeGpt)} className="flex items-center gap-2">
                                <Info className="h-4 w-4" />
                                <span>Acerca de</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEditGpt?.(activeGpt)} className="flex items-center gap-2">
                                <Settings className="h-4 w-4" />
                                <span>Editar GPT</span>
                            </DropdownMenuItem>
                            {isGptPinned?.(activeGpt.id) ? (
                                <DropdownMenuItem onClick={() => onHideGptFromSidebar?.(activeGpt.id)} className="flex items-center gap-2">
                                    <EyeOff className="h-4 w-4" />
                                    <span>Ocultar de la barra lateral</span>
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onClick={() => onPinGptToSidebar?.(activeGpt.id)} className="flex items-center gap-2">
                                    <Pin className="h-4 w-4" />
                                    <span>Fijar en la barra lateral</span>
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/gpts/${activeGpt.id}`);
                                    toast({ title: "Enlace copiado", description: "El enlace del GPT se ha copiado al portapapeles" });
                                }}
                                className="flex items-center gap-2"
                            >
                                <Link className="h-4 w-4" />
                                <span>Copiar enlace</span>
                            </DropdownMenuItem>
                            {/* Rating and Reporting placeholders */}
                            <DropdownMenuItem
                                onClick={() => toast({ title: "Valorar GPT", description: "Esta función estará disponible próximamente" })}
                                className="flex items-center gap-2"
                            >
                                <Star className="h-4 w-4" />
                                <span>Valorar GPT</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => toast({ title: "Denunciar GPT", description: "Puedes reportar contenido inapropiado a soporte" })}
                                className="flex items-center gap-2 text-destructive"
                            >
                                <Flag className="h-4 w-4" />
                                <span>Denunciar GPT</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : !isAnyModelAvailable ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div
                                    className="flex items-center gap-1 sm:gap-2 bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-1 rounded-md cursor-not-allowed opacity-60"
                                    data-testid="button-model-selector-disabled"
                                >
                                    <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none text-gray-500 dark:text-gray-400">
                                        Sin modelos activos
                                    </span>
                                    <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>No hay modelos disponibles. Un administrador debe activar al menos un modelo.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : (
                    <div
                        className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                        onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
                        data-testid="button-model-selector"
                    >
                        <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                            {selectedModelData?.name || "Seleccionar modelo"}
                        </span>
                        <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    </div>
                )}
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1">
                {(!userPlanInfo || (userPlanInfo.plan === "free" && !userPlanInfo.isAdmin && !userPlanInfo.isPaid)) && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="hidden sm:flex rounded-full text-xs gap-1.5 px-3 border-primary/30 bg-primary/5 hover:bg-primary/10"
                        onClick={() => setIsUpgradeDialogOpen(true)}
                        data-testid="button-upgrade-header"
                    >
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span className="hidden md:inline">Mejorar el plan a Go</span>
                        <span className="md:hidden">Upgrade</span>
                    </Button>
                )}

                {chatId && !chatId.startsWith("pending-") ? (
                    <ShareChatDialog chatId={chatId} chatTitle={messages[0]?.content?.slice(0, 30) || "Chat"}>
                        <Button variant="ghost" size="icon" data-testid="button-share-chat">
                            <ShareIcon size={20} />
                        </Button>
                    </ShareChatDialog>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        data-testid="button-share-chat-disabled"
                        disabled
                        title="Envía un mensaje para poder compartir este chat"
                    >
                        <ShareIcon size={20} />
                    </Button>
                )}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid="button-chat-options">
                            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52" sideOffset={5}>
                        <DropdownMenuItem
                            onClick={(e) => chatId && onPinChat?.(chatId, e as unknown as React.MouseEvent)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-pin-chat"
                        >
                            <Pin className="h-4 w-4 mr-2" />
                            {isPinned ? "Desfijar" : "Fijar chat"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => {
                                if (chatId && onEditChatTitle) {
                                    const newTitle = prompt("Nuevo título del chat:", messages[0]?.content?.slice(0, 50) || "Chat");
                                    if (newTitle && newTitle.trim()) {
                                        onEditChatTitle(chatId, newTitle.trim());
                                    }
                                }
                            }}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-edit-chat"
                        >
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger
                                disabled={!chatId || chatId.startsWith("pending-")}
                                data-testid="menu-move-folder"
                            >
                                <Folder className="h-4 w-4 mr-2" />
                                Mover a carpeta
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                    {folders.length > 0 ? (
                                        <>
                                            {folders.map((folder) => (
                                                <DropdownMenuItem
                                                    key={folder.id}
                                                    onClick={() => chatId && onMoveToFolder?.(chatId, folder.id)}
                                                    data-testid={`menu-folder-${folder.id}`}
                                                >
                                                    <span
                                                        className="h-3 w-3 rounded-full mr-2 flex-shrink-0"
                                                        style={{ backgroundColor: folder.color }}
                                                    />
                                                    {folder.name}
                                                </DropdownMenuItem>
                                            ))}
                                            {currentFolderId && (
                                                <>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => chatId && onMoveToFolder?.(chatId, null)}
                                                        data-testid="menu-remove-folder"
                                                    >
                                                        <X className="h-4 w-4 mr-2" />
                                                        Quitar de carpeta
                                                    </DropdownMenuItem>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                const folderName = prompt("Nombre de la carpeta:");
                                                if (folderName && folderName.trim()) {
                                                    onCreateFolder?.(folderName.trim());
                                                }
                                            }}
                                            data-testid="menu-create-folder"
                                        >
                                            <FolderPlus className="h-4 w-4 mr-2" />
                                            Crear carpeta
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                        </DropdownMenuSub>
                        <DropdownMenuItem
                            onClick={(e) => chatId && onDownloadChat?.(chatId, e as unknown as React.MouseEvent)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-download-chat"
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Descargar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={(e) => chatId && onArchiveChat?.(chatId, e as unknown as React.MouseEvent)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-archive-chat"
                        >
                            <Archive className="h-4 w-4 mr-2" />
                            {isArchived ? "Desarchivar" : "Archivar"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={(e) => chatId && onHideChat?.(chatId, e as unknown as React.MouseEvent)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            data-testid="menu-hide-chat"
                        >
                            <EyeOff className="h-4 w-4 mr-2" />
                            Ocultar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={(e) => chatId && onDeleteChat?.(chatId, e as unknown as React.MouseEvent)}
                            disabled={!chatId || chatId.startsWith("pending-")}
                            className="text-red-500 focus:text-red-500"
                            data-testid="menu-delete-chat"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Eliminar
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <UpgradePlanDialog open={isUpgradeDialogOpen} onOpenChange={setIsUpgradeDialogOpen} />
        </header>
    );
}
