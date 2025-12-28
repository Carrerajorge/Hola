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
import { Image, Video, FileText, Download, X, FolderOpen, Trash2, Upload, HardDrive } from "lucide-react";
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
      className="group relative flex flex-col gap-2 cursor-pointer"
      onClick={onClick}
      data-testid={`media-item-${item.uuid}`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted border border-border/50 transition-all duration-200 group-hover:border-primary/30 group-hover:shadow-md">
        {displayType === "image" ? (
          <img
            src={thumbnailUrl}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : displayType === "video" ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-500/10 to-blue-500/10">
            <Video className="h-12 w-12 text-muted-foreground/70" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-500/10 to-red-500/10">
            <FileText className="h-12 w-12 text-muted-foreground/70" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/40 group-hover:opacity-100">
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full bg-white/90 hover:bg-white shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            data-testid={`download-button-${item.uuid}`}
          >
            <Download className="h-5 w-5 text-gray-700" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full bg-white/90 hover:bg-red-100 shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`delete-button-${item.uuid}`}
          >
            <Trash2 className="h-5 w-5 text-red-600" />
          </Button>
        </div>
        {item.size > 0 && (
          <div className="absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white">
            {formatFileSize(item.size)}
          </div>
        )}
      </div>
      <p className="truncate text-sm font-medium text-foreground/90 px-1">
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
          onDownload();
        }}
        data-testid="lightbox-download"
      >
        <Download className="h-5 w-5" />
      </Button>
      <div
        className="max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {displayType === "image" ? (
          <img
            src={fileUrl}
            alt={item.name}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        ) : displayType === "video" ? (
          <video
            src={fileUrl}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg bg-white/10 p-12">
            <FileText className="h-24 w-24 text-white/70" />
            <p className="text-lg font-medium text-white">{item.name}</p>
            <p className="text-sm text-white/50">{formatFileSize(item.size)}</p>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
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
        {item.name}
      </p>
    </div>
  );
}

function UploadProgressBar({ uploads }: { uploads: { fileName: string; progress: number; status: string }[] }) {
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg bg-background border shadow-lg p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Upload className="h-4 w-4 animate-pulse" />
        Subiendo {uploads.length} archivo{uploads.length > 1 ? 's' : ''}
      </div>
      {uploads.map((upload, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="truncate max-w-[200px]">{upload.fileName}</span>
            <span>{upload.progress}%</span>
          </div>
          <Progress value={upload.progress} className="h-1" />
        </div>
      ))}
    </div>
  );
}

function StorageInfo({ stats }: { stats: { totalBytes: number; quotaBytes: number; fileCount: number } | null }) {
  if (!stats) return null;

  const usagePercent = stats.quotaBytes > 0 ? (stats.totalBytes / stats.quotaBytes) * 100 : 0;

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <HardDrive className="h-4 w-4" />
      <div className="flex-1 max-w-[200px]">
        <Progress value={usagePercent} className="h-1.5" />
      </div>
      <span>{formatStorageUsage(stats.totalBytes, stats.quotaBytes)}</span>
      <span className="text-xs">({stats.fileCount} archivos)</span>
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
        window.open(fallbackUrl, '_blank');
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
          className="max-w-none w-screen h-screen max-h-screen p-0 rounded-none border-0 gap-0"
          data-testid="user-library-dialog"
        >
          <DialogHeader className="px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-semibold" data-testid="library-title">
                Tu Biblioteca de Medios
              </DialogTitle>
              <div className="flex items-center gap-4">
                <StorageInfo stats={stats ?? null} />
                <label htmlFor="file-upload">
                  <Button asChild variant="outline" size="sm" disabled={isUploading}>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Subir archivo
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
              </div>
            </div>
            <VisuallyHidden>
              <DialogDescription>Explora y gestiona tus archivos multimedia</DialogDescription>
            </VisuallyHidden>
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
                  Todo ({safeFiles.length})
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
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                    data-testid="loading-skeleton"
                  >
                    {Array.from({ length: 12 }).map((_, i) => (
                      <MediaItemSkeleton key={i} />
                    ))}
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <EmptyState filter={activeTab} />
                ) : (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                    data-testid="media-grid"
                  >
                    {filteredFiles.map((item) => (
                      <MediaThumbnail
                        key={item.uuid}
                        item={item}
                        onClick={() => setLightboxItem(item)}
                        onDelete={() => handleDelete(item)}
                        onDownload={() => handleDownload(item)}
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
          onDownload={() => handleDownload(lightboxItem)}
        />
      )}

      <UploadProgressBar uploads={uploadProgress} />
    </>
  );
}
