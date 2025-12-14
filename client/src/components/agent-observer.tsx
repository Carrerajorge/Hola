import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Globe, 
  FileText, 
  Camera, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentStep } from "@/hooks/use-agent";

interface AgentObserverProps {
  steps: AgentStep[];
  objective?: string;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  onCancel?: () => void;
}

const stepTypeConfig: Record<string, { icon: typeof Globe; label: string; color: string }> = {
  navigate: { icon: Globe, label: "Navegando", color: "text-blue-500" },
  extract: { icon: FileText, label: "Extrayendo", color: "text-green-500" },
  screenshot: { icon: Camera, label: "Captura", color: "text-purple-500" },
  synthesize: { icon: FileText, label: "Sintetizando", color: "text-orange-500" },
  click: { icon: Globe, label: "Click", color: "text-blue-400" },
  input: { icon: FileText, label: "Escribiendo", color: "text-cyan-500" }
};

export function AgentObserver({ steps, objective, status, onCancel }: AgentObserverProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  if (steps.length === 0 && status === "idle") return null;

  const getStatusIcon = (stepStatus: string) => {
    switch (stepStatus) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "started":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Loader2 className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStepConfig = (stepType: string) => {
    return stepTypeConfig[stepType] || { icon: FileText, label: stepType, color: "text-gray-500" };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-3xl mx-auto mb-4"
    >
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 rounded-xl border border-blue-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-100/50 dark:hover:bg-gray-800/50 transition-colors"
          data-testid="button-toggle-agent-observer"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10">
              {status === "running" ? (
                <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
              ) : status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : status === "failed" ? (
                <XCircle className="h-4 w-4 text-red-500" />
              ) : (
                <Globe className="h-4 w-4 text-blue-500" />
              )}
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Navegación Web Autónoma
              </p>
              {objective && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[300px]">
                  {objective}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {steps.length} {steps.length === 1 ? "paso" : "pasos"}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </div>
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4">
                <div className="relative">
                  <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
                  
                  <div className="space-y-3">
                    {steps.map((step, index) => {
                      const config = getStepConfig(step.stepType);
                      const Icon = config.icon;
                      
                      return (
                        <motion.div
                          key={step.stepId}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="relative flex items-start gap-3"
                          data-testid={`agent-step-${step.stepId}`}
                        >
                          <div className={cn(
                            "relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 bg-white dark:bg-gray-900",
                            step.status === "completed" ? "border-green-300" :
                            step.status === "failed" ? "border-red-300" :
                            "border-blue-300"
                          )}>
                            <Icon className={cn("h-4 w-4", config.color)} />
                          </div>
                          
                          <div className="flex-1 min-w-0 pt-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {config.label}
                              </span>
                              {getStatusIcon(step.status)}
                            </div>
                            
                            {step.url && (
                              <a
                                href={step.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 mt-1 truncate max-w-[300px]"
                                data-testid={`link-step-url-${step.stepId}`}
                              >
                                {new URL(step.url).hostname}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            
                            {step.detail?.title && (
                              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">
                                {step.detail.title}
                              </p>
                            )}
                            
                            {step.error && (
                              <p className="text-xs text-red-500 mt-1">
                                {step.error}
                              </p>
                            )}
                            
                            {step.screenshot && (
                              <div className="mt-2">
                                <img
                                  src={`/objects/${step.screenshot}`}
                                  alt="Screenshot"
                                  className="w-full max-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700"
                                  data-testid={`img-screenshot-${step.stepId}`}
                                />
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
                
                {status === "running" && onCancel && (
                  <button
                    onClick={onCancel}
                    className="mt-4 w-full py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    data-testid="button-cancel-agent"
                  >
                    Cancelar navegación
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
