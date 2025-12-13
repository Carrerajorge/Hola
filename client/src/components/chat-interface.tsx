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
  PanelLeftOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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
    setInput("");
    setIsTyping(true);

    // Simulate AI processing with sub-objectives
    setTimeout(() => {
      const aiMsgId = (Date.now() + 1).toString();
      const aiMsg: Message = {
        id: aiMsgId,
        role: "assistant",
        content: "I'll help you with that. I'm starting the process now.",
        timestamp: new Date(),
        isThinking: true,
        steps: [
          { title: "Analyzing request parameters", status: "loading" },
          { title: "Searching relevant sources", status: "pending" },
          { title: "Compiling data", status: "pending" },
          { title: "Generating documents", status: "pending" },
        ],
      };
      
      onSendMessage(aiMsg);

      // Simulate step progression - In a real app this would be streaming updates
      // For this mock, we'll just update the message in place via the parent's addMessage 
      // but since addMessage appends, we need a way to update. 
      // For simplicity in this mock, we will just send a "completion" message after delay
      // replacing the thinking one or appending. 
      // To keep it simple, let's just append the final result after delay.
      
      setTimeout(() => {
        const finalMsg: Message = {
          id: (Date.now() + 2).toString(),
          role: "assistant",
          content: "I have successfully gathered the information and created the requested documents. You can download them below.",
          timestamp: new Date(),
          attachments: [
            { type: "word", name: "Report.docx" },
            { type: "excel", name: "Data_Analysis.xlsx" },
            { type: "ppt", name: "Presentation.pptx" },
          ]
        };
        onSendMessage(finalMsg);
        setIsTyping(false);
      }, 4000);

    }, 500);
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
                     <div className="text-sm leading-relaxed text-foreground">
                       {msg.content}
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
      <div className="p-4 sm:p-6 w-full max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2 rounded-3xl border bg-background shadow-sm p-2 focus-within:ring-1 focus-within:ring-ring transition-shadow">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground">
            <Plus className="h-5 w-5" />
          </Button>
          
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
