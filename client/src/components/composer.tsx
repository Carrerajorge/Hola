import React, { useRef } from "react";
import {
  Plus,
  Upload,
  Search,
  Image,
  Video,
  Bot,
  Plug,
  Globe,
  FileText,
  ChevronRight,
  X,
  Loader2,
  CheckCircle2,
  ArrowUp,
  Mic,
  MicOff,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RecordingPanel } from "@/components/recording-panel";
import { getFileTheme } from "@/lib/fileTypeTheme";

export interface UploadedFile {
  id?: string;
  name: string;
  type: string;
  mimeType?: string;
  size: number;
  dataUrl?: string;
  storagePath?: string;
  status?: string;
  content?: string;
}

type AiState = "idle" | "thinking" | "responding";
type DocToolType = "word" | "excel" | "ppt" | "figma" | null;
type ToolType = "web" | "agent" | "image" | null;

interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  uploadedFiles: UploadedFile[];
  onRemoveFile: (index: number) => void;
  onSubmit: () => void;
  onStopChat: () => void;
  aiState: AiState;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  placeholder?: string;
  compact?: boolean;
  selectedDocText?: string | null;
  onDocTextDeselect?: () => void;
  selectedDocTool?: DocToolType;
  onCloseDocEditor?: () => void;
  selectedTool?: ToolType;
  onSelectTool?: (tool: ToolType) => void;
  onSelectDocTool?: (tool: DocToolType) => void;
  onOpenBlankDocEditor?: (type: "word" | "excel" | "ppt") => void;
  onToggleBrowser?: () => void;
  isBrowserOpen?: boolean;
  isRecording?: boolean;
  isPaused?: boolean;
  recordingTime?: number;
  onDiscardRecording?: () => void;
  onPauseRecording?: () => void;
  onResumeRecording?: () => void;
  onSendRecording?: () => void;
  onToggleRecording?: () => void;
  onOpenVoiceChat?: () => void;
  isFigmaConnected?: boolean;
  isFigmaConnecting?: boolean;
  onFigmaConnect?: () => void;
  onFigmaDisconnect?: () => void;
  onCloseSidebar?: () => void;
  isDraggingOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onPreviewUploadedImage?: (file: { name: string; dataUrl: string }) => void;
  composerRef?: React.RefObject<HTMLDivElement>;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

function FilePreviewInline({
  file,
  index,
  onRemove,
  onPreview,
}: {
  file: UploadedFile;
  index: number;
  onRemove: (index: number) => void;
  onPreview?: (file: { name: string; dataUrl: string }) => void;
}) {
  const theme = getFileTheme(file.name, file.mimeType);
  const isImage = file.type?.startsWith("image/") || file.mimeType?.startsWith("image/");

  if (isImage && file.dataUrl) {
    return (
      <div className="relative group">
        <div
          className="relative w-14 h-14 rounded-lg overflow-hidden cursor-pointer border border-border hover:border-primary transition-colors"
          onClick={() => onPreview?.({ name: file.name, dataUrl: file.dataUrl! })}
          data-testid={`preview-image-${index}`}
        >
          <img
            src={file.dataUrl}
            alt={file.name}
            className="w-full h-full object-cover"
          />
          {(file.status === "uploading" || file.status === "processing") && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 className="h-4 w-4 text-white animate-spin" />
            </div>
          )}
        </div>
        <button
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          data-testid={`button-remove-file-${index}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "relative group flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all duration-200 cursor-pointer",
              file.status === "uploading" && "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800",
              file.status === "processing" && "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800",
              file.status === "ready" && "bg-muted/50 border border-border hover:bg-muted",
              file.status === "error" && "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
            )}
          >
            <div className={cn("flex items-center justify-center w-7 h-7 rounded shrink-0", theme.bgColor)}>
              {file.status === "uploading" || file.status === "processing" ? (
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              ) : (
                <span className="text-white text-xs font-bold">{theme.icon}</span>
              )}
            </div>
            <span className="max-w-[100px] truncate font-medium">{file.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(index);
              }}
              data-testid={`button-remove-file-${index}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">
            {file.name} ({formatFileSize(file.size)})
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ToolBadge({
  tool,
  onClose,
}: {
  tool: ToolType;
  onClose: () => void;
}) {
  if (!tool) return null;

  return (
    <div className="relative group shrink-0">
      <div
        className={cn(
          "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
          "transition-all duration-500 ease-out",
          "hover:shadow-lg hover:shadow-current/30",
          tool === "web" && "bg-gradient-to-br from-cyan-500 to-cyan-700",
          tool === "agent" && "bg-gradient-to-br from-purple-500 to-purple-700",
          tool === "image" && "bg-gradient-to-br from-pink-500 to-rose-600"
        )}
        style={{ animation: "liquid-float 3s ease-in-out infinite" }}
        data-testid="button-selected-tool"
      >
        {tool === "web" ? (
          <Globe className="h-5 w-5 text-white z-10 drop-shadow-md" />
        ) : tool === "image" ? (
          <Image className="h-5 w-5 text-white z-10 drop-shadow-md" />
        ) : (
          <Bot className="h-5 w-5 text-white z-10 drop-shadow-md" />
        )}
      </div>
      <button
        onClick={onClose}
        className={cn(
          "absolute -top-1 -right-1 w-4 h-4 rounded-full",
          "bg-red-500 hover:bg-red-600 text-white",
          "flex items-center justify-center",
          "opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100",
          "transition-all duration-200 ease-out",
          "shadow-md hover:shadow-lg"
        )}
        data-testid="button-close-tool"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function DocToolBadge({
  tool,
  onClose,
}: {
  tool: DocToolType;
  onClose: () => void;
}) {
  if (!tool) return null;

  return (
    <div className="relative group shrink-0">
      <div
        className={cn(
          "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
          "transition-all duration-500 ease-out",
          "hover:shadow-lg hover:shadow-current/30",
          tool === "word" && "bg-gradient-to-br from-blue-500 to-blue-700",
          tool === "excel" && "bg-gradient-to-br from-green-500 to-green-700",
          tool === "ppt" && "bg-gradient-to-br from-orange-400 to-orange-600",
          tool === "figma" && "bg-gradient-to-br from-purple-500 to-pink-500"
        )}
        style={{ animation: "liquid-float 3s ease-in-out infinite" }}
      >
        {tool === "figma" ? (
          <svg width="16" height="24" viewBox="0 0 38 57" fill="none" className="z-10 drop-shadow-md">
            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
          </svg>
        ) : (
          <span className="text-white text-base font-bold z-10 drop-shadow-md">
            {tool === "word" ? "W" : tool === "excel" ? "E" : "P"}
          </span>
        )}
      </div>
      <button
        onClick={onClose}
        className={cn(
          "absolute -top-1 -right-1 w-4 h-4 rounded-full",
          "bg-red-500 hover:bg-red-600 text-white",
          "flex items-center justify-center",
          "opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100",
          "transition-all duration-200 ease-out",
          "shadow-md hover:shadow-lg"
        )}
        data-testid="button-close-doc-tool"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function ToolsPopover({
  onFileUpload,
  onSelectTool,
  onSelectDocTool,
  onOpenBlankDocEditor,
  onCloseSidebar,
  isFigmaConnected,
  isFigmaConnecting,
  onFigmaConnect,
  onFigmaDisconnect,
  compact,
}: {
  onFileUpload?: () => void;
  onSelectTool?: (tool: ToolType) => void;
  onSelectDocTool?: (tool: DocToolType) => void;
  onOpenBlankDocEditor?: (type: "word" | "excel" | "ppt") => void;
  onCloseSidebar?: () => void;
  isFigmaConnected?: boolean;
  isFigmaConnecting?: boolean;
  onFigmaConnect?: () => void;
  onFigmaDisconnect?: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground">
            <Plus className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start" side="top">
          <div className="flex flex-col">
            <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={onFileUpload} data-testid="button-upload-files">
              <Upload className="h-4 w-4" />
              Upload Files
            </Button>
            <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={() => onSelectTool?.("web")}>
              <Search className="h-4 w-4" />
              Web Search
            </Button>
            <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={() => onSelectTool?.("image")}>
              <Image className="h-4 w-4" />
              Image Generation
            </Button>
            <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
              <Video className="h-4 w-4" />
              Video Generation
            </Button>
            <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={() => onSelectTool?.("agent")}>
              <Bot className="h-4 w-4" />
              Agente
            </Button>
            <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
              <Plug className="h-4 w-4" />
              Connectors MPC
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground flex-shrink-0 mb-1">
          <Plus className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 p-2">
        <div className="grid gap-1">
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-2 text-sm h-9" 
            onClick={onFileUpload}
            data-testid="button-upload-files"
          >
            <Upload className="h-4 w-4" />
            Subir archivo
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2 text-sm h-9"
            onClick={() => {
              onSelectTool?.("web");
              onCloseSidebar?.();
            }}
          >
            <Globe className="h-4 w-4" />
            Navegar en la web
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2 text-sm h-9"
            onClick={() => {
              onSelectTool?.("image");
              onCloseSidebar?.();
            }}
          >
            <Image className="h-4 w-4" />
            Generar imagen
          </Button>

          <HoverCard openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Button variant="ghost" className="justify-between gap-2 text-sm h-9 w-full">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Crear documento
                </span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" className="w-48 p-2">
              <div className="grid gap-1">
                <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={() => onOpenBlankDocEditor?.("word")} data-testid="button-create-word">
                  <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-600">
                    <span className="text-white text-xs font-bold">W</span>
                  </div>
                  Documento Word
                </Button>
                <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={() => onOpenBlankDocEditor?.("excel")} data-testid="button-create-excel">
                  <div className="flex items-center justify-center w-5 h-5 rounded bg-green-600">
                    <span className="text-white text-xs font-bold">X</span>
                  </div>
                  Hoja Excel
                </Button>
                <Button variant="ghost" className="justify-start gap-2 text-sm h-9" onClick={() => onOpenBlankDocEditor?.("ppt")}>
                  <div className="flex items-center justify-center w-5 h-5 rounded bg-orange-500">
                    <span className="text-white text-xs font-bold">P</span>
                  </div>
                  Presentación PPT
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-2 text-sm h-9"
                  onClick={() => {
                    onSelectDocTool?.("figma");
                    onCloseSidebar?.();
                  }}
                >
                  <div className="flex items-center justify-center w-5 h-5 rounded bg-card border border-border">
                    <svg width="10" height="14" viewBox="0 0 38 57" fill="none">
                      <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
                      <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
                      <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
                      <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
                      <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
                    </svg>
                  </div>
                  Diagrama Figma
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>

          <Button
            variant="ghost"
            className="justify-start gap-2 text-sm h-9"
            onClick={() => {
              onSelectTool?.("agent");
              onCloseSidebar?.();
            }}
          >
            <Bot className="h-4 w-4" />
            Agente
          </Button>

          <HoverCard openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <Button variant="ghost" className="justify-between gap-2 text-sm h-9 w-full">
                <span className="flex items-center gap-2">
                  <Plug className="h-4 w-4" />
                  Conectores
                </span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" className="w-56 p-2">
              <div className="grid gap-1">
                <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-gmail">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center">
                      <svg width="18" height="14" viewBox="0 0 24 18" fill="none">
                        <path d="M1.5 5.25V15.75C1.5 16.1478 1.65804 16.5294 1.93934 16.8107C2.22064 17.092 2.60218 17.25 3 17.25H21C21.3978 17.25 21.7794 17.092 22.0607 16.8107C22.342 16.5294 22.5 16.1478 22.5 15.75V5.25L12 12L1.5 5.25Z" fill="#EA4335" />
                        <path d="M22.5 2.25V5.25L12 12L1.5 5.25V2.25C1.5 1.85218 1.65804 1.47064 1.93934 1.18934C2.22064 0.908035 2.60218 0.75 3 0.75H21C21.3978 0.75 21.7794 0.908035 22.0607 1.18934C22.342 1.47064 22.5 1.85218 22.5 2.25Z" fill="#FBBC05" />
                        <path d="M1.5 5.25L12 12L22.5 5.25" stroke="#34A853" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium">Gmail</span>
                  </div>
                  <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-full">
                    Conectar
                  </Button>
                </div>

                <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-google-drive">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center">
                      <svg width="20" height="18" viewBox="0 0 87.3 78" fill="none">
                        <path d="M6.6 66.85L0.8 56.05L28.7 5.8H57.7L85.6 56.05L79.8 66.85L56.1 25.6H30.4L6.6 66.85Z" fill="#0066DA" />
                        <path d="M29.2 78L44.1 51.2H87.3L72.4 78H29.2Z" fill="#00AC47" />
                        <path d="M0 78L14.9 51.2H29.2L44.1 78H0Z" fill="#EA4335" />
                        <path d="M57.7 5.8L72.6 32.6L87.3 51.2H44.1L29.2 24.4L57.7 5.8Z" fill="#00832D" />
                        <path d="M14.9 51.2L29.2 24.4L44.1 51.2H14.9Z" fill="#2684FC" />
                        <path d="M44.1 51.2L29.2 78H0L14.9 51.2H44.1Z" fill="#FFBA00" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium">Google Drive</span>
                  </div>
                  <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-full">
                    Conectar
                  </Button>
                </div>

                <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-onedrive">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center">
                      <svg width="20" height="14" viewBox="0 0 24 16" fill="none">
                        <path d="M14.5 2C12.5 2 10.7 3.1 9.8 4.8C9.3 4.5 8.7 4.4 8 4.4C5.8 4.4 4 6.2 4 8.4C4 8.6 4 8.8 4.1 9C1.8 9.4 0 11.4 0 13.8C0 16.1 1.9 18 4.2 18H19.5C22 18 24 16 24 13.5C24 11.2 22.3 9.3 20 9C20 5.1 17.6 2 14.5 2Z" fill="#0364B8" />
                        <path d="M9.8 4.8C10.7 3.1 12.5 2 14.5 2C17.6 2 20 5.1 20 9C22.3 9.3 24 11.2 24 13.5C24 16 22 18 19.5 18H10L9.8 4.8Z" fill="#0078D4" />
                        <path d="M8 4.4C8.7 4.4 9.3 4.5 9.8 4.8L10 18H4.2C1.9 18 0 16.1 0 13.8C0 11.4 1.8 9.4 4.1 9C4 8.8 4 8.6 4 8.4C4 6.2 5.8 4.4 8 4.4Z" fill="#1490DF" />
                        <path d="M10 18L9.8 4.8C9.3 4.5 8.7 4.4 8 4.4C5.8 4.4 4 6.2 4 8.4C4 8.6 4 8.8 4.1 9C1.8 9.4 0 11.4 0 13.8C0 16.1 1.9 18 4.2 18H10Z" fill="#28A8EA" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium">OneDrive</span>
                  </div>
                  <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-full">
                    Conectar
                  </Button>
                </div>

                <div className="flex flex-col gap-2 px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-figma">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center">
                        <svg width="14" height="20" viewBox="0 0 38 57" fill="none">
                          <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
                          <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
                          <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
                          <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
                          <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium">Figma</span>
                    </div>
                    {isFigmaConnected ? (
                      <Button size="sm" variant="outline" className="h-7 px-3 text-xs rounded-full" onClick={onFigmaDisconnect}>
                        Desconectar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-full"
                        onClick={onFigmaConnect}
                        disabled={isFigmaConnecting}
                      >
                        {isFigmaConnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Conectar"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Composer({
  input,
  onInputChange,
  uploadedFiles,
  onRemoveFile,
  onSubmit,
  onStopChat,
  aiState,
  textareaRef,
  fileInputRef,
  onFileUpload,
  onPaste,
  placeholder = "Escribe tu mensaje aquí...",
  compact = false,
  selectedDocText,
  onDocTextDeselect,
  selectedDocTool,
  onCloseDocEditor,
  selectedTool,
  onSelectTool,
  onSelectDocTool,
  onOpenBlankDocEditor,
  onToggleBrowser,
  isBrowserOpen,
  isRecording = false,
  isPaused = false,
  recordingTime = 0,
  onDiscardRecording,
  onPauseRecording,
  onResumeRecording,
  onSendRecording,
  onToggleRecording,
  onOpenVoiceChat,
  isFigmaConnected,
  isFigmaConnecting,
  onFigmaConnect,
  onFigmaDisconnect,
  onCloseSidebar,
  isDraggingOver,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onPreviewUploadedImage,
  composerRef,
}: ComposerProps) {
  const filesStillLoading = uploadedFiles.some((f) => f.status === "uploading" || f.status === "processing");
  const hasContent = input.trim().length > 0 || uploadedFiles.length > 0;

  return (
    <div
      ref={composerRef}
      className="sticky bottom-0 w-full max-w-4xl mx-auto px-4 pb-4 pt-2"
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border-2 border-dashed border-primary pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-8 w-8" />
            <span className="text-sm font-medium">Suelta los archivos aquí</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {uploadedFiles.length > 0 && (
          <div className="flex items-center gap-2 pl-2">
            {uploadedFiles.map((file, index) => (
              <FilePreviewInline
                key={file.id || index}
                file={file}
                index={index}
                onRemove={onRemoveFile}
                onPreview={onPreviewUploadedImage}
              />
            ))}
          </div>
        )}

        {selectedDocText && (
          <div className="mb-2 px-1 animate-in fade-in duration-150">
            <div className="bg-teal-50/80 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 rounded-lg px-3 py-1.5 text-sm text-teal-700 dark:text-teal-300 flex items-center gap-2">
              <span className="truncate flex-1">
                {selectedDocText.length > 50 ? selectedDocText.substring(0, 50) + "..." : selectedDocText}
              </span>
              <button onClick={onDocTextDeselect} className="text-teal-500 hover:text-teal-700 flex-shrink-0">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <ToolsPopover
            onFileUpload={() => fileInputRef.current?.click()}
            onSelectTool={onSelectTool}
            onSelectDocTool={onSelectDocTool}
            onOpenBlankDocEditor={onOpenBlankDocEditor}
            onCloseSidebar={onCloseSidebar}
            isFigmaConnected={isFigmaConnected}
            isFigmaConnecting={isFigmaConnecting}
            onFigmaConnect={onFigmaConnect}
            onFigmaDisconnect={onFigmaDisconnect}
            compact={compact}
          />

          <ToolBadge tool={selectedTool ?? null} onClose={() => onSelectTool?.(null)} />
          <DocToolBadge tool={selectedDocTool ?? null} onClose={() => (onCloseDocEditor ? onCloseDocEditor() : onSelectDocTool?.(null))} />

          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !filesStillLoading) {
                e.preventDefault();
                onSubmit();
              }
            }}
            onPaste={onPaste}
            placeholder={placeholder}
            className="min-h-[40px] w-full resize-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 text-base leading-relaxed"
            rows={1}
          />

          <div className="flex items-center gap-1 pb-1">
            {compact ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleRecording}
                  className={cn(
                    "h-9 w-9 rounded-full transition-all duration-300",
                    isRecording ? "bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50" : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="button-voice-recording"
                >
                  {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
                {aiState !== "idle" ? (
                  <Button
                    onClick={onStopChat}
                    size="icon"
                    className="h-10 w-10 rounded-full bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50"
                    data-testid="button-stop-chat"
                  >
                    <Square className="h-5 w-5 fill-current" />
                  </Button>
                ) : (
                  <Button onClick={onSubmit} size="icon" className="h-9 w-9 rounded-full transition-all duration-300 liquid-btn" data-testid="button-send-message">
                    <ArrowUp className="h-5 w-5" />
                  </Button>
                )}
              </>
            ) : (
              <RecordingPanel
                isRecording={isRecording}
                isPaused={isPaused}
                recordingTime={recordingTime}
                canSend={hasContent}
                onDiscard={onDiscardRecording || (() => {})}
                onPause={onPauseRecording || (() => {})}
                onResume={onResumeRecording || (() => {})}
                onSend={onSendRecording || (() => {})}
                onToggleRecording={onToggleRecording || (() => {})}
                onOpenVoiceChat={onOpenVoiceChat || (() => {})}
                onStopChat={onStopChat}
                onSubmit={onSubmit}
                aiState={aiState}
                hasContent={hasContent}
              />
            )}
          </div>
        </div>
      </div>
      <div className="text-center text-xs text-muted-foreground mt-3">MICHAT can make mistakes. Check important info.</div>
    </div>
  );
}
