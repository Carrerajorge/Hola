/**
 * File Mini Preview Tooltip
 * Muestra una vista previa rápida al pasar el mouse sobre un archivo adjunto
 */

import React, { useState, useEffect, useMemo } from "react";
import { FileText, FileSpreadsheet, Presentation, FileIcon, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getFileTheme } from "@/lib/fileTypeTheme";

interface FileMiniPreviewProps {
  file: {
    name: string;
    type?: string;
    mimeType?: string;
    size?: number;
    content?: string;
    dataUrl?: string;
    status?: string;
  };
  children: React.ReactNode;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "...";
}

function getFileExtension(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

export function FileMiniPreview({ file, children }: FileMiniPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isImage = file.type?.startsWith("image/") || file.mimeType?.startsWith("image/");
  const isProcessing = file.status === "uploading" || file.status === "processing";

  const previewContent = useMemo(() => {
    if (!file.content) return null;

    const ext = getFileExtension(file.name);
    const lines = file.content.split("\n").slice(0, 5);
    const preview = lines.join("\n");

    return truncateText(preview, 300);
  }, [file.content, file.name]);

  const stats = useMemo(() => {
    if (!file.content) return null;

    const lines = file.content.split("\n").length;
    const chars = file.content.length;
    const words = file.content.split(/\s+/).filter(Boolean).length;

    return { lines, chars, words };
  }, [file.content]);

  return (
    <Tooltip open={isOpen} onOpenChange={setIsOpen} delayDuration={500}>
      <TooltipTrigger asChild>
        <div
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-sm p-0 overflow-hidden"
        sideOffset={8}
      >
        <div className="p-3 space-y-2">
          {/* Header con icono */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center justify-center w-8 h-8 rounded",
              getFileTheme(file.name, file.mimeType).bgColor
            )}>
              {isProcessing ? (
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              ) : (
                <span className="text-white text-[10px] font-bold">
                  {getFileTheme(file.name, file.mimeType).icon}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{file.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {file.mimeType || file.type || "Archivo"}
                {file.size && ` • ${(file.size / 1024).toFixed(1)} KB`}
              </p>
            </div>
          </div>

          {/* Preview de imagen */}
          {isImage && file.dataUrl && (
            <div className="relative w-full h-24 rounded overflow-hidden bg-muted">
              <img
                src={file.dataUrl}
                alt={file.name}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Preview de contenido */}
          {previewContent && !isImage && (
            <div className="space-y-1">
              <pre className="text-[10px] text-muted-foreground bg-muted/50 p-2 rounded overflow-hidden whitespace-pre-wrap font-mono leading-relaxed max-h-20 overflow-y-auto">
                {previewContent}
              </pre>
              
              {stats && (
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{stats.lines} líneas</span>
                  <span>{stats.words} palabras</span>
                  <span>{stats.chars} caracteres</span>
                </div>
              )}
            </div>
          )}

          {/* Estado de procesamiento */}
          {isProcessing && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>
                {file.status === "uploading" ? "Subiendo..." : "Procesando..."}
              </span>
            </div>
          )}

          {/* Sin preview disponible */}
          {!previewContent && !isImage && !isProcessing && (
            <p className="text-[10px] text-muted-foreground italic">
              Vista previa no disponible
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default FileMiniPreview;
