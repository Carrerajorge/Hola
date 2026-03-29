/**
 * File Preview Modal - Previsualización mejorada de archivos
 * 
 * Características:
 * - PDF inline con react-pdf
 * - Excel interactivo con DataTable
 * - Word con detección de tablas
 * - Comparación side-by-side
 * - Exportación de contenido
 * - Indicador de progreso de extracción
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Copy,
  Download,
  Check,
  FileText,
  FileSpreadsheet,
  Presentation,
  FileIcon,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Columns,
  FileDown,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Document, Page } from "react-pdf";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getFileTheme, type FileCategory } from "@/lib/fileTypeTheme";
import { PdfPreview } from "@/components/PdfPreview";
import {
  getCachedPreview,
  setCachedPreview,
  extractTablesFromHtml,
  htmlToMarkdown,
  exportContentAsFile,
  subscribeToProgress,
  type ExtractionProgress,
} from "@/lib/filePreviewCache";
import { DataTableWrapper } from "@/components/chat-interface/DataTableWrapper";
import { configurePdfJsWorker } from "@/lib/pdfjs";

configurePdfJsWorker();

export interface FilePreviewData {
  id: string;
  name: string;
  mimeType?: string;
  content?: string;
  htmlContent?: string;
  storagePath?: string;
  localUrl?: string;
  fileId?: string;
  isLoading?: boolean;
  isProcessing?: boolean;
  size?: number;
}

interface FilePreviewModalProps {
  file: FilePreviewData | null;
  onClose: () => void;
  secondFile?: FilePreviewData | null;
  comparisonMode?: boolean;
}

function getFileCategory(mimeType?: string, name?: string): FileCategory {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  
  if (mimeType?.includes("word") || ext === "docx" || ext === "doc") return "word";
  if (mimeType?.includes("sheet") || mimeType?.includes("excel") || ext === "xlsx" || ext === "xls" || ext === "csv") return "excel";
  if (mimeType?.includes("presentation") || ext === "pptx" || ext === "ppt") return "ppt";
  if (mimeType?.includes("pdf") || ext === "pdf") return "pdf";
  if (mimeType?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (mimeType?.startsWith("text/") || ["txt", "md", "json", "csv"].includes(ext)) return "text";
  if (["js", "ts", "jsx", "tsx", "py", "java", "cpp"].includes(ext)) return "code";
  
  return "unknown";
}

function getDocumentTypeIcon(category: FileCategory): React.ElementType {
  const icons: Record<FileCategory, React.ElementType> = {
    word: FileText,
    excel: FileSpreadsheet,
    ppt: Presentation,
    pdf: FileText,
    image: FileIcon,
    text: FileText,
    code: FileText,
    archive: FileIcon,
    unknown: FileIcon,
  };
  return icons[category] || FileIcon;
}

function getDocumentTypeLabel(category: FileCategory): string {
  const labels: Record<FileCategory, string> = {
    word: "Documento Word",
    excel: "Hoja de cálculo",
    ppt: "Presentación",
    pdf: "Documento PDF",
    image: "Imagen",
    text: "Archivo de texto",
    code: "Código",
    archive: "Archivo comprimido",
    unknown: "Documento",
  };
  return labels[category] || "Documento";
}

interface WordPreviewProps {
  content?: string;
  htmlContent?: string;
  onExport?: (format: "txt" | "html" | "md") => void;
}

const WordPreview = React.memo(function WordPreview({ content, htmlContent, onExport }: WordPreviewProps) {
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  
  const tables = useMemo(() => {
    if (!htmlContent) return [];
    return extractTablesFromHtml(htmlContent);
  }, [htmlContent]);

  const hasTables = tables.length > 0;

  if (!content && !htmlContent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No hay contenido disponible para previsualizar</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "rendered" | "source")}>
          <TabsList className="h-8">
            <TabsTrigger value="rendered" className="text-xs">Renderizado</TabsTrigger>
            <TabsTrigger value="source" className="text-xs">Código fuente</TabsTrigger>
          </TabsList>
        </Tabs>
        {hasTables && (
          <span className="text-xs text-muted-foreground ml-2">
            {tables.length} tabla{tables.length > 1 ? "s" : ""} detectada{tables.length > 1 ? "s" : ""}
          </span>
        )}
        {onExport && (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => onExport("txt")}>
                  <FileDown className="h-3.5 w-3.5 mr-1" />
                  TXT
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar como texto</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => onExport("html")}>
                  <FileDown className="h-3.5 w-3.5 mr-1" />
                  HTML
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar como HTML</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => onExport("md")}>
                  <FileDown className="h-3.5 w-3.5 mr-1" />
                  MD
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exportar como Markdown</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      
      <ScrollArea className="flex-1">
        {viewMode === "rendered" && htmlContent ? (
          <div className="p-6">
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
            {hasTables && (
              <div className="mt-6 space-y-4">
                <h4 className="text-sm font-medium text-muted-foreground">Tablas detectadas</h4>
                {tables.map((table, index) => (
                  <div key={index} className="border rounded-lg overflow-hidden">
                    <DataTableWrapper>
                      <thead>
                        <tr>
                          {table.headers.map((header, hIndex) => (
                            <th key={hIndex} className="px-3 py-2 text-left text-xs font-medium">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="px-3 py-2 text-xs">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </DataTableWrapper>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6">
            <pre className="text-xs bg-muted/50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono">
              {content || htmlContent}
            </pre>
          </div>
        )}
      </ScrollArea>
    </div>
  );
});

interface ExcelPreviewProps {
  data?: { headers: string[]; rows: string[][] };
  csvContent?: string;
}

const ExcelPreview = React.memo(function ExcelPreview({ data, csvContent }: ExcelPreviewProps) {
  const tableData = useMemo(() => {
    if (data) return data;
    
    if (csvContent) {
      const lines = csvContent.split("\n").filter(Boolean);
      if (lines.length === 0) return null;
      
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map(line => 
        line.split(",").map(cell => cell.trim().replace(/^"|"$/g, ""))
      );
      
      return { headers, rows };
    }
    
    return null;
  }, [data, csvContent]);

  if (!tableData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No hay datos disponibles para mostrar</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <DataTableWrapper>
          <thead>
            <tr>
              {tableData.headers.map((header, index) => (
                <th key={index} className="px-3 py-2 text-left text-xs font-medium bg-muted">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-muted/50">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 text-xs">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTableWrapper>
      </div>
    </ScrollArea>
  );
});

interface TextPreviewProps {
  content?: string;
}

const TextPreview = React.memo(function TextPreview({ content }: TextPreviewProps) {
  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No hay contenido disponible</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/30 p-4 rounded-lg">
          {content}
        </pre>
      </div>
    </ScrollArea>
  );
});

interface ExtractionProgressBarProps {
  progress: ExtractionProgress;
}

const ExtractionProgressBar = React.memo(function ExtractionProgressBar({ progress }: ExtractionProgressBarProps) {
  const stageMessages: Record<string, string> = {
    reading: "Leyendo archivo...",
    extracting: "Extrayendo contenido...",
    parsing: "Procesando datos...",
    ready: "Completado",
    error: "Error",
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <div className="text-center">
        <p className="text-sm font-medium">{stageMessages[progress.stage]}</p>
        <p className="text-xs text-muted-foreground mt-1">{progress.message}</p>
      </div>
      <div className="w-full max-w-xs bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress.progress}%` }}
        />
      </div>
    </div>
  );
});

export function FilePreviewModal({ file, onClose, secondFile, comparisonMode }: FilePreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const category = useMemo(() => 
    getFileCategory(file?.mimeType, file?.name), 
    [file?.mimeType, file?.name]
  );
  
  const Icon = getDocumentTypeIcon(category);

  useEffect(() => {
    if (!file?.id) return;
    
    return subscribeToProgress(file.id, setExtractionProgress);
  }, [file?.id]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    if (!file?.content) return;
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [file?.content]);

  const handleExport = useCallback((format: "txt" | "html" | "md") => {
    if (!file) return;
    
    const content = format === "html" 
      ? (file.htmlContent || file.content || "")
      : format === "md"
        ? htmlToMarkdown(file.htmlContent || file.content || "")
        : (file.content || "");
    
    exportContentAsFile(content, format, file.name);
  }, [file]);

  const handleDownload = useCallback(() => {
    if (!file?.storagePath) return;
    const link = document.createElement("a");
    link.href = file.storagePath;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [file]);

  if (!file) return null;

  const isLoading = file.isLoading || file.isProcessing;
  const hasContent = file.content || file.htmlContent;

  const renderPreview = () => {
    if (isLoading && !hasContent && extractionProgress) {
      return <ExtractionProgressBar progress={extractionProgress} />;
    }

    if (isLoading && !hasContent) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Procesando archivo...</p>
        </div>
      );
    }

    switch (category) {
      case "pdf":
        if (file.localUrl || file.storagePath) {
          return (
            <PdfPreview
              url={file.localUrl || file.storagePath}
              title={file.name}
              embedded
              showToolbar
              onClose={onClose}
            />
          );
        }
        return <TextPreview content={file.content} />;

      case "word":
        return (
          <WordPreview
            content={file.content}
            htmlContent={file.htmlContent}
            onExport={handleExport}
          />
        );

      case "excel":
        return <ExcelPreview csvContent={file.content} />;

      case "text":
      case "code":
        return <TextPreview content={file.content} />;

      default:
        return <TextPreview content={file.content} />;
    }
  };

  const renderComparison = () => {
    if (!comparisonMode || !secondFile) return null;

    return (
      <div className="grid grid-cols-2 gap-4 h-full">
        <div className="border-r border-border">
          <div className="p-2 bg-muted/50 border-b border-border text-xs font-medium truncate">
            {file.name}
          </div>
          <div className="h-[calc(100%-32px)] overflow-auto">
            {renderPreview()}
          </div>
        </div>
        <div>
          <div className="p-2 bg-muted/50 border-b border-border text-xs font-medium truncate">
            {secondFile.name}
          </div>
          <div className="h-[calc(100%-32px)] overflow-auto">
            <TextPreview content={secondFile.content} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-card rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex items-center justify-center w-10 h-10 rounded-lg",
              getFileTheme(file.name, file.mimeType).bgColor
            )}>
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-foreground truncate max-w-md">
                {file.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {getDocumentTypeLabel(category)}
                {file.size && ` • ${(file.size / 1024).toFixed(1)} KB`}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {hasContent && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 mr-2 text-green-500" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copiar
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copiar contenido</TooltipContent>
              </Tooltip>
            )}
            
            {file.storagePath && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    Descargar
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Descargar archivo original</TooltipContent>
              </Tooltip>
            )}
            
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {comparisonMode && secondFile ? renderComparison() : renderPreview()}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default FilePreviewModal;
