import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Image, Video, FileText, Download, X, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaItem {
  id: string;
  title: string;
  type: "image" | "video" | "document";
  url: string;
  thumbnailUrl?: string;
  createdAt: string;
}

interface UserLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterType = "all" | "image" | "video" | "document";

function MediaItemSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function EmptyState({ filter }: { filter: FilterType }) {
  const messages: Record<FilterType, string> = {
    all: "No tienes archivos en tu biblioteca",
    image: "No tienes imágenes guardadas",
    video: "No tienes videos guardados",
    document: "No tienes documentos guardados",
  };

  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="empty-state"
    >
      <FolderOpen className="h-16 w-16 text-muted-foreground/50 mb-4" />
      <p className="text-lg font-medium text-muted-foreground">
        {messages[filter]}
      </p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Los archivos que subas aparecerán aquí
      </p>
    </div>
  );
}

function MediaThumbnail({
  item,
  onClick,
}: {
  item: MediaItem;
  onClick: () => void;
}) {
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(item.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.title;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  return (
    <div
      className="group relative flex flex-col gap-2 cursor-pointer"
      onClick={onClick}
      data-testid={`media-item-${item.id}`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted border border-border/50 transition-all duration-200 group-hover:border-primary/30 group-hover:shadow-md">
        {item.type === "image" ? (
          <img
            src={item.thumbnailUrl || item.url}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : item.type === "video" ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-500/10 to-blue-500/10">
            <Video className="h-12 w-12 text-muted-foreground/70" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-red-500/10">
            <FileText className="h-12 w-12 text-muted-foreground/70" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/40 group-hover:opacity-100">
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full bg-white/90 hover:bg-white shadow-lg"
            onClick={handleDownload}
            data-testid={`download-button-${item.id}`}
          >
            <Download className="h-5 w-5 text-gray-700" />
          </Button>
        </div>
      </div>
      <p className="truncate text-sm font-medium text-foreground/90 px-1">
        {item.title}
      </p>
    </div>
  );
}

function LightboxView({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const handleDownload = async () => {
    try {
      const response = await fetch(item.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.title;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={onClose}
      data-testid="lightbox-overlay"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
        data-testid="lightbox-close"
      >
        <X className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-16 top-4 h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={(e) => {
          e.stopPropagation();
          handleDownload();
        }}
        data-testid="lightbox-download"
      >
        <Download className="h-5 w-5" />
      </Button>
      <div
        className="max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {item.type === "image" ? (
          <img
            src={item.url}
            alt={item.title}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        ) : item.type === "video" ? (
          <video
            src={item.url}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg bg-white/10 p-12">
            <FileText className="h-24 w-24 text-white/70" />
            <p className="text-lg font-medium text-white">{item.title}</p>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              data-testid="lightbox-download-document"
            >
              <Download className="h-4 w-4 mr-2" />
              Descargar documento
            </Button>
          </div>
        )}
      </div>
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">
        {item.title}
      </p>
    </div>
  );
}

export function UserLibrary({ open, onOpenChange }: UserLibraryProps) {
  const [activeTab, setActiveTab] = useState<FilterType>("all");
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);

  const queryParam = activeTab === "all" ? "" : `?type=${activeTab}`;

  const { data: items = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/library", activeTab],
    queryFn: async () => {
      const response = await fetch(`/api/library${queryParam}`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error("Failed to fetch library");
      }
      const data = await response.json();
      // Map API response fields to MediaItem interface
      return data.map((item: any) => ({
        id: item.id,
        title: item.title,
        type: item.mediaType as "image" | "video" | "document",
        url: item.storagePath,
        thumbnailUrl: item.thumbnailPath,
        createdAt: item.createdAt,
      }));
    },
    enabled: open,
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value as FilterType);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen max-h-screen p-0 rounded-none border-0 gap-0"
          data-testid="user-library-dialog"
        >
          <DialogHeader className="px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <DialogTitle className="text-xl font-semibold" data-testid="library-title">
              Tu Biblioteca de Medios
            </DialogTitle>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex flex-col h-[calc(100vh-73px)]"
          >
            <div className="px-6 pt-4 pb-2 border-b bg-background">
              <TabsList className="h-10" data-testid="library-tabs">
                <TabsTrigger
                  value="all"
                  className="px-4"
                  data-testid="tab-all"
                >
                  Todo
                </TabsTrigger>
                <TabsTrigger
                  value="image"
                  className="px-4 gap-2"
                  data-testid="tab-images"
                >
                  <Image className="h-4 w-4" />
                  Imágenes
                </TabsTrigger>
                <TabsTrigger
                  value="video"
                  className="px-4 gap-2"
                  data-testid="tab-videos"
                >
                  <Video className="h-4 w-4" />
                  Videos
                </TabsTrigger>
                <TabsTrigger
                  value="document"
                  className="px-4 gap-2"
                  data-testid="tab-documents"
                >
                  <FileText className="h-4 w-4" />
                  Documentos
                </TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1 px-6 py-4">
              <TabsContent value={activeTab} className="mt-0 h-full">
                {isLoading ? (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                    data-testid="loading-skeleton"
                  >
                    {Array.from({ length: 12 }).map((_, i) => (
                      <MediaItemSkeleton key={i} />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <EmptyState filter={activeTab} />
                ) : (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                    data-testid="media-grid"
                  >
                    {items.map((item) => (
                      <MediaThumbnail
                        key={item.id}
                        item={item}
                        onClick={() => setLightboxItem(item)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </DialogContent>
      </Dialog>

      {lightboxItem && (
        <LightboxView
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
        />
      )}
    </>
  );
}
