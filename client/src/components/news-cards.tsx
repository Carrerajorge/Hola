import React, { memo } from "react";
import { ExternalLink, Globe, ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebSource } from "@/hooks/use-chats";
import { useRef, useState } from "react";

interface NewsCardsProps {
  sources: WebSource[];
  maxDisplay?: number;
}

const getGradientForDomain = (domain: string): string => {
  const colors = [
    "from-blue-500 to-blue-700",
    "from-red-500 to-red-700",
    "from-green-500 to-green-700",
    "from-purple-500 to-purple-700",
    "from-orange-500 to-orange-700",
    "from-pink-500 to-pink-700",
    "from-cyan-500 to-cyan-700",
    "from-indigo-500 to-indigo-700",
  ];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const NewsCard = memo(function NewsCard({ source, index }: { source: WebSource; index: number }) {
  const [imageError, setImageError] = useState(false);
  const hasImage = source.imageUrl && !imageError;

  return (
    <a
      href={source.canonicalUrl || source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-shrink-0 w-[200px] group cursor-pointer"
      data-testid={`news-card-${index}`}
    >
      <div className="rounded-xl overflow-hidden border border-border bg-card hover:border-primary/50 transition-all duration-200 hover:shadow-lg">
        <div className={cn(
          "h-28 flex items-center justify-center relative overflow-hidden",
          !hasImage && "bg-gradient-to-br",
          !hasImage && getGradientForDomain(source.domain)
        )}>
          {hasImage ? (
            <img
              src={source.imageUrl}
              alt={source.title || source.domain}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
              loading="lazy"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-black/10" />
              <span className="text-white/80 text-3xl font-bold uppercase">
                {source.domain.slice(0, 2)}
              </span>
            </>
          )}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <ExternalLink className="w-4 h-4 text-white drop-shadow-md" />
          </div>
        </div>
        
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            {source.favicon ? (
              <img
                src={source.favicon}
                alt={source.source?.name || source.domain}
                className="w-4 h-4 rounded-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            ) : (
              <Globe className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground truncate">
              {source.source?.name || source.siteName || source.domain}
            </span>
          </div>
          
          <h4 className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {source.title || source.domain}
          </h4>
          
          {source.date && (
            <span className="text-xs text-muted-foreground">{source.date}</span>
          )}
        </div>
      </div>
    </a>
  );
});

export const NewsCards = memo(function NewsCards({ sources, maxDisplay = 5 }: NewsCardsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  if (!sources || sources.length === 0) return null;

  const displaySources = sources.slice(0, maxDisplay);

  const updateScrollState = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 220;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      setTimeout(updateScrollState, 300);
    }
  };

  return (
    <div className="relative my-4" data-testid="news-cards-container">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium text-muted-foreground">Fuentes destacadas</span>
      </div>
      
      <div className="relative group">
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-background/90 border border-border shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
            data-testid="scroll-left-button"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide pb-2"
          onScroll={updateScrollState}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {displaySources.map((source, idx) => (
            <NewsCard key={`${source.url}-${idx}`} source={source} index={idx} />
          ))}
        </div>
        
        {canScrollRight && displaySources.length > 2 && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-background/90 border border-border shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent"
            data-testid="scroll-right-button"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
});

export const SourcesList = memo(function SourcesList({ sources }: { sources: WebSource[] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="space-y-3 my-4" data-testid="sources-list">
      {sources.map((source, idx) => (
        <a
          key={`${source.url}-${idx}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-all group"
          data-testid={`source-item-${idx}`}
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            {source.favicon ? (
              <img
                src={source.favicon}
                alt={source.domain}
                className="w-6 h-6 object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null;
                  target.src = '';
                  target.style.display = 'none';
                }}
              />
            ) : (
              <Globe className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">{source.domain}</span>
              {source.date && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{source.date}</span>
                </>
              )}
            </div>
            <h4 className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">
              {source.title || source.url}
            </h4>
            {source.snippet && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                {source.snippet}
              </p>
            )}
          </div>
          
          <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </a>
      ))}
    </div>
  );
});
