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
  Minimize2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Upload, Search, Image, Video, Bot, Plug } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

import { Message } from "@/hooks/use-chats";

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: Message) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function ChatInterface({ 
  messages, 
  onSendMessage, 
  isSidebarOpen = true, 
  onToggleSidebar 
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("https://www.google.com");
  const [isBrowserMaximized, setIsBrowserMaximized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    onSendMessage(userMsg);
    const userInput = input;
    setInput("");
    setIsTyping(true);

    try {
      // Build message history for context
      const chatHistory = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.content,
        timestamp: new Date(),
      };
      
      onSendMessage(aiMsg);
    } catch (error: any) {
      console.error("Chat error:", error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Lo siento, hubo un error al procesar tu mensaje. Por favor intenta de nuevo.`,
        timestamp: new Date(),
      };
      onSendMessage(errorMsg);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background relative">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-4 border-b bg-background/50 backdrop-blur-sm z-10 sticky top-0">
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

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 space-y-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center space-y-4 opacity-50">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <BotIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">How can I help you today?</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex w-full max-w-3xl mx-auto gap-4",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="h-8 w-8 rounded-full bg-black/5 flex items-center justify-center flex-shrink-0 mt-1">
                <BotIcon className="h-5 w-5" />
              </div>
            )}
            
            <div className={cn(
              "flex flex-col gap-2 max-w-[85%]",
              msg.role === "user" ? "items-end" : "items-start"
            )}>
              {msg.role === "user" ? (
                <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm">
                  {msg.content}
                </div>
              ) : (
                <div className="space-y-4 w-full">
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
                     <div className="text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-code:before:content-none prose-code:after:content-none">
                       <ReactMarkdown
                         remarkPlugins={[remarkGfm, remarkMath]}
                         rehypePlugins={[rehypeKatex, rehypeHighlight]}
                       >
                         {msg.content}
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
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

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
              {isTyping && (
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
              {isTyping && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              )}
            </div>
          </div>
        )}
        
        <div className="relative flex items-end gap-2 rounded-3xl border bg-background shadow-sm p-2 focus-within:ring-1 focus-within:ring-ring transition-shadow">
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
                <Button variant="ghost" className="justify-start gap-2 text-sm h-9">
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
            <Button 
              onClick={handleSubmit}
              disabled={!input.trim()}
              size="icon" 
              className={cn(
                "h-9 w-9 rounded-full transition-all",
                input.trim() ? "bg-black text-white hover:bg-black/90" : "bg-muted text-muted-foreground"
              )}
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
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
