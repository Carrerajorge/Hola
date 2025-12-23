import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, Mail, Search, RefreshCw, Send, ChevronDown, ChevronUp,
  Inbox, Star, Archive, Trash2, MailOpen, MailWarning, Clock,
  User, AlertCircle, Check, ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO } from "date-fns";

interface SourceMetadata {
  provider: 'gmail';
  accountId?: string;
  accountEmail?: string;
  mailbox: string;
  messageId: string;
  threadId: string;
  labels: string[];
  permalink: string;
}

interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
  source?: SourceMetadata;
}

interface EmailMessage {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  subject: string;
  body: string;
  snippet: string;
  source?: SourceMetadata;
}

interface EmailThread {
  id: string;
  subject: string;
  messages: EmailMessage[];
  labels: string[];
}

const SourceBadge = ({ source, subject }: { source: SourceMetadata; subject: string }) => (
  <a
    href={source.permalink}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 transition-colors cursor-pointer"
    title={`Abrir en Gmail: ${subject}`}
    onClick={(e) => e.stopPropagation()}
  >
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none">
      <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z" fill="currentColor"/>
    </svg>
    <span className="truncate max-w-[120px]">{subject}</span>
  </a>
);

export interface InlineGmailPreviewProps {
  query?: string;
  action?: "search" | "unread" | "recent" | "thread";
  threadId?: string;
  onComplete?: (message: string) => void;
}

type Status = "loading" | "connected" | "not_connected" | "error";
type ViewMode = "list" | "thread" | "compose";

const GmailLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none">
    <path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z" fill="currentColor"/>
  </svg>
);

function formatEmailDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return format(date, "HH:mm");
    } else if (diffDays < 7) {
      return format(date, "EEE");
    } else {
      return format(date, "d MMM");
    }
  } catch {
    return dateStr;
  }
}

export function InlineGmailPreview({ 
  query: initialQuery = "",
  action = "recent",
  threadId: initialThreadId,
  onComplete
}: InlineGmailPreviewProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [viewMode, setViewMode] = useState<ViewMode>(initialThreadId ? "thread" : "list");
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionEmail, setConnectionEmail] = useState<string>("");
  
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google/gmail/status");
      const data = await res.json();
      
      if (data.connected) {
        setStatus("connected");
        setConnectionEmail(data.email || "");
        loadEmails();
      } else {
        setStatus("not_connected");
      }
    } catch (err) {
      console.error("Error checking Gmail connection:", err);
      setStatus("error");
      setError("No se pudo verificar la conexión");
    }
  }, []);

  const loadEmails = useCallback(async (q?: string, append: boolean = false, pageToken?: string) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
    }
    setError(null);
    
    try {
      let queryParam = q || searchQuery;
      
      if (action === "unread") {
        queryParam = "is:unread " + queryParam;
      }
      
      let url = `/api/integrations/google/gmail/search?q=${encodeURIComponent(queryParam)}&maxResults=20`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.emails) {
        if (append) {
          setEmails(prev => [...prev, ...data.emails]);
        } else {
          setEmails(data.emails);
        }
        setNextPageToken(data.nextPageToken || null);
      }
    } catch (err: any) {
      console.error("Error loading emails:", err);
      setError("Error al cargar correos");
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  }, [searchQuery, action]);

  const loadMoreEmails = useCallback(() => {
    if (nextPageToken && !isLoadingMore) {
      loadEmails(searchQuery, true, nextPageToken);
    }
  }, [nextPageToken, isLoadingMore, loadEmails, searchQuery]);

  const loadThread = useCallback(async (threadId: string) => {
    setIsSearching(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/integrations/google/gmail/threads/${threadId}`);
      const data = await res.json();
      
      if (data.id) {
        setSelectedThread(data);
        setViewMode("thread");
        
        if (data.messages?.length > 0) {
          const lastMessage = data.messages[data.messages.length - 1];
          setReplyTo(lastMessage.fromEmail);
          setReplySubject(data.subject);
        }
      }
    } catch (err: any) {
      console.error("Error loading thread:", err);
      setError("Error al cargar la conversación");
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setNextPageToken(null);
    loadEmails(searchQuery);
  };

  const handleSelectEmail = (email: EmailSummary) => {
    loadThread(email.threadId);
  };

  const handleSendReply = async () => {
    if (!selectedThread || !replyBody.trim()) return;
    
    setIsSending(true);
    setError(null);
    
    try {
      const res = await fetch("/api/integrations/google/gmail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThread.id,
          to: replyTo,
          subject: replySubject,
          body: replyBody
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setReplyBody("");
        onComplete?.(`Respuesta enviada a ${replyTo}`);
        loadThread(selectedThread.id);
      } else {
        setError(data.error || "Error al enviar respuesta");
      }
    } catch (err: any) {
      setError("Error al enviar respuesta");
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    if (initialThreadId && status === "connected") {
      loadThread(initialThreadId);
    }
  }, [initialThreadId, status, loadThread]);

  if (status === "loading") {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex items-center justify-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-red-600" />
          <span className="text-sm text-muted-foreground">Conectando con Gmail...</span>
        </div>
      </motion.div>
    );
  }

  if (status === "not_connected") {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-gray-900 p-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <Mail className="h-7 w-7 text-red-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium">Gmail no conectado</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Conecta Gmail desde la configuración de integraciones para acceder a tus correos
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-900/20 dark:to-gray-900 overflow-hidden"
    >
      <div className="p-4 border-b border-red-200 dark:border-red-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="font-medium flex items-center gap-2">
                Gmail
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                  CONECTADO
                </span>
              </h4>
              <p className="text-xs text-muted-foreground">{connectionEmail}</p>
            </div>
          </div>
          
          {viewMode === "thread" && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => { setViewMode("list"); setSelectedThread(null); }}
            >
              <ChevronUp className="h-4 w-4 mr-1" />
              Volver
            </Button>
          )}
        </div>

        {viewMode === "list" && (
          <form onSubmit={handleSearch} className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar correos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button type="submit" size="sm" disabled={isSearching} className="bg-red-600 hover:bg-red-700 text-white">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => loadEmails()} disabled={isSearching}>
              <RefreshCw className={cn("h-4 w-4", isSearching && "animate-spin")} />
            </Button>
          </form>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-100 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        </div>
      )}

      <ScrollArea className="max-h-[400px]">
        <AnimatePresence mode="wait">
          {viewMode === "list" && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {emails.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No se encontraron correos</p>
                </div>
              ) : (
                <div className="divide-y divide-red-100 dark:divide-red-900/30">
                  {emails.map((email) => (
                    <button
                      key={email.id}
                      onClick={() => handleSelectEmail(email)}
                      className={cn(
                        "w-full p-3 text-left hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors",
                        email.isUnread && "bg-red-50/50 dark:bg-red-900/10"
                      )}
                      data-testid={`email-item-${email.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium",
                          email.isUnread 
                            ? "bg-red-600 text-white" 
                            : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        )}>
                          {email.from.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn(
                              "text-sm truncate",
                              email.isUnread && "font-semibold"
                            )}>
                              {email.from}
                            </span>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {formatEmailDate(email.date)}
                            </span>
                          </div>
                          <p className={cn(
                            "text-sm truncate",
                            email.isUnread ? "font-medium" : "text-muted-foreground"
                          )}>
                            {email.subject}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {email.snippet}
                          </p>
                          {email.source && (
                            <div className="mt-1.5">
                              <SourceBadge source={email.source} subject={email.subject} />
                            </div>
                          )}
                        </div>
                        {email.isUnread && (
                          <div className="w-2 h-2 rounded-full bg-red-600 flex-shrink-0 mt-2" />
                        )}
                      </div>
                    </button>
                  ))}
                  
                  {nextPageToken && (
                    <div className="p-3 flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadMoreEmails}
                        disabled={isLoadingMore}
                        className="w-full"
                        data-testid="button-load-more-emails"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Cargando...
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-2" />
                            Cargar más correos
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {viewMode === "thread" && selectedThread && (
            <motion.div
              key="thread"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4"
            >
              <h3 className="font-semibold text-lg mb-4">{selectedThread.subject}</h3>
              
              <div className="space-y-4">
                {selectedThread.messages.map((msg, idx) => (
                  <div 
                    key={msg.id}
                    className="p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-xs font-medium text-red-600">
                          {msg.from.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{msg.from}</p>
                          <p className="text-xs text-muted-foreground">{msg.fromEmail}</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatEmailDate(msg.date)}
                      </span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap pl-10">
                      {msg.body.slice(0, 1000)}
                      {msg.body.length > 1000 && "..."}
                    </div>
                    {msg.source && (
                      <div className="mt-2 pl-10">
                        <SourceBadge source={msg.source} subject={msg.subject} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-red-200 dark:border-red-800">
                <h4 className="text-sm font-medium mb-2">Responder</h4>
                <div className="space-y-2">
                  <Input
                    placeholder="Para:"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    className="text-sm"
                  />
                  <Textarea
                    placeholder="Escribe tu respuesta..."
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                  <div className="flex justify-end">
                    <Button 
                      onClick={handleSendReply}
                      disabled={!replyBody.trim() || isSending}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Enviar
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </motion.div>
  );
}
