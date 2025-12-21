import React, { useState } from "react";
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
  FileText,
  FileSpreadsheet,
  FileIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Message, storeGeneratedImage, getGeneratedImage } from "@/hooks/use-chats";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { FigmaBlock } from "@/components/figma-block";
import { CodeExecutionBlock } from "@/components/code-execution-block";
import { getFileTheme, getFileCategory } from "@/lib/fileTypeTheme";

interface DocumentBlock {
  type: "word" | "excel" | "ppt";
  title: string;
  content: string;
}

interface FileAttachment {
  name: string;
  type: string;
  mimeType?: string;
  imageUrl?: string;
  storagePath?: string;
  fileId?: string;
  content?: string;
}

type AiState = "idle" | "thinking" | "responding";

interface MessageListProps {
  messages: Message[];
  compact?: boolean;
  aiState: AiState;
  streamingContent: string;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.MutableRefObject<{ messageId: string; imageData: string } | null>;
  editingMessageId: string | null;
  editContent: string;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down" | null>;
  speakingMessageId: string | null;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onCopyMessage: (content: string, msgId?: string) => void;
  onStartEdit: (msg: Message) => void;
  onCancelEdit: () => void;
  onSendEdit: (msgId: string) => void;
  onEditContentChange: (content: string) => void;
  onFeedback: (msgId: string, value: "up" | "down") => void;
  onShare: (content: string) => void;
  onReadAloud: (msgId: string, content: string) => void;
  onRegenerate: (msgIndex: number) => void;
  onOpenDocumentPreview: (doc: DocumentBlock) => void;
  onOpenFileAttachmentPreview: (att: FileAttachment) => void;
  CleanDataTableComponents: Record<string, React.ComponentType<any>>;
}

const parseDocumentBlocks = (content: string): { text: string; documents: DocumentBlock[] } => {
  const documents: DocumentBlock[] = [];
  const regex = /```document\s*\n([\s\S]*?)```/g;
  let match;
  let cleanText = content;
  const successfulBlocks: string[] = [];
  
  while ((match = regex.exec(content)) !== null) {
    try {
      let jsonStr = match[1].trim();
      jsonStr = jsonStr.replace(/"content"\s*:\s*"([\s\S]*?)"\s*\}/, (m, contentValue) => {
        const fixedContent = contentValue
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        return `"content": "${fixedContent}"}`;
      });
      
      const doc = JSON.parse(jsonStr);
      if (doc.type && doc.title && doc.content) {
        doc.content = doc.content.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
        documents.push(doc as DocumentBlock);
        successfulBlocks.push(match[0]);
      }
    } catch (e) {
      try {
        const blockContent = match[1];
        const typeMatch = blockContent.match(/"type"\s*:\s*"(word|excel|ppt)"/);
        const titleMatch = blockContent.match(/"title"\s*:\s*"([^"]+)"/);
        const contentMatch = blockContent.match(/"content"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/);
        
        if (typeMatch && titleMatch && contentMatch) {
          documents.push({
            type: typeMatch[1] as "word" | "excel" | "ppt",
            title: titleMatch[1],
            content: contentMatch[1].replace(/\\n/g, '\n').replace(/\\\\n/g, '\n')
          });
          successfulBlocks.push(match[0]);
        }
      } catch (fallbackError) {
        // Silent fallback
      }
    }
  }
  
  for (const block of successfulBlocks) {
    cleanText = cleanText.replace(block, "").trim();
  }
  
  return { text: cleanText, documents };
};

const extractCodeBlocks = (content: string) => {
  const pythonBlockRegex = /```(?:python|py)\n([\s\S]*?)```/g;
  const blocks: { type: 'text' | 'python', content: string }[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = pythonBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    blocks.push({ type: 'python', content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < content.length) {
    blocks.push({ type: 'text', content: content.slice(lastIndex) });
  }
  
  return blocks.length > 0 ? blocks : [{ type: 'text' as const, content }];
};

function UserMessage({
  msg,
  compact,
  editingMessageId,
  editContent,
  copiedMessageId,
  onCopyMessage,
  onStartEdit,
  onCancelEdit,
  onSendEdit,
  onEditContentChange,
  onOpenFileAttachmentPreview
}: {
  msg: Message;
  compact?: boolean;
  editingMessageId: string | null;
  editContent: string;
  copiedMessageId: string | null;
  onCopyMessage: (content: string, msgId?: string) => void;
  onStartEdit: (msg: Message) => void;
  onCancelEdit: () => void;
  onSendEdit: (msgId: string) => void;
  onEditContentChange: (content: string) => void;
  onOpenFileAttachmentPreview: (att: FileAttachment) => void;
}) {
  if (compact) {
    return (
      <div className="bg-primary/10 text-primary-foreground px-3 py-2 rounded-lg max-w-full text-sm">
        <span className="text-muted-foreground mr-1 font-medium">Instrucción:</span>
        <span className="text-foreground">{msg.content}</span>
      </div>
    );
  }

  if (editingMessageId === msg.id) {
    return (
      <div className="w-full min-w-[300px] max-w-[500px]">
        <Textarea
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
          className="w-full px-4 py-3 text-sm min-h-[80px] resize-y rounded-2xl border border-border bg-card focus:border-primary focus:ring-1 focus:ring-primary"
          autoFocus
          data-testid={`textarea-edit-${msg.id}`}
        />
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
            onClick={onCancelEdit}
            data-testid={`button-cancel-edit-${msg.id}`}
          >
            <X className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => onSendEdit(msg.id)}
            data-testid={`button-send-edit-${msg.id}`}
          >
            <Send className="h-4 w-4 mr-1" />
            Enviar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 justify-end">
          {msg.attachments.map((att, i) => (
            att.type === "image" && att.imageUrl ? (
              <div 
                key={i} 
                className="relative max-w-[280px] rounded-xl overflow-hidden border border-border cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => onOpenFileAttachmentPreview(att as FileAttachment)}
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
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-card border-border cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => onOpenFileAttachmentPreview(att as FileAttachment)}
                    data-testid={`attachment-file-${i}`}
                  >
                    <div className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg",
                      attTheme.bgColor
                    )}>
                      <span className="text-white text-xs font-bold">
                        {attTheme.icon}
                      </span>
                    </div>
                    <span className="max-w-[200px] truncate font-medium">{att.name}</span>
                  </div>
                );
              })()
            )
          ))}
        </div>
      )}
      {msg.content && (
        <div className="liquid-message-user px-4 py-2.5 text-sm break-words leading-relaxed">
          {msg.content}
        </div>
      )}
      <div className="flex items-center justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => onCopyMessage(msg.content, msg.id)}
          data-testid={`button-copy-user-${msg.id}`}
        >
          {copiedMessageId === msg.id ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => onStartEdit(msg)}
          data-testid={`button-edit-user-${msg.id}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AIMessage({
  msg,
  msgIndex,
  messages,
  compact,
  aiState,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  onCopyMessage,
  onFeedback,
  onShare,
  onReadAloud,
  onRegenerate,
  onOpenDocumentPreview,
  CleanDataTableComponents
}: {
  msg: Message;
  msgIndex: number;
  messages: Message[];
  compact?: boolean;
  aiState: AiState;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.MutableRefObject<{ messageId: string; imageData: string } | null>;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down" | null>;
  speakingMessageId: string | null;
  onCopyMessage: (content: string, msgId?: string) => void;
  onFeedback: (msgId: string, value: "up" | "down") => void;
  onShare: (content: string) => void;
  onReadAloud: (msgId: string, content: string) => void;
  onRegenerate: (msgIndex: number) => void;
  onOpenDocumentPreview: (doc: DocumentBlock) => void;
  CleanDataTableComponents: Record<string, React.ComponentType<any>>;
}) {
  if (compact) {
    return (
      <div className="bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg max-w-[90%] text-xs flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        <span>{msg.content}</span>
      </div>
    );
  }

  const { text, documents } = parseDocumentBlocks(msg.content);
  const contentBlocks = extractCodeBlocks(text || '');

  const msgImage = msg.generatedImage;
  const storeImage = getGeneratedImage(msg.id);
  const pendingMatch = pendingGeneratedImage?.messageId === msg.id ? pendingGeneratedImage.imageData : null;
  const refMatch = latestGeneratedImageRef.current?.messageId === msg.id ? latestGeneratedImageRef.current.imageData : null;
  let imageData = msgImage || storeImage || pendingMatch || refMatch;
  
  if (imageData && !storeImage) {
    storeGeneratedImage(msg.id, imageData);
  }
  
  const showSkeleton = isGeneratingImage && msg.role === "assistant" && msgIndex === messages.length - 1 && !imageData;

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      {msg.isThinking && msg.steps && (
        <div className="rounded-lg border bg-card p-4 space-y-3 w-full animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing Goal
          </div>
          {msg.steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-3 text-sm">
              {step.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : step.status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
              )}
              <span className={cn(
                step.status === "pending" && "text-muted-foreground",
                step.status === "loading" && "text-foreground font-medium",
                step.status === "complete" && "text-muted-foreground line-through"
              )}>
                {step.title}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {msg.content && !msg.isThinking && (
        <>
          {contentBlocks.map((block, blockIdx) => (
            block.type === 'python' ? (
              <div key={blockIdx} className="px-4">
                <CodeExecutionBlock code={block.content.trim()} language="python" />
              </div>
            ) : block.content.trim() ? (
              <div key={blockIdx} className="px-4 py-3 text-foreground liquid-message-ai-light min-w-0" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", fontSize: "16px", lineHeight: "1.6", fontWeight: 400 }}>
                <MarkdownRenderer
                  content={block.content}
                  customComponents={{...CleanDataTableComponents}}
                />
              </div>
            ) : null
          ))}
          {documents.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-3 px-4">
              {documents.map((doc, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  className="flex items-center gap-2 px-4 py-2 h-auto"
                  onClick={() => onOpenDocumentPreview(doc)}
                  data-testid={`button-preview-doc-${idx}`}
                >
                  {doc.type === "word" && <FileText className="h-5 w-5 text-blue-600" />}
                  {doc.type === "excel" && <FileSpreadsheet className="h-5 w-5 text-green-600" />}
                  {doc.type === "ppt" && <FileIcon className="h-5 w-5 text-orange-600" />}
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-medium">{doc.title}</span>
                    <span className="text-xs text-muted-foreground">
                      Ver {doc.type === "word" ? "Word" : doc.type === "excel" ? "Excel" : "PowerPoint"}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      
      {msg.figmaDiagram && (
        <div className="mt-3 w-full">
          <FigmaBlock diagram={msg.figmaDiagram} />
        </div>
      )}

      {showSkeleton && (
        <div className="mt-3 px-4">
          <div className="w-64 h-64 bg-muted rounded-lg animate-pulse flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      )}
      
      {imageData && !showSkeleton && (
        <div className="mt-3 px-4">
          <img 
            src={imageData} 
            alt="Imagen generada" 
            className="max-w-full h-auto rounded-lg shadow-md"
            style={{ maxHeight: "400px" }}
          />
        </div>
      )}

      {msg.attachments && (
        <div className="flex gap-2 flex-wrap mt-2">
          {msg.attachments.map((file, idx) => {
            const fileTheme = getFileTheme(file.name, file.mimeType);
            const category = getFileCategory(file.name, file.mimeType);
            return (
              <div key={idx} className="flex items-center gap-2 p-3 rounded-xl border bg-card hover:bg-accent/50 cursor-pointer transition-colors group">
                {category === "excel" ? (
                  <FileSpreadsheet className={`h-8 w-8 ${fileTheme.textColor}`} />
                ) : (
                  <FileText className={`h-8 w-8 ${fileTheme.textColor}`} />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium group-hover:text-blue-600 transition-colors">{file.name}</span>
                  <span className="text-xs text-muted-foreground">Click to open</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg.content && !msg.isThinking && (
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-1 mt-2" data-testid={`message-actions-${msg.id}`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => onCopyMessage(msg.content, msg.id)}
                  data-testid={`button-copy-${msg.id}`}
                >
                  {copiedMessageId === msg.id ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Copiar</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", messageFeedback[msg.id] === "up" ? "text-green-500" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => onFeedback(msg.id, "up")}
                  data-testid={`button-like-${msg.id}`}
                >
                  <ThumbsUp className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Me gusta</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", messageFeedback[msg.id] === "down" ? "text-red-500" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => onFeedback(msg.id, "down")}
                  data-testid={`button-dislike-${msg.id}`}
                >
                  <ThumbsDown className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>No me gusta</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => onRegenerate(msgIndex)}
                  disabled={aiState !== "idle"}
                  data-testid={`button-regenerate-${msg.id}`}
                >
                  <RefreshCw className={cn("h-4 w-4", aiState !== "idle" && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Regenerar</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => onShare(msg.content)}
                  data-testid={`button-share-${msg.id}`}
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Compartir</p></TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      data-testid={`button-more-${msg.id}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Más opciones</p></TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" side="bottom">
                <DropdownMenuItem onClick={() => onReadAloud(msg.id, msg.content)} data-testid={`menu-read-aloud-${msg.id}`}>
                  {speakingMessageId === msg.id ? <VolumeX className="h-4 w-4 mr-2" /> : <Volume2 className="h-4 w-4 mr-2" />}
                  {speakingMessageId === msg.id ? "Detener lectura" : "Leer en voz alta"}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid={`menu-create-thread-${msg.id}`}>
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Crear hilo desde aquí
                </DropdownMenuItem>
                <DropdownMenuItem className="text-red-500" data-testid={`menu-report-${msg.id}`}>
                  <Flag className="h-4 w-4 mr-2" />
                  Reportar mensaje
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  compact = false,
  aiState,
  streamingContent,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  editingMessageId,
  editContent,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  messagesEndRef,
  onCopyMessage,
  onStartEdit,
  onCancelEdit,
  onSendEdit,
  onEditContentChange,
  onFeedback,
  onShare,
  onReadAloud,
  onRegenerate,
  onOpenDocumentPreview,
  onOpenFileAttachmentPreview,
  CleanDataTableComponents
}: MessageListProps) {
  return (
    <>
      {messages.map((msg, msgIndex) => (
        <div
          key={msg.id}
          className={cn(
            compact 
              ? "flex gap-2 text-sm" 
              : "flex w-full max-w-3xl mx-auto gap-4",
            msg.role === "user" ? "justify-end" : "justify-start"
          )}
        >
          {compact ? (
            msg.role === "user" ? (
              <UserMessage
                msg={msg}
                compact={true}
                editingMessageId={editingMessageId}
                editContent={editContent}
                copiedMessageId={copiedMessageId}
                onCopyMessage={onCopyMessage}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSendEdit={onSendEdit}
                onEditContentChange={onEditContentChange}
                onOpenFileAttachmentPreview={onOpenFileAttachmentPreview}
              />
            ) : (
              <AIMessage
                msg={msg}
                msgIndex={msgIndex}
                messages={messages}
                compact={true}
                aiState={aiState}
                isGeneratingImage={isGeneratingImage}
                pendingGeneratedImage={pendingGeneratedImage}
                latestGeneratedImageRef={latestGeneratedImageRef}
                copiedMessageId={copiedMessageId}
                messageFeedback={messageFeedback}
                speakingMessageId={speakingMessageId}
                onCopyMessage={onCopyMessage}
                onFeedback={onFeedback}
                onShare={onShare}
                onReadAloud={onReadAloud}
                onRegenerate={onRegenerate}
                onOpenDocumentPreview={onOpenDocumentPreview}
                CleanDataTableComponents={CleanDataTableComponents}
              />
            )
          ) : (
            <div className={cn(
              "flex flex-col gap-2 max-w-[85%]",
              msg.role === "user" ? "items-end" : "items-start"
            )}>
              {msg.role === "user" ? (
                <div className="flex flex-col items-end gap-1">
                  <UserMessage
                    msg={msg}
                    compact={false}
                    editingMessageId={editingMessageId}
                    editContent={editContent}
                    copiedMessageId={copiedMessageId}
                    onCopyMessage={onCopyMessage}
                    onStartEdit={onStartEdit}
                    onCancelEdit={onCancelEdit}
                    onSendEdit={onSendEdit}
                    onEditContentChange={onEditContentChange}
                    onOpenFileAttachmentPreview={onOpenFileAttachmentPreview}
                  />
                </div>
              ) : (
                <AIMessage
                  msg={msg}
                  msgIndex={msgIndex}
                  messages={messages}
                  compact={false}
                  aiState={aiState}
                  isGeneratingImage={isGeneratingImage}
                  pendingGeneratedImage={pendingGeneratedImage}
                  latestGeneratedImageRef={latestGeneratedImageRef}
                  copiedMessageId={copiedMessageId}
                  messageFeedback={messageFeedback}
                  speakingMessageId={speakingMessageId}
                  onCopyMessage={onCopyMessage}
                  onFeedback={onFeedback}
                  onShare={onShare}
                  onReadAloud={onReadAloud}
                  onRegenerate={onRegenerate}
                  onOpenDocumentPreview={onOpenDocumentPreview}
                  CleanDataTableComponents={CleanDataTableComponents}
                />
              )}
            </div>
          )}
        </div>
      ))}
      
      {streamingContent && !compact && (
        <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
          <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
              <MarkdownRenderer
                content={streamingContent}
                customComponents={{...CleanDataTableComponents}}
              />
              <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
            </div>
          </div>
        </div>
      )}
      
      {aiState !== "idle" && !streamingContent && !compact && (
        <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
          <div className="flex items-center gap-3 py-3 px-4 text-sm text-muted-foreground bg-muted/30 rounded-lg">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="font-medium">
              {aiState === "thinking" ? "Pensando..." : "Escribiendo..."}
            </span>
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </>
  );
}
