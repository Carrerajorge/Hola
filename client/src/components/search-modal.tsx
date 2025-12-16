import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, MessageSquare, Loader2 } from "lucide-react";
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
import { format } from "date-fns";

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

  const debouncedQuery = useDebounce(query, 300);

  const searchChats = useCallback((searchQuery: string, allChats: Chat[]) => {
    if (!searchQuery.trim()) {
      return [];
    }

    const lowerQuery = searchQuery.toLowerCase();

    return allChats.filter((chat) => {
      const titleMatch = chat.title.toLowerCase().includes(lowerQuery);

      const lastMessage = chat.messages[chat.messages.length - 1];
      const lastMessageMatch = lastMessage
        ? lastMessage.content.toLowerCase().includes(lowerQuery)
        : false;

      const anyMessageMatch = chat.messages.some((msg) =>
        msg.content.toLowerCase().includes(lowerQuery)
      );

      return titleMatch || lastMessageMatch || anyMessageMatch;
    });
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
    }, 100);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      handleSelectResult(results[selectedIndex].id);
    }
  };

  const handleSelectResult = (chatId: string) => {
    onSelectChat(chatId);
    onOpenChange(false);
  };

  const getLastMessagePreview = (chat: Chat) => {
    const lastMessage = chat.messages[chat.messages.length - 1];
    if (!lastMessage) return "Sin mensajes";
    const preview = lastMessage.content.slice(0, 60);
    return preview + (lastMessage.content.length > 60 ? "..." : "");
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl p-0 gap-0 overflow-hidden"
        aria-describedby={undefined}
        onKeyDown={handleKeyDown}
        data-testid="modal-search"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Buscar chats</DialogTitle>
        </DialogHeader>

        <div className="flex items-center border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground mr-2 flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar chats..."
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-10"
            aria-label="Buscar conversaciones"
            data-testid="input-search-modal"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              data-testid="button-clear-search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[300px]" ref={resultsRef}>
          <div 
            className="p-2" 
            role="listbox" 
            aria-label="Resultados de búsqueda"
            aria-activedescendant={results.length > 0 ? `search-result-option-${results[selectedIndex]?.id}` : undefined}
          >
            {isSearching && (
              <div
                className="flex items-center justify-center py-8 text-muted-foreground"
                data-testid="search-loading"
              >
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span>Buscando...</span>
              </div>
            )}

            {!isSearching && query.trim() && results.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-8 text-muted-foreground"
                data-testid="search-no-results"
              >
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p>No se encontraron resultados</p>
                <p className="text-sm">Intenta con otros términos</p>
              </div>
            )}

            {!isSearching && !query.trim() && (
              <div
                className="flex flex-col items-center justify-center py-8 text-muted-foreground"
                data-testid="search-empty-state"
              >
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p>Escribe para buscar</p>
              </div>
            )}

            {!isSearching && results.length > 0 && (
              <div className="flex flex-col gap-1">
                {results.map((chat, index) => (
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
                    <MessageSquare className="h-4 w-4 mt-1 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">
                          {highlightMatch(chat.title, debouncedQuery)}
                        </span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {format(new Date(chat.timestamp), "dd/MM")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {highlightMatch(getLastMessagePreview(chat), debouncedQuery)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
          <span>{results.length > 0 ? `${results.length} resultado${results.length !== 1 ? 's' : ''}` : ''}</span>
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>
            <span>navegar</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↵</kbd>
            <span>seleccionar</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">esc</kbd>
            <span>cerrar</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
