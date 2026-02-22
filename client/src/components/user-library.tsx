import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Image, Video, FileText, Download, X, FolderOpen, Trash2, Upload, HardDrive, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCloudLibrary,
  LibraryFile,
  formatFileSize,
  formatStorageUsage,
  type FileType
} from "@/hooks/use-cloud-library";
import { toast } from "@/hooks/use-toast";

interface UserLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterType = "all" | "image" | "video" | "document" | "app";

import { Grid } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";

// ... existing imports ...

interface VirtualizedGridProps {
  items: LibraryFile[];
  onSelect: (item: LibraryFile) => void;
  onDelete: (item: LibraryFile) => void;
  onDownload: (item: LibraryFile) => void;
}

const GUTTER_SIZE = 16;
const ITEM_HEIGHT = 200; // Approximate height of card + text
const OPTS_MIN_COLUMN_WIDTH = 180;

function VirtualizedMediaGrid({ items, onSelect, onDelete, onDownload }: VirtualizedGridProps) {
  return (
    // @ts-ignore - react-virtualized-auto-sizer types mismatch
    <AutoSizer>
      {({ height, width }: { height: number; width: number }) => {
        const columnCount = Math.floor((width + GUTTER_SIZE) / (OPTS_MIN_COLUMN_WIDTH + GUTTER_SIZE));
        const safeColumnCount = Math.max(1, columnCount);
        const columnWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
        const rowCount = Math.ceil(items.length / safeColumnCount);

        return (
          // @ts-ignore - react-window prop types mismatch with modern React 18 children
          <Grid
            columnCount={safeColumnCount}
            columnWidth={columnWidth + GUTTER_SIZE}
            height={height}
            rowCount={rowCount}
            rowHeight={ITEM_HEIGHT + GUTTER_SIZE}
            width={width}
            className="px-6 py-4"
          >
            {({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
              const index = rowIndex * safeColumnCount + columnIndex;
              if (index >= items.length) return null;
              const item = items[index];

              // Adjust style for gutter
              const itemStyle = {
                ...style,
                left: Number(style.left),
                top: Number(style.top),
                width: columnWidth,
                height: ITEM_HEIGHT,
              };

              return (
                <div style={itemStyle}>
                  <MediaThumbnail
                    item={item}
                    onClick={() => onSelect(item)}
                    onDelete={() => onDelete(item)}
                    onDownload={() => onDownload(item)}
                  />
                </div>
              );
            }}
          </Grid>
        );
      }}
    </AutoSizer>
  );
}

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
    app: "No tienes aplicaciones guardadas",
  };

  return (
    <div
      className="flex flex-col items-center justify-center py-24 text-center h-full w-full opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]"
      data-testid="empty-state"
    >
      <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-muted/40 border border-border/50 shadow-inner mb-6 transition-transform hover:scale-105">
        <FolderOpen className="h-10 w-10 text-muted-foreground/60" />
      </div>
      <p className="text-xl font-semibold tracking-tight text-foreground/80">
        {messages[filter]}
      </p>
      <p className="text-sm text-muted-foreground mt-2 max-w-[280px]">
        Los archivos que subas aparecerán aquí y podrás acceder a ellos fácilmente en cualquier momento.
      </p>
    </div>
  );
}

function MediaThumbnail({
  item,
  onClick,
  onDelete,
  onDownload,
}: {
  item: LibraryFile;
  onClick: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const thumbnailUrl = item.thumbnailUrl || item.storageUrl || item.storagePath;
  const displayType = item.type as FileType;

  return (
    <div
      className="group relative flex flex-col gap-2 cursor-pointer outline-none"
      onClick={onClick}
      data-testid={`media-item-${item.uuid}`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted/30 border border-border/40 transition-all duration-300 ease-out group-hover:border-primary/40 group-hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] group-hover:-translate-y-1">
        {displayType === "image" ? (
          <img
            src={thumbnailUrl}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : displayType === "video" ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-500/10 to-blue-500/10">
            <Video className="h-12 w-12 text-foreground/40 transition-transform duration-300 group-hover:scale-110 group-hover:text-foreground/70" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-red-500/10">
            <FileText className="h-12 w-12 text-foreground/40 transition-transform duration-300 group-hover:scale-110 group-hover:text-foreground/70" />
          </div>
        )}

        {/* Hover overlay masking */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Action Buttons (Slide up effect) */}
        <div className="absolute inset-x-0 bottom-0 p-4 flex items-center justify-end gap-2 translate-y-4 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 rounded-full bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white/30 hover:scale-105 transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            data-testid={`download-button-${item.uuid}`}
            aria-label={`Descargar ${item.name}`}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 rounded-full bg-destructive/80 backdrop-blur-md text-white border border-white/20 hover:bg-destructive hover:scale-105 transition-all"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`delete-button-${item.uuid}`}
            aria-label={`Eliminar ${item.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Size Badge */}
        {item.size > 0 && (
          <div className="absolute top-2 right-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 px-2 py-1 text-[10px] font-medium tracking-wider text-white opacity-100 transition-opacity duration-300 group-hover:opacity-0">
            {formatFileSize(item.size)}
          </div>
        )}
      </div>
      <p className="truncate text-sm font-medium text-foreground/80 px-1 text-center transition-colors group-hover:text-foreground">
        {item.name}
      </p>
    </div>
  );
}

function LightboxView({
  item,
  onClose,
  onDownload,
}: {
  item: LibraryFile;
  onClose: () => void;
  onDownload: () => void;
}) {
  const fileUrl = item.storageUrl || item.storagePath;
  const displayType = item.type as FileType;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-2xl animate-[fadeIn_0.2s_ease-out_forwards]"
      onClick={onClose}
      data-testid="lightbox-overlay"
    >
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-6 top-6 h-12 w-12 rounded-full bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white/20 hover:scale-105 transition-all z-50"
        onClick={onClose}
        data-testid="lightbox-close"
        aria-label="Cerrar vista previa"
      >
        <X className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-24 top-6 h-12 w-12 rounded-full bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white/20 hover:scale-105 transition-all z-50"
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
        data-testid="lightbox-download"
        aria-label="Descargar archivo"
      >
        <Download className="h-5 w-5" />
      </Button>
      <div
        className="relative max-h-[85vh] max-w-[85vw] w-full flex items-center justify-center z-10 animate-[zoomIn_0.3s_ease-out_forwards]"
        onClick={(e) => e.stopPropagation()}
      >
        {displayType === "image" ? (
          <img
            src={fileUrl}
            alt={item.name}
            className="max-h-[85vh] max-w-[85vw] object-contain rounded-xl shadow-2xl ring-1 ring-white/10"
          />
        ) : displayType === "video" ? (
          <video
            src={fileUrl}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl ring-1 ring-white/10"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl p-16 shadow-2xl">
            <div className="p-6 rounded-3xl bg-white/10">
              <FileText className="h-24 w-24 text-white/80" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xl font-semibold text-white tracking-tight">{item.name}</p>
              <p className="text-sm font-medium text-white/60">{formatFileSize(item.size)}</p>
            </div>
            <Button
              className="mt-4 rounded-full px-8 bg-white/10 hover:bg-white/20 text-white border border-white/20"
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              data-testid="lightbox-download-document"
            >
              <Download className="h-4 w-4 mr-2" />
              Descargar Archivo
            </Button>
          </div>
        )}
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 shadow-lg z-50">
        <p className="text-sm font-medium tracking-wide text-white/90">
          {item.name}
        </p>
      </div>
    </div>
  );
}

function UploadProgressBar({ uploads }: { uploads: { fileName: string; progress: number; status: string }[] }) {
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 space-y-3 rounded-xl bg-background/80 backdrop-blur-xl border border-border/50 shadow-2xl p-5 ring-1 ring-white/10 opacity-0 animate-[slideUp_0.3s_ease-out_forwards]">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Upload className="h-4 w-4 text-primary animate-pulse" />
        Subiendo {uploads.length} archivo{uploads.length > 1 ? 's' : ''}
      </div>
      {uploads.map((upload, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex justify-between text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            <span className="truncate max-w-[180px]">{upload.fileName}</span>
            <span className="text-primary">{upload.progress}%</span>
          </div>
          <Progress value={upload.progress} className="h-1.5 bg-secondary/50" />
        </div>
      ))}
    </div>
  );
}

function StorageInfo({ stats }: { stats: { totalBytes: number; quotaBytes: number; fileCount: number } | null }) {
  if (!stats) return null;

  const usagePercent = stats.quotaBytes > 0 ? (stats.totalBytes / stats.quotaBytes) * 100 : 0;
  const isWarning = usagePercent > 85;

  return (
    <div className="flex items-center gap-4 text-sm bg-muted/30 px-4 py-2 rounded-full border border-border/40 backdrop-blur-sm transition-colors hover:bg-muted/50">
      <HardDrive className={cn("h-4 w-4", isWarning ? "text-red-500" : "text-muted-foreground")} />
      <div className="flex-1 w-[120px]">
        <Progress value={usagePercent} className={cn("h-1.5", isWarning ? "[&>div]:bg-red-500" : "")} />
      </div>
      <div className="flex gap-1 items-center font-medium">
        <span className="text-foreground/80">{formatStorageUsage(stats.totalBytes, stats.quotaBytes)}</span>
        <span className="text-muted-foreground/60 text-xs tabular-nums tracking-wide">({stats.fileCount})</span>
      </div>
    </div>
  );
}

export function UserLibrary({ open, onOpenChange }: UserLibraryProps) {
  const [activeTab, setActiveTab] = useState<FilterType>("all");
  const [lightboxItem, setLightboxItem] = useState<LibraryFile | null>(null);

  const filterType = activeTab === "all" ? undefined : activeTab;

  const {
    files,
    stats,
    isLoading,
    uploadProgress,
    deleteFile,
    getDownloadUrl,
    uploadFile,
    isUploading,
    isAuthenticated,
    libraryError,
  } = useCloudLibrary({ type: filterType as FileType | undefined });

  const safeFiles = files ?? [];

  const filteredFiles = useMemo(() => {
    if (activeTab === "all") return safeFiles;
    return safeFiles.filter((f) => f.type === activeTab);
  }, [safeFiles, activeTab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value as FilterType);
  };

  const handleDownload = async (item: LibraryFile) => {
    try {
      const downloadUrl = await getDownloadUrl(item.uuid);
      if (downloadUrl) {
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = item.originalName || item.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const fallbackUrl = item.storageUrl || item.storagePath;
        // FRONTEND FIX #35: Add noopener,noreferrer to prevent window.opener attacks
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Error al descargar",
        description: "No se pudo descargar el archivo",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (item: LibraryFile) => {
    try {
      await deleteFile(item.uuid);
      toast({
        title: "Archivo eliminado",
        description: `${item.name} ha sido eliminado`,
      });
    } catch (error) {
      console.error("Delete failed:", error);
      toast({
        title: "Error al eliminar",
        description: "No se pudo eliminar el archivo",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    for (const file of Array.from(uploadedFiles)) {
      try {
        await uploadFile({ file });
        toast({
          title: "Archivo subido",
          description: `${file.name} se ha guardado en tu biblioteca`,
        });
      } catch (error) {
        console.error("Upload failed:", error);
        toast({
          title: "Error al subir",
          description: `No se pudo subir ${file.name}`,
          variant: "destructive",
        });
      }
    }
    e.target.value = '';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen max-h-screen p-0 rounded-none border-0 gap-0 bg-background/60 backdrop-blur-2xl"
          data-testid="user-library-dialog"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background/60 to-background/95 pointer-events-none" />

          <DialogHeader className="relative z-10 px-8 py-5 border-b border-border/40 shadow-sm bg-background/50 backdrop-blur-xl supports-[backdrop-filter]:bg-background/30">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent" data-testid="library-title">
                Tu Biblioteca de Medios
              </DialogTitle>
              <div className="flex items-center gap-6">
                <StorageInfo stats={stats ?? null} />
                <label htmlFor="file-upload">
                  <Button asChild className="rounded-full shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200" disabled={isUploading}>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      {isUploading ? "Subiendo..." : "Subir archivo"}
                    </span>
                  </Button>
                </label>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="file-upload-input"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="rounded-full h-10 w-10 hover:bg-muted/50 border border-transparent hover:border-border/50 text-muted-foreground hover:text-foreground transition-all"
                  aria-label="Cerrar biblioteca"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <VisuallyHidden>
              <DialogDescription>Explora y gestiona tus archivos multimedia</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex flex-col h-[calc(100vh-85px)] relative z-10"
          >
            <div className="px-8 pt-6 pb-2 border-b border-border/20 bg-background/20 backdrop-blur-md">
              <TabsList className="h-11 bg-muted/40 p-1 rounded-2xl border border-border/30" data-testid="library-tabs">
                <TabsTrigger
                  value="all"
                  className="px-5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50 transition-all font-medium"
                  data-testid="tab-all"
                >
                  <LayoutGrid className="h-4 w-4 mr-2" />
                  Todo ({safeFiles.length})
                </TabsTrigger>
                <TabsTrigger
                  value="image"
                  className="px-5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50 transition-all font-medium gap-2"
                  data-testid="tab-images"
                >
                  <Image className="h-4 w-4" />
                  Imágenes
                </TabsTrigger>
                <TabsTrigger
                  value="video"
                  className="px-5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50 transition-all font-medium gap-2"
                  data-testid="tab-videos"
                >
                  <Video className="h-4 w-4" />
                  Videos
                </TabsTrigger>
                <TabsTrigger
                  value="document"
                  className="px-5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50 transition-all font-medium gap-2"
                  data-testid="tab-documents"
                >
                  <FileText className="h-4 w-4" />
                  Documentos
                </TabsTrigger>

                <TabsTrigger
                  value="app"
                  className="px-5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50 transition-all font-medium gap-2"
                  data-testid="tab-apps"
                >
                  <LayoutGrid className="h-4 w-4" />
                  Apps
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent value={activeTab} className="mt-0 h-full">
                {!isAuthenticated ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="auth-required-state">
                    <FolderOpen className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <p className="text-lg font-medium text-muted-foreground">
                      Inicia sesión para ver tu biblioteca
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Necesitas estar autenticado para acceder a tus archivos
                    </p>
                  </div>
                ) : isLoading ? (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-6"
                    data-testid="loading-skeleton"
                  >
                    {Array.from({ length: 12 }).map((_, i) => (
                      <MediaItemSkeleton key={i} />
                    ))}
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <EmptyState filter={activeTab} />
                ) : (
                  <div className="h-full w-full">
                    <VirtualizedMediaGrid
                      items={filteredFiles}
                      onSelect={(item) => setLightboxItem(item)}
                      onDelete={handleDelete}
                      onDownload={handleDownload}
                    />
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {lightboxItem && (
        <LightboxView
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
          onDownload={() => handleDownload(lightboxItem)}
        />
      )}

      <UploadProgressBar uploads={uploadProgress} />
    </>
  );
}
