import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, ExternalLink, CheckCircle2, ClipboardList, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface GoogleFormsDialogProps {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  onComplete?: (message: string, formUrl?: string) => void;
}

interface FormQuestion {
  id: string;
  title: string;
  type: "text" | "paragraph" | "multiple_choice" | "checkbox" | "dropdown";
  options?: string[];
  required: boolean;
}

type Status = "idle" | "generating" | "success" | "error";

const questionTypeLabels: Record<string, string> = {
  text: "Respuesta corta",
  paragraph: "Párrafo",
  multiple_choice: "Opción múltiple",
  checkbox: "Casillas de verificación",
  dropdown: "Lista desplegable"
};

export function GoogleFormsDialog({ 
  open, 
  onClose, 
  initialPrompt = "",
  onComplete 
}: GoogleFormsDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setFormTitle("");
      setFormDescription("");
      setStatus("idle");
      setError(null);
      setQuestions([]);
      setProgress(0);
      setCopied(false);
    }
  }, [open, initialPrompt]);

  const generateForm = async () => {
    if (!prompt.trim()) {
      setError("Por favor describe el formulario que quieres crear");
      return;
    }

    setStatus("generating");
    setError(null);
    setProgress(10);

    try {
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      const res = await fetch("/api/google-forms/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          prompt: prompt.trim(),
          title: formTitle.trim() || undefined
        })
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || errData.details || "Error al generar el formulario");
      }

      const data = await res.json();
      
      setProgress(100);
      setFormTitle(data.title || "Formulario");
      setFormDescription(data.description || "");
      setQuestions(data.questions || []);
      setStatus("success");
      
      if (onComplete) {
        onComplete(
          `Se generó la plantilla del formulario "${data.title}" con ${data.questions?.length || 0} preguntas. Puedes crear el formulario en Google Forms.`
        );
      }
    } catch (err: any) {
      setError(err.message || "Error al generar el formulario");
      setStatus("error");
      setProgress(0);
    }
  };

  const openGoogleForms = () => {
    window.open("https://docs.google.com/forms/create", "_blank");
  };

  const copyFormTemplate = () => {
    const template = `FORMULARIO: ${formTitle}\n${formDescription ? `Descripción: ${formDescription}\n` : ""}\n` +
      questions.map((q, idx) => {
        let text = `${idx + 1}. ${q.title}${q.required ? " *" : ""}\n   Tipo: ${questionTypeLabels[q.type] || q.type}`;
        if (q.options && q.options.length > 0) {
          text += `\n   Opciones:\n${q.options.map(o => `   - ${o}`).join("\n")}`;
        }
        return text;
      }).join("\n\n");
    
    navigator.clipboard.writeText(template);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="google-forms-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-600">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none">
                <path d="M7.5 3C6.12 3 5 4.12 5 5.5v13C5 19.88 6.12 21 7.5 21h9c1.38 0 2.5-1.12 2.5-2.5v-13C19 4.12 17.88 3 16.5 3h-9z" fill="currentColor"/>
                <circle cx="9" cy="9" r="1.5" fill="#673AB7"/>
                <rect x="12" y="8" width="5" height="2" rx="1" fill="#673AB7"/>
                <circle cx="9" cy="13" r="1.5" fill="#673AB7"/>
                <rect x="12" y="12" width="5" height="2" rx="1" fill="#673AB7"/>
                <circle cx="9" cy="17" r="1.5" fill="#673AB7"/>
                <rect x="12" y="16" width="5" height="2" rx="1" fill="#673AB7"/>
              </svg>
            </div>
            <span>Crear Formulario de Google</span>
          </DialogTitle>
          <DialogDescription>
            Describe el formulario que necesitas y generaremos la plantilla con todas las preguntas
          </DialogDescription>
        </DialogHeader>

        {status === "idle" || status === "error" ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Título del formulario (opcional)</label>
              <Input
                placeholder="Ej: Encuesta de satisfacción del cliente"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                data-testid="input-form-title"
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Describe tu formulario</label>
              <Textarea
                placeholder="Ej: Crea un formulario para recopilar feedback de clientes con preguntas sobre satisfacción general, calidad del producto, atención al cliente, y sugerencias de mejora..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="resize-none"
                data-testid="textarea-form-description"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-form">
                Cancelar
              </Button>
              <Button 
                onClick={generateForm}
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={!prompt.trim()}
                data-testid="button-generate-form"
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                Crear Formulario
              </Button>
            </div>
          </div>
        ) : status === "generating" ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Loader2 className="h-10 w-10 text-purple-600 animate-spin" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-white dark:bg-gray-800 border-2 border-purple-600 flex items-center justify-center text-xs font-bold text-purple-600">
                {progress}%
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Creando tu formulario...</h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Estamos generando las preguntas para tu formulario
              </p>
            </div>

            <div className="w-full max-w-xs">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-600 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
              {progress < 30 && <span>Analizando tu descripción...</span>}
              {progress >= 30 && progress < 60 && <span>Generando preguntas...</span>}
              {progress >= 60 && progress < 90 && <span>Estructurando el formulario...</span>}
              {progress >= 90 && <span>Finalizando...</span>}
            </div>
          </div>
        ) : status === "success" ? (
          <div className="py-6 space-y-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">¡Plantilla lista!</h3>
                <p className="text-muted-foreground text-sm mt-1">{formTitle}</p>
                {formDescription && <p className="text-muted-foreground text-xs mt-1">{formDescription}</p>}
              </div>
            </div>

            {questions.length > 0 && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <h4 className="font-medium text-sm">Preguntas incluidas:</h4>
                <div className="space-y-2">
                  {questions.slice(0, 5).map((q, idx) => (
                    <div key={q.id} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground">{idx + 1}.</span>
                      <span>{q.title}</span>
                      {q.required && <span className="text-red-500">*</span>}
                    </div>
                  ))}
                  {questions.length > 5 && (
                    <p className="text-sm text-muted-foreground">
                      +{questions.length - 5} preguntas más...
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                onClick={openGoogleForms}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                data-testid="button-open-in-google"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Crear en Google Forms
              </Button>
              <Button 
                variant="outline" 
                onClick={copyFormTemplate}
                className="flex-1"
                data-testid="button-copy-template"
              >
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Copiado" : "Copiar plantilla"}
              </Button>
            </div>

            <div className="text-center">
              <Button variant="ghost" onClick={onClose} data-testid="button-close-success">
                Cerrar
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
