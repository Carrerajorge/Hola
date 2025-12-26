import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, X, MessageSquare, Loader2, Clock, Calendar } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chat } from "@/hooks/use-chats";
import { format, isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";
import { es } from "date-fns/locale";

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chats: Chat[];
  onSelectChat: (id: string) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

function formatChatDate(date: Date): string {
  if (isToday(date)) return "Hoy";
  if (isYesterday(date)) return "Ayer";
  if (isThisWeek(date)) return format(date, "EEEE", { locale: es });
  if (isThisMonth(date)) return format(date, "d 'de' MMMM", { locale: es });
  return format(date, "d MMM yyyy", { locale: es });
}

export function SearchModal({
  open,
  onOpenChange,
  chats,
  onSelectChat,
  triggerRef,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<Chat[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 200);

  const recentChats = useMemo(() => {
    return [...chats]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
  }, [chats]);

  const searchChats = useCallback((searchQuery: string, allChats: Chat[]) => {
    if (!searchQuery.trim()) {
      return [];
    }

    const lowerQuery = searchQuery.toLowerCase();
    const words = lowerQuery.split(/\s+/).filter(w => w.length > 0);

    return allChats
      .map((chat) => {
        let score = 0;
        const titleLower = chat.title.toLowerCase();
        
        if (titleLower === lowerQuery) score += 100;
        else if (titleLower.startsWith(lowerQuery)) score += 50;
        else if (titleLower.includes(lowerQuery)) score += 25;
        
        words.forEach(word => {
          if (titleLower.includes(word)) score += 10;
        });

        const matchingMessages = chat.messages.filter((msg) =>
          msg.content.toLowerCase().includes(lowerQuery)
        );
        score += matchingMessages.length * 5;

        const recency = Date.now() - new Date(chat.timestamp).getTime();
        const daysSinceChat = recency / (1000 * 60 * 60 * 24);
        if (daysSinceChat < 1) score += 20;
        else if (daysSinceChat < 7) score += 10;
        else if (daysSinceChat < 30) score += 5;

        return { chat, score, matchCount: matchingMessages.length };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ chat, matchCount }) => ({ ...chat, matchCount }));
  }, []);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    
    const timer = setTimeout(() => {
      const searchResults = searchChats(debouncedQuery, chats);
      setResults(searchResults);
      setSelectedIndex(0);
      setIsSearching(false);
    }, 50);

    return () => clearTimeout(timer);
  }, [debouncedQuery, chats, searchChats]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      triggerRef?.current?.focus();
    }
  }, [open, triggerRef]);

  const displayedItems = query.trim() ? results : recentChats;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, displayedItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && displayedItems.length > 0) {
      e.preventDefault();
      handleSelectResult(displayedItems[selectedIndex].id);
    }
  };

  const handleSelectResult = (chatId: string) => {
    onSelectChat(chatId);
    onOpenChange(false);
  };

  const getLastMessagePreview = (chat: Chat) => {
    const lastMessage = chat.messages[chat.messages.length - 1];
    if (!lastMessage) return "Sin mensajes";
    const preview = lastMessage.content.slice(0, 80);
    return preview + (lastMessage.content.length > 80 ? "..." : "");
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    try {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = text.split(new RegExp(`(${escapedQuery})`, "gi"));
      return parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/50 text-foreground rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      );
    } catch {
      return text;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[50vw] max-w-[50vw] h-[50vh] max-h-[50vh] p-0 gap-0 overflow-hidden flex flex-col"
        aria-describedby={undefined}
        onKeyDown={handleKeyDown}
        data-testid="modal-search"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Buscar chats</DialogTitle>
        </DialogHeader>

        <div className="flex items-center border-b px-4 py-3 flex-shrink-0">
          <Search className="h-5 w-5 text-muted-foreground mr-3 flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en tus conversaciones..."
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-10 text-base"
            aria-label="Buscar conversaciones"
            data-testid="input-search-modal"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              data-testid="button-clear-search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1" ref={resultsRef}>
          <div 
            className="p-3" 
            role="listbox" 
            aria-label="Resultados de búsqueda"
            aria-activedescendant={displayedItems.length > 0 ? `search-result-option-${displayedItems[selectedIndex]?.id}` : undefined}
          >
            {isSearching && (
              <div
                className="flex items-center justify-center py-12 text-muted-foreground"
                data-testid="search-loading"
              >
                <Loader2 className="h-6 w-6 animate-spin mr-3" />
                <span className="text-base">Buscando...</span>
              </div>
            )}

            {!isSearching && query.trim() && results.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-12 text-muted-foreground"
                data-testid="search-no-results"
              >
                <Search className="h-10 w-10 mb-3 opacity-50" />
                <p className="text-base font-medium">No se encontraron resultados</p>
                <p className="text-sm mt-1">Intenta con otros términos de búsqueda</p>
              </div>
            )}

            {!isSearching && !query.trim() && recentChats.length > 0 && (
              <div className="flex flex-col">
                <div className="flex items-center gap-2 px-2 py-2 text-sm font-medium text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Conversaciones recientes</span>
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  {recentChats.map((chat, index) => (
                    <button
                      key={chat.id}
                      id={`search-result-option-${chat.id}`}
                      className={cn(
                        "flex items-start gap-3 w-full p-3 rounded-lg text-left transition-colors",
                        "hover:bg-accent",
                        selectedIndex === index && "bg-accent"
                      )}
                      onClick={() => handleSelectResult(chat.id)}
                      role="option"
                      aria-selected={selectedIndex === index}
                      data-testid={`search-result-${chat.id}`}
                    >
                      <MessageSquare className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">
                            {chat.title}
                          </span>
                          <span className="text-xs text-muted-foreground flex-shrink-0 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatChatDate(new Date(chat.timestamp))}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {getLastMessagePreview(chat)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isSearching && !query.trim() && recentChats.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-12 text-muted-foreground"
                data-testid="search-empty-state"
              >
                <MessageSquare className="h-10 w-10 mb-3 opacity-50" />
                <p className="text-base font-medium">No hay conversaciones</p>
                <p className="text-sm mt-1">Inicia un nuevo chat para comenzar</p>
              </div>
            )}

            {!isSearching && query.trim() && results.length > 0 && (
              <div className="flex flex-col gap-1">
                {results.map((chat: any, index: number) => (
                  <button
                    key={chat.id}
                    id={`search-result-option-${chat.id}`}
                    className={cn(
                      "flex items-start gap-3 w-full p-3 rounded-lg text-left transition-colors",
                      "hover:bg-accent",
                      selectedIndex === index && "bg-accent"
                    )}
                    onClick={() => handleSelectResult(chat.id)}
                    role="option"
                    aria-selected={selectedIndex === index}
                    data-testid={`search-result-${chat.id}`}
                  >
                    <MessageSquare className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">
                          {highlightMatch(chat.title, debouncedQuery)}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {chat.matchCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">
                              {chat.matchCount} coincidencia{chat.matchCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatChatDate(new Date(chat.timestamp))}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {highlightMatch(getLastMessagePreview(chat), debouncedQuery)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-4 py-2.5 text-xs text-muted-foreground flex items-center justify-between flex-shrink-0 bg-muted/30">
          <span className="font-medium">
            {query.trim() 
              ? (results.length > 0 ? `${results.length} resultado${results.length !== 1 ? 's' : ''}` : '')
              : `${recentChats.length} conversación${recentChats.length !== 1 ? 'es' : ''} reciente${recentChats.length !== 1 ? 's' : ''}`
            }
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">↑↓</kbd>
              <span>navegar</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">↵</kbd>
              <span>abrir</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">esc</kbd>
              <span>cerrar</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
