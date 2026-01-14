import { memo, useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

type ThinkingPhase = 
  | "thinking" 
  | "searching" 
  | "analyzing" 
  | "generating" 
  | "coding"
  | "browsing"
  | "connecting"
  | "processing"
  | "verifying";

interface ThinkingIndicatorProps {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  variant?: "minimal" | "detailed" | "inline" | "phase-narrator";
}

const phaseNarrations: Record<ThinkingPhase, string[]> = {
  thinking: [
    "Procesando tu solicitud",
    "Analizando contexto",
    "Preparando respuesta"
  ],
  searching: [
    "Buscando fuentes",
    "Explorando resultados",
    "Encontrando información",
    "Consultando bases de datos"
  ],
  analyzing: [
    "Analizando contenido",
    "Extrayendo datos clave",
    "Procesando información"
  ],
  generating: [
    "Generando respuesta",
    "Construyendo contenido",
    "Finalizando"
  ],
  coding: [
    "Escribiendo código",
    "Optimizando solución",
    "Verificando sintaxis"
  ],
  browsing: [
    "Navegando la web",
    "Cargando página",
    "Extrayendo contenido"
  ],
  connecting: [
    "Conectando servicio",
    "Estableciendo enlace",
    "Sincronizando"
  ],
  processing: [
    "Procesando datos",
    "Calculando resultados",
    "Optimizando salida"
  ],
  verifying: [
    "Verificando datos",
    "Validando información",
    "Confirmando exactitud"
  ]
};

const PhaseNarrator = memo(function PhaseNarrator({
  phase = "thinking",
  message,
  className
}: {
  phase: ThinkingPhase;
  message?: string;
  className?: string;
}) {
  const [currentNarration, setCurrentNarration] = useState(message || phaseNarrations[phase][0]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const narrationIndex = useRef(0);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastPhase = useRef(phase);

  const updateNarration = useCallback(() => {
    const narrations = phaseNarrations[phase];
    narrationIndex.current = (narrationIndex.current + 1) % narrations.length;
    
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentNarration(message || narrations[narrationIndex.current]);
      setIsTransitioning(false);
    }, 150);
  }, [phase, message]);

  useEffect(() => {
    if (phase !== lastPhase.current) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      debounceTimer.current = setTimeout(() => {
        lastPhase.current = phase;
        narrationIndex.current = 0;
        setIsTransitioning(true);
        setTimeout(() => {
          setCurrentNarration(message || phaseNarrations[phase][0]);
          setIsTransitioning(false);
        }, 150);
      }, 300);
    }
    
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [phase, message]);

  useEffect(() => {
    if (message) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentNarration(message);
        setIsTransitioning(false);
      }, 150);
      return;
    }

    const interval = setInterval(updateNarration, 2500);
    return () => clearInterval(interval);
  }, [message, updateNarration]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div className="phase-narrator-shimmer absolute inset-0 pointer-events-none" />
      
      <span 
        className={cn(
          "text-sm text-muted-foreground/80 font-medium transition-all duration-150",
          isTransitioning ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
        )}
      >
        {currentNarration}
      </span>

      <style>{`
        .phase-narrator-shimmer::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 50%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255,255,255,0.08) 50%,
            transparent 100%
          );
          animation: shimmer-pass 2.5s ease-in-out infinite;
        }
        
        @keyframes shimmer-pass {
          0% { left: -50%; }
          100% { left: 150%; }
        }
        
        .dark .phase-narrator-shimmer::before {
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255,255,255,0.05) 50%,
            transparent 100%
          );
        }
      `}</style>
    </div>
  );
});

export const ThinkingIndicator = memo(function ThinkingIndicator({
  phase = "thinking",
  message,
  className,
  variant = "phase-narrator",
}: ThinkingIndicatorProps) {

  if (variant === "phase-narrator") {
    return (
      <div 
        className={cn(
          "inline-flex items-center py-2 px-1",
          className
        )}
        data-testid="thinking-indicator"
      >
        <PhaseNarrator phase={phase} message={message} />
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <PhaseNarrator phase={phase} message={message} />
      </span>
    );
  }

  if (variant === "minimal") {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <PhaseNarrator phase={phase} message={message} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2",
        className
      )}
    >
      <PhaseNarrator phase={phase} message={message} />
    </div>
  );
});

interface ThinkingDotsProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const ThinkingDots = memo(function ThinkingDots({
  className,
  size = "md",
}: ThinkingDotsProps) {
  const sizeClasses = {
    sm: "w-1 h-1",
    md: "w-1.5 h-1.5",
    lg: "w-2 h-2",
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "rounded-full bg-current animate-bounce",
            sizeClasses[size]
          )}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
});

export { PhaseNarrator };
export default ThinkingIndicator;
