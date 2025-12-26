import React, { memo, useState, useCallback, useRef } from "react";
import {
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  X,
  RefreshCw,
  Copy,
  Pencil,
  Send,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Volume2,
  VolumeX,
  Flag,
  MessageSquare,
  Download,
  FileText,
  FileSpreadsheet,
  FileIcon,
  Image as ImageIcon,
  Check,
  Maximize2,
  Minimize2,
  ListPlus,
  Minus,
  ArrowUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

import { Message, storeGeneratedImage, getGeneratedImage } from "@/hooks/use-chats";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { FigmaBlock } from "@/components/figma-block";
import { CodeExecutionBlock } from "@/components/code-execution-block";
import { InlineGoogleFormPreview } from "@/components/inline-google-form-preview";
import { InlineGmailPreview } from "@/components/inline-gmail-preview";
import { SuggestedReplies, generateSuggestions } from "@/components/suggested-replies";
import { getFileTheme, getFileCategory } from "@/lib/fileTypeTheme";

const formatMessageTime = (timestamp: Date | undefined): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString('es-ES', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
};

interface DocumentBlock {
  type: "word" | "excel" | "ppt";
  title: string;
  content: string;
}

const extractTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }
  if (React.isValidElement(children)) {
    return extractTextFromChildren((children.props as any)?.children);
  }
  const childArray = React.Children.toArray(children);
  return childArray.map(extractTextFromChildren).join("");
};

const isNumericValue = (text: string): boolean => {
  if (!text || typeof text !== "string") return false;
  const cleaned = text.trim().replace(/[$€£¥%,\s]/g, "");
  return (
    !isNaN(parseFloat(cleaned)) &&
    isFinite(Number(cleaned)) &&
    cleaned.length > 0
  );
};

const CleanDataTableWrapper = ({ children }: { children?: React.ReactNode }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const handleCopy = useCallback(async () => {
    if (!tableRef.current) return;
    const table = tableRef.current.querySelector('table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tr');
    const text = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => cell.textContent?.trim() || '').join('\t');
    }).join('\n');
    
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!tableRef.current) return;
    const table = tableRef.current.querySelector('table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tr');
    const csv = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => {
        const text = cell.textContent?.trim() || '';
        return text.includes(',') ? `"${text}"` : text;
      }).join(',');
    }).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tabla.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div 
      ref={tableRef}
      className={cn(
        "relative group my-4",
        isExpanded && "fixed inset-4 z-50 bg-background rounded-lg border shadow-2xl overflow-auto p-4"
      )}
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title={copied ? "Copiado" : "Copiar tabla"}
          data-testid="button-copy-table"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title="Descargar CSV"
          data-testid="button-download-table"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title={isExpanded ? "Minimizar" : "Expandir"}
          data-testid="button-expand-table"
        >
          {isExpanded ? (
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-border text-sm">
          {children}
        </table>
      </div>
    </div>
  );
};

const CleanDataTableComponents = {
  table: CleanDataTableWrapper,
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="border-b border-border">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    return (
      <th
        scope="col"
        className={cn(
          "px-3 py-2 text-left font-semibold",
          isNumeric && "text-right"
        )}
      >
        {children}
      </th>
    );
  },
  td: ({ children }: { children?: React.ReactNode }) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    const isLong = text.length > 50;
    return (
      <td
        className={cn(
          "px-3 py-2",
          isNumeric && "text-right",
          isLong && "max-w-xs break-words"
        )}
      >
        {children}
      </td>
    );
  }
};

const parseDocumentBlocks = (
  content: string
): { text: string; documents: DocumentBlock[] } => {
  const documents: DocumentBlock[] = [];
  const regex = /```document\s*\n([\s\S]*?)```/g;
  let match;
  let cleanText = content;
  const successfulBlocks: string[] = [];

  while ((match = regex.exec(content)) !== null) {
    try {
      let jsonStr = match[1].trim();
      jsonStr = jsonStr.replace(
        /"content"\s*:\s*"([\s\S]*?)"\s*\}/,
        (m, contentValue) => {
          const fixedContent = contentValue
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
          return `"content": "${fixedContent}"}`;
        }
      );

      const doc = JSON.parse(jsonStr);
      if (doc.type && doc.title && doc.content) {
        doc.content = doc.content
          .replace(/\\n/g, "\n")
          .replace(/\\\\n/g, "\n");
        documents.push(doc as DocumentBlock);
        successfulBlocks.push(match[0]);
      }
    } catch (e) {
      try {
        const blockContent = match[1];
        const typeMatch = blockContent.match(
          /"type"\s*:\s*"(word|excel|ppt)"/
        );
        const titleMatch = blockContent.match(/"title"\s*:\s*"([^"]+)"/);
        const contentMatch = blockContent.match(
          /"content"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/
        );

        if (typeMatch && titleMatch && contentMatch) {
          documents.push({
            type: typeMatch[1] as "word" | "excel" | "ppt",
            title: titleMatch[1],
            content: contentMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\\\n/g, "\n")
          });
          successfulBlocks.push(match[0]);
        }
      } catch (fallbackError) {
        console.error("Fallback parsing also failed:", fallbackError);
      }
    }
  }

  for (const block of successfulBlocks) {
    cleanText = cleanText.replace(block, "").trim();
  }

  return { text: cleanText, documents };
};

const extractCodeBlocks = (
  content: string
): { type: "text" | "python"; content: string }[] => {
  const pythonBlockRegex = /```(?:python|py)\n([\s\S]*?)```/g;
  const blocks: { type: "text" | "python"; content: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pythonBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "text",
        content: content.slice(lastIndex, match.index)
      });
    }
    blocks.push({ type: "python", content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    blocks.push({ type: "text", content: content.slice(lastIndex) });
  }

  return blocks.length > 0 ? blocks : [{ type: "text" as const, content }];
};

interface AttachmentListProps {
  attachments: Message["attachments"];
  variant: "compact" | "default";
  onOpenPreview?: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
}

const AttachmentList = memo(function AttachmentList({
  attachments,
  variant,
  onOpenPreview,
  onReopenDocument
}: AttachmentListProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        variant === "default" && "mb-2 justify-end"
      )}
    >
      {attachments.map((att, i) =>
        att.type === "document" && att.documentType ? (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-card border-border cursor-pointer hover:bg-accent transition-colors"
            )}
            onClick={() => onReopenDocument?.({ 
              type: att.documentType as "word" | "excel" | "ppt", 
              title: att.title || att.name, 
              content: att.content || "" 
            })}
            data-testid={`attachment-document-${i}`}
          >
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg",
                att.documentType === "word" && "bg-blue-600",
                att.documentType === "excel" && "bg-green-600",
                att.documentType === "ppt" && "bg-orange-500"
              )}
            >
              <span className="text-white text-xs font-bold">
                {att.documentType === "word" ? "W" : att.documentType === "excel" ? "E" : "P"}
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="max-w-[200px] truncate font-medium">
                {att.title || att.name}
              </span>
              <span className="text-xs text-muted-foreground">
                Documento guardado - Clic para abrir
              </span>
            </div>
          </div>
        ) : att.type === "image" && att.imageUrl ? (
          <div
            key={i}
            className={cn(
              "relative rounded-xl overflow-hidden border border-border",
              variant === "default" && "max-w-[280px] cursor-pointer hover:opacity-90 transition-opacity"
            )}
            onClick={() => onOpenPreview?.(att)}
            data-testid={`attachment-image-${i}`}
          >
            <img
              src={att.imageUrl}
              alt={att.name}
              className="w-full h-auto max-h-[200px] object-cover"
            />
          </div>
        ) : (
          (() => {
            const attTheme = getFileTheme(att.name, att.mimeType);
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-card border-border",
                  variant === "default" && "cursor-pointer hover:bg-accent transition-colors"
                )}
                onClick={() => onOpenPreview?.(att)}
                data-testid={`attachment-file-${i}`}
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg",
                    attTheme.bgColor
                  )}
                >
                  <span className="text-white text-xs font-bold">
                    {attTheme.icon}
                  </span>
                </div>
                <span className="max-w-[200px] truncate font-medium">
                  {att.name}
                </span>
              </div>
            );
          })()
        )
      )}
    </div>
  );
});

interface ActionToolbarProps {
  messageId: string;
  content: string;
  msgIndex: number;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down">;
  speakingMessageId: string | null;
  aiState: "idle" | "thinking" | "responding";
  isRegenerating: boolean;
  variant: "compact" | "default";
  onCopy: (content: string, id: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRegenerate: (index: number, instruction?: string) => void;
  onShare: (content: string) => void;
  onReadAloud: (id: string, content: string) => void;
}

const ActionToolbar = memo(function ActionToolbar({
  messageId,
  content,
  msgIndex,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  aiState,
  isRegenerating,
  variant,
  onCopy,
  onFeedback,
  onRegenerate,
  onShare,
  onReadAloud
}: ActionToolbarProps) {
  const testIdSuffix = variant === "compact" ? messageId : `main-${messageId}`;
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");

  const handleRegenerateOption = (instruction?: string) => {
    setRegenerateOpen(false);
    setCustomInstruction("");
    onRegenerate(msgIndex, instruction);
  };

  const handleCustomSubmit = () => {
    if (customInstruction.trim()) {
      handleRegenerateOption(customInstruction.trim());
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-0.5"
        data-testid={`message-actions-${testIdSuffix}`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onCopy(content, messageId)}
              data-testid={`button-copy-${testIdSuffix}`}
            >
              {copiedMessageId === messageId ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Copiar respuesta</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7",
                messageFeedback[messageId] === "up"
                  ? "text-green-500"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => onFeedback(messageId, "up")}
              data-testid={`button-like-${testIdSuffix}`}
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Me gusta</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7",
                messageFeedback[messageId] === "down"
                  ? "text-red-500"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => onFeedback(messageId, "down")}
              data-testid={`button-dislike-${testIdSuffix}`}
            >
              <ThumbsDown className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>No me gusta</p>
          </TooltipContent>
        </Tooltip>

        <Popover open={regenerateOpen} onOpenChange={setRegenerateOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={aiState !== "idle"}
                  data-testid={`button-regenerate-${testIdSuffix}`}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isRegenerating && "animate-spin")}
                  />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Regenerar</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent 
            className="w-52 p-1.5 bg-background/95 backdrop-blur-xl border-border/50 shadow-lg" 
            align="start" 
            side="top"
            sideOffset={8}
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 px-1 pb-1 border-b border-border/30 mb-1">
                <input
                  type="text"
                  placeholder="Pedir cambio de respuesta"
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
                  className="flex-1 h-7 px-2 text-[13px] bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
                  data-testid={`input-custom-regenerate-${testIdSuffix}`}
                />
                <button
                  onClick={handleCustomSubmit}
                  disabled={!customInstruction.trim()}
                  className="h-6 w-6 flex items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  data-testid={`button-submit-custom-${testIdSuffix}`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                onClick={() => handleRegenerateOption()}
                data-testid={`option-retry-${testIdSuffix}`}
              >
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span>Inténtalo nuevamente</span>
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                onClick={() => handleRegenerateOption("Agrega más detalles y explicaciones a tu respuesta")}
                data-testid={`option-details-${testIdSuffix}`}
              >
                <ListPlus className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span>Agregar detalles</span>
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                onClick={() => handleRegenerateOption("Hazlo más conciso y breve, elimina redundancias")}
                data-testid={`option-concise-${testIdSuffix}`}
              >
                <Minus className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span>Más concisa</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onShare(content)}
              data-testid={`button-share-${testIdSuffix}`}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Compartir</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  data-testid={`button-more-${testIdSuffix}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Más opciones</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuItem
              onClick={() => onReadAloud(messageId, content)}
              data-testid={`menu-read-aloud-${testIdSuffix}`}
            >
              {speakingMessageId === messageId ? (
                <VolumeX className="h-4 w-4 mr-2" />
              ) : (
                <Volume2 className="h-4 w-4 mr-2" />
              )}
              {speakingMessageId === messageId
                ? "Detener lectura"
                : "Leer en voz alta"}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid={`menu-create-thread-${testIdSuffix}`}>
              <MessageSquare className="h-4 w-4 mr-2" />
              Crear hilo desde aquí
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-500"
              data-testid={`menu-report-${testIdSuffix}`}
            >
              <Flag className="h-4 w-4 mr-2" />
              Reportar mensaje
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
});

interface UserMessageProps {
  message: Message;
  variant: "compact" | "default";
  isEditing: boolean;
  editContent: string;
  copiedMessageId: string | null;
  onEditContentChange: (value: string) => void;
  onCancelEdit: () => void;
  onSendEdit: (id: string) => void;
  onCopyMessage: (content: string, id: string) => void;
  onStartEdit: (msg: Message) => void;
  onOpenPreview?: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
}

const UserMessage = memo(function UserMessage({
  message,
  variant,
  isEditing,
  editContent,
  copiedMessageId,
  onEditContentChange,
  onCancelEdit,
  onSendEdit,
  onCopyMessage,
  onStartEdit,
  onOpenPreview,
  onReopenDocument
}: UserMessageProps) {
  if (variant === "compact") {
    return (
      <div className="bg-primary/10 text-primary-foreground px-3 py-2 rounded-lg max-w-full text-sm">
        <span className="text-muted-foreground mr-1 font-medium">
          Instrucción:
        </span>
        <span className="text-foreground">{message.content}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {isEditing ? (
        <div className="w-full min-w-[300px] max-w-[500px]">
          <Textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            className="w-full px-4 py-3 text-sm min-h-[80px] resize-y rounded-2xl border border-border bg-card focus:border-primary focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
              onClick={onCancelEdit}
            >
              <X className="h-4 w-4 mr-1" />
              Cancelar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => onSendEdit(message.id)}
            >
              <Send className="h-4 w-4 mr-1" />
              Enviar
            </Button>
          </div>
        </div>
      ) : (
        <div className="group">
          <AttachmentList
            attachments={message.attachments}
            variant={variant}
            onOpenPreview={onOpenPreview}
            onReopenDocument={onReopenDocument}
          />
          {message.content && (
            <div className="liquid-message-user px-4 py-2.5 text-sm break-words leading-relaxed">
              {message.content}
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5 mt-2">
            {message.timestamp && (
              <span className="text-[10px] text-muted-foreground/60 mr-1">
                {formatMessageTime(message.timestamp)}
              </span>
            )}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => onCopyMessage(message.content, message.id)}
                data-testid={`button-copy-user-${message.id}`}
              >
                {copiedMessageId === message.id ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => onStartEdit(message)}
                data-testid={`button-edit-user-${message.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

interface AssistantMessageProps {
  message: Message;
  msgIndex: number;
  totalMessages: number;
  variant: "compact" | "default";
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down">;
  speakingMessageId: string | null;
  aiState: "idle" | "thinking" | "responding";
  isRegenerating: boolean;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
  onCopyMessage: (content: string, id: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRegenerate: (index: number) => void;
  onShare: (content: string) => void;
  onReadAloud: (id: string, content: string) => void;
  onOpenDocumentPreview: (doc: DocumentBlock) => void;
  onDownloadImage: (imageData: string) => void;
  onOpenLightbox: (imageData: string) => void;
  onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
  minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
  onRestoreDocument?: () => void;
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  msgIndex,
  totalMessages,
  variant,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  aiState,
  isRegenerating,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  onCopyMessage,
  onFeedback,
  onRegenerate,
  onShare,
  onReadAloud,
  onOpenDocumentPreview,
  onDownloadImage,
  onOpenLightbox,
  onReopenDocument,
  minimizedDocument,
  onRestoreDocument
}: AssistantMessageProps) {
  if (variant === "compact") {
    return (
      <div className="bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg max-w-[90%] text-xs flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        <span>{message.content}</span>
      </div>
    );
  }

  const { text, documents } = parseDocumentBlocks(message.content);
  const contentBlocks = extractCodeBlocks(text || "");

  const msgImage = message.generatedImage;
  const storeImage = getGeneratedImage(message.id);
  const pendingMatch =
    pendingGeneratedImage?.messageId === message.id
      ? pendingGeneratedImage.imageData
      : null;
  const refMatch =
    latestGeneratedImageRef.current?.messageId === message.id
      ? latestGeneratedImageRef.current.imageData
      : null;

  let imageData = msgImage || storeImage || pendingMatch || refMatch;

  if (imageData && !storeImage) {
    storeGeneratedImage(message.id, imageData);
  }

  const showSkeleton =
    isGeneratingImage &&
    message.role === "assistant" &&
    msgIndex === totalMessages - 1 &&
    !imageData;

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      {message.isThinking && message.steps && (
        <div className="rounded-lg border bg-card p-4 space-y-3 w-full animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing Goal
          </div>
          {message.steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-3 text-sm">
              {step.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : step.status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
              )}
              <span
                className={cn(
                  step.status === "pending" && "text-muted-foreground",
                  step.status === "loading" && "text-foreground font-medium",
                  step.status === "complete" &&
                    "text-muted-foreground line-through"
                )}
              >
                {step.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {message.content && !message.isThinking && (
        <>
          {contentBlocks.map((block, blockIdx) =>
            block.type === "python" ? (
              <div key={blockIdx} className="my-2">
                <CodeExecutionBlock
                  code={block.content.trim()}
                  language="python"
                />
              </div>
            ) : block.content.trim() ? (
              <div
                key={blockIdx}
                className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0"
              >
                <MarkdownRenderer
                  content={block.content}
                  customComponents={{ ...CleanDataTableComponents }}
                  onOpenDocument={onOpenDocumentPreview}
                />
              </div>
            ) : null
          )}
          {documents.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-3">
              {documents.map((doc, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  className="flex items-center gap-2 px-4 py-2 h-auto"
                  onClick={() => onOpenDocumentPreview(doc)}
                >
                  {doc.type === "word" && (
                    <FileText className="h-5 w-5 text-blue-600" />
                  )}
                  {doc.type === "excel" && (
                    <FileSpreadsheet className="h-5 w-5 text-green-600" />
                  )}
                  {doc.type === "ppt" && (
                    <FileIcon className="h-5 w-5 text-orange-600" />
                  )}
                  <span className="text-sm font-medium">{doc.title}</span>
                </Button>
              ))}
            </div>
          )}
        </>
      )}

      {showSkeleton && (
        <div className="mt-3">
          <div className="w-64 h-64 rounded-lg animate-pulse bg-gradient-to-br from-muted/80 via-muted to-muted/80 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-muted-foreground/10 animate-pulse" />
            <div className="space-y-2 text-center">
              <div className="h-3 w-32 bg-muted-foreground/10 rounded animate-pulse mx-auto" />
              <div className="h-2 w-24 bg-muted-foreground/10 rounded animate-pulse mx-auto" />
            </div>
          </div>
        </div>
      )}

      {imageData && (
        <div className="mt-3 relative group inline-block">
          <img
            src={imageData}
            alt="Imagen generada"
            className="max-w-full h-auto rounded-lg shadow-md cursor-pointer hover:opacity-95 transition-opacity"
            style={{ maxHeight: "400px" }}
            onClick={() => onOpenLightbox(imageData)}
            data-testid={`generated-image-${message.id}`}
          />
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-black/80 text-white"
            onClick={(e) => {
              e.stopPropagation();
              onDownloadImage(imageData);
            }}
            data-testid={`button-download-image-${message.id}`}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      )}

      {minimizedDocument && minimizedDocument.messageId === message.id && onRestoreDocument && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors group"
          onClick={onRestoreDocument}
          data-testid={`thumbnail-document-${message.id}`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">
                {minimizedDocument.title}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Clic para restaurar documento
              </p>
            </div>
            <Maximize2 className="h-4 w-4 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </motion.div>
      )}

      {message.content && !message.isThinking && (
        <div className="flex items-center gap-3 mt-2">
          {message.timestamp && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatMessageTime(message.timestamp)}
            </span>
          )}
          <ActionToolbar
            messageId={message.id}
            content={message.content}
            msgIndex={msgIndex}
            copiedMessageId={copiedMessageId}
            messageFeedback={messageFeedback}
            speakingMessageId={speakingMessageId}
            aiState={aiState}
            isRegenerating={isRegenerating}
            variant={variant}
            onCopy={onCopyMessage}
            onFeedback={onFeedback}
            onRegenerate={onRegenerate}
            onShare={onShare}
            onReadAloud={onReadAloud}
          />
        </div>
      )}

      {message.figmaDiagram && (
        <div className="mt-3 w-full">
          <FigmaBlock diagram={message.figmaDiagram} />
        </div>
      )}

      {message.googleFormPreview && (
        <div className="mt-3 w-full">
          <InlineGoogleFormPreview
            prompt={message.googleFormPreview.prompt}
            fileContext={message.googleFormPreview.fileContext}
            autoStart={message.googleFormPreview.autoStart}
          />
        </div>
      )}

      {message.gmailPreview && (
        <div className="mt-3 w-full">
          <InlineGmailPreview
            query={message.gmailPreview.query}
            action={message.gmailPreview.action}
            threadId={message.gmailPreview.threadId}
          />
        </div>
      )}

      {message.attachments && message.attachments.some(a => a.type === "document") && (
        <div className="mt-3">
          <AttachmentList
            attachments={message.attachments}
            variant={variant}
            onReopenDocument={onReopenDocument}
          />
        </div>
      )}
    </div>
  );
});

export interface MessageListProps {
  messages: Message[];
  variant: "compact" | "default";
  editingMessageId: string | null;
  editContent: string;
  setEditContent: (value: string) => void;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down">;
  speakingMessageId: string | null;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
  streamingContent: string;
  aiState: "idle" | "thinking" | "responding";
  regeneratingMsgIndex: number | null;
  handleCopyMessage: (content: string, id: string) => void;
  handleStartEdit: (msg: Message) => void;
  handleCancelEdit: () => void;
  handleSendEdit: (id: string) => void;
  handleFeedback: (id: string, type: "up" | "down") => void;
  handleRegenerate: (index: number) => void;
  handleShare: (content: string) => void;
  handleReadAloud: (id: string, content: string) => void;
  handleOpenDocumentPreview: (doc: DocumentBlock) => void;
  handleOpenFileAttachmentPreview: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  handleDownloadImage: (imageData: string) => void;
  setLightboxImage: (imageData: string | null) => void;
  handleReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
  minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
  onRestoreDocument?: () => void;
  onSelectSuggestedReply?: (text: string) => void;
}

export function MessageList({
  messages,
  variant,
  editingMessageId,
  editContent,
  setEditContent,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  streamingContent,
  aiState,
  regeneratingMsgIndex,
  handleCopyMessage,
  handleStartEdit,
  handleCancelEdit,
  handleSendEdit,
  handleFeedback,
  handleRegenerate,
  handleShare,
  handleReadAloud,
  handleOpenDocumentPreview,
  handleOpenFileAttachmentPreview,
  handleDownloadImage,
  setLightboxImage,
  handleReopenDocument,
  minimizedDocument,
  onRestoreDocument,
  onSelectSuggestedReply
}: MessageListProps) {
  const lastAssistantMessage = messages.filter(m => m.role === "assistant").pop();
  const isLastMessageAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";
  const showSuggestedReplies = variant === "default" && aiState === "idle" && isLastMessageAssistant && lastAssistantMessage && !streamingContent;
  const suggestions = showSuggestedReplies ? generateSuggestions(lastAssistantMessage.content) : [];
  return (
    <>
      {messages.map((msg, msgIndex) => (
        <div
          key={msg.id}
          className={cn(
            "flex",
            variant === "compact"
              ? cn(
                  "gap-2 text-sm",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )
              : cn(
                  "w-full max-w-3xl mx-auto gap-4",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-2",
              variant === "default" && "max-w-[85%]",
              msg.role === "user" ? "items-end" : "items-start"
            )}
          >
            {msg.role === "user" ? (
              <UserMessage
                message={msg}
                variant={variant}
                isEditing={editingMessageId === msg.id}
                editContent={editContent}
                copiedMessageId={copiedMessageId}
                onEditContentChange={setEditContent}
                onCancelEdit={handleCancelEdit}
                onSendEdit={handleSendEdit}
                onCopyMessage={handleCopyMessage}
                onStartEdit={handleStartEdit}
                onOpenPreview={handleOpenFileAttachmentPreview}
                onReopenDocument={handleReopenDocument}
              />
            ) : msg.role === "system" && msg.attachments?.some(a => a.type === "document") ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AttachmentList
                  attachments={msg.attachments}
                  variant={variant}
                  onReopenDocument={handleReopenDocument}
                />
              </div>
            ) : (
              <AssistantMessage
                message={msg}
                msgIndex={msgIndex}
                totalMessages={messages.length}
                variant={variant}
                copiedMessageId={copiedMessageId}
                messageFeedback={messageFeedback}
                speakingMessageId={speakingMessageId}
                aiState={aiState}
                isRegenerating={regeneratingMsgIndex === msgIndex}
                isGeneratingImage={isGeneratingImage}
                pendingGeneratedImage={pendingGeneratedImage}
                latestGeneratedImageRef={latestGeneratedImageRef}
                onCopyMessage={handleCopyMessage}
                onFeedback={handleFeedback}
                onRegenerate={handleRegenerate}
                onShare={handleShare}
                onReadAloud={handleReadAloud}
                onOpenDocumentPreview={handleOpenDocumentPreview}
                onDownloadImage={handleDownloadImage}
                onOpenLightbox={setLightboxImage}
                onReopenDocument={handleReopenDocument}
                minimizedDocument={minimizedDocument}
                onRestoreDocument={onRestoreDocument}
              />
            )}
          </div>
        </div>
      ))}

      {streamingContent && variant === "default" && (
        <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
          <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
              <MarkdownRenderer
                content={streamingContent}
                customComponents={{ ...CleanDataTableComponents }}
              />
              <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
            </div>
          </div>
        </div>
      )}

      {showSuggestedReplies && suggestions.length > 0 && onSelectSuggestedReply && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex w-full max-w-3xl mx-auto gap-4 justify-start mt-2"
        >
          <SuggestedReplies
            suggestions={suggestions}
            onSelect={onSelectSuggestedReply}
          />
        </motion.div>
      )}

      {aiState !== "idle" && !streamingContent && variant === "default" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex w-full max-w-3xl mx-auto gap-4 justify-start"
        >
          <div className="flex items-center gap-3 py-3 px-5 text-sm text-muted-foreground bg-gradient-to-r from-muted/40 to-muted/20 rounded-2xl border border-border/30 shadow-sm">
            <div className="flex gap-1.5">
              <motion.span
                className="w-2.5 h-2.5 bg-primary rounded-full"
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5] 
                }}
                transition={{ 
                  duration: 1,
                  repeat: Infinity,
                  delay: 0 
                }}
              />
              <motion.span
                className="w-2.5 h-2.5 bg-primary rounded-full"
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5] 
                }}
                transition={{ 
                  duration: 1,
                  repeat: Infinity,
                  delay: 0.2 
                }}
              />
              <motion.span
                className="w-2.5 h-2.5 bg-primary rounded-full"
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5] 
                }}
                transition={{ 
                  duration: 1,
                  repeat: Infinity,
                  delay: 0.4 
                }}
              />
            </div>
            <span className="font-medium text-foreground/80">
              {aiState === "thinking" ? "Pensando..." : "Escribiendo..."}
            </span>
          </div>
        </motion.div>
      )}
    </>
  );
}

export { CleanDataTableComponents, parseDocumentBlocks };
export type { DocumentBlock };
