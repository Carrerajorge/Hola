import React, { useState, useRef, useEffect } from "react";
import { 
  Mic,
  MicOff,
  ArrowUp, 
  Plus, 
  ChevronDown,
  ChevronRight,
  Globe, 
  FileText,
  FileSpreadsheet,
  FileIcon,
  Check,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  PanelLeftOpen,
  X,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
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
  Square,
  Download,
  GripVertical,
  Pause,
  Play,
  Trash2,
  Circle
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Search, Image, Video, Bot, Plug } from "lucide-react";
import { motion } from "framer-motion";

import { Message, FigmaDiagram, storeGeneratedImage, getGeneratedImage } from "@/hooks/use-chats";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useAgent } from "@/hooks/use-agent";
import { useBrowserSession } from "@/hooks/use-browser-session";
import { AgentObserver } from "@/components/agent-observer";
import { VirtualComputer } from "@/components/virtual-computer";
import { DocumentEditor } from "@/components/document-editor";
import { EnhancedDocumentEditor } from "@/components/ribbon";
import { SpreadsheetEditor } from "@/components/spreadsheet-editor";
import { PPTEditorShellLazy } from "@/lib/lazyComponents";
import { usePptStreaming } from "@/hooks/usePptStreaming";
import { PPT_STREAMING_SYSTEM_PROMPT } from "@/lib/pptPrompts";
import { ETLDialog } from "@/components/etl-dialog";
import { FigmaBlock } from "@/components/figma-block";
import { CodeExecutionBlock } from "@/components/code-execution-block";
import { SiraLogo } from "@/components/sira-logo";
import { ShareChatDialog, ShareIcon } from "@/components/share-chat-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { DocumentGeneratorDialog } from "@/components/document-generator-dialog";
import { GoogleFormsDialog } from "@/components/google-forms-dialog";
import { InlineGoogleFormPreview } from "@/components/inline-google-form-preview";
import { detectFormIntent, extractMentionFromPrompt } from "@/lib/formIntentDetector";
import { detectGmailIntent } from "@/lib/gmailIntentDetector";
import { InlineGmailPreview } from "@/components/inline-gmail-preview";
import { VoiceChatMode } from "@/components/voice-chat-mode";
import { RecordingPanel } from "@/components/recording-panel";
import { Composer } from "@/components/composer";
import { MessageList, parseDocumentBlocks, type DocumentBlock } from "@/components/message-list";
import { useAuth } from "@/hooks/use-auth";
import { Database, Sparkles, AudioLines } from "lucide-react";
import { getFileTheme, getFileCategory, FileCategory } from "@/lib/fileTypeTheme";

const extractTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join('');
  }
  if (React.isValidElement(children)) {
    return extractTextFromChildren((children.props as any)?.children);
  }
  const childArray = React.Children.toArray(children);
  return childArray.map(extractTextFromChildren).join('');
};

const isNumericValue = (text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const cleaned = text.trim().replace(/[$€£¥%,\s]/g, '');
  return !isNaN(parseFloat(cleaned)) && isFinite(Number(cleaned)) && cleaned.length > 0;
};

const extractTableData = (children: React.ReactNode): string[][] => {
  const data: string[][] = [];
  const childArray = React.Children.toArray(children);
  childArray.forEach((section: any) => {
    if (section?.props?.children) {
      const rows = React.Children.toArray(section.props.children);
      rows.forEach((row: any) => {
        if (row?.props?.children) {
          const cells = React.Children.toArray(row.props.children);
          const rowData = cells.map((cell: any) => extractTextFromChildren(cell?.props?.children || ''));
          data.push(rowData);
        }
      });
    }
  });
  return data;
};

const downloadTableAsExcel = (children: React.ReactNode) => {
  const data = extractTableData(children);
  if (data.length === 0) return;
  
  let csv = data.map(row => 
    row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tabla_${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const copyTableToClipboard = (children: React.ReactNode) => {
  const data = extractTableData(children);
  if (data.length === 0) return;
  const text = data.map(row => row.join('\t')).join('\n');
  navigator.clipboard.writeText(text);
};

const DataTableWrapper = ({children}: {children?: React.ReactNode}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const childArray = React.Children.toArray(children);
  let colCount = 0;
  childArray.forEach((child: any) => {
    if (child?.props?.children) {
      const rows = React.Children.toArray(child.props.children);
      rows.forEach((row: any) => {
        if (row?.props?.children) {
          const cells = React.Children.toArray(row.props.children);
          colCount = Math.max(colCount, cells.length);
        }
      });
    }
  });
  const minWidth = Math.min(Math.max(colCount * 150, 400), 1400);
  
  const handleCopy = () => {
    copyTableToClipboard(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const renderTable = () => (
    <table className="data-table" style={{ minWidth: `${minWidth}px` }}>
      {children}
    </table>
  );

  return (
    <>
      <div className="table-container group relative my-4">
        <div className="table-actions absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => downloadTableAsExcel(children)}
                className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                data-testid="button-download-excel"
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Descargar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                data-testid="button-fullscreen-table"
              >
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Ampliar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                data-testid="button-copy-table"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copiado" : "Copiar"}</TooltipContent>
          </Tooltip>
        </div>
        <div className="table-wrap">
          {renderTable()}
        </div>
      </div>
      
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">Vista ampliada</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTableAsExcel(children)}
                data-testid="button-download-excel-fullscreen"
              >
                <Download className="h-4 w-4 mr-2" />
                Descargar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsFullscreen(false)}
                data-testid="button-close-fullscreen"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="table-wrap">
              {renderTable()}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CleanDataTableComponents = {
  table: DataTableWrapper,
  thead: ({children}: {children?: React.ReactNode}) => <thead>{children}</thead>,
  tbody: ({children}: {children?: React.ReactNode}) => <tbody>{children}</tbody>,
  tr: ({children}: {children?: React.ReactNode}) => <tr>{children}</tr>,
  th: ({children}: {children?: React.ReactNode}) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    return (
      <th scope="col" className={isNumeric ? "text-right" : ""}>
        {children}
      </th>
    );
  },
  td: ({children}: {children?: React.ReactNode}) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    const isLong = text.length > 50;
    return (
      <td className={`${isNumeric ? "text-right" : ""} ${isLong ? "wrap-cell" : ""}`}>
        {children}
      </td>
    );
  }
};

interface ContentBlock {
  id: number;
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'list' | 'numberedList' | 'blockquote' | 'table' | 'hr';
  content: string;
  raw: string;
}

function parseContentToBlocks(content: string): ContentBlock[] {
  const lines = content.split('\n');
  const blocks: ContentBlock[] = [];
  let currentBlock: string[] = [];
  let blockId = 0;
  
  const flushBlock = (type: ContentBlock['type'], raw: string) => {
    if (raw.trim()) {
      blocks.push({ id: blockId++, type, content: raw.trim(), raw: raw });
    }
  };
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    if (line.startsWith('### ')) {
      flushBlock('heading3', line);
    } else if (line.startsWith('## ')) {
      flushBlock('heading2', line);
    } else if (line.startsWith('# ')) {
      flushBlock('heading1', line);
    } else if (line.startsWith('> ')) {
      let quoteLines = [line];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        quoteLines.push(lines[i]);
      }
      flushBlock('blockquote', quoteLines.join('\n'));
    } else if (line.match(/^[-*] /)) {
      let listLines = [line];
      while (i + 1 < lines.length && lines[i + 1].match(/^[-*] /)) {
        i++;
        listLines.push(lines[i]);
      }
      flushBlock('list', listLines.join('\n'));
    } else if (line.match(/^\d+\. /)) {
      let listLines = [line];
      while (i + 1 < lines.length && lines[i + 1].match(/^\d+\. /)) {
        i++;
        listLines.push(lines[i]);
      }
      flushBlock('numberedList', listLines.join('\n'));
    } else if (line.startsWith('|')) {
      let tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].startsWith('|')) {
        i++;
        tableLines.push(lines[i]);
      }
      flushBlock('table', tableLines.join('\n'));
    } else if (line.match(/^[-*_]{3,}$/)) {
      flushBlock('hr', line);
    } else if (line.trim()) {
      let paraLines = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && 
             !lines[i + 1].startsWith('#') && 
             !lines[i + 1].startsWith('>') && 
             !lines[i + 1].match(/^[-*] /) && 
             !lines[i + 1].match(/^\d+\. /) &&
             !lines[i + 1].startsWith('|') &&
             !lines[i + 1].match(/^[-*_]{3,}$/)) {
        i++;
        paraLines.push(lines[i]);
      }
      flushBlock('paragraph', paraLines.join('\n'));
    }
    i++;
  }
  
  return blocks;
}

interface TextSelection {
  text: string;
  startIndex: number;
  endIndex: number;
}

function EditableDocumentPreview({ 
  content, 
  onChange,
  onSelectionChange
}: { 
  content: string; 
  onChange: (newContent: string) => void;
  onSelectionChange?: (selection: TextSelection | null) => void;
}) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => parseContentToBlocks(content));
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    setBlocks(parseContentToBlocks(content));
  }, [content]);
  
  useEffect(() => {
    if (editingBlockId !== null && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingBlockId]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }
    
    const selectedText = selection.toString();
    if (!selectedText.trim()) {
      return;
    }
    
    const startIndex = content.indexOf(selectedText);
    if (startIndex === -1) {
      const normalizedContent = content.replace(/\s+/g, ' ');
      const normalizedSelection = selectedText.replace(/\s+/g, ' ');
      const normalizedStart = normalizedContent.indexOf(normalizedSelection);
      
      if (normalizedStart !== -1) {
        let charCount = 0;
        let realStart = 0;
        for (let i = 0; i < content.length && charCount < normalizedStart; i++) {
          if (!/\s/.test(content[i]) || (i > 0 && !/\s/.test(content[i-1]))) {
            charCount++;
          }
          realStart = i + 1;
        }
        
        onSelectionChange?.({
          text: selectedText,
          startIndex: realStart,
          endIndex: realStart + selectedText.length
        });
      }
      return;
    }
    
    onSelectionChange?.({
      text: selectedText,
      startIndex,
      endIndex: startIndex + selectedText.length
    });
  };
  
  const handleBlockClick = (block: ContentBlock) => {
    setEditingBlockId(block.id);
    setEditingText(block.raw);
  };
  
  const handleSaveBlock = () => {
    if (editingBlockId === null) return;
    
    const newBlocks = blocks.map(b => 
      b.id === editingBlockId 
        ? { ...b, raw: editingText, content: editingText.trim() }
        : b
    );
    setBlocks(newBlocks);
    
    const newContent = newBlocks.map(b => b.raw).join('\n\n');
    onChange(newContent);
    setEditingBlockId(null);
    setEditingText("");
  };
  
  const renderInlineFormatting = (text: string) => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const italicMatch = remaining.match(/\*(.+?)\*/);
      
      if (boldMatch && boldMatch.index !== undefined) {
        if (boldMatch.index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
        }
        parts.push(<strong key={key++} className="font-bold">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      } else if (italicMatch && italicMatch.index !== undefined && !remaining.startsWith('**')) {
        if (italicMatch.index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, italicMatch.index)}</span>);
        }
        parts.push(<em key={key++} className="italic">{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch.index + italicMatch[0].length);
      } else {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      }
    }
    
    return parts;
  };
  
  const renderBlock = (block: ContentBlock) => {
    const isEditing = editingBlockId === block.id;
    
    if (isEditing) {
      return (
        <div key={block.id} className="relative">
          <textarea
            ref={textareaRef}
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={handleSaveBlock}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingBlockId(null);
                setEditingText("");
              }
            }}
            className="w-full p-3 border-2 border-blue-500 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm font-mono resize-none focus:outline-none"
            style={{ minHeight: Math.max(60, editingText.split('\n').length * 24) }}
            data-testid={`textarea-block-${block.id}`}
          />
          <div className="absolute -top-6 left-0 text-xs text-blue-600 bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded">
            Editando - Click afuera para guardar
          </div>
        </div>
      );
    }
    
    const baseClass = "cursor-pointer transition-all duration-200 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded px-2 py-1 -mx-2 border border-transparent hover:border-teal-200 dark:hover:border-teal-800";
    
    switch (block.type) {
      case 'heading1':
        return (
          <h1 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("text-4xl font-bold mb-6 mt-2 text-teal-700 dark:text-teal-400 italic", baseClass)}
            style={{ fontFamily: 'Georgia, serif' }}
          >
            {block.content.replace(/^# /, '')}
          </h1>
        );
      case 'heading2':
        return (
          <h2 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("text-xl font-bold mb-3 mt-6 text-teal-700 dark:text-teal-400", baseClass)}
          >
            {block.content.replace(/^## /, '')}
          </h2>
        );
      case 'heading3':
        return (
          <h3 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("text-lg font-bold mb-2 mt-4 text-foreground", baseClass)}
          >
            {block.content.replace(/^### /, '')}
          </h3>
        );
      case 'paragraph':
        return (
          <p 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("mb-3 leading-relaxed text-muted-foreground text-sm", baseClass)}
          >
            {renderInlineFormatting(block.content)}
          </p>
        );
      case 'list':
        return (
          <ul 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("list-disc list-inside mb-4 space-y-1", baseClass)}
          >
            {block.content.split('\n').map((item, idx) => (
              <li key={idx} className="text-foreground">
                {renderInlineFormatting(item.replace(/^[-*] /, ''))}
              </li>
            ))}
          </ul>
        );
      case 'numberedList':
        return (
          <ol 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("list-decimal list-inside mb-4 space-y-1", baseClass)}
          >
            {block.content.split('\n').map((item, idx) => (
              <li key={idx} className="text-foreground">
                {renderInlineFormatting(item.replace(/^\d+\. /, ''))}
              </li>
            ))}
          </ol>
        );
      case 'blockquote':
        return (
          <blockquote 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("border-l-4 border-blue-500 pl-4 italic my-4 py-2 bg-muted", baseClass)}
          >
            {block.content.split('\n').map((line, idx) => (
              <p key={idx} className="text-muted-foreground">
                {renderInlineFormatting(line.replace(/^> /, ''))}
              </p>
            ))}
          </blockquote>
        );
      case 'table':
        const rows = block.content.split('\n').filter(r => !r.match(/^\|[-:| ]+\|$/));
        return (
          <div key={block.id} onClick={() => handleBlockClick(block)} className={baseClass}>
            <table className="w-full border-collapse border border-border my-4">
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} className={idx === 0 ? "bg-muted" : ""}>
                    {row.split('|').filter(c => c.trim()).map((cell, cidx) => (
                      idx === 0 ? (
                        <th key={cidx} className="border border-border px-3 py-2 font-semibold text-left">
                          {cell.trim()}
                        </th>
                      ) : (
                        <td key={cidx} className="border border-border px-3 py-2">
                          {cell.trim()}
                        </td>
                      )
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'hr':
        return <hr key={block.id} className="my-6 border-t-2 border-border" />;
      default:
        return (
          <p key={block.id} onClick={() => handleBlockClick(block)} className={cn("mb-4", baseClass)}>
            {block.content}
          </p>
        );
    }
  };
  
  return (
    <div 
      ref={containerRef}
      className="document-preview space-y-1 select-text"
      onMouseUp={handleTextSelection}
      onDoubleClick={handleTextSelection}
    >
      {blocks.length === 0 ? (
        <p className="text-muted-foreground italic">El documento está vacío. Haz clic para agregar contenido.</p>
      ) : (
        blocks.map(renderBlock)
      )}
    </div>
  );
}

interface ActiveGpt {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  temperature: string | null;
  topP: string | null;
  welcomeMessage: string | null;
  conversationStarters: string[] | null;
  avatar: string | null;
  capabilities?: {
    webBrowsing?: boolean;
    codeInterpreter?: boolean;
    imageGeneration?: boolean;
    wordCreation?: boolean;
    excelCreation?: boolean;
    pptCreation?: boolean;
  };
}

type AiState = "idle" | "thinking" | "responding";
type AiProcessStep = { step: string; status: "pending" | "active" | "done" };

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: Message) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onCloseSidebar?: () => void;
  activeGpt?: ActiveGpt | null;
  aiState: AiState;
  setAiState: React.Dispatch<React.SetStateAction<AiState>>;
  aiProcessSteps: AiProcessStep[];
  setAiProcessSteps: React.Dispatch<React.SetStateAction<AiProcessStep[]>>;
  chatId?: string | null;
  onOpenApps?: () => void;
}

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

export function ChatInterface({ 
  messages, 
  onSendMessage, 
  isSidebarOpen = true, 
  onToggleSidebar,
  onCloseSidebar,
  activeGpt,
  aiState,
  setAiState,
  aiProcessSteps,
  setAiProcessSteps,
  chatId,
  onOpenApps
}: ChatInterfaceProps) {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("https://www.google.com");
  const [isBrowserMaximized, setIsBrowserMaximized] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [messageFeedback, setMessageFeedback] = useState<Record<string, "up" | "down" | null>>({});
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DocumentBlock | null>(null);
  const [editedDocumentContent, setEditedDocumentContent] = useState<string>("");
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [editingSelectionText, setEditingSelectionText] = useState<string>("");
  const [originalSelectionText, setOriginalSelectionText] = useState<string>("");
  const [selectedDocText, setSelectedDocText] = useState<string>("");
  const [selectedDocTool, setSelectedDocTool] = useState<"word" | "excel" | "ppt" | "figma" | null>(null);
  const [selectedTool, setSelectedTool] = useState<"web" | "agent" | "image" | null>(null);
  const [activeDocEditor, setActiveDocEditor] = useState<{ type: "word" | "excel" | "ppt"; title: string; content: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isETLDialogOpen, setIsETLDialogOpen] = useState(false);
  const [figmaTokenInput, setFigmaTokenInput] = useState("");
  const [isFigmaConnecting, setIsFigmaConnecting] = useState(false);
  const [isFigmaConnected, setIsFigmaConnected] = useState(false);
  const [showFigmaTokenInput, setShowFigmaTokenInput] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"xai" | "gemini">("gemini");
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3-flash-preview");
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isDocGeneratorOpen, setIsDocGeneratorOpen] = useState(false);
  const [docGeneratorType, setDocGeneratorType] = useState<"word" | "excel">("word");
  const [isGoogleFormsOpen, setIsGoogleFormsOpen] = useState(false);
  const [googleFormsPrompt, setGoogleFormsPrompt] = useState("");
  const [isGoogleFormsActive, setIsGoogleFormsActive] = useState(true);
  const [isGmailActive, setIsGmailActive] = useState(true);
  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [pendingGeneratedImage, setPendingGeneratedImage] = useState<{messageId: string; imageData: string} | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [previewUploadedImage, setPreviewUploadedImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [previewFileAttachment, setPreviewFileAttachment] = useState<{
    name: string;
    type: string;
    mimeType?: string;
    imageUrl?: string;
    storagePath?: string;
    fileId?: string;
    content?: string;
    isLoading?: boolean;
    isProcessing?: boolean;
  } | null>(null);
  const [copiedAttachmentContent, setCopiedAttachmentContent] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const latestGeneratedImageRef = useRef<{messageId: string; imageData: string} | null>(null);
  const dragCounterRef = useRef(0);
  const activeDocEditorRef = useRef<{ type: "word" | "excel" | "ppt"; title: string; content: string } | null>(null);
  
  // PPT streaming integration
  const pptStreaming = usePptStreaming();
  const applyRewriteRef = useRef<((newText: string) => void) | null>(null);
  const docInsertContentRef = useRef<((content: string, replaceMode?: boolean) => void) | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when AI is thinking or streaming
  useEffect(() => {
    if (aiState !== "idle" || streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [aiState, streamingContent, messages.length]);

  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current = null;
      }
    };
  }, []);

  // Recording timer effect
  useEffect(() => {
    if (isRecording && !isPaused) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording, isPaused]);

  // Close file attachment preview on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewFileAttachment) {
        setPreviewFileAttachment(null);
      }
    };
    
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewFileAttachment]);
  
  // Keep ref in sync with state
  useEffect(() => {
    activeDocEditorRef.current = activeDocEditor;
  }, [activeDocEditor]);
  
  // Document editor is now only opened manually by the user clicking the buttons
  // Removed auto-open behavior to prevent unwanted document creation
  
  // Check Figma connection status and handle OAuth callback
  useEffect(() => {
    const checkFigmaStatus = async () => {
      try {
        const response = await fetch("/api/figma/status");
        const data = await response.json();
        setIsFigmaConnected(data.connected);
      } catch (error) {
        console.error("Error checking Figma status:", error);
      }
    };
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('figma_connected') === 'true') {
      setIsFigmaConnected(true);
      setIsFigmaConnecting(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (urlParams.get('figma_error')) {
      setIsFigmaConnecting(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
    
    checkFigmaStatus();
  }, []);
  
  // Figma connection handler - OAuth flow
  const handleFigmaConnect = () => {
    setIsFigmaConnecting(true);
    window.location.href = "/api/auth/figma";
  };
  
  const handleFigmaDisconnect = async () => {
    try {
      await fetch("/api/figma/disconnect", { method: "POST" });
      setIsFigmaConnected(false);
    } catch (error) {
      console.error("Error disconnecting from Figma:", error);
    }
  };
  
  // Function to open blank document editor - preserves existing messages
  const openBlankDocEditor = (type: "word" | "excel" | "ppt") => {
    const titles = {
      word: "Nuevo Documento Word",
      excel: "Nueva Hoja de Cálculo",
      ppt: "Nueva Presentación"
    };
    const templates = {
      word: "<p>Comienza a escribir tu documento aquí...</p>",
      excel: "",
      ppt: "<h1>Título de la Presentación</h1><p>Haz clic para agregar subtítulo</p>"
    };
    
    // Only update document editor state - DO NOT clear messages
    setSelectedDocTool(type);
    setActiveDocEditor({
      type,
      title: titles[type],
      content: templates[type]
    });
    setEditedDocumentContent(templates[type]);
    
    // Close sidebar when opening a document tool
    onCloseSidebar?.();
  };
  
  const closeDocEditor = () => {
    setActiveDocEditor(null);
    setSelectedDocTool(null);
    setEditedDocumentContent("");
    docInsertContentRef.current = null;
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamingContentRef = useRef<string>("");
  const aiStateRef = useRef<"idle" | "thinking" | "responding">("idle");
  const composerRef = useRef<HTMLDivElement>(null);
  
  // Measure composer height and set CSS variable for proper layout
  useEffect(() => {
    const updateComposerHeight = () => {
      if (composerRef.current) {
        const h = composerRef.current.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--composer-height', `${h}px`);
      }
    };
    
    updateComposerHeight();
    window.addEventListener('resize', updateComposerHeight);
    window.addEventListener('orientationchange', updateComposerHeight);
    
    return () => {
      window.removeEventListener('resize', updateComposerHeight);
      window.removeEventListener('orientationchange', updateComposerHeight);
    };
  }, []);
  
  // Keep aiStateRef in sync with aiState for reliable access
  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);
  const agent = useAgent();
  const browserSession = useBrowserSession();

  useEffect(() => {
    if (agent.state.browserSessionId && browserSession.state.sessionId !== agent.state.browserSessionId) {
      browserSession.subscribeToSession(agent.state.browserSessionId, agent.state.objective || "Navegando web");
    }
  }, [agent.state.browserSessionId, agent.state.objective, browserSession.state.sessionId]);

  const handleStopChat = () => {
    // Abort any ongoing fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Clear any streaming interval
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    
    // Clean up PPT streaming if active
    if (pptStreaming.isStreaming) {
      pptStreaming.stopStreaming();
    }
    
    // Save the partial content as a message if there's any (use ref for latest value)
    const currentContent = streamingContentRef.current;
    if (currentContent && currentContent.trim()) {
      const partialMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: currentContent + "\n\n*[Respuesta detenida por el usuario]*",
        timestamp: new Date(),
      };
      onSendMessage(partialMsg);
    } else {
      // If stopped during "thinking" phase (no content yet), show a stopped message
      const stoppedMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "*[Solicitud cancelada por el usuario]*",
        timestamp: new Date(),
      };
      onSendMessage(stoppedMsg);
    }
    
    // Reset states
    streamingContentRef.current = "";
    setAiState("idle");
    setStreamingContent("");
  };

  const handleCopyMessage = (content: string, msgId?: string) => {
    navigator.clipboard.writeText(content);
    if (msgId) {
      setCopiedMessageId(msgId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const startVoiceRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz. Por favor usa Chrome, Edge o Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES';

    let finalTranscript = '';
    let interimTranscript = '';

    recognition.onstart = () => {
      setIsRecording(true);
      setRecordingTime(0);
      setIsPaused(false);
      finalTranscript = input;
    };

    recognition.onresult = (event: any) => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
        } else {
          interimTranscript = transcript;
        }
      }
      setInput(finalTranscript + (interimTranscript ? ' ' + interimTranscript : ''));
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      setRecordingTime(0);
      setIsPaused(false);
      speechRecognitionRef.current = null;
    };

    recognition.onend = () => {
      // Don't auto-reset if paused - user might resume
      if (!isPaused) {
        setIsRecording(false);
        speechRecognitionRef.current = null;
      }
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  };

  const pauseVoiceRecording = () => {
    if (speechRecognitionRef.current && isRecording) {
      speechRecognitionRef.current.stop();
      setIsPaused(true);
    }
  };

  const resumeVoiceRecording = () => {
    if (isPaused) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'es-ES';

      let currentInput = input;

      recognition.onstart = () => {
        setIsPaused(false);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            currentInput += (currentInput ? ' ' : '') + transcript;
          } else {
            interimTranscript = transcript;
          }
        }
        setInput(currentInput + (interimTranscript ? ' ' + interimTranscript : ''));
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        setRecordingTime(0);
        setIsPaused(false);
        speechRecognitionRef.current = null;
      };

      recognition.onend = () => {
        if (!isPaused) {
          setIsRecording(false);
          speechRecognitionRef.current = null;
        }
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    }
  };

  const stopVoiceRecording = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
    setIsPaused(false);
  };

  const discardVoiceRecording = () => {
    stopVoiceRecording();
    setInput("");
  };

  const sendVoiceRecording = () => {
    stopVoiceRecording();
    if (input.trim() || uploadedFiles.length > 0) {
      handleSubmit();
    }
  };

  const handleOpenDocumentPreview = (doc: DocumentBlock) => {
    setPreviewDocument(doc);
    setEditedDocumentContent(doc.content);
  };

  const handleCloseDocumentPreview = () => {
    setPreviewDocument(null);
    setEditedDocumentContent("");
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");
  };

  const handleSelectionChange = (selection: TextSelection | null) => {
    if (selection && selection.text.trim()) {
      setTextSelection(selection);
      setEditingSelectionText(selection.text);
      setOriginalSelectionText(selection.text);
    }
  };

  const handleApplySelectionEdit = () => {
    if (!textSelection || !editedDocumentContent) return;
    
    const before = editedDocumentContent.substring(0, textSelection.startIndex);
    const after = editedDocumentContent.substring(textSelection.endIndex);
    const newContent = before + editingSelectionText + after;
    
    setEditedDocumentContent(newContent);
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");
    
    window.getSelection()?.removeAllRanges();
  };

  const handleCancelSelectionEdit = () => {
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");
    window.getSelection()?.removeAllRanges();
  };

  const handleRevertSelectionEdit = () => {
    setEditingSelectionText(originalSelectionText);
  };

  const handleDocTextSelect = (text: string, applyRewrite: (newText: string) => void) => {
    setSelectedDocText(text);
    applyRewriteRef.current = applyRewrite;
  };

  const handleDocTextDeselect = () => {
    setSelectedDocText("");
    applyRewriteRef.current = null;
  };

  const handleDownloadDocument = async (doc: DocumentBlock) => {
    try {
      const documentToDownload = {
        ...doc,
        content: editedDocumentContent || doc.content
      };
      const response = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentToDownload),
      });
      
      if (!response.ok) {
        throw new Error("Failed to generate document");
      }
      
      const blob = await response.blob();
      const ext = doc.type === "word" ? "docx" : doc.type === "excel" ? "xlsx" : "pptx";
      const filename = `${doc.title.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Document download error:", error);
    }
  };

  const handleDownloadImage = (imageData: string) => {
    const link = document.createElement("a");
    link.href = imageData;
    link.download = `imagen-generada-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenFileAttachmentPreview = async (att: {
    type: string;
    name: string;
    mimeType?: string;
    imageUrl?: string;
    storagePath?: string;
    fileId?: string;
  }) => {
    if (att.type === "image" && att.imageUrl) {
      setLightboxImage(att.imageUrl);
      return;
    }
    
    if (att.type === "image" && att.storagePath) {
      setLightboxImage(att.storagePath);
      return;
    }

    setPreviewFileAttachment({
      ...att,
      isLoading: true,
      isProcessing: false,
      content: undefined,
    });

    if (att.fileId) {
      try {
        const response = await fetch(`/api/files/${att.fileId}/content`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === "ready" && data.content) {
            setPreviewFileAttachment(prev => prev ? {
              ...prev,
              content: data.content,
              isLoading: false,
              isProcessing: false,
            } : null);
            return;
          } else if (data.status === "processing" || data.status === "queued") {
            setPreviewFileAttachment(prev => prev ? {
              ...prev,
              isLoading: false,
              isProcessing: true,
              content: undefined,
            } : null);
            return;
          }
        }
      } catch (error) {
        console.error("Error fetching file content:", error);
      }
    }

    setPreviewFileAttachment(prev => prev ? {
      ...prev,
      isLoading: false,
      isProcessing: false,
      content: "No se pudo cargar el contenido del archivo.",
    } : null);
  };

  const handleCopyAttachmentContent = async () => {
    if (previewFileAttachment?.content) {
      await navigator.clipboard.writeText(previewFileAttachment.content);
      setCopiedAttachmentContent(true);
      setTimeout(() => setCopiedAttachmentContent(false), 2000);
    }
  };

  const handleDownloadFileAttachment = async () => {
    if (!previewFileAttachment?.storagePath) return;
    try {
      const response = await fetch(previewFileAttachment.storagePath);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = previewFileAttachment.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const handleFeedback = (msgId: string, value: "up" | "down") => {
    setMessageFeedback(prev => ({
      ...prev,
      [msgId]: prev[msgId] === value ? null : value
    }));
  };

  const handleShare = async (content: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "MICHAT Response",
          text: content
        });
      } catch (e) {
        navigator.clipboard.writeText(content);
      }
    } else {
      navigator.clipboard.writeText(content);
    }
  };

  const handleReadAloud = (msgId: string, content: string) => {
    if (speakingMessageId === msgId) {
      speechSynthesis.cancel();
      setSpeakingMessageId(null);
    } else {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);
      speechSynthesis.speak(utterance);
      setSpeakingMessageId(msgId);
    }
  };

  const handleRegenerate = async (msgIndex: number) => {
    const prevMessages = messages.slice(0, msgIndex);
    const lastUserMsgIndex = [...prevMessages].reverse().findIndex(m => m.role === "user");
    if (lastUserMsgIndex === -1) return;
    
    const contextUpToUser = prevMessages.slice(0, prevMessages.length - lastUserMsgIndex);
    
    setAiState("thinking");
    streamingContentRef.current = "";
    setStreamingContent("");
    
    try {
      abortControllerRef.current = new AbortController();
      
      const chatHistory = contextUpToUser.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory, provider: selectedProvider, model: selectedModel }),
        signal: abortControllerRef.current.signal
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAiState("responding");
      const fullContent = data.content;
      let currentIndex = 0;
      
      streamIntervalRef.current = setInterval(() => {
        if (currentIndex < fullContent.length) {
          const chunkSize = Math.floor(Math.random() * 3) + 1;
          const newContent = fullContent.slice(0, currentIndex + chunkSize);
          streamingContentRef.current = newContent;
          setStreamingContent(newContent);
          currentIndex += chunkSize;
        } else {
          if (streamIntervalRef.current) {
            clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
          }
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: fullContent,
            timestamp: new Date(),
          };
          onSendMessage(aiMsg);
          streamingContentRef.current = "";
          setStreamingContent("");
          setAiState("idle");
          abortControllerRef.current = null;
        }
      }, 15);
    } catch (error: any) {
      if (error.name === "AbortError") return;
      console.error("Regenerate error:", error);
      setAiState("idle");
      abortControllerRef.current = null;
    }
  };

  const handleStartEdit = (msg: Message) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent("");
  };

  const handleSendEdit = (msgId: string) => {
    if (!editContent.trim()) return;
    const editedMsg: Message = {
      id: msgId,
      role: "user",
      content: editContent,
      timestamp: new Date(),
    };
    onSendMessage(editedMsg);
    setEditingMessageId(null);
    setEditContent("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    await processFilesForUpload(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const pollFileStatus = async (fileId: string, trackingId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    const checkStatus = async () => {
      try {
        const contentRes = await fetch(`/api/files/${fileId}/content`);
        
        if (!contentRes.ok && contentRes.status !== 202) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }
        
        const contentData = await contentRes.json();

        if (contentData.status === "ready") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId 
              ? { ...f, id: fileId, status: "ready", content: contentData.content } 
              : f))
          );
          return;
        } else if (contentData.status === "error") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, status: "error" } : f))
          );
          console.warn(`File ${fileId} processing timed out`);
          return;
        }
        setTimeout(checkStatus, 2000);
      } catch (error) {
        console.error("Error polling file status:", error);
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, status: "error" } : f))
        );
      }
    };

    setTimeout(checkStatus, 2000);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const ALLOWED_TYPES = [
    "text/plain",
    "text/markdown", 
    "text/csv",
    "text/html",
    "application/json",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/tiff",
  ];

  const processFilesForUpload = async (files: File[]) => {
    const validFiles = files.filter(file => 
      ALLOWED_TYPES.includes(file.type) || file.type.startsWith("image/")
    );
    
    if (validFiles.length === 0) return;

    const uploadPromises = validFiles.map(async (file) => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      const isImage = file.type.startsWith("image/");
      
      let dataUrl: string | undefined;
      if (isImage) {
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }
      
      const tempFile: UploadedFile = {
        id: tempId,
        name: file.name,
        type: file.type,
        mimeType: file.type,
        size: file.size,
        status: "uploading",
        dataUrl,
      };
      setUploadedFiles((prev) => [...prev, tempFile]);

      try {
        const urlRes = await fetch("/api/objects/upload", { method: "POST" });
        const { uploadURL, storagePath } = await urlRes.json();
        if (!uploadURL || !storagePath) throw new Error("No upload URL received");

        const uploadRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");

        if (isImage) {
          const registerRes = await fetch("/api/files/quick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, type: file.type, size: file.size, storagePath }),
          });
          const registeredFile = await registerRes.json();
          if (!registerRes.ok) throw new Error(registeredFile.error);
          
          setUploadedFiles((prev) =>
            prev.map((f) => f.id === tempId ? { ...f, id: registeredFile.id, storagePath, status: "ready" } : f)
          );
        } else {
          setUploadedFiles((prev) =>
            prev.map((f) => f.id === tempId ? { ...f, status: "processing" } : f)
          );
          
          const registerRes = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, type: file.type, size: file.size, storagePath }),
          });
          const registeredFile = await registerRes.json();
          if (!registerRes.ok) throw new Error(registeredFile.error);

          setUploadedFiles((prev) =>
            prev.map((f) => f.id === tempId ? { ...f, id: registeredFile.id, storagePath } : f)
          );

          pollFileStatusFast(registeredFile.id, tempId);
        }
      } catch (error) {
        console.error("File upload error:", error);
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === tempId ? { ...f, status: "error" } : f))
        );
      }
    });

    await Promise.all(uploadPromises);
  };
  
  const pollFileStatusFast = async (fileId: string, trackingId: string) => {
    const maxTime = 3000;
    const pollInterval = 200;
    const startTime = Date.now();

    const checkStatus = async (): Promise<void> => {
      if (Date.now() - startTime > maxTime) {
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === fileId || f.id === trackingId 
            ? { ...f, id: fileId, status: "ready", content: "" } 
            : f))
        );
        return;
      }

      try {
        const contentRes = await fetch(`/api/files/${fileId}/content`);
        
        if (!contentRes.ok && contentRes.status !== 202) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }
        
        const contentData = await contentRes.json();

        if (contentData.status === "ready") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId 
              ? { ...f, id: fileId, status: "ready", content: contentData.content } 
              : f))
          );
          return;
        } else if (contentData.status === "error") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }

        setTimeout(checkStatus, pollInterval);
      } catch (error) {
        console.error("Polling error:", error);
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === fileId || f.id === trackingId 
            ? { ...f, id: fileId, status: "ready", content: "" } 
            : f))
        );
      }
    };

    checkStatus();
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToUpload: File[] = [];

    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const mimeType = file.type || item.type || "image/png";
          const ext = mimeType.split("/")[1] || "png";
          const fileName = file.name && file.name !== "image.png" && file.name !== "" 
            ? file.name 
            : `pasted-${Date.now()}.${ext}`;
          const renamedFile = new File([file], fileName, { type: mimeType });
          filesToUpload.push(renamedFile);
        }
      }
    }

    if (filesToUpload.length > 0) {
      e.preventDefault();
      await processFilesForUpload(filesToUpload);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    await processFilesForUpload(Array.from(files));
  };

  const getFileIcon = (type: string, fileName?: string) => {
    const theme = getFileTheme(fileName, type);
    const category = getFileCategory(fileName, type);
    
    if (category === "excel") {
      return <FileSpreadsheet className={`h-4 w-4 ${theme.textColor}`} />;
    }
    if (category === "image") {
      return <Image className={`h-4 w-4 ${theme.textColor}`} />;
    }
    return <FileText className={`h-4 w-4 ${theme.textColor}`} />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  const handleSubmit = async () => {
    // Don't submit if files are still uploading/processing
    const filesStillLoading = uploadedFiles.some(f => f.status === "uploading" || f.status === "processing");
    if (filesStillLoading) return;
    
    if (!input.trim() && uploadedFiles.length === 0) return;

    // If there's selected text from document, rewrite it
    if (selectedDocText && applyRewriteRef.current && input.trim()) {
      const rewritePrompt = input.trim();
      setInput("");
      setAiState("thinking");
      
      try {
        abortControllerRef.current = new AbortController();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            messages: [{
              role: "user",
              content: `Reescribe el siguiente texto según esta instrucción: "${rewritePrompt}"\n\nTexto original:\n${selectedDocText}\n\nDevuelve SOLO el texto reescrito, sin explicaciones ni comentarios adicionales.`
            }],
            provider: selectedProvider,
            model: selectedModel
          }),
          signal: abortControllerRef.current.signal
        });

        const data = await response.json();
        if (response.ok && data.content) {
          applyRewriteRef.current(data.content.trim());
        }
        
        setSelectedDocText("");
        applyRewriteRef.current = null;
        setAiState("idle");
        abortControllerRef.current = null;
        return;
      } catch (error: any) {
        if (error.name !== "AbortError") {
          console.error("Rewrite error:", error);
        }
        setAiState("idle");
        abortControllerRef.current = null;
        return;
      }
    }

    const attachments = uploadedFiles
      .filter(f => f.status === "ready" || f.status === "processing")
      .map(f => ({
        type: f.type.startsWith("image/") ? "image" as const :
              f.type.includes("word") || f.type.includes("document") ? "word" as const :
              f.type.includes("sheet") || f.type.includes("excel") ? "excel" as const :
              f.type.includes("presentation") || f.type.includes("powerpoint") ? "ppt" as const :
              "word" as const,
        name: f.name,
        imageUrl: f.dataUrl,
        storagePath: f.storagePath,
        fileId: f.id,
      }));
    
    // Set thinking state FIRST to show stop button immediately
    setAiState("thinking");
    streamingContentRef.current = "";
    setStreamingContent("");
    
    const userInput = input;
    const currentFiles = [...uploadedFiles];
    
    // Initialize process steps based on context
    const hasFiles = currentFiles.length > 0;
    const initialSteps: {step: string; status: "pending" | "active" | "done"}[] = [];
    if (hasFiles) {
      initialSteps.push({ step: "Analizando archivos adjuntos", status: "active" });
    }
    initialSteps.push({ step: "Procesando tu mensaje", status: hasFiles ? "pending" : "active" });
    initialSteps.push({ step: "Buscando información relevante", status: "pending" });
    initialSteps.push({ step: "Generando respuesta", status: "pending" });
    setAiProcessSteps(initialSteps);
    setInput("");
    setUploadedFiles([]);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userInput,
      timestamp: new Date(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    onSendMessage(userMsg);

    // Check for Google Forms intent
    const { hasMention, cleanPrompt } = extractMentionFromPrompt(userInput);
    const formIntent = detectFormIntent(cleanPrompt, isGoogleFormsActive, hasMention);
    
    if (formIntent.hasFormIntent && formIntent.confidence !== 'low') {
      // Create file context from uploaded files
      const fileContext = currentFiles
        .filter(f => f.content && f.status === "ready")
        .map(f => ({
          name: f.name,
          content: f.content || "",
          type: f.type
        }));
      
      // Create assistant message with inline form preview
      const formPreviewMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Creando formulario en base a tu solicitud...",
        timestamp: new Date(),
        googleFormPreview: {
          prompt: cleanPrompt,
          fileContext: fileContext.length > 0 ? fileContext : undefined,
          autoStart: true
        }
      };
      
      onSendMessage(formPreviewMsg);
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }

    // Check for Gmail intent
    const hasGmailMention = userInput.toLowerCase().includes('@gmail');
    const gmailIntent = detectGmailIntent(cleanPrompt, isGmailActive, hasGmailMention);
    
    if (gmailIntent.hasGmailIntent && gmailIntent.confidence !== 'low') {
      const gmailPreviewMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Buscando en tu correo electrónico...",
        timestamp: new Date(),
        gmailPreview: {
          query: gmailIntent.searchQuery || cleanPrompt,
          action: gmailIntent.suggestedAction === 'search' || gmailIntent.suggestedAction === 'list' 
            ? 'search' 
            : gmailIntent.suggestedAction === 'read' 
              ? 'recent' 
              : 'recent',
          filters: gmailIntent.filters
        }
      };
      
      onSendMessage(gmailPreviewMsg);
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }

    try {
      abortControllerRef.current = new AbortController();
      
      // Check if this is an image generation request (manual tool selection or auto-detect)
      const isImageTool = selectedTool === "image";
      let shouldGenerateImage = isImageTool;
      
      // Auto-detect image requests if no tool is selected (also skip if doc tool like Figma is selected)
      if (!isImageTool && !selectedTool && !selectedDocTool) {
        try {
          const detectRes = await fetch("/api/image/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userInput })
          });
          const detectData = await detectRes.json();
          shouldGenerateImage = detectData.isImageRequest;
        } catch (e) {
          console.error("Image detection error:", e);
        }
      }
      
      // Generate image if needed
      if (shouldGenerateImage) {
        setIsGeneratingImage(true);
        setAiProcessSteps([
          { step: "Analizando tu petición", status: "done" },
          { step: "Generando imagen con IA", status: "active" },
          { step: "Procesando resultado", status: "pending" }
        ]);
        
        try {
          const imageRes = await fetch("/api/image/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: userInput }),
            signal: abortControllerRef.current.signal
          });
          
          const imageData = await imageRes.json();
          
          if (imageRes.ok && imageData.success) {
            setAiProcessSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
            
            const msgId = (Date.now() + 1).toString();
            
            // Store image in separate memory store to prevent loss during localStorage sync
            storeGeneratedImage(msgId, imageData.imageData);
            
            // Save generated image to user's library (fire and forget)
            if (user) {
              fetch("/api/library", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  mediaType: "image",
                  title: `Imagen generada - ${new Date().toLocaleDateString('es-ES')}`,
                  description: userInput.slice(0, 200),
                  storagePath: imageData.imageData,
                  mimeType: "image/png",
                  sourceChatId: chatId || null,
                  metadata: { prompt: userInput }
                })
              }).catch(err => console.error("Failed to save image to library:", err));
            }
            
            // Also store in local component state and ref for persistence across remounts
            const pendingImage = { messageId: msgId, imageData: imageData.imageData };
            setPendingGeneratedImage(pendingImage);
            latestGeneratedImageRef.current = pendingImage;
            
            const aiMsg: Message = {
              id: msgId,
              role: "assistant",
              content: "Aquí está la imagen que generé basada en tu descripción:",
              generatedImage: imageData.imageData,
              timestamp: new Date(),
            };
            onSendMessage(aiMsg);
            
            setIsGeneratingImage(false);
            setAiState("idle");
            setAiProcessSteps([]);
            setSelectedTool(null);
            abortControllerRef.current = null;
            return;
          } else {
            throw new Error(imageData.error || "Error al generar imagen");
          }
        } catch (imgError: any) {
          setIsGeneratingImage(false);
          if (imgError.name === "AbortError") {
            setAiState("idle");
            setAiProcessSteps([]);
            abortControllerRef.current = null;
            return;
          }
          // If image generation fails, continue with normal chat to explain
          console.error("Image generation failed:", imgError);
        }
      }
      
      const fileContents = currentFiles
        .filter(f => f.content && f.status === "ready")
        .map(f => `[ARCHIVO ADJUNTO: "${f.name}"]\n${f.content}\n[FIN DEL ARCHIVO]`)
        .join("\n\n");
      
      const messageWithFiles = fileContents 
        ? `${fileContents}\n\n[SOLICITUD DEL USUARIO]: ${userInput}`
        : userInput;

      const chatHistory = [...messages, { ...userMsg, content: messageWithFiles }].map(m => ({
        role: m.role,
        content: m.content
      }));

      // Extract image data URLs from current files
      const imageDataUrls = currentFiles
        .filter(f => f.type.startsWith("image/") && f.dataUrl)
        .map(f => f.dataUrl as string);

      // Determine if we're in document mode for special AI behavior
      const isDocumentMode = !!activeDocEditorRef.current;
      const documentType = activeDocEditorRef.current?.type || null;
      const isFigmaMode = selectedDocTool === "figma";
      const isPptMode = documentType === "ppt";
      
      // Build chat history with PPT system prompt if in PPT mode
      const finalChatHistory = isPptMode 
        ? [{ role: "system", content: PPT_STREAMING_SYSTEM_PROMPT }, ...chatHistory]
        : chatHistory;
      
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: finalChatHistory,
          images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
          documentMode: isDocumentMode && !isPptMode ? { type: documentType } : undefined,
          figmaMode: isFigmaMode,
          pptMode: isPptMode,
          provider: selectedProvider,
          model: selectedModel,
          gptConfig: activeGpt ? {
            id: activeGpt.id,
            systemPrompt: activeGpt.systemPrompt,
            temperature: parseFloat(activeGpt.temperature || "0.7"),
            topP: parseFloat(activeGpt.topP || "1")
          } : undefined
        }),
        signal: abortControllerRef.current?.signal
      });

      // Update steps: mark processing done, searching active
      setAiProcessSteps(prev => prev.map((s, i) => {
        if (s.step.includes("Analizando")) return { ...s, status: "done" };
        if (s.step.includes("Procesando")) return { ...s, status: "done" };
        if (s.step.includes("Buscando")) return { ...s, status: "active" };
        return s;
      }));
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }
      
      // Update steps: mark searching done, generating active
      setAiProcessSteps(prev => prev.map(s => {
        if (s.step.includes("Buscando")) return { ...s, status: "done" };
        if (s.step.includes("Generando")) return { ...s, status: "active" };
        return { ...s, status: s.status === "pending" ? "pending" : "done" };
      }));

      // Note: Not subscribing to agent/browser updates to keep simple thinking → streaming flow

      // Capture document mode state NOW using ref (avoids closure issues)
      const shouldWriteToDoc = !!activeDocEditorRef.current;
      
      const fullContent = data.content;
      const responseSources = data.sources || [];
      const figmaDiagram = data.figmaDiagram as FigmaDiagram | undefined;
      
      // If Figma diagram was generated, add it to chat immediately
      if (figmaDiagram) {
        setAiState("responding");
        
        // Quick streaming effect for the text part
        let currentIndex = 0;
        streamIntervalRef.current = setInterval(() => {
          if (currentIndex < fullContent.length) {
            const chunkSize = Math.floor(Math.random() * 5) + 3;
            currentIndex = Math.min(currentIndex + chunkSize, fullContent.length);
            streamingContentRef.current = fullContent.slice(0, currentIndex);
            setStreamingContent(fullContent.slice(0, currentIndex));
          } else {
            if (streamIntervalRef.current) {
              clearInterval(streamIntervalRef.current);
              streamIntervalRef.current = null;
            }
            
            const aiMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: fullContent,
              timestamp: new Date(),
              figmaDiagram,
            };
            onSendMessage(aiMsg);
            
            streamingContentRef.current = "";
            setStreamingContent("");
            setAiState("idle");
            setAiProcessSteps([]);
            setSelectedDocTool(null); // Reset tool selection
            agent.complete();
            abortControllerRef.current = null;
          }
        }, 10);
        return;
      }
      
      // If PPT mode is active: Stream to PPT editor using special parser
      if (isPptMode && shouldWriteToDoc) {
        setAiState("responding");
        
        // Clear chat streaming - we write to PPT canvas
        streamingContentRef.current = "";
        setStreamingContent("");
        
        // Start PPT streaming
        pptStreaming.startStreaming();
        
        // Stream content progressively through PPT parser
        let currentIndex = 0;
        
        streamIntervalRef.current = setInterval(() => {
          if (currentIndex < fullContent.length) {
            // Get progressive chunk
            const chunkSize = Math.floor(Math.random() * 8) + 4;
            const newChunk = fullContent.slice(currentIndex, currentIndex + chunkSize);
            currentIndex += chunkSize;
            
            // Route chunk through PPT stream parser
            pptStreaming.processChunk(newChunk);
          } else {
            if (streamIntervalRef.current) {
              clearInterval(streamIntervalRef.current);
              streamIntervalRef.current = null;
            }
            
            // Finalize PPT streaming
            pptStreaming.stopStreaming();
            
            // Add confirmation message in chat
            const confirmMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "✓ Presentación generada correctamente",
              timestamp: new Date(),
            };
            onSendMessage(confirmMsg);
            
            setAiState("idle");
            setAiProcessSteps([]);
            agent.complete();
            abortControllerRef.current = null;
          }
        }, 20);
        return;
      }
      
      // If document mode is active: Stream DIRECTLY to document editor in real-time
      if (shouldWriteToDoc && docInsertContentRef.current) {
        setAiState("responding");
        
        // Clear chat streaming - we write directly to document
        streamingContentRef.current = "";
        setStreamingContent("");
        
        // Stream content progressively to document editor
        let currentIndex = 0;
        
        streamIntervalRef.current = setInterval(() => {
          if (currentIndex < fullContent.length) {
            // Get progressive chunk - larger chunks for smoother document typing
            const chunkSize = Math.floor(Math.random() * 15) + 8;
            currentIndex = Math.min(currentIndex + chunkSize, fullContent.length);
            const contentSoFar = fullContent.slice(0, currentIndex);
            
            // Replace entire document content with progressively more content
            // This ensures markdown renders correctly at each step
            try {
              if (docInsertContentRef.current) {
                docInsertContentRef.current(contentSoFar, true); // replaceMode = true
              }
            } catch (err) {
              console.error('[ChatInterface] Error streaming to document:', err);
            }
          } else {
            if (streamIntervalRef.current) {
              clearInterval(streamIntervalRef.current);
              streamIntervalRef.current = null;
            }
            
            // Final write with complete content to ensure nothing is missed
            try {
              if (docInsertContentRef.current) {
                docInsertContentRef.current(fullContent, true);
              }
            } catch (err) {
              console.error('[ChatInterface] Error finalizing document:', err);
            }
            
            // Add confirmation message in chat
            const confirmMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "✓ Documento generado correctamente",
              timestamp: new Date(),
            };
            onSendMessage(confirmMsg);
            
            setAiState("idle");
            setAiProcessSteps([]);
            agent.complete();
            abortControllerRef.current = null;
          }
        }, 25);
      } else {
        // Normal chat mode - stream to chat interface
        setAiState("responding");
        let currentIndex = 0;
        
        streamIntervalRef.current = setInterval(() => {
          if (currentIndex < fullContent.length) {
            const chunkSize = Math.floor(Math.random() * 3) + 1;
            const newContent = fullContent.slice(0, currentIndex + chunkSize);
            streamingContentRef.current = newContent;
            setStreamingContent(newContent);
            currentIndex += chunkSize;
          } else {
            if (streamIntervalRef.current) {
              clearInterval(streamIntervalRef.current);
              streamIntervalRef.current = null;
            }
            
            const aiMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: fullContent,
              timestamp: new Date(),
              sources: responseSources.length > 0 ? responseSources : undefined,
            };
            onSendMessage(aiMsg);
            
            streamingContentRef.current = "";
            setStreamingContent("");
            setAiState("idle");
            setAiProcessSteps([]);
            agent.complete();
            abortControllerRef.current = null;
          }
        }, 15);
      }
      
    } catch (error: any) {
      // Clean up PPT streaming on any error
      if (pptStreaming.isStreaming) {
        pptStreaming.stopStreaming();
      }
      
      if (error.name === "AbortError") {
        return;
      }
      console.error("Chat error:", error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Lo siento, hubo un error al procesar tu mensaje. Por favor intenta de nuevo.`,
        timestamp: new Date(),
      };
      onSendMessage(errorMsg);
      setAiState("idle");
      setAiProcessSteps([]);
      abortControllerRef.current = null;
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col bg-transparent relative">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-2 sm:px-4 border-b border-white/20 dark:border-white/10 glass-card-light dark:glass-card rounded-none z-10 sticky top-0 flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-1 sm:gap-2 relative min-w-0">
          <div 
            className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors"
            onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
            data-testid="button-model-selector"
          >
            <span className="font-semibold text-xs sm:text-sm truncate max-w-[80px] sm:max-w-none">
              {selectedProvider === "xai" ? "xAI" : "Gemini"}: {
                selectedProvider === "xai" 
                  ? (selectedModel === "grok-3-fast" ? "Grok 3" : "Vision")
                  : (selectedModel === "gemini-3-flash-preview" ? "3 Flash" 
                     : selectedModel === "gemini-2.5-flash" ? "2.5 Flash" : "2.5 Pro")
              }
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          </div>
          
          {isModelSelectorOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50">
              <div className="p-2">
                <div className="text-xs font-medium text-muted-foreground mb-2 px-2">xAI</div>
                <button
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm ${selectedProvider === "xai" && selectedModel === "grok-3-fast" ? "bg-muted" : ""}`}
                  onClick={() => { setSelectedProvider("xai"); setSelectedModel("grok-3-fast"); setIsModelSelectorOpen(false); }}
                  data-testid="model-option-grok-3-fast"
                >
                  <div className="font-medium">Grok 3 Fast</div>
                  <div className="text-xs text-muted-foreground">Respuestas más rápidas</div>
                </button>
                <button
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm ${selectedProvider === "xai" && selectedModel === "grok-2-vision-1212" ? "bg-muted" : ""}`}
                  onClick={() => { setSelectedProvider("xai"); setSelectedModel("grok-2-vision-1212"); setIsModelSelectorOpen(false); }}
                  data-testid="model-option-grok-2-vision"
                >
                  <div className="font-medium">Grok 2 Vision</div>
                  <div className="text-xs text-muted-foreground">Análisis de imágenes</div>
                </button>
                
                <div className="border-t border-border my-2"></div>
                
                <div className="text-xs font-medium text-muted-foreground mb-2 px-2">Google Gemini</div>
                <button
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm ${selectedProvider === "gemini" && selectedModel === "gemini-3-flash-preview" ? "bg-muted" : ""}`}
                  onClick={() => { setSelectedProvider("gemini"); setSelectedModel("gemini-3-flash-preview"); setIsModelSelectorOpen(false); }}
                  data-testid="model-option-gemini-3-flash"
                >
                  <div className="font-medium">Gemini 3 Flash Preview</div>
                  <div className="text-xs text-muted-foreground">Más nuevo y rápido (predeterminado)</div>
                </button>
                <button
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm ${selectedProvider === "gemini" && selectedModel === "gemini-2.5-flash" ? "bg-muted" : ""}`}
                  onClick={() => { setSelectedProvider("gemini"); setSelectedModel("gemini-2.5-flash"); setIsModelSelectorOpen(false); }}
                  data-testid="model-option-gemini-flash"
                >
                  <div className="font-medium">Gemini 2.5 Flash</div>
                  <div className="text-xs text-muted-foreground">Rápido y eficiente</div>
                </button>
                <button
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm ${selectedProvider === "gemini" && selectedModel === "gemini-2.5-pro" ? "bg-muted" : ""}`}
                  onClick={() => { setSelectedProvider("gemini"); setSelectedModel("gemini-2.5-pro"); setIsModelSelectorOpen(false); }}
                  data-testid="model-option-gemini-pro"
                >
                  <div className="font-medium">Gemini 2.5 Pro</div>
                  <div className="text-xs text-muted-foreground">Más capaz y avanzado</div>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1">
          {user?.email !== "infosiragpt@gmail.com" && (
            <Button
              size="sm"
              className="rounded-full text-[10px] sm:text-xs px-2 sm:px-4 bg-purple-600 hover:bg-purple-700 text-white border-0"
              onClick={() => setIsUpgradeDialogOpen(true)}
              data-testid="button-upgrade-header"
            >
              <span className="hidden sm:inline">Mejorar el plan a Go</span>
              <span className="sm:hidden">Mejorar</span>
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
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>
      </header>

      {/* Main Content Area with Side Panel */}
      {(previewDocument || activeDocEditor) ? (
        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left Panel: Minimized Chat for Document Mode */}
          <Panel defaultSize={activeDocEditor ? 25 : 50} minSize={20} maxSize={activeDocEditor ? 35 : 70}>
            <div className="flex flex-col min-w-0 h-full bg-background/50">
              {/* Compact Header for Document Mode */}
              {activeDocEditor && (
                <div className="p-3 border-b border-border/50 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      activeDocEditor.type === "word" && "bg-blue-600",
                      activeDocEditor.type === "excel" && "bg-green-600",
                      activeDocEditor.type === "ppt" && "bg-orange-500"
                    )}>
                      <span className="text-white text-sm font-bold">
                        {activeDocEditor.type === "word" ? "W" : activeDocEditor.type === "excel" ? "E" : "P"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">Instrucciones</p>
                      <p className="text-xs text-muted-foreground">El AI escribe directo al documento</p>
                    </div>
                  </div>
                </div>
              )}
              
          {/* Messages Area - Compact for document mode */}
          {hasMessages && (
            <div 
              className={cn(
                "flex-1 overflow-y-auto space-y-3 overscroll-contain",
                activeDocEditor ? "p-3" : "p-4 sm:p-6 md:p-10 space-y-6"
              )}
              style={{ paddingBottom: 'var(--composer-height, 120px)' }}
            >
              <MessageList
                messages={messages}
                variant={activeDocEditor ? "compact" : "default"}
                editingMessageId={editingMessageId}
                editContent={editContent}
                setEditContent={setEditContent}
                copiedMessageId={copiedMessageId}
                messageFeedback={messageFeedback}
                speakingMessageId={speakingMessageId}
                isGeneratingImage={isGeneratingImage}
                pendingGeneratedImage={pendingGeneratedImage}
                latestGeneratedImageRef={latestGeneratedImageRef}
                streamingContent={streamingContent}
                aiState={aiState}
                handleCopyMessage={handleCopyMessage}
                handleStartEdit={handleStartEdit}
                handleCancelEdit={handleCancelEdit}
                handleSendEdit={handleSendEdit}
                handleFeedback={handleFeedback}
                handleRegenerate={handleRegenerate}
                handleShare={handleShare}
                handleReadAloud={handleReadAloud}
                handleOpenDocumentPreview={handleOpenDocumentPreview}
                handleOpenFileAttachmentPreview={handleOpenFileAttachmentPreview}
                handleDownloadImage={handleDownloadImage}
                setLightboxImage={setLightboxImage}
              />

              {/* Agent Observer - Show when agent is running */}
        {agent.state.status !== "idle" && (
          <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
            <AgentObserver
              steps={agent.state.steps}
              objective={agent.state.objective}
              status={agent.state.status}
              onCancel={agent.cancel}
            />
          </div>
        )}

        {/* Image Generation Loading Skeleton */}
        {isGeneratingImage && (
          <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
            <div className="flex flex-col gap-2 items-start">
              <div className="liquid-message-ai-light px-4 py-3 text-sm mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generando imagen...</span>
                </div>
              </div>
              <div className="px-4">
                <div className="w-64 h-64 bg-muted rounded-lg animate-pulse flex items-center justify-center">
                  <Image className="h-8 w-8 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Thinking/Responding State */}
        {aiState !== "idle" && !isGeneratingImage && (
          <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
            <div className="flex flex-col gap-2 items-start">
              {aiState === "thinking" && (
                <div className="liquid-message-ai-light px-4 py-3 text-sm">
                  <div className="flex items-center">
                    <span className="thinking-wave">Pensando</span>
                    <span className="thinking-cursor">|</span>
                  </div>
                </div>
              )}
              {aiState === "responding" && streamingContent && (
                <div className="px-4 py-3 text-foreground min-w-0" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", fontSize: "16px", lineHeight: "1.6", fontWeight: 400 }}>
                  <MarkdownRenderer
                    content={streamingContent}
                    customComponents={{...CleanDataTableComponents}}
                  />
                  <span className="typing-cursor">|</span>
                </div>
              )}
            </div>
          </div>
        )}
        
              <div ref={bottomRef} />
            </div>
          )}

          {/* Centered content when no messages */}
          {!hasMessages && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="flex flex-col items-center justify-center text-center space-y-4 mb-6">
                {activeGpt ? (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-2">
                      {activeGpt.avatar ? (
                        <img src={activeGpt.avatar} alt={activeGpt.name} className="w-full h-full rounded-2xl object-cover" />
                      ) : (
                        <Bot className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <h2 className="text-xl font-semibold">{activeGpt.name}</h2>
                    <p className="text-muted-foreground max-w-md">{activeGpt.welcomeMessage || activeGpt.description || "¿En qué puedo ayudarte?"}</p>
                    {activeGpt.conversationStarters && activeGpt.conversationStarters.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-4 justify-center max-w-xl">
                        {activeGpt.conversationStarters.filter(s => s).map((starter, idx) => (
                          <button
                            key={idx}
                            onClick={() => setInput(starter)}
                            className="px-4 py-2 text-sm border rounded-lg hover:bg-muted/50 transition-colors text-left"
                          >
                            {starter}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">¿En qué puedo ayudarte?</p>
                )}
              </div>
            </div>
          )}

          <Composer
            input={input}
            setInput={setInput}
            textareaRef={textareaRef}
            composerRef={composerRef}
            fileInputRef={fileInputRef}
            uploadedFiles={uploadedFiles}
            removeFile={removeFile}
            handleSubmit={handleSubmit}
            handleFileUpload={handleFileUpload}
            handlePaste={handlePaste}
            handleDragOver={handleDragOver}
            handleDragEnter={handleDragEnter}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            isDraggingOver={isDraggingOver}
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            selectedDocTool={selectedDocTool}
            setSelectedDocTool={setSelectedDocTool}
            closeDocEditor={closeDocEditor}
            openBlankDocEditor={openBlankDocEditor}
            aiState={aiState}
            isRecording={isRecording}
            isPaused={isPaused}
            recordingTime={recordingTime}
            toggleVoiceRecording={toggleVoiceRecording}
            discardVoiceRecording={discardVoiceRecording}
            pauseVoiceRecording={pauseVoiceRecording}
            resumeVoiceRecording={resumeVoiceRecording}
            sendVoiceRecording={sendVoiceRecording}
            handleStopChat={handleStopChat}
            setIsVoiceChatOpen={setIsVoiceChatOpen}
            browserSession={browserSession}
            isBrowserOpen={isBrowserOpen}
            setIsBrowserOpen={setIsBrowserOpen}
            isBrowserMaximized={isBrowserMaximized}
            setIsBrowserMaximized={setIsBrowserMaximized}
            browserUrl={browserUrl}
            variant="document"
            placeholder={selectedDocText ? "Escribe cómo mejorar el texto..." : "Type your message here..."}
            selectedDocText={selectedDocText}
            handleDocTextDeselect={handleDocTextDeselect}
          />
            </div>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="w-2 bg-border/50 hover:bg-primary/30 transition-colors cursor-col-resize flex items-center justify-center group">
            <GripVertical className="h-6 w-6 text-muted-foreground/50 group-hover:text-primary transition-colors" />
          </PanelResizeHandle>

          {/* Right: Document Editor Panel */}
          <Panel defaultSize={activeDocEditor ? 75 : 50} minSize={25}>
            <div className="h-full animate-in slide-in-from-right duration-300">
              {(activeDocEditor?.type === "ppt") ? (
                <PPTEditorShellLazy
                  onClose={closeDocEditor}
                  onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                />
              ) : (activeDocEditor?.type === "excel" || previewDocument?.type === "excel") ? (
                <SpreadsheetEditor
                  key="excel-editor-stable"
                  title={activeDocEditor ? activeDocEditor.title : (previewDocument?.title || "")}
                  content={editedDocumentContent}
                  onChange={setEditedDocumentContent}
                  onClose={activeDocEditor ? closeDocEditor : handleCloseDocumentPreview}
                  onDownload={() => {
                    if (activeDocEditor) {
                      handleDownloadDocument({
                        type: activeDocEditor.type,
                        title: activeDocEditor.title,
                        content: editedDocumentContent
                      });
                    } else if (previewDocument) {
                      handleDownloadDocument(previewDocument);
                    }
                  }}
                  onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                />
              ) : (
                <EnhancedDocumentEditor
                  key={activeDocEditor ? `new-${activeDocEditor.type}` : previewDocument?.title}
                  title={activeDocEditor ? activeDocEditor.title : (previewDocument?.title || "")}
                  content={editedDocumentContent}
                  onChange={setEditedDocumentContent}
                  onClose={activeDocEditor ? closeDocEditor : handleCloseDocumentPreview}
                  onDownload={() => {
                    if (activeDocEditor) {
                      handleDownloadDocument({
                        type: activeDocEditor.type,
                        title: activeDocEditor.title,
                        content: editedDocumentContent
                      });
                    } else if (previewDocument) {
                      handleDownloadDocument(previewDocument);
                    }
                  }}
                  onTextSelect={handleDocTextSelect}
                  onTextDeselect={handleDocTextDeselect}
                  onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                />
              )}
            </div>
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Messages Area - only show when there are messages */}
          {hasMessages && (
            <div 
              className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 space-y-6 overscroll-contain"
              style={{ paddingBottom: 'var(--composer-height, 120px)' }}
            >
              <MessageList
                messages={messages}
                variant="default"
                editingMessageId={editingMessageId}
                editContent={editContent}
                setEditContent={setEditContent}
                copiedMessageId={copiedMessageId}
                messageFeedback={messageFeedback}
                speakingMessageId={speakingMessageId}
                isGeneratingImage={isGeneratingImage}
                pendingGeneratedImage={pendingGeneratedImage}
                latestGeneratedImageRef={latestGeneratedImageRef}
                streamingContent={streamingContent}
                aiState={aiState}
                handleCopyMessage={handleCopyMessage}
                handleStartEdit={handleStartEdit}
                handleCancelEdit={handleCancelEdit}
                handleSendEdit={handleSendEdit}
                handleFeedback={handleFeedback}
                handleRegenerate={handleRegenerate}
                handleShare={handleShare}
                handleReadAloud={handleReadAloud}
                handleOpenDocumentPreview={handleOpenDocumentPreview}
                handleOpenFileAttachmentPreview={handleOpenFileAttachmentPreview}
                handleDownloadImage={handleDownloadImage}
                setLightboxImage={setLightboxImage}
              />
              
              <div ref={messagesEndRef} />

            </div>
          )}

          {/* Processing indicators when AI is working (even without messages) */}
          {!hasMessages && aiState !== "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center px-4">
              {streamingContent ? (
                <div className="w-full max-w-3xl mx-auto">
                  <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
                    <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
                      <MarkdownRenderer
                        content={streamingContent}
                        customComponents={{...CleanDataTableComponents}}
                      />
                      <span className="inline-block w-0.5 h-4 bg-primary animate-[pulse_0.33s_ease-in-out_infinite] ml-0.5" />
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-3xl mx-auto"
                >
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
                </motion.div>
              )}
            </div>
          )}

          {/* Welcome Screen when no messages AND not processing */}
          {!hasMessages && aiState === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center px-4">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="mb-8"
              >
                {activeGpt?.avatar ? (
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30">
                    <img src={activeGpt.avatar} alt={activeGpt.name} className="w-full h-full rounded-2xl object-cover" />
                  </div>
                ) : (
                  <SiraLogo size={80} />
                )}
              </motion.div>
              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-4xl font-bold text-center mb-3 bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text"
              >
                {activeGpt ? activeGpt.name : "¿En qué puedo ayudarte?"}
              </motion.h1>
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="text-muted-foreground text-center max-w-md text-base"
              >
                {activeGpt 
                  ? (activeGpt.welcomeMessage || activeGpt.description || "¿En qué puedo ayudarte?")
                  : "Soy MICHAT, tu asistente de IA. Puedo responder preguntas, generar documentos, analizar archivos y mucho más."
                }
              </motion.p>
              {activeGpt?.conversationStarters && activeGpt.conversationStarters.length > 0 && (
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                  className="flex flex-wrap gap-2 mt-6 justify-center max-w-xl"
                >
                  {activeGpt.conversationStarters.filter(s => s).map((starter, idx) => (
                    <button
                      key={idx}
                      onClick={() => setInput(starter)}
                      className="px-4 py-2 text-sm border rounded-lg hover:bg-muted/50 transition-colors text-left"
                      data-testid={`button-starter-${idx}`}
                    >
                      {starter}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          )}
          
          {/* Input Bar */}
          <Composer
            input={input}
            setInput={setInput}
            textareaRef={textareaRef}
            composerRef={composerRef}
            fileInputRef={fileInputRef}
            uploadedFiles={uploadedFiles}
            removeFile={removeFile}
            handleSubmit={handleSubmit}
            handleFileUpload={handleFileUpload}
            handlePaste={handlePaste}
            handleDragOver={handleDragOver}
            handleDragEnter={handleDragEnter}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            isDraggingOver={isDraggingOver}
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            selectedDocTool={selectedDocTool}
            setSelectedDocTool={setSelectedDocTool}
            closeDocEditor={closeDocEditor}
            openBlankDocEditor={openBlankDocEditor}
            aiState={aiState}
            isRecording={isRecording}
            isPaused={isPaused}
            recordingTime={recordingTime}
            toggleVoiceRecording={toggleVoiceRecording}
            discardVoiceRecording={discardVoiceRecording}
            pauseVoiceRecording={pauseVoiceRecording}
            resumeVoiceRecording={resumeVoiceRecording}
            sendVoiceRecording={sendVoiceRecording}
            handleStopChat={handleStopChat}
            setIsVoiceChatOpen={setIsVoiceChatOpen}
            browserSession={browserSession}
            isBrowserOpen={isBrowserOpen}
            setIsBrowserOpen={setIsBrowserOpen}
            isBrowserMaximized={isBrowserMaximized}
            setIsBrowserMaximized={setIsBrowserMaximized}
            browserUrl={browserUrl}
            variant="default"
            placeholder="Escribe tu mensaje aquí..."
            onCloseSidebar={onCloseSidebar}
            setPreviewUploadedImage={setPreviewUploadedImage}
            isFigmaConnected={isFigmaConnected}
            isFigmaConnecting={isFigmaConnecting}
            handleFigmaConnect={handleFigmaConnect}
            handleFigmaDisconnect={handleFigmaDisconnect}
            onOpenGoogleForms={() => setIsGoogleFormsOpen(true)}
            onOpenApps={onOpenApps}
            isGoogleFormsActive={isGoogleFormsActive}
            setIsGoogleFormsActive={setIsGoogleFormsActive}
          />
        </div>
      )}
      
      
      <ETLDialog 
        open={isETLDialogOpen} 
        onClose={() => setIsETLDialogOpen(false)}
        onComplete={(summary) => {
          onSendMessage({
            id: `etl-${Date.now()}`,
            role: "assistant",
            content: `ETL Agent completed. ${summary}`,
            timestamp: new Date()
          });
        }}
      />

      <UpgradePlanDialog 
        open={isUpgradeDialogOpen} 
        onOpenChange={setIsUpgradeDialogOpen} 
      />

      <DocumentGeneratorDialog
        open={isDocGeneratorOpen}
        onClose={() => setIsDocGeneratorOpen(false)}
        documentType={docGeneratorType}
        onComplete={(message) => {
          onSendMessage({
            id: `doc-gen-${Date.now()}`,
            role: "assistant",
            content: message,
            timestamp: new Date()
          });
        }}
      />

      <GoogleFormsDialog
        open={isGoogleFormsOpen}
        onClose={() => {
          setIsGoogleFormsOpen(false);
          setGoogleFormsPrompt("");
        }}
        initialPrompt={googleFormsPrompt}
        onComplete={(message, formUrl) => {
          onSendMessage({
            id: `forms-gen-${Date.now()}`,
            role: "assistant",
            content: message + (formUrl ? `\n\n[Abrir en Google Forms](${formUrl})` : ""),
            timestamp: new Date()
          });
        }}
      />

      {/* Voice Chat Mode - Fullscreen conversation with Grok */}
      <VoiceChatMode 
        open={isVoiceChatOpen} 
        onClose={() => setIsVoiceChatOpen(false)} 
      />

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img 
              src={lightboxImage} 
              alt="Imagen ampliada" 
              className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-4 right-4 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
              onClick={() => setLightboxImage(null)}
              data-testid="button-close-lightbox"
            >
              <X className="h-5 w-5" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-4 right-16 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
              onClick={(e) => { e.stopPropagation(); handleDownloadImage(lightboxImage); }}
              data-testid="button-download-lightbox"
            >
              <Download className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      {/* File Attachment Preview Modal */}
      {previewFileAttachment && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewFileAttachment(null)}
          data-testid="file-attachment-preview-overlay"
        >
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                {(() => {
                  const attTheme = getFileTheme(previewFileAttachment.name, previewFileAttachment.mimeType);
                  return (
                    <motion.div 
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1, duration: 0.2 }}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg",
                        attTheme.bgColor
                      )}
                    >
                      <span className="text-white text-sm font-bold">
                        {attTheme.icon}
                      </span>
                    </motion.div>
                  );
                })()}
                <div>
                  <h3 className="font-semibold text-lg text-foreground truncate max-w-md" data-testid="preview-file-name">
                    {previewFileAttachment.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {previewFileAttachment.mimeType || "Archivo"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {previewFileAttachment.content && !previewFileAttachment.isLoading && !previewFileAttachment.isProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyAttachmentContent}
                        data-testid="button-copy-attachment-content"
                      >
                        {copiedAttachmentContent ? (
                          <>
                            <Check className="h-4 w-4 mr-2 text-green-500" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copiar contenido al portapapeles</TooltipContent>
                  </Tooltip>
                )}
                {previewFileAttachment.storagePath && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadFileAttachment}
                    data-testid="button-download-attachment"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Descargar
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPreviewFileAttachment(null)}
                  data-testid="button-close-attachment-preview"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              {previewFileAttachment.isLoading ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-center h-64"
                >
                  <div className="flex flex-col items-center gap-3">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Loader2 className="h-8 w-8 text-primary" />
                    </motion.div>
                    <motion.p 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="text-muted-foreground"
                    >
                      Cargando contenido...
                    </motion.p>
                  </div>
                </motion.div>
              ) : previewFileAttachment.isProcessing ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-center h-64"
                >
                  <div className="flex flex-col items-center gap-4 p-6 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                    <motion.div
                      animate={{ 
                        scale: [1, 1.1, 1],
                        rotate: [0, 5, -5, 0]
                      }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <RefreshCw className="h-10 w-10 text-amber-600 dark:text-amber-400" />
                    </motion.div>
                    <div className="text-center">
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        Procesando archivo...
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                        El contenido estará disponible en breve
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) : previewFileAttachment.content ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="prose prose-sm dark:prose-invert max-w-none"
                >
                  <div className="bg-muted/30 p-4 rounded-lg overflow-auto max-h-[60vh]">
                    <MarkdownRenderer content={previewFileAttachment.content} />
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col items-center justify-center h-64 text-center"
                >
                  <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    La vista previa no está disponible para este tipo de archivo.
                  </p>
                  {previewFileAttachment.storagePath && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={handleDownloadFileAttachment}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar archivo
                    </Button>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Uploaded Image Preview Modal */}
      {previewUploadedImage && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUploadedImage(null)}
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative max-w-4xl max-h-[90vh] rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={previewUploadedImage.dataUrl} 
              alt={previewUploadedImage.name}
              className="max-w-full max-h-[90vh] object-contain"
            />
            <button
              onClick={() => setPreviewUploadedImage(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
              data-testid="button-close-image-preview"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
              <p className="text-white text-sm truncate">{previewUploadedImage.name}</p>
            </div>
          </motion.div>
        </motion.div>
      )}

    </div>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
    </svg>
  );
}
