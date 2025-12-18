import { useState, useRef, useEffect } from "react";
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
  GripVertical
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

import { Message, FigmaDiagram } from "@/hooks/use-chats";
import { useAgent } from "@/hooks/use-agent";
import { useBrowserSession } from "@/hooks/use-browser-session";
import { AgentObserver } from "@/components/agent-observer";
import { VirtualComputer } from "@/components/virtual-computer";
import { DocumentEditor } from "@/components/document-editor";
import { SpreadsheetEditor } from "@/components/spreadsheet-editor";
import { ETLDialog } from "@/components/etl-dialog";
import { FigmaBlock } from "@/components/figma-block";
import { Database } from "lucide-react";

const processLatex = (content: string): string => {
  return content
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');
};

interface DocumentBlock {
  type: "word" | "excel" | "ppt";
  title: string;
  content: string;
}

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
            className={cn("text-lg font-bold mb-2 mt-4 text-gray-800 dark:text-gray-200", baseClass)}
          >
            {block.content.replace(/^### /, '')}
          </h3>
        );
      case 'paragraph':
        return (
          <p 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("mb-3 leading-relaxed text-gray-700 dark:text-gray-300 text-sm", baseClass)}
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
              <li key={idx} className="text-gray-800 dark:text-gray-200">
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
              <li key={idx} className="text-gray-800 dark:text-gray-200">
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
            className={cn("border-l-4 border-blue-500 pl-4 italic my-4 py-2 bg-gray-50 dark:bg-gray-800", baseClass)}
          >
            {block.content.split('\n').map((line, idx) => (
              <p key={idx} className="text-gray-700 dark:text-gray-300">
                {renderInlineFormatting(line.replace(/^> /, ''))}
              </p>
            ))}
          </blockquote>
        );
      case 'table':
        const rows = block.content.split('\n').filter(r => !r.match(/^\|[-:| ]+\|$/));
        return (
          <div key={block.id} onClick={() => handleBlockClick(block)} className={baseClass}>
            <table className="w-full border-collapse border border-gray-300 my-4">
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} className={idx === 0 ? "bg-gray-100 dark:bg-gray-700" : ""}>
                    {row.split('|').filter(c => c.trim()).map((cell, cidx) => (
                      idx === 0 ? (
                        <th key={cidx} className="border border-gray-300 px-3 py-2 font-semibold text-left">
                          {cell.trim()}
                        </th>
                      ) : (
                        <td key={cidx} className="border border-gray-300 px-3 py-2">
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
        return <hr key={block.id} className="my-6 border-t-2 border-gray-200 dark:border-gray-700" />;
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

const parseDocumentBlocks = (content: string): { text: string; documents: DocumentBlock[] } => {
  const documents: DocumentBlock[] = [];
  const regex = /```document\s*\n([\s\S]*?)```/g;
  let match;
  let cleanText = content;
  const successfulBlocks: string[] = [];
  
  while ((match = regex.exec(content)) !== null) {
    try {
      let jsonStr = match[1].trim();
      
      // Fix common JSON issues from AI responses
      // Replace actual newlines inside strings with \n
      jsonStr = jsonStr.replace(/"content"\s*:\s*"([\s\S]*?)"\s*\}/, (m, contentValue) => {
        const fixedContent = contentValue
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        return `"content": "${fixedContent}"}`;
      });
      
      const doc = JSON.parse(jsonStr);
      if (doc.type && doc.title && doc.content) {
        // Clean up the content - remove double escaped newlines
        doc.content = doc.content.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
        documents.push(doc as DocumentBlock);
        successfulBlocks.push(match[0]);
      }
    } catch (e) {
      console.error("Failed to parse document block:", e);
      
      // Try regex extraction as fallback
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
        console.error("Fallback parsing also failed:", fallbackError);
      }
    }
  }
  
  for (const block of successfulBlocks) {
    cleanText = cleanText.replace(block, "").trim();
  }
  
  return { text: cleanText, documents };
};

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
}

interface UploadedFile {
  id?: string;
  name: string;
  type: string;
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
  setAiProcessSteps
}: ChatInterfaceProps) {
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
  const [isETLDialogOpen, setIsETLDialogOpen] = useState(false);
  const [figmaTokenInput, setFigmaTokenInput] = useState("");
  const [isFigmaConnecting, setIsFigmaConnecting] = useState(false);
  const [isFigmaConnected, setIsFigmaConnected] = useState(false);
  const [showFigmaTokenInput, setShowFigmaTokenInput] = useState(false);
  const activeDocEditorRef = useRef<{ type: "word" | "excel" | "ppt"; title: string; content: string } | null>(null);
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
  
  // Keep ref in sync with state
  useEffect(() => {
    activeDocEditorRef.current = activeDocEditor;
    console.log('[ChatInterface] activeDocEditor changed:', !!activeDocEditor);
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
    console.log('[ChatInterface] Opening document editor:', type, 'Current messages:', messages.length);
    
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

  const toggleVoiceRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz. Por favor usa Chrome, Edge o Safari.");
      return;
    }

    if (isRecording) {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current = null;
      }
      setIsRecording(false);
    } else {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'es-ES';

      let finalTranscript = '';
      let interimTranscript = '';

      recognition.onstart = () => {
        setIsRecording(true);
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
        speechRecognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsRecording(false);
        speechRecognitionRef.current = null;
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
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
          title: "Sira GPT Response",
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
        body: JSON.stringify({ messages: chatHistory }),
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

    for (const file of Array.from(files)) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        console.warn(`Tipo de archivo no soportado: ${file.type}`);
        continue;
      }

      const tempId = `temp-${Date.now()}-${Math.random()}`;
      
      let dataUrl: string | undefined;
      if (file.type.startsWith("image/")) {
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

        const registerRes = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            type: file.type,
            size: file.size,
            storagePath,
          }),
        });
        const registeredFile = await registerRes.json();
        if (!registerRes.ok) throw new Error(registeredFile.error);

        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === tempId
              ? { ...f, id: registeredFile.id, storagePath, status: "processing" }
              : f
          )
        );

        pollFileStatus(registeredFile.id, tempId);
      } catch (error) {
        console.error("File upload error:", error);
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === tempId ? { ...f, status: "error" } : f))
        );
      }
    }

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

  const getFileIcon = (type: string, fileName?: string) => {
    const lowerType = type.toLowerCase();
    const lowerName = (fileName || "").toLowerCase();
    
    // Check by file extension first (more reliable)
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv")) {
      return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
    }
    if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
      return <FileText className="h-4 w-4 text-blue-600" />;
    }
    if (lowerName.endsWith(".pptx") || lowerName.endsWith(".ppt")) {
      return <FileText className="h-4 w-4 text-orange-500" />;
    }
    if (lowerName.endsWith(".pdf")) {
      return <FileText className="h-4 w-4 text-red-500" />;
    }
    
    // Check by MIME type
    if (lowerType.includes("pdf")) return <FileText className="h-4 w-4 text-red-500" />;
    if (lowerType.includes("word") || lowerType.includes("document") || lowerType.includes("wordprocessing")) {
      return <FileText className="h-4 w-4 text-blue-600" />;
    }
    if (lowerType.includes("sheet") || lowerType.includes("excel") || lowerType.includes("spreadsheet") || lowerType.includes("csv")) {
      return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
    }
    if (lowerType.includes("presentation") || lowerType.includes("powerpoint")) {
      return <FileText className="h-4 w-4 text-orange-500" />;
    }
    if (lowerType.includes("image")) return <Image className="h-4 w-4 text-purple-500" />;
    return <FileIcon className="h-4 w-4 text-gray-500" />;
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
            }]
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

    try {
      abortControllerRef.current = new AbortController();
      
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
      
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: chatHistory,
          images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
          documentMode: isDocumentMode ? { type: documentType } : undefined,
          figmaMode: isFigmaMode,
          gptConfig: activeGpt ? {
            id: activeGpt.id,
            systemPrompt: activeGpt.systemPrompt,
            temperature: parseFloat(activeGpt.temperature || "0.7"),
            topP: parseFloat(activeGpt.topP || "1")
          } : undefined
        }),
        signal: abortControllerRef.current.signal
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
      console.log('[ChatInterface] Document mode:', shouldWriteToDoc, 'Insert ref available:', !!docInsertContentRef.current);
      
      const fullContent = data.content;
      const responseSources = data.sources || [];
      const figmaDiagram = data.figmaDiagram as FigmaDiagram | undefined;
      
      // If Figma diagram was generated, add it to chat immediately
      if (figmaDiagram) {
        console.log('[ChatInterface] Figma diagram received from API:', figmaDiagram);
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
            console.log('[ChatInterface] Sending AI message with figmaDiagram:', aiMsg);
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
      
      // If document mode is active: Buffer approach - show progress in chat, single write to document at end
      if (shouldWriteToDoc && docInsertContentRef.current) {
        setAiState("responding");
        
        // Buffer the content - show typing animation in chat, write to doc ONCE at the end
        let currentIndex = 0;
        
        streamIntervalRef.current = setInterval(() => {
          if (currentIndex < fullContent.length) {
            const chunkSize = Math.floor(Math.random() * 8) + 5; // Fast typing effect
            currentIndex = Math.min(currentIndex + chunkSize, fullContent.length);
            const currentContent = fullContent.slice(0, currentIndex);
            
            // Show progress in chat bubble only - NO writes to document during streaming
            streamingContentRef.current = currentContent;
            setStreamingContent(currentContent);
          } else {
            if (streamIntervalRef.current) {
              clearInterval(streamIntervalRef.current);
              streamIntervalRef.current = null;
            }
            
            // SINGLE WRITE: Insert complete content to document once
            try {
              if (docInsertContentRef.current) {
                docInsertContentRef.current(fullContent);
                console.log('[ChatInterface] Document written with single insert');
              }
            } catch (err) {
              console.error('[ChatInterface] Error writing to document:', err);
            }
            
            // Add confirmation message in chat
            const confirmMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "✓ Contenido agregado al documento",
              timestamp: new Date(),
            };
            onSendMessage(confirmMsg);
            
            streamingContentRef.current = "";
            setStreamingContent("");
            setAiState("idle");
            setAiProcessSteps([]);
            agent.complete();
            abortControllerRef.current = null;
          }
        }, 8);
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
  
  // Debug: Log state changes
  useEffect(() => {
    console.log("[ChatInterface] State:", { hasMessages, aiState, aiProcessStepsCount: aiProcessSteps.length, streamingContent: !!streamingContent });
  }, [hasMessages, aiState, aiProcessSteps.length, streamingContent]);


  return (
    <div className="flex h-full flex-col bg-transparent relative">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-4 border-b border-white/20 glass-card-light rounded-none z-10 sticky top-0 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded-md transition-colors">
            <span className="font-semibold text-sm">xAI: Grok 4.1 Fast</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </div>
        </div>
        <div className="flex items-center gap-4">
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
                        {activeDocEditor.type === "word" ? "W" : activeDocEditor.type === "excel" ? "X" : "P"}
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
            <div className={cn(
              "flex-1 overflow-y-auto space-y-3",
              activeDocEditor ? "p-3" : "p-4 sm:p-6 md:p-10 space-y-6"
            )}>
        
        {messages.map((msg, msgIndex) => (
          // Compact message display for document mode
          activeDocEditor ? (
            <div
              key={msg.id}
              className={cn(
                "flex gap-2 text-sm",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "user" ? (
                <div className="bg-primary/10 text-primary-foreground px-3 py-2 rounded-lg max-w-full text-sm">
                  <span className="text-muted-foreground mr-1 font-medium">Instrucción:</span>
                  <span className="text-foreground">{msg.content}</span>
                </div>
              ) : (
                <div className="bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg max-w-[90%] text-xs flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>{msg.content}</span>
                </div>
              )}
            </div>
          ) : (
          <div
            key={msg.id}
            className={cn(
              "flex w-full max-w-3xl mx-auto gap-4",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div className={cn(
              "flex flex-col gap-2 max-w-[85%]",
              msg.role === "user" ? "items-end" : "items-start"
            )}>
              {msg.role === "user" ? (
                <div className="flex flex-col items-end gap-1">
                  {editingMessageId === msg.id ? (
                    <div className="w-full min-w-[300px] max-w-[500px]">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full px-4 py-3 text-sm min-h-[80px] resize-y rounded-2xl border border-gray-200 bg-white focus:border-primary focus:ring-1 focus:ring-primary"
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-2 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
                          onClick={handleCancelEdit}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancelar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
                          onClick={() => handleSendEdit(msg.id)}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Enviar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="group">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2 justify-end">
                          {msg.attachments.map((file, idx) => (
                            file.type === "image" && file.imageUrl ? (
                              <div key={idx} className="relative max-w-[280px] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                                <img 
                                  src={file.imageUrl} 
                                  alt={file.name}
                                  className="w-full h-auto max-h-[200px] object-cover"
                                />
                              </div>
                            ) : (
                              <div
                                key={idx}
                                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                              >
                                <div className={cn(
                                  "flex items-center justify-center w-8 h-8 rounded-lg",
                                  file.type === "word" ? "bg-blue-600" :
                                  file.type === "excel" ? "bg-green-600" :
                                  file.type === "ppt" ? "bg-orange-500" :
                                  "bg-gray-500"
                                )}>
                                  <span className="text-white text-xs font-bold">
                                    {file.type === "word" ? "W" :
                                     file.type === "excel" ? "X" :
                                     file.type === "ppt" ? "P" : "F"}
                                  </span>
                                </div>
                                <span className="max-w-[200px] truncate font-medium">{file.name}</span>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {msg.content && (
                        <div className="liquid-message-user px-4 py-2.5 text-sm break-words">
                          {msg.content}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyMessage(msg.content, msg.id)}
                        >
                          {copiedMessageId === msg.id ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => handleStartEdit(msg)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4 w-full group/ai">
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
                  
                  {msg.content && !msg.isThinking && (() => {
                    const { text, documents } = parseDocumentBlocks(msg.content);
                    return (
                      <>
                        {text && (
                          <div className="px-4 py-3 text-foreground liquid-message-ai-light" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", fontSize: "16px", lineHeight: "1.6", fontWeight: 400 }}>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkMath]}
                              rehypePlugins={[rehypeKatex, rehypeHighlight]}
                              components={{
                                p: ({children}) => <p className="mb-3 last:mb-0">{children}</p>,
                                a: ({href, children}) => <a href={href} className="text-blue-500 hover:underline break-all" target="_blank" rel="noopener noreferrer">{children}</a>,
                                pre: ({children}) => <pre className="bg-muted p-3 rounded-lg overflow-x-auto mb-3 text-xs">{children}</pre>,
                                code: ({children, className}) => className ? <code className={className}>{children}</code> : <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{children}</code>,
                                ul: ({children}) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
                                ol: ({children}) => <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>,
                                li: ({children}) => <li className="ml-2">{children}</li>,
                                h1: ({children}) => <h1 className="text-xl font-bold mb-3">{children}</h1>,
                                h2: ({children}) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
                                h3: ({children}) => <h3 className="text-base font-semibold mb-2">{children}</h3>,
                                blockquote: ({children}) => <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-3">{children}</blockquote>,
                              }}
                            >
                              {processLatex(text)}
                            </ReactMarkdown>
                          </div>
                        )}
                        {documents.length > 0 && (
                          <div className="flex gap-2 flex-wrap mt-3 px-4">
                            {documents.map((doc, idx) => (
                              <Button
                                key={idx}
                                variant="outline"
                                className="flex items-center gap-2 px-4 py-2 h-auto"
                                onClick={() => handleOpenDocumentPreview(doc)}
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
                    );
                  })()}
                  
                  {/* Figma Diagram Block */}
                  {(() => {
                    console.log('[ChatInterface] Message render:', { msgId: msg.id, hasFigmaDiagram: !!msg.figmaDiagram, figmaDiagram: msg.figmaDiagram });
                    return null;
                  })()}
                  {msg.figmaDiagram && (
                    <div className="mt-3 w-full">
                      <FigmaBlock diagram={msg.figmaDiagram} />
                    </div>
                  )}

                  {msg.attachments && (
                    <div className="flex gap-2 flex-wrap mt-2">
                      {msg.attachments.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-3 rounded-xl border bg-card hover:bg-accent/50 cursor-pointer transition-colors group">
                          {file.type === "word" && <FileText className="h-8 w-8 text-blue-600" />}
                          {file.type === "excel" && <FileSpreadsheet className="h-8 w-8 text-green-600" />}
                          {file.type === "ppt" && <FileIcon className="h-8 w-8 text-orange-600" />}
                          <div className="flex flex-col">
                            <span className="text-sm font-medium group-hover:text-blue-600 transition-colors">{file.name}</span>
                            <span className="text-xs text-muted-foreground">Click to open</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Message Actions Toolbar */}
                  {msg.content && !msg.isThinking && (
                    <TooltipProvider delayDuration={300}>
                      <div className="flex items-center gap-1 mt-2" data-testid={`message-actions-${msg.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => handleCopyMessage(msg.content, msg.id)}
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
                              onClick={() => handleFeedback(msg.id, "up")}
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
                              onClick={() => handleFeedback(msg.id, "down")}
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
                              onClick={() => handleRegenerate(msgIndex)}
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
                              onClick={() => handleShare(msg.content)}
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
                            <DropdownMenuItem onClick={() => handleReadAloud(msg.id, msg.content)} data-testid={`menu-read-aloud-${msg.id}`}>
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
              )}
            </div>
          </div>
          )
        ))}
        

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

        {/* Thinking/Responding State */}
        {aiState !== "idle" && (
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
                <div className="px-4 py-3 text-foreground" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", fontSize: "16px", lineHeight: "1.6", fontWeight: 400 }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
                    components={{
                      p: ({children}) => <p className="mb-3 last:mb-0">{children}</p>,
                      a: ({href, children}) => <a href={href} className="text-blue-500 hover:underline break-all" target="_blank" rel="noopener noreferrer">{children}</a>,
                      pre: ({children}) => <pre className="bg-muted p-3 rounded-lg overflow-x-auto mb-3 text-xs">{children}</pre>,
                      code: ({children, className}) => className ? <code className={className}>{children}</code> : <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{children}</code>,
                    }}
                  >
                    {processLatex(streamingContent)}
                  </ReactMarkdown>
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

          {/* Sticky Input Area */}
          <div className="flex-shrink-0 p-4 sm:p-6 w-full max-w-3xl mx-auto relative">
            {/* Virtual Computer - Always visible above input */}
            <div className="absolute left-4 sm:left-6 bottom-[calc(100%+8px)] z-20">
              <VirtualComputer
                state={browserSession.state}
                onCancel={browserSession.cancel}
                compact={true}
              />
            </div>
            {/* Floating Mini Browser - positioned above the + button */}
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
                <div className="bg-white relative h-[100px]">
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
            
            {/* Maximized Browser */}
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
                <div className="bg-white relative h-[calc(100%-28px)]">
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
            
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              multiple
              accept="*/*"
              data-testid="input-file-upload"
            />

            <div className="relative flex flex-col rounded-3xl liquid-input-light p-2 focus-within:shadow-lg transition-all duration-300">
              {/* Inline Attachments Preview - inside input container */}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2 px-1" data-testid="inline-attachments-container">
                  {uploadedFiles.map((file, index) => (
                    <div
                      key={file.id || index}
                      className={cn(
                        "relative group rounded-lg border overflow-hidden",
                        file.status === "error" 
                          ? "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800" 
                          : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
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
                            "bg-gray-500"
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
              )}

              {/* Selected text indicator */}
              {selectedDocText && (
                <div className="mb-2 px-1 animate-in fade-in duration-150">
                  <div className="bg-teal-50/80 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 rounded-lg px-3 py-1.5 text-sm text-teal-700 dark:text-teal-300 flex items-center gap-2">
                    <span className="truncate flex-1">
                      {selectedDocText.length > 50 ? selectedDocText.substring(0, 50) + '...' : selectedDocText}
                    </span>
                    <button 
                      onClick={handleDocTextDeselect}
                      className="text-teal-500 hover:text-teal-700 flex-shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
              
              <div className="flex items-end gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start" side="top">
                  <div className="flex flex-col">
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
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* Selected Document Tool Logo in Split View */}
              {selectedDocTool && (
                <div className="relative group shrink-0">
                  <div 
                    className={cn(
                      "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
                      "transition-all duration-500 ease-out",
                      "hover:shadow-lg hover:shadow-current/30",
                      selectedDocTool === "word" && "bg-gradient-to-br from-blue-500 to-blue-700",
                      selectedDocTool === "excel" && "bg-gradient-to-br from-green-500 to-green-700",
                      selectedDocTool === "ppt" && "bg-gradient-to-br from-orange-400 to-orange-600",
                      selectedDocTool === "figma" && "bg-gradient-to-br from-purple-500 to-pink-500"
                    )}
                    style={{ animation: "liquid-float 3s ease-in-out infinite" }}
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
                        {selectedDocTool === "word" ? "W" : selectedDocTool === "excel" ? "X" : "P"}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={closeDocEditor}
                    className={cn(
                      "absolute -top-1 -right-1 w-4 h-4 rounded-full",
                      "bg-red-500 hover:bg-red-600 text-white",
                      "flex items-center justify-center",
                      "opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100",
                      "transition-all duration-200 ease-out",
                      "shadow-md hover:shadow-lg"
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
              
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
                placeholder={selectedDocText ? "Escribe cómo mejorar el texto..." : "Type your message here..."}
                className="min-h-[40px] w-full resize-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 text-base"
                rows={1}
              />

              <div className="flex items-center gap-1 pb-1">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={toggleVoiceRecording}
                  className={cn(
                    "h-9 w-9 rounded-full transition-all duration-300",
                    isRecording 
                      ? "bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="button-voice-recording"
                >
                  {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
                {aiState !== "idle" ? (
                  <Button 
                    onClick={handleStopChat}
                    size="icon" 
                    className="h-10 w-10 rounded-full bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50"
                    data-testid="button-stop-chat"
                  >
                    <Square className="h-5 w-5 fill-current" />
                  </Button>
                ) : (
                  <Button 
                    onClick={handleSubmit}
                    size="icon" 
                    className="h-9 w-9 rounded-full transition-all duration-300 liquid-btn"
                    data-testid="button-send-message"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </Button>
                )}
              </div>
              </div>
            </div>
            <div className="text-center text-xs text-muted-foreground mt-3">
              Sira GPT can make mistakes. Check important info.
            </div>
          </div>
            </div>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="w-2 bg-border/50 hover:bg-primary/30 transition-colors cursor-col-resize flex items-center justify-center group">
            <GripVertical className="h-6 w-6 text-muted-foreground/50 group-hover:text-primary transition-colors" />
          </PanelResizeHandle>

          {/* Right: Document Editor Panel */}
          <Panel defaultSize={50} minSize={25}>
            <div className="h-full animate-in slide-in-from-right duration-300">
              {(activeDocEditor?.type === "excel" || previewDocument?.type === "excel") ? (
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
                <DocumentEditor
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
                  documentType={activeDocEditor ? activeDocEditor.type : (previewDocument?.type || "word")}
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
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 space-y-6">
              {messages.map((msg, msgIndex) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex w-full max-w-3xl mx-auto gap-4",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div className={cn(
                    "flex flex-col gap-2 max-w-[85%]",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}>
                    {msg.role === "user" ? (
                      <div className="flex flex-col items-end gap-1">
                        {editingMessageId === msg.id ? (
                          <div className="w-full min-w-[300px] max-w-[500px]">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full px-4 py-3 text-sm min-h-[80px] resize-y rounded-2xl border border-gray-200 bg-white focus:border-primary focus:ring-1 focus:ring-primary"
                              autoFocus
                            />
                            <div className="flex items-center justify-end gap-2 mt-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
                                onClick={handleCancelEdit}
                              >
                                <X className="h-4 w-4 mr-1" />
                                Cancelar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
                                onClick={() => handleSendEdit(msg.id)}
                              >
                                <Send className="h-4 w-4 mr-1" />
                                Enviar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="group">
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-2 justify-end">
                                {msg.attachments.map((att, i) => (
                                  att.type === "image" && att.imageUrl ? (
                                    <div key={i} className="relative max-w-[280px] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                                      <img 
                                        src={att.imageUrl} 
                                        alt={att.name} 
                                        className="w-full h-auto max-h-[200px] object-cover"
                                      />
                                    </div>
                                  ) : (
                                    <div
                                      key={i}
                                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                                    >
                                      <div className={cn(
                                        "flex items-center justify-center w-8 h-8 rounded-lg",
                                        att.type === "word" ? "bg-blue-600" :
                                        att.type === "excel" ? "bg-green-600" :
                                        att.type === "ppt" ? "bg-orange-500" :
                                        "bg-gray-500"
                                      )}>
                                        <span className="text-white text-xs font-bold">
                                          {att.type === "word" ? "W" :
                                           att.type === "excel" ? "X" :
                                           att.type === "ppt" ? "P" : "F"}
                                        </span>
                                      </div>
                                      <span className="max-w-[200px] truncate font-medium">{att.name}</span>
                                    </div>
                                  )
                                ))}
                              </div>
                            )}
                            {msg.content && (
                              <div className="liquid-message-user px-4 py-2.5 text-sm break-words leading-relaxed">
                                {msg.content}
                              </div>
                            )}
                            {/* User Message Actions */}
                            <div className="flex items-center justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => handleCopyMessage(msg.content, msg.id)}
                                data-testid={`button-copy-user-${msg.id}`}
                              >
                                {copiedMessageId === msg.id ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => handleStartEdit(msg)}
                                data-testid={`button-edit-user-${msg.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 w-full">
                        <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex, rehypeHighlight]}
                          >
                            {processLatex(parseDocumentBlocks(msg.content).text)}
                          </ReactMarkdown>
                        </div>
                        {parseDocumentBlocks(msg.content).documents.length > 0 && (
                          <div className="flex gap-2 flex-wrap mt-3">
                            {parseDocumentBlocks(msg.content).documents.map((doc, idx) => (
                              <Button
                                key={idx}
                                variant="outline"
                                className="flex items-center gap-2 px-4 py-2 h-auto"
                                onClick={() => handleOpenDocumentPreview(doc)}
                              >
                                {doc.type === "word" && <FileText className="h-5 w-5 text-blue-600" />}
                                {doc.type === "excel" && <FileSpreadsheet className="h-5 w-5 text-green-600" />}
                                {doc.type === "ppt" && <FileIcon className="h-5 w-5 text-orange-600" />}
                                <span className="text-sm font-medium">{doc.title}</span>
                              </Button>
                            ))}
                          </div>
                        )}
                                                {/* Assistant Message Actions Toolbar */}
                        {msg.content && !msg.isThinking && (
                          <TooltipProvider delayDuration={300}>
                            <div className="flex items-center gap-1 mt-2" data-testid={`message-actions-main-${msg.id}`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => handleCopyMessage(msg.content, msg.id)}
                                    data-testid={`button-copy-main-${msg.id}`}
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
                                    onClick={() => handleFeedback(msg.id, "up")}
                                    data-testid={`button-like-main-${msg.id}`}
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
                                    onClick={() => handleFeedback(msg.id, "down")}
                                    data-testid={`button-dislike-main-${msg.id}`}
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
                                    onClick={() => handleRegenerate(msgIndex)}
                                    disabled={aiState !== "idle"}
                                    data-testid={`button-regenerate-main-${msg.id}`}
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
                                    onClick={() => handleShare(msg.content)}
                                    data-testid={`button-share-main-${msg.id}`}
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
                                        data-testid={`button-more-main-${msg.id}`}
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom"><p>Más opciones</p></TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="start" side="bottom">
                                  <DropdownMenuItem onClick={() => handleReadAloud(msg.id, msg.content)} data-testid={`menu-read-aloud-main-${msg.id}`}>
                                    {speakingMessageId === msg.id ? <VolumeX className="h-4 w-4 mr-2" /> : <Volume2 className="h-4 w-4 mr-2" />}
                                    {speakingMessageId === msg.id ? "Detener lectura" : "Leer en voz alta"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem data-testid={`menu-create-thread-main-${msg.id}`}>
                                    <MessageSquare className="h-4 w-4 mr-2" />
                                    Crear hilo desde aquí
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-red-500" data-testid={`menu-report-main-${msg.id}`}>
                                    <Flag className="h-4 w-4 mr-2" />
                                    Reportar mensaje
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TooltipProvider>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {streamingContent && (
                <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
                  <div className="flex flex-col gap-2 max-w-[85%] items-start">
                    <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeHighlight]}
                      >
                        {processLatex(streamingContent)}
                      </ReactMarkdown>
                      <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
                    </div>
                  </div>
                </div>
              )}
              
              {aiState !== "idle" && !streamingContent && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex w-full max-w-3xl mx-auto gap-4 justify-start"
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
              
              <div ref={messagesEndRef} />

            </div>
          )}

          {/* Processing indicators when AI is working (even without messages) */}
          {!hasMessages && aiState !== "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center px-4">
              {streamingContent ? (
                <div className="w-full max-w-3xl mx-auto">
                  <div className="flex flex-col gap-2 max-w-[85%] items-start">
                    <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeHighlight]}
                      >
                        {processLatex(streamingContent)}
                      </ReactMarkdown>
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
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30">
                  {activeGpt?.avatar ? (
                    <img src={activeGpt.avatar} alt={activeGpt.name} className="w-full h-full rounded-2xl object-cover" />
                  ) : (
                    <BotIcon className="h-10 w-10 text-primary-foreground" />
                  )}
                </div>
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
                  : "Soy Sira GPT, tu asistente de IA. Puedo responder preguntas, generar documentos, analizar archivos y mucho más."
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
          <div className="shrink-0 px-4 pb-4">
            <div className={cn(
              "max-w-3xl mx-auto glass-card-light rounded-2xl border border-white/30 p-3",
              selectedDocText && "ring-2 ring-primary/50"
            )}>
              <div className="flex flex-col gap-2">
                {uploadedFiles.length > 0 && (
                  <div className="flex items-center gap-2 pl-2">
                    {uploadedFiles.map((file, index) => {
                      const isWord = file.type === "word" || file.name.endsWith('.doc') || file.name.endsWith('.docx');
                      const isExcel = file.type === "excel" || file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
                      const isPpt = file.type === "ppt" || file.name.endsWith('.ppt') || file.name.endsWith('.pptx');
                      const isPdf = file.type === "pdf" || file.name.endsWith('.pdf');
                      const isImage = file.type === "image" || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
                      
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
                                  isWord && "bg-blue-600",
                                  isExcel && "bg-green-600",
                                  isPpt && "bg-orange-500",
                                  isPdf && "bg-red-600",
                                  isImage && "bg-purple-500",
                                  !isWord && !isExcel && !isPpt && !isPdf && !isImage && "bg-gray-500"
                                )}>
                                  {file.status === "uploading" || file.status === "processing" ? (
                                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                                  ) : (
                                    <span className="text-white text-xs font-bold">
                                      {isWord ? "W" : isExcel ? "X" : isPpt ? "P" : isPdf ? "PDF" : isImage ? "IMG" : "F"}
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
                )}
                <div className="flex items-end gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground flex-shrink-0 mb-1">
                      <Plus className="h-5 w-5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-56 p-2">
                    <div className="grid gap-1">
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
                                <div className="flex items-center justify-center w-5 h-5 rounded bg-white border">
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
                                <div className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center">
                                  <svg width="18" height="14" viewBox="0 0 24 18" fill="none">
                                    <path d="M1.5 5.25V15.75C1.5 16.1478 1.65804 16.5294 1.93934 16.8107C2.22064 17.092 2.60218 17.25 3 17.25H21C21.3978 17.25 21.7794 17.092 22.0607 16.8107C22.342 16.5294 22.5 16.1478 22.5 15.75V5.25L12 12L1.5 5.25Z" fill="#EA4335"/>
                                    <path d="M22.5 2.25V5.25L12 12L1.5 5.25V2.25C1.5 1.85218 1.65804 1.47064 1.93934 1.18934C2.22064 0.908035 2.60218 0.75 3 0.75H21C21.3978 0.75 21.7794 0.908035 22.0607 1.18934C22.342 1.47064 22.5 1.85218 22.5 2.25Z" fill="#FBBC05"/>
                                    <path d="M1.5 5.25L12 12L22.5 5.25" stroke="#34A853" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </div>
                                <span className="text-sm font-medium">Gmail</span>
                              </div>
                              <Button size="sm" className="h-7 px-3 text-xs bg-black text-white hover:bg-gray-800 rounded-full">
                                Conectar
                              </Button>
                            </div>
                            
                            <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-google-drive">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center">
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
                              <Button size="sm" className="h-7 px-3 text-xs bg-black text-white hover:bg-gray-800 rounded-full">
                                Conectar
                              </Button>
                            </div>
                            
                            <div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-onedrive">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center">
                                  <svg width="20" height="14" viewBox="0 0 24 16" fill="none">
                                    <path d="M14.5 2C12.5 2 10.7 3.1 9.8 4.8C9.3 4.5 8.7 4.4 8 4.4C5.8 4.4 4 6.2 4 8.4C4 8.6 4 8.8 4.1 9C1.8 9.4 0 11.4 0 13.8C0 16.1 1.9 18 4.2 18H19.5C22 18 24 16 24 13.5C24 11.2 22.3 9.3 20 9C20 5.1 17.6 2 14.5 2Z" fill="#0364B8"/>
                                    <path d="M9.8 4.8C10.7 3.1 12.5 2 14.5 2C17.6 2 20 5.1 20 9C22.3 9.3 24 11.2 24 13.5C24 16 22 18 19.5 18H10L9.8 4.8Z" fill="#0078D4"/>
                                    <path d="M8 4.4C8.7 4.4 9.3 4.5 9.8 4.8L10 18H4.2C1.9 18 0 16.1 0 13.8C0 11.4 1.8 9.4 4.1 9C4 8.8 4 8.6 4 8.4C4 6.2 5.8 4.4 8 4.4Z" fill="#1490DF"/>
                                    <path d="M10 18L9.8 4.8C9.3 4.5 8.7 4.4 8 4.4C5.8 4.4 4 6.2 4 8.4C4 8.6 4 8.8 4.1 9C1.8 9.4 0 11.4 0 13.8C0 16.1 1.9 18 4.2 18H10Z" fill="#28A8EA"/>
                                  </svg>
                                </div>
                                <span className="text-sm font-medium">OneDrive</span>
                              </div>
                              <Button size="sm" className="h-7 px-3 text-xs bg-black text-white hover:bg-gray-800 rounded-full">
                                Conectar
                              </Button>
                            </div>
                            
                            <div className="flex flex-col gap-2 px-2 py-2 rounded-md hover:bg-accent/50" data-testid="mcp-figma">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center">
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
                                    className="h-7 px-3 text-xs bg-black text-white hover:bg-gray-800 rounded-full"
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
                    </div>
                  </PopoverContent>
                </Popover>
                
                {/* Selected Tool Logo (Web/Agent) */}
                {selectedTool && (
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
                      style={{
                        animation: "liquid-float 3s ease-in-out infinite"
                      }}
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
                    {/* Close button on hover */}
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
                )}
                
                {/* Selected Document Tool Logo */}
                {selectedDocTool && (
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
                        selectedDocTool === "word" && "bg-gradient-to-br from-blue-500 to-blue-700 after:bg-blue-400/20",
                        selectedDocTool === "excel" && "bg-gradient-to-br from-green-500 to-green-700 after:bg-green-400/20",
                        selectedDocTool === "ppt" && "bg-gradient-to-br from-orange-400 to-orange-600 after:bg-orange-400/20",
                        selectedDocTool === "figma" && "bg-gradient-to-br from-purple-500 to-pink-500 after:bg-purple-400/20"
                      )}
                      style={{
                        animation: "liquid-float 3s ease-in-out infinite"
                      }}
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
                          {selectedDocTool === "word" ? "W" : selectedDocTool === "excel" ? "X" : "P"}
                        </span>
                      )}
                    </div>
                    {/* Close button on hover */}
                    <button
                      onClick={() => setSelectedDocTool(null)}
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
                )}
                
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
                  placeholder="Escribe tu mensaje aquí..."
                  className="min-h-[40px] w-full resize-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 text-base leading-relaxed"
                  rows={1}
                />

                <div className="flex items-center gap-1 pb-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={toggleVoiceRecording}
                    className={cn(
                      "h-9 w-9 rounded-full transition-all duration-300",
                      isRecording 
                        ? "bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    data-testid="button-voice-recording"
                  >
                    {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  {aiState !== "idle" ? (
                    <Button 
                      onClick={handleStopChat}
                      size="icon" 
                      className="h-10 w-10 rounded-full bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-lg shadow-red-500/50"
                      data-testid="button-stop-chat"
                    >
                      <Square className="h-5 w-5 fill-current" />
                    </Button>
                  ) : (
                    <Button 
                      onClick={handleSubmit}
                      size="icon" 
                      className="h-9 w-9 rounded-full transition-all duration-300 liquid-btn"
                      data-testid="button-send-message"
                    >
                      <ArrowUp className="h-5 w-5" />
                    </Button>
                  )}
                </div>
                </div>
              </div>
            </div>
            <div className="text-center text-xs text-muted-foreground mt-3">
              Sira GPT can make mistakes. Check important info.
            </div>
          </div>
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
