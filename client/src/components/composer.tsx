import React, { useState } from "react";
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
  ChevronDown,
  X,
  Loader2,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Users,
  Calendar,
  Contact
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { RecordingPanel } from "@/components/recording-panel";
import { VirtualComputer } from "@/components/virtual-computer";
import { getFileTheme } from "@/lib/fileTypeTheme";

interface UploadedFile {
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

interface BrowserSession {
  state: "idle" | "connecting" | "running" | "error";
  cancel: () => void;
}

export interface ComposerProps {
  input: string;
  setInput: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  composerRef: React.RefObject<HTMLDivElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadedFiles: UploadedFile[];
  removeFile: (index: number) => void;
  handleSubmit: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  isDraggingOver: boolean;
  selectedTool: "web" | "agent" | "image" | null;
  setSelectedTool: (tool: "web" | "agent" | "image" | null) => void;
  selectedDocTool: "word" | "excel" | "ppt" | "figma" | null;
  setSelectedDocTool: (tool: "word" | "excel" | "ppt" | "figma" | null) => void;
  closeDocEditor: () => void;
  openBlankDocEditor: (type: "word" | "excel" | "ppt") => void;
  aiState: "idle" | "thinking" | "responding";
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  toggleVoiceRecording: () => void;
  discardVoiceRecording: () => void;
  pauseVoiceRecording: () => void;
  resumeVoiceRecording: () => void;
  sendVoiceRecording: () => void;
  handleStopChat: () => void;
  setIsVoiceChatOpen: (value: boolean) => void;
  browserSession: BrowserSession;
  isBrowserOpen: boolean;
  setIsBrowserOpen: (value: boolean) => void;
  isBrowserMaximized: boolean;
  setIsBrowserMaximized: (value: boolean) => void;
  browserUrl: string;
  variant: "default" | "document";
  placeholder: string;
  selectedDocText?: string;
  handleDocTextDeselect?: () => void;
  onCloseSidebar?: () => void;
  setPreviewUploadedImage?: (value: { name: string; dataUrl: string } | null) => void;
  isFigmaConnected?: boolean;
  isFigmaConnecting?: boolean;
  handleFigmaConnect?: () => void;
  handleFigmaDisconnect?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function Composer({
  input,
  setInput,
  textareaRef,
  composerRef,
  fileInputRef,
  uploadedFiles,
  removeFile,
  handleSubmit,
  handleFileUpload,
  handlePaste,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  isDraggingOver,
  selectedTool,
  setSelectedTool,
  selectedDocTool,
  setSelectedDocTool,
  closeDocEditor,
  openBlankDocEditor,
  aiState,
  isRecording,
  isPaused,
  recordingTime,
  toggleVoiceRecording,
  discardVoiceRecording,
  pauseVoiceRecording,
  resumeVoiceRecording,
  sendVoiceRecording,
  handleStopChat,
  setIsVoiceChatOpen,
  browserSession,
  isBrowserOpen,
  setIsBrowserOpen,
  isBrowserMaximized,
  setIsBrowserMaximized,
  browserUrl,
  variant,
  placeholder,
  selectedDocText,
  handleDocTextDeselect,
  onCloseSidebar,
  setPreviewUploadedImage,
  isFigmaConnected,
  isFigmaConnecting,
  handleFigmaConnect,
  handleFigmaDisconnect,
}: ComposerProps) {
  const isDocumentMode = variant === "document";
  const hasContent = input.trim().length > 0 || uploadedFiles.length > 0;
  
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState({
    github: false,
    teams: true,
    gmail: false,
    box: false,
    outlook: false,
    googleContacts: false,
  });

  const toggleKnowledgeSource = (source: keyof typeof knowledgeSources) => {
    setKnowledgeSources(prev => ({ ...prev, [source]: !prev[source] }));
  };

  const renderAttachmentPreview = () => {
    if (uploadedFiles.length === 0) return null;

    if (isDocumentMode) {
      return (
        <div className="flex flex-wrap gap-2 mb-2 px-1" data-testid="inline-attachments-container">
          {uploadedFiles.map((file, index) => (
            <div
              key={file.id || index}
              className={cn(
                "relative group rounded-lg border overflow-hidden",
                file.status === "error" 
                  ? "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800" 
                  : "bg-card border-border"
              )}
              data-testid={`inline-file-${index}`}
            >
              <button
                className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-0.5 text-white z-10 transition-colors opacity-0 group-hover:opacity-100"
                onClick={() => removeFile(index)}
                data-testid={`button-remove-file-${index}`}
              >
                <X className="h-3 w-3" />
              </button>
              {file.type.startsWith("image/") && file.dataUrl ? (
                <div className="relative w-16 h-16">
                  <img 
                    src={file.dataUrl} 
                    alt={file.name}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  {(file.status === "uploading" || file.status === "processing") && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                  {file.status === "ready" && (
                    <div className="absolute bottom-0 right-0 bg-green-500 rounded-tl-md p-0.5">
                      <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-2 py-1.5 pr-6 max-w-[180px]">
                  <div className={cn(
                    "flex items-center justify-center w-8 h-8 rounded flex-shrink-0",
                    (file.name.toLowerCase().endsWith(".pdf") || file.type.includes("pdf")) ? "bg-red-500" :
                    (file.name.toLowerCase().endsWith(".docx") || file.name.toLowerCase().endsWith(".doc") || file.type.includes("word") || file.type.includes("document") || file.type.includes("wordprocessing")) ? "bg-blue-600" :
                    (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") || file.name.toLowerCase().endsWith(".csv") || file.type.includes("sheet") || file.type.includes("excel") || file.type.includes("spreadsheet")) ? "bg-green-600" :
                    (file.name.toLowerCase().endsWith(".pptx") || file.name.toLowerCase().endsWith(".ppt") || file.type.includes("presentation") || file.type.includes("powerpoint")) ? "bg-orange-500" :
                    "bg-muted-foreground"
                  )}>
                    <span className="text-white text-[10px] font-bold">
                      {(file.name.toLowerCase().endsWith(".pdf") || file.type.includes("pdf")) ? "PDF" :
                       (file.name.toLowerCase().endsWith(".docx") || file.name.toLowerCase().endsWith(".doc") || file.type.includes("word") || file.type.includes("document") || file.type.includes("wordprocessing")) ? "DOC" :
                       (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") || file.name.toLowerCase().endsWith(".csv") || file.type.includes("sheet") || file.type.includes("excel") || file.type.includes("spreadsheet")) ? "XLS" :
                       (file.name.toLowerCase().endsWith(".pptx") || file.name.toLowerCase().endsWith(".ppt") || file.type.includes("presentation") || file.type.includes("powerpoint")) ? "PPT" :
                       "FILE"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block">{file.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {file.status === "uploading" ? "Subiendo..." :
                       file.status === "processing" ? "Procesando..." :
                       file.status === "error" ? "Error" :
                       formatFileSize(file.size)}
                    </span>
                  </div>
                  {(file.status === "uploading" || file.status === "processing") && (
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500 flex-shrink-0" />
                  )}
                  {file.status === "ready" && (
                    <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 pl-2">
        {uploadedFiles.map((file, index) => {
          const theme = getFileTheme(file.name, file.mimeType);
          const isImage = file.type?.startsWith("image/") || file.mimeType?.startsWith("image/");
          
          if (isImage && file.dataUrl) {
            return (
              <div key={file.id} className="relative group">
                <div 
                  className="relative w-14 h-14 rounded-lg overflow-hidden cursor-pointer border border-border hover:border-primary transition-colors"
                  onClick={() => setPreviewUploadedImage?.({ name: file.name, dataUrl: file.dataUrl! })}
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
                  onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                  data-testid={`button-remove-file-${index}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          }
          
          return (
            <TooltipProvider key={file.id}>
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
                    <div className={cn(
                      "flex items-center justify-center w-7 h-7 rounded shrink-0",
                      theme.bgColor
                    )}>
                      {file.status === "uploading" || file.status === "processing" ? (
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      ) : (
                        <span className="text-white text-xs font-bold">
                          {theme.icon}
                        </span>
                      )}
                    </div>
                    <span className="max-w-[100px] truncate font-medium">{file.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                      onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                      data-testid={`button-remove-file-${index}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">{file.name} ({formatFileSize(file.size)})</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    );
  };

  const renderToolsPopover = () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn(
            "h-9 w-9 rounded-full text-muted-foreground hover:text-foreground flex-shrink-0",
            isDocumentMode && "h-10 w-10"
          )}
        >
          <Plus className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-1", isDocumentMode ? "w-48" : "w-56 p-2")} align="start" side="top">
        <div className={cn(isDocumentMode ? "flex flex-col" : "grid gap-1")}>
          {isDocumentMode ? (
            <>
              <Button 
                variant="ghost" 
                className="justify-start gap-2 text-sm h-9"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-files"
              >
                <Upload className="h-4 w-4" />
                Upload Files
              </Button>
              <Button 
                variant="ghost" 
                className="justify-start gap-2 text-sm h-9"
                onClick={() => setIsBrowserOpen(!isBrowserOpen)}
              >
                <Search className="h-4 w-4" />
                Web Search
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
                <Image className="h-4 w-4" />
                Image Generation
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
                <Video className="h-4 w-4" />
                Video Generation
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
                <Bot className="h-4 w-4" />
                Agente
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
                <Plug className="h-4 w-4" />
                Connectors MPC
              </Button>
            </>
          ) : (
            <>
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp"
                  onChange={handleFileUpload}
                />
                <Button variant="ghost" className="w-full justify-start gap-2 text-sm h-9" asChild>
                  <span>
                    <Upload className="h-4 w-4" />
                    Subir archivo
                  </span>
                </Button>
              </label>
              <Button 
                variant="ghost" 
                className="justify-start gap-2 text-sm h-9"
                onClick={() => { setShowKnowledgeBase(true); onCloseSidebar?.(); }}
                data-testid="button-knowledge-base"
              >
                <Users className="h-4 w-4" />
                Conocimientos de la empresa
              </Button>
              <Button 
                variant="ghost" 
                className="justify-start gap-2 text-sm h-9"
                onClick={() => { setSelectedTool("web"); onCloseSidebar?.(); }}
              >
                <Globe className="h-4 w-4" />
                Navegar en la web
              </Button>
              <Button 
                variant="ghost" 
                className="justify-start gap-2 text-sm h-9"
                onClick={() => { setSelectedTool("image"); onCloseSidebar?.(); }}
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
                    <Button 
                      variant="ghost" 
                      className="justify-start gap-2 text-sm h-9"
                      onClick={() => openBlankDocEditor("word")}
                      data-testid="button-create-word"
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-600">
                        <span className="text-white text-xs font-bold">W</span>
                      </div>
                      Documento Word
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="justify-start gap-2 text-sm h-9"
                      onClick={() => openBlankDocEditor("excel")}
                      data-testid="button-create-excel"
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded bg-green-600">
                        <span className="text-white text-xs font-bold">X</span>
                      </div>
                      Hoja Excel
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="justify-start gap-2 text-sm h-9"
                      onClick={() => openBlankDocEditor("ppt")}
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded bg-orange-500">
                        <span className="text-white text-xs font-bold">P</span>
                      </div>
                      Presentación PPT
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="justify-start gap-2 text-sm h-9"
                      onClick={() => { setSelectedDocTool("figma"); onCloseSidebar?.(); }}
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded bg-card border border-border">
                        <svg width="10" height="14" viewBox="0 0 38 57" fill="none">
                          <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
                          <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
                          <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
                          <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
                          <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
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
                onClick={() => { setSelectedTool("agent"); onCloseSidebar?.(); }}
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
                            <path d="M1.5 5.25V15.75C1.5 16.1478 1.65804 16.5294 1.93934 16.8107C2.22064 17.092 2.60218 17.25 3 17.25H21C21.3978 17.25 21.7794 17.092 22.0607 16.8107C22.342 16.5294 22.5 16.1478 22.5 15.75V5.25L12 12L1.5 5.25Z" fill="#EA4335"/>
                            <path d="M22.5 2.25V5.25L12 12L1.5 5.25V2.25C1.5 1.85218 1.65804 1.47064 1.93934 1.18934C2.22064 0.908035 2.60218 0.75 3 0.75H21C21.3978 0.75 21.7794 0.908035 22.0607 1.18934C22.342 1.47064 22.5 1.85218 22.5 2.25Z" fill="#FBBC05"/>
                            <path d="M1.5 5.25L12 12L22.5 5.25" stroke="#34A853" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
                            <path d="M6.6 66.85L0.8 56.05L28.7 5.8H57.7L85.6 56.05L79.8 66.85L56.1 25.6H30.4L6.6 66.85Z" fill="#0066DA"/>
                            <path d="M29.2 78L44.1 51.2H87.3L72.4 78H29.2Z" fill="#00AC47"/>
                            <path d="M0 78L14.9 51.2H29.2L44.1 78H0Z" fill="#EA4335"/>
                            <path d="M57.7 5.8L72.6 32.6L87.3 51.2H44.1L29.2 24.4L57.7 5.8Z" fill="#00832D"/>
                            <path d="M14.9 51.2L29.2 24.4L44.1 51.2H14.9Z" fill="#2684FC"/>
                            <path d="M44.1 51.2L29.2 78H0L14.9 51.2H44.1Z" fill="#FFBA00"/>
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
                            <path d="M14.5 2C12.5 2 10.7 3.1 9.8 4.8C9.3 4.5 8.7 4.4 8 4.4C5.8 4.4 4 6.2 4 8.4C4 8.6 4 8.8 4.1 9C1.8 9.4 0 11.4 0 13.8C0 16.1 1.9 18 4.2 18H19.5C22 18 24 16 24 13.5C24 11.2 22.3 9.3 20 9C20 5.1 17.6 2 14.5 2Z" fill="#0364B8"/>
                            <path d="M9.8 4.8C10.7 3.1 12.5 2 14.5 2C17.6 2 20 5.1 20 9C22.3 9.3 24 11.2 24 13.5C24 16 22 18 19.5 18H10L9.8 4.8Z" fill="#0078D4"/>
                            <path d="M8 4.4C8.7 4.4 9.3 4.5 9.8 4.8L10 18H4.2C1.9 18 0 16.1 0 13.8C0 11.4 1.8 9.4 4.1 9C4 8.8 4 8.6 4 8.4C4 6.2 5.8 4.4 8 4.4Z" fill="#1490DF"/>
                            <path d="M10 18L9.8 4.8C9.3 4.5 8.7 4.4 8 4.4C5.8 4.4 4 6.2 4 8.4C4 8.6 4 8.8 4.1 9C1.8 9.4 0 11.4 0 13.8C0 16.1 1.9 18 4.2 18H10Z" fill="#28A8EA"/>
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
                              <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
                              <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
                              <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
                              <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
                              <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
                            </svg>
                          </div>
                          <span className="text-sm font-medium">Figma</span>
                        </div>
                        {isFigmaConnected ? (
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="h-7 px-3 text-xs rounded-full"
                            onClick={handleFigmaDisconnect}
                          >
                            Desconectar
                          </Button>
                        ) : (
                          <Button 
                            size="sm" 
                            className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-full"
                            onClick={handleFigmaConnect}
                            disabled={isFigmaConnecting}
                          >
                            {isFigmaConnecting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Conectar"
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  const renderSelectedToolLogo = () => {
    if (!selectedTool) return null;

    return (
      <div className="relative group shrink-0">
        <div 
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
            "transition-all duration-500 ease-out",
            "hover:shadow-lg hover:shadow-current/30",
            "before:absolute before:inset-0 before:rounded-xl before:opacity-0 before:transition-opacity before:duration-300",
            "hover:before:opacity-100 before:bg-gradient-to-br before:from-white/20 before:to-transparent",
            "after:absolute after:inset-0 after:rounded-xl after:opacity-0 after:transition-all after:duration-700",
            "hover:after:opacity-100 after:animate-pulse",
            selectedTool === "web" && "bg-gradient-to-br from-cyan-500 to-cyan-700 after:bg-cyan-400/20",
            selectedTool === "agent" && "bg-gradient-to-br from-purple-500 to-purple-700 after:bg-purple-400/20",
            selectedTool === "image" && "bg-gradient-to-br from-pink-500 to-rose-600 after:bg-pink-400/20"
          )}
          style={{ animation: "liquid-float 3s ease-in-out infinite" }}
          data-testid="button-selected-tool"
        >
          {selectedTool === "web" ? (
            <Globe className="h-5 w-5 text-white z-10 drop-shadow-md" />
          ) : selectedTool === "image" ? (
            <Image className="h-5 w-5 text-white z-10 drop-shadow-md" />
          ) : (
            <Bot className="h-5 w-5 text-white z-10 drop-shadow-md" />
          )}
        </div>
        <button
          onClick={() => setSelectedTool(null)}
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
  };

  const renderSelectedDocToolLogo = () => {
    if (!selectedDocTool) return null;

    return (
      <div className="relative group shrink-0">
        <div 
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
            "transition-all duration-500 ease-out",
            "hover:shadow-lg hover:shadow-current/30",
            isDocumentMode ? "" : "before:absolute before:inset-0 before:rounded-xl before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100 before:bg-gradient-to-br before:from-white/20 before:to-transparent after:absolute after:inset-0 after:rounded-xl after:opacity-0 after:transition-all after:duration-700 hover:after:opacity-100 after:animate-pulse",
            selectedDocTool === "word" && "bg-gradient-to-br from-blue-500 to-blue-700",
            selectedDocTool === "excel" && "bg-gradient-to-br from-green-500 to-green-700",
            selectedDocTool === "ppt" && "bg-gradient-to-br from-orange-400 to-orange-600",
            selectedDocTool === "figma" && "bg-gradient-to-br from-purple-500 to-pink-500",
            !isDocumentMode && selectedDocTool === "word" && "after:bg-blue-400/20",
            !isDocumentMode && selectedDocTool === "excel" && "after:bg-green-400/20",
            !isDocumentMode && selectedDocTool === "ppt" && "after:bg-orange-400/20",
            !isDocumentMode && selectedDocTool === "figma" && "after:bg-purple-400/20"
          )}
          style={{ animation: "liquid-float 3s ease-in-out infinite" }}
          data-testid="button-selected-doc-tool"
        >
          {selectedDocTool === "figma" ? (
            <svg width="16" height="24" viewBox="0 0 38 57" fill="none" className="z-10 drop-shadow-md">
              <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
              <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
              <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
              <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
              <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
            </svg>
          ) : (
            <span className="text-white text-base font-bold z-10 drop-shadow-md">
              {selectedDocTool === "word" ? "W" : selectedDocTool === "excel" ? "E" : "P"}
            </span>
          )}
        </div>
        <button
          onClick={isDocumentMode ? closeDocEditor : () => setSelectedDocTool(null)}
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
  };

  const containerClass = isDocumentMode
    ? cn(
        "sticky bottom-0 p-4 sm:p-6 w-full max-w-3xl mx-auto relative bg-background z-10",
        isDraggingOver && "ring-2 ring-primary rounded-2xl"
      )
    : "shrink-0 px-4 pb-4";

  const inputContainerClass = isDocumentMode
    ? "relative flex flex-col rounded-3xl liquid-input-light dark:liquid-input p-2 focus-within:shadow-lg transition-all duration-300"
    : cn(
        "max-w-3xl mx-auto glass-card-light dark:glass-card rounded-2xl border border-white/30 dark:border-white/10 p-3 relative",
        selectedDocText && "ring-2 ring-primary/50",
        isDraggingOver && "ring-2 ring-primary border-primary"
      );

  return (
    <div 
      ref={composerRef}
      className={containerClass}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border-2 border-dashed border-primary pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-8 w-8" />
            <span className="text-sm font-medium">Suelta los archivos aquí</span>
          </div>
        </div>
      )}

      {isDocumentMode && (
        <>
          <div className="absolute left-4 sm:left-6 bottom-[calc(100%+8px)] z-20">
            <VirtualComputer
              state={browserSession.state}
              onCancel={browserSession.cancel}
              compact={true}
            />
          </div>

          {(isBrowserOpen || input.trim().length > 0) && !isBrowserMaximized && (
            <div className="absolute left-4 sm:left-6 bottom-[calc(100%-16px)] w-[120px] border rounded-lg overflow-hidden shadow-lg bg-card z-20 transition-all duration-200">
              <div className="flex items-center justify-between px-1 py-0.5 bg-muted/50 border-b">
                <span className="text-[8px] font-medium text-muted-foreground">Computadora Virtual</span>
                <div className="flex items-center">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-4 w-4 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsBrowserMaximized(true)}
                  >
                    <Maximize2 className="h-2 w-2" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-4 w-4 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsBrowserOpen(false)}
                  >
                    <X className="h-2 w-2" />
                  </Button>
                </div>
              </div>
              <div className="bg-card relative h-[100px]">
                <iframe 
                  src={browserUrl}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  title="Virtual Browser"
                />
                {aiState !== "idle" && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  </div>
                )}
              </div>
            </div>
          )}
          
          {isBrowserMaximized && (
            <div className="fixed inset-4 z-50 border rounded-lg overflow-hidden shadow-lg bg-card">
              <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b">
                <span className="text-xs font-medium text-muted-foreground">Computadora Virtual</span>
                <div className="flex items-center gap-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsBrowserMaximized(false)}
                  >
                    <Minimize2 className="h-3 w-3" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => { setIsBrowserOpen(false); setIsBrowserMaximized(false); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="bg-card relative h-[calc(100%-28px)]">
                <iframe 
                  src={browserUrl}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  title="Virtual Browser"
                />
                {aiState !== "idle" && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        multiple
        accept="*/*"
        data-testid="input-file-upload"
      />

      <div className={inputContainerClass}>
        <div className={isDocumentMode ? "" : "flex flex-col gap-2"}>
          {renderAttachmentPreview()}

          {isDocumentMode && selectedDocText && handleDocTextDeselect && (
            <div className="mb-2 px-1 animate-in fade-in duration-150" data-testid="selected-doc-text-banner">
              <div className="bg-teal-50/80 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 rounded-lg px-3 py-1.5 text-sm text-teal-700 dark:text-teal-300 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                <span className="truncate flex-1" data-testid="selected-doc-text-preview">
                  {selectedDocText.length > 50 ? selectedDocText.substring(0, 50) + '...' : selectedDocText}
                </span>
                <button 
                  onClick={handleDocTextDeselect}
                  className="text-teal-500 hover:text-teal-700 flex-shrink-0 p-0.5 rounded hover:bg-teal-100 dark:hover:bg-teal-800/50 transition-colors"
                  aria-label="Deselect text"
                  data-testid="button-deselect-doc-text"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
          
          <div className="flex flex-col gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                const filesStillLoading = uploadedFiles.some(f => f.status === "uploading" || f.status === "processing");
                if (e.key === "Enter" && !e.shiftKey && !filesStillLoading) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              onPaste={handlePaste}
              placeholder={placeholder}
              className={cn(
                "min-h-[40px] w-full resize-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 text-base",
                !isDocumentMode && "leading-relaxed"
              )}
              rows={1}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {renderToolsPopover()}
                
                {!isDocumentMode && renderSelectedToolLogo()}
                {renderSelectedDocToolLogo()}
                
                {showKnowledgeBase && (
                  <>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300 text-sm" data-testid="knowledge-base-active">
                      <Users className="h-3.5 w-3.5" />
                      <span className="max-w-[120px] truncate">Conocimientos de la e...</span>
                      <button 
                        onClick={() => setShowKnowledgeBase(false)}
                        className="ml-0.5 hover:bg-purple-200 dark:hover:bg-purple-800 rounded-full p-0.5 transition-colors"
                        data-testid="button-close-knowledge-base"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    
                    <Popover>
                      <PopoverTrigger asChild>
                        <button 
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-muted hover:bg-muted/80 border border-border text-sm font-medium transition-colors"
                          data-testid="button-fuentes-dropdown"
                        >
                          <Users className="h-3.5 w-3.5" />
                          <span>Fuentes</span>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-2" data-testid="fuentes-popover">
                        <div className="grid gap-1">
                          <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50">
                            <div className="flex items-center gap-3">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                              </svg>
                              <span className="text-sm font-medium">GitHub</span>
                            </div>
                            <button 
                              onClick={() => toggleKnowledgeSource('github')}
                              className={cn(
                                "w-10 h-6 rounded-full transition-colors relative",
                                knowledgeSources.github ? "bg-primary" : "bg-muted"
                              )}
                              data-testid="toggle-github"
                            >
                              <span className={cn(
                                "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
                                knowledgeSources.github ? "translate-x-5" : "translate-x-1"
                              )} />
                            </button>
                          </div>
                          
                          <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50">
                            <div className="flex items-center gap-3">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                                <path d="M20.625 4.5H3.375C2.96016 4.5 2.625 4.83516 2.625 5.25V18.75C2.625 19.1648 2.96016 19.5 3.375 19.5H20.625C21.0398 19.5 21.375 19.1648 21.375 18.75V5.25C21.375 4.83516 21.0398 4.5 20.625 4.5Z" fill="#5059C9"/>
                                <path d="M12 10.5H21.375V17.625C21.375 18.6605 20.5355 19.5 19.5 19.5H12V10.5Z" fill="#7B83EB"/>
                                <circle cx="16.5" cy="7.5" r="2.25" fill="#7B83EB"/>
                                <circle cx="9" cy="9" r="3" fill="#5059C9"/>
                                <path d="M13.5 12H4.5V18C4.5 18.8284 5.17157 19.5 6 19.5H12C12.8284 19.5 13.5 18.8284 13.5 18V12Z" fill="#7B83EB"/>
                              </svg>
                              <span className="text-sm font-medium">Teams</span>
                            </div>
                            <button 
                              onClick={() => toggleKnowledgeSource('teams')}
                              className={cn(
                                "w-10 h-6 rounded-full transition-colors relative",
                                knowledgeSources.teams ? "bg-primary" : "bg-muted"
                              )}
                              data-testid="toggle-teams"
                            >
                              <span className={cn(
                                "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
                                knowledgeSources.teams ? "translate-x-5" : "translate-x-1"
                              )} />
                            </button>
                          </div>
                          
                          <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50">
                            <div className="flex items-center gap-3">
                              <svg className="h-5 w-5" viewBox="0 0 24 18" fill="none">
                                <path d="M1.5 5.25V15.75C1.5 16.1478 1.65804 16.5294 1.93934 16.8107C2.22064 17.092 2.60218 17.25 3 17.25H21C21.3978 17.25 21.7794 17.092 22.0607 16.8107C22.342 16.5294 22.5 16.1478 22.5 15.75V5.25L12 12L1.5 5.25Z" fill="#EA4335"/>
                                <path d="M22.5 2.25V5.25L12 12L1.5 5.25V2.25C1.5 1.85218 1.65804 1.47064 1.93934 1.18934C2.22064 0.908035 2.60218 0.75 3 0.75H21C21.3978 0.75 21.7794 0.908035 22.0607 1.18934C22.342 1.47064 22.5 1.85218 22.5 2.25Z" fill="#FBBC05"/>
                              </svg>
                              <span className="text-sm font-medium">Gmail</span>
                            </div>
                            <button 
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              data-testid="connect-gmail-source"
                            >
                              Conectar
                            </button>
                          </div>
                          
                          <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50">
                            <div className="flex items-center gap-3">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                                <rect x="2" y="4" width="20" height="16" rx="2" fill="#0061D5"/>
                                <text x="12" y="15" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">box</text>
                              </svg>
                              <span className="text-sm font-medium">Box</span>
                            </div>
                            <button 
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              data-testid="connect-box-source"
                            >
                              Conectar
                            </button>
                          </div>
                          
                          <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50">
                            <div className="flex items-center gap-3">
                              <Calendar className="h-5 w-5 text-blue-500" />
                              <span className="text-sm font-medium truncate max-w-[100px]">Calendario de Outl...</span>
                            </div>
                            <button 
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              data-testid="connect-outlook-source"
                            >
                              Conectar
                            </button>
                          </div>
                          
                          <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50">
                            <div className="flex items-center gap-3">
                              <Contact className="h-5 w-5 text-blue-600" />
                              <span className="text-sm font-medium">Contactos de Google</span>
                            </div>
                            <button 
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              data-testid="connect-google-contacts-source"
                            >
                              Conectar
                            </button>
                          </div>
                          
                          <div className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent/50 cursor-pointer" data-testid="connect-more-sources">
                            <div className="flex items-center justify-center w-5 h-5">
                              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                                <circle cx="4" cy="8" r="1.5" />
                                <circle cx="8" cy="8" r="1.5" />
                                <circle cx="12" cy="8" r="1.5" />
                                <circle cx="4" cy="4" r="1.5" />
                                <circle cx="8" cy="4" r="1.5" />
                                <circle cx="12" cy="4" r="1.5" />
                              </svg>
                            </div>
                            <span className="text-sm font-medium">Conectar más</span>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </>
                )}
              </div>

              <div className={cn("flex items-center gap-1", isDocumentMode ? "pb-1" : "pb-1")}>
                <RecordingPanel
                  isRecording={isRecording}
                  isPaused={isPaused}
                  recordingTime={recordingTime}
                  canSend={hasContent}
                  onDiscard={discardVoiceRecording}
                  onPause={pauseVoiceRecording}
                  onResume={resumeVoiceRecording}
                  onSend={sendVoiceRecording}
                  onToggleRecording={toggleVoiceRecording}
                  onOpenVoiceChat={() => setIsVoiceChatOpen(true)}
                  onStopChat={handleStopChat}
                  onSubmit={handleSubmit}
                  aiState={aiState}
                  hasContent={hasContent}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-muted-foreground mt-3">
        MICHAT can make mistakes. Check important info.
      </div>
    </div>
  );
}
