import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText, FileSpreadsheet, Download, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentGeneratorDialogProps {
  open: boolean;
  onClose: () => void;
  documentType: "word" | "excel";
  onComplete?: (message: string) => void;
}

type GenerateStatus = "idle" | "generating" | "success" | "error";

export function DocumentGeneratorDialog({ 
  open, 
  onClose, 
  documentType,
  onComplete 
}: DocumentGeneratorDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<GenerateStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPrompt("");
      setStatus("idle");
      setError(null);
    }
  }, [open]);

  const generateDocument = async () => {
    if (!prompt.trim()) {
      setError("Por favor describe el documento que quieres crear");
      return;
    }

    setStatus("generating");
    setError(null);

    try {
      const endpoint = documentType === "excel" 
        ? "/api/documents/generate/excel" 
        : "/api/documents/generate/word";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt: prompt.trim() })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || errData.details || "Error al generar el documento");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || (documentType === "excel" ? "documento.xlsx" : "documento.docx");
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setStatus("success");
      
      if (onComplete) {
        const docTypeLabel = documentType === "excel" ? "Excel" : "Word";
        onComplete(`Se generó y descargó un documento ${docTypeLabel}: "${filename}"`);
      }

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Error al generar el documento");
      setStatus("error");
    }
  };

  const docConfig = {
    word: {
      icon: FileText,
      title: "Crear Documento Word",
      description: "Describe el documento que quieres crear y la IA lo generará automáticamente",
      placeholder: "Ej: Crea un informe ejecutivo sobre el rendimiento del Q4 2024 con secciones de resumen, análisis de ventas, y recomendaciones...",
      color: "bg-blue-600",
      buttonText: "Generar Word"
    },
    excel: {
      icon: FileSpreadsheet,
      title: "Crear Hoja de Cálculo Excel",
      description: "Describe los datos o análisis que necesitas y la IA creará el archivo Excel",
      placeholder: "Ej: Crea una hoja de cálculo con datos de ventas mensuales del 2024, incluyendo productos, cantidades, precios y totales...",
      color: "bg-green-600",
      buttonText: "Generar Excel"
    }
  };

  const config = docConfig[documentType];
  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="document-generator-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={cn("flex items-center justify-center w-8 h-8 rounded", config.color)}>
              <Icon className="h-5 w-5 text-white" />
            </div>
            {config.title}
          </DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Textarea
            data-testid="input-document-prompt"
            placeholder={config.placeholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-[120px] resize-none"
            disabled={status === "generating"}
          />

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md" data-testid="text-error">
              {error}
            </div>
          )}

          {status === "success" && (
            <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/30 p-3 rounded-md flex items-center gap-2" data-testid="text-success">
              <Download className="h-4 w-4" />
              Documento generado y descargado exitosamente
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button 
            variant="outline" 
            onClick={onClose}
            disabled={status === "generating"}
            data-testid="button-cancel"
          >
            Cancelar
          </Button>
          <Button 
            onClick={generateDocument}
            disabled={status === "generating" || !prompt.trim()}
            className={cn("gap-2", documentType === "excel" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700")}
            data-testid="button-generate"
          >
            {status === "generating" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {config.buttonText}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
