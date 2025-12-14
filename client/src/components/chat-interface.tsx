import { useState, useRef, useEffect } from "react";
import { 
  Mic, 
  ArrowUp, 
  Plus, 
  ChevronDown, 
  Globe, 
  FileText,
  FileSpreadsheet,
  FileIcon,
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
  Square
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Upload, Search, Image, Video, Bot, Plug } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

import { Message } from "@/hooks/use-chats";

const processLatex = (content: string): string => {
  return content
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');
};

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: Message) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

interface UploadedFile {
  id?: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  storagePath?: string;
  status?: string;
}

export function ChatInterface({ 
  messages, 
  onSendMessage, 
  isSidebarOpen = true, 
  onToggleSidebar 
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [aiState, setAiState] = useState<"idle" | "thinking" | "responding">("idle");
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleStopChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
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
    setStreamingContent("");
    
    try {
      const chatHistory = contextUpToUser.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAiState("responding");
      const fullContent = data.content;
      let currentIndex = 0;
      
      const streamInterval = setInterval(() => {
        if (currentIndex < fullContent.length) {
          const chunkSize = Math.floor(Math.random() * 3) + 1;
          setStreamingContent(fullContent.slice(0, currentIndex + chunkSize));
          currentIndex += chunkSize;
        } else {
          clearInterval(streamInterval);
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: fullContent,
            timestamp: new Date(),
          };
          onSendMessage(aiMsg);
          setStreamingContent("");
          setAiState("idle");
        }
      }, 15);
    } catch (error) {
      console.error("Regenerate error:", error);
      setAiState("idle");
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
    ];

    for (const file of Array.from(files)) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        console.warn(`Tipo de archivo no soportado: ${file.type}`);
        continue;
      }

      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const tempFile: UploadedFile = {
        id: tempId,
        name: file.name,
        type: file.type,
        size: file.size,
        status: "uploading",
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
        const res = await fetch("/api/files");
        const files = await res.json();
        const file = files.find((f: any) => f.id === fileId);

        if (file) {
          if (file.status === "ready") {
            setUploadedFiles((prev) =>
              prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "ready" } : f))
            );
            return;
          } else if (file.status === "error") {
            setUploadedFiles((prev) =>
              prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
            );
            return;
          }
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

  const getFileIcon = (type: string) => {
    if (type.includes("pdf")) return <FileText className="h-4 w-4 text-red-500" />;
    if (type.includes("word") || type.includes("document")) return <FileText className="h-4 w-4 text-blue-600" />;
    if (type.includes("sheet") || type.includes("excel")) return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
    if (type.includes("image")) return <Image className="h-4 w-4 text-purple-500" />;
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
    if (!input.trim() && uploadedFiles.length === 0) return;

    const attachments = uploadedFiles
      .filter(f => f.status === "ready" || f.status === "processing")
      .map(f => ({
        type: f.type.includes("word") || f.type.includes("document") ? "word" as const :
              f.type.includes("sheet") || f.type.includes("excel") ? "excel" as const :
              f.type.includes("presentation") || f.type.includes("powerpoint") ? "ppt" as const :
              "word" as const,
        name: f.name
      }));
    
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    onSendMessage(userMsg);
    const userInput = input;
    const currentFiles = [...uploadedFiles];
    setInput("");
    setUploadedFiles([]);
    setAiState("thinking");
    setStreamingContent("");

    try {
      abortControllerRef.current = new AbortController();
      
      const chatHistory = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.attachments && m.attachments.length > 0 
          ? `${m.content}\n\n[Archivos adjuntos: ${m.attachments.map(a => a.name).join(", ")}]`
          : m.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory }),
        signal: abortControllerRef.current.signal
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      setAiState("responding");
      
      const fullContent = data.content;
      const responseSources = data.sources || [];
      let currentIndex = 0;
      
      streamIntervalRef.current = setInterval(() => {
        if (currentIndex < fullContent.length) {
          const chunkSize = Math.floor(Math.random() * 3) + 1;
          setStreamingContent(fullContent.slice(0, currentIndex + chunkSize));
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
          setStreamingContent("");
          setAiState("idle");
          abortControllerRef.current = null;
        }
      }, 15);
      
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
      abortControllerRef.current = null;
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col bg-transparent relative">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-4 border-b border-white/20 glass-card-light rounded-none z-10 sticky top-0 flex-shrink-0">
        <div className="flex items-center gap-2">
          {!isSidebarOpen && (
            <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-8 w-8 mr-2 text-muted-foreground">
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          )}
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
                          {msg.attachments.map((file, idx) => (
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
                          ))}
                        </div>
                      )}
                      {msg.content && (
                        <div className="liquid-message-user px-4 py-2.5 text-sm">
                          {msg.content}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyMessage(msg.content)}
                        >
                          <Copy className="h-4 w-4" />
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
                  
                  {msg.content && !msg.isThinking && (
                     <div className="liquid-message-ai-light px-4 py-3 text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-code:before:content-none prose-code:after:content-none">
                       <ReactMarkdown
                         remarkPlugins={[remarkGfm, remarkMath]}
                         rehypePlugins={[rehypeKatex, rehypeHighlight]}
                       >
                         {processLatex(msg.content)}
                       </ReactMarkdown>
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

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-muted">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                        <FileText className="h-3 w-3" />
                        Fuentes ({msg.sources.length})
                      </div>
                      <div className="space-y-2">
                        {msg.sources.map((source, idx) => (
                          <div key={idx} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{source.fileName}:</span>{" "}
                            {source.content}
                          </div>
                        ))}
                      </div>
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
        ))}
        
        {/* Thinking/Responding State */}
        {aiState !== "idle" && (
          <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
            <div className="flex flex-col gap-2 items-start">
              {aiState === "thinking" && (
                <div className="liquid-message-ai-light px-4 py-3 text-sm">
                  <div className="flex items-center">
                    <span className="thinking-wave">Thinking</span>
                    <span className="thinking-cursor">|</span>
                  </div>
                </div>
              )}
              {aiState === "responding" && streamingContent && (
                <div className="liquid-message-ai-light px-4 py-3 text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
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
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <BotIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">How can I help you today?</p>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 sm:p-6 w-full max-w-3xl mx-auto relative">
        {/* Floating Mini Browser - positioned above the + button */}
        {(isBrowserOpen || input.trim().length > 0) && !isBrowserMaximized && (
          <div className="absolute left-4 sm:left-6 bottom-[calc(100%-16px)] w-[120px] border rounded-lg overflow-hidden shadow-lg bg-card z-20 transition-all duration-200">
            <div className="flex items-center justify-between px-1 py-0.5 bg-muted/50 border-b">
              <span className="text-[8px] font-medium text-muted-foreground">web</span>
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
              <span className="text-xs font-medium text-muted-foreground">web</span>
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
        
        {/* Uploaded files preview */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {uploadedFiles.map((file, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border",
                  file.status === "error" 
                    ? "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800" 
                    : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                )}
                data-testid={`file-preview-${index}`}
              >
                <div className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-lg",
                  file.type.includes("pdf") ? "bg-red-500" :
                  file.type.includes("word") || file.type.includes("document") ? "bg-blue-600" :
                  file.type.includes("sheet") || file.type.includes("excel") ? "bg-green-600" :
                  file.type.includes("presentation") || file.type.includes("powerpoint") ? "bg-orange-500" :
                  "bg-gray-500"
                )}>
                  <span className="text-white text-xs font-bold">
                    {file.type.includes("pdf") ? "PDF" :
                     file.type.includes("word") || file.type.includes("document") ? "W" :
                     file.type.includes("sheet") || file.type.includes("excel") ? "X" :
                     file.type.includes("presentation") || file.type.includes("powerpoint") ? "P" :
                     "F"}
                  </span>
                </div>
                <span className="max-w-[200px] truncate font-medium">{file.name}</span>
                {file.status === "uploading" && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500 ml-1" />
                )}
                {file.status === "processing" && (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-500 ml-1" />
                )}
                <button
                  className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  onClick={() => removeFile(index)}
                  data-testid={`button-remove-file-${index}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="relative flex items-end gap-2 rounded-3xl liquid-input-light p-2 focus-within:shadow-lg transition-all duration-300">
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
          
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Type your message here..."
            className="min-h-[40px] w-full resize-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 text-base"
            rows={1}
          />

          <div className="flex items-center gap-1 pb-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground">
              <Mic className="h-5 w-5" />
            </Button>
            {aiState !== "idle" ? (
              <Button 
                onClick={handleStopChat}
                size="icon" 
                className="h-9 w-9 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all duration-300"
                data-testid="button-stop-chat"
              >
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button 
                onClick={handleSubmit}
                disabled={!input.trim() && uploadedFiles.length === 0}
                size="icon" 
                className={cn(
                  "h-9 w-9 rounded-full transition-all duration-300",
                  (input.trim() || uploadedFiles.length > 0) ? "liquid-btn" : "bg-muted/50 text-muted-foreground"
                )}
                data-testid="button-send-message"
              >
                <ArrowUp className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>
        <div className="text-center text-xs text-muted-foreground mt-3">
          Sira GPT can make mistakes. Check important info.
        </div>
      </div>
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
