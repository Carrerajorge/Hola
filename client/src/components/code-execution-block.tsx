import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  ChevronDown, 
  ChevronRight, 
  Play, 
  Copy, 
  Check, 
  AlertCircle,
  Clock,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeArtifact {
  id: string;
  type: string;
  name: string;
  data: string;
  mimeType: string;
}

interface CodeRun {
  id: string;
  code: string;
  language: string;
  status: string;
  stdout: string | null;
  stderr: string | null;
  executionTimeMs: number | null;
}

interface CodeExecutionBlockProps {
  code: string;
  language?: string;
  conversationId?: string;
  autoRun?: boolean;
  onExecuted?: (run: CodeRun, artifacts: CodeArtifact[]) => void;
}

export function CodeExecutionBlock({
  code,
  language = "python",
  conversationId,
  autoRun = false,
  onExecuted,
}: CodeExecutionBlockProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [run, setRun] = useState<CodeRun | null>(null);
  const [artifacts, setArtifacts] = useState<CodeArtifact[]>([]);
  const { toast } = useToast();

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast({
      title: "Código copiado",
      description: "El código ha sido copiado al portapapeles.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunCode = async () => {
    if (isRunning) return;
    
    setIsRunning(true);
    setRun(null);
    setArtifacts([]);

    try {
      const response = await fetch("/api/code-interpreter/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, conversationId, language }),
      });

      if (!response.ok) {
        throw new Error("Error ejecutando código");
      }

      const result = await response.json();
      setRun(result.run);
      setArtifacts(result.artifacts || []);
      
      if (onExecuted) {
        onExecuted(result.run, result.artifacts || []);
      }

      if (result.run.status === "error") {
        toast({
          title: "Error en ejecución",
          description: "El código produjo un error. Revisa la salida.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo ejecutar el código.",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = () => {
    if (isRunning) return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    if (!run) return null;
    if (run.status === "success") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (run.status === "error") return <AlertCircle className="w-4 h-4 text-red-500" />;
    return null;
  };

  return (
    <div 
      className="my-4 rounded-lg border border-border overflow-hidden bg-[#1e1e1e]"
      data-testid="code-execution-block"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-border">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-400 hover:text-white"
            onClick={() => setIsCollapsed(!isCollapsed)}
            data-testid="toggle-code"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
          <span className="text-sm text-gray-400 font-mono">
            {language}
          </span>
          {getStatusIcon()}
          {run?.executionTimeMs && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {(run.executionTimeMs / 1000).toFixed(2)}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-gray-400 hover:text-white"
            onClick={handleCopyCode}
            data-testid="copy-code"
          >
            {copied ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-gray-400 hover:text-green-400 disabled:opacity-50"
            onClick={handleRunCode}
            disabled={isRunning}
            data-testid="run-code"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="max-h-[400px] overflow-auto">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: "1rem",
              fontSize: "0.875rem",
              background: "transparent",
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      )}

      {run && (run.stdout || run.stderr || artifacts.length > 0) && (
        <div className="border-t border-border">
          <div className="px-3 py-2 bg-[#252525] text-xs text-gray-400 uppercase tracking-wide">
            Salida
          </div>
          
          {run.stdout && (
            <pre className="px-4 py-3 text-sm text-gray-200 font-mono whitespace-pre-wrap overflow-auto max-h-[300px]">
              {run.stdout}
            </pre>
          )}
          
          {run.stderr && (
            <pre className="px-4 py-3 text-sm text-red-400 font-mono whitespace-pre-wrap overflow-auto max-h-[200px] bg-red-950/20">
              {run.stderr}
            </pre>
          )}

          {artifacts.length > 0 && (
            <div className="p-4 space-y-4">
              {artifacts.map((artifact) => (
                <div key={artifact.id} data-testid={`artifact-${artifact.id}`}>
                  {artifact.type === "image" && artifact.mimeType?.startsWith("image/") && (
                    <div className="rounded-lg overflow-hidden bg-white inline-block">
                      <img
                        src={`data:${artifact.mimeType};base64,${artifact.data}`}
                        alt={artifact.name}
                        className="max-w-full h-auto"
                      />
                    </div>
                  )}
                  {artifact.type === "file" && (
                    <div className="flex items-center gap-2 p-2 bg-[#2d2d2d] rounded">
                      <span className="text-sm text-gray-300">{artifact.name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
