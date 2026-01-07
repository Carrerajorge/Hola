import React, { memo } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";

interface SourcesIndicatorProps {
  sources: WebSource[];
  onViewSources: () => void;
}

export const SourcesIndicator = memo(function SourcesIndicator({
  sources,
  onViewSources
}: SourcesIndicatorProps) {
  if (!sources || sources.length === 0) return null;

  const displayedSources = sources.slice(0, 3);
  const remainingCount = sources.length - displayedSources.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onViewSources}
          data-testid="button-sources"
        >
          <div className="flex items-center -space-x-1">
            {displayedSources.map((source, idx) => (
              <div
                key={`${source.domain}-${idx}`}
                className={cn(
                  "w-4 h-4 rounded-full bg-background border border-border overflow-hidden flex items-center justify-center",
                  idx > 0 && "ring-1 ring-background"
                )}
              >
                {source.favicon ? (
                  <img
                    src={source.favicon}
                    alt={source.domain}
                    className="w-3 h-3 object-contain"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : (
                  <Globe className="w-2.5 h-2.5 text-muted-foreground" />
                )}
                <Globe className="w-2.5 h-2.5 text-muted-foreground hidden" />
              </div>
            ))}
            {remainingCount > 0 && (
              <div className="w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-medium text-muted-foreground ring-1 ring-background">
                +{remainingCount}
              </div>
            )}
          </div>
          <span className="text-xs font-medium">Fuentes</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>Ver {sources.length} fuentes</p>
      </TooltipContent>
    </Tooltip>
  );
});
