import React, { memo } from "react";
import { ExternalLink, Globe, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";

interface SourcesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: WebSource[];
}

const SourceCard = memo(function SourceCard({ 
  source, 
  index 
}: { 
  source: WebSource; 
  index: number;
}) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 rounded-lg border border-border/50 hover:border-border hover:bg-muted/50 transition-colors group"
      data-testid={`source-card-${index}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
          {source.favicon ? (
            <img
              src={source.favicon}
              alt={source.domain}
              className="w-5 h-5 object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const fallback = target.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : (
            <Globe className="w-4 h-4 text-muted-foreground" />
          )}
          <Globe className="w-4 h-4 text-muted-foreground hidden" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              {source.domain}
            </span>
            {source.date && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="text-xs text-muted-foreground">
                  {source.date}
                </span>
              </>
            )}
          </div>
          <p className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
            {source.title}
          </p>
          {source.snippet && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {source.snippet}
            </p>
          )}
        </div>
        <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </div>
    </a>
  );
});

export const SourcesPanel = memo(function SourcesPanel({
  open,
  onOpenChange,
  sources
}: SourcesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md p-0 flex flex-col"
        data-testid="sources-panel"
      >
        <SheetHeader className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">
              Citas ({sources.length})
            </SheetTitle>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3">
            {sources.map((source, idx) => (
              <SourceCard 
                key={`${source.url}-${idx}`} 
                source={source} 
                index={idx} 
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
});
