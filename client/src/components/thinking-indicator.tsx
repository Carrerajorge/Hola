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
  | "verifying"
  | "responding";

interface ThinkingIndicatorProps {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  variant?: "minimal" | "detailed" | "inline" | "phase-narrator";
}

const phaseNarrations: Record<ThinkingPhase, string[]> = {
  thinking: [
    "Procesando solicitud",
    "Analizando contexto",
    "Preparando respuesta"
  ],
  searching: [
    "Buscando en la web",
    "Explorando fuentes",
    "Consultando bases de datos",
    "Recopilando información"
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
  responding: [
    "Escribiendo respuesta",
    "Procesando información",
    "Generando contenido"
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
  const [currentNarration, setCurrentNarration] = useState(message || phaseNarrations[phase]?.[0] || "Procesando");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const narrationIndex = useRef(0);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastPhase = useRef(phase);

  const updateNarration = useCallback(() => {
    const narrations = phaseNarrations[phase] || phaseNarrations.thinking;
    narrationIndex.current = (narrationIndex.current + 1) % narrations.length;
    
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentNarration(message || narrations[narrationIndex.current]);
      setIsTransitioning(false);
    }, 120);
  }, [phase, message]);

  useEffect(() => {
    if (phase !== lastPhase.current) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      debounceTimer.current = setTimeout(() => {
        lastPhase.current = phase;
        narrationIndex.current = 0;
        const narrations = phaseNarrations[phase] || phaseNarrations.thinking;
        setIsTransitioning(true);
        setTimeout(() => {
          setCurrentNarration(message || narrations[0]);
          setIsTransitioning(false);
        }, 120);
      }, 200);
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
      }, 120);
      return;
    }

    const interval = setInterval(updateNarration, 2000);
    return () => clearInterval(interval);
  }, [message, updateNarration]);

  return (
    <div className={cn("phase-narrator-container relative inline-block", className)}>
      <span 
        className={cn(
          "phase-narrator-text text-sm font-medium text-foreground/70 relative inline-block",
          isTransitioning && "phase-narrator-exit"
        )}
      >
        {currentNarration}
      </span>

      <style>{`
        .phase-narrator-container {
          position: relative;
          overflow: hidden;
        }
        
        .phase-narrator-text {
          display: inline-block;
          position: relative;
          background: linear-gradient(
            90deg,
            currentColor 0%,
            currentColor 40%,
            rgba(59, 130, 246, 0.8) 50%,
            currentColor 60%,
            currentColor 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer-text 1.5s ease-in-out infinite;
        }
        
        .phase-narrator-exit {
          opacity: 0;
          transform: translateY(-4px);
          transition: all 0.12s ease-out;
        }
        
        @keyframes shimmer-text {
          0% {
            background-position: 100% 0;
          }
          100% {
            background-position: -100% 0;
          }
        }
        
        .dark .phase-narrator-text {
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.7) 0%,
            rgba(255, 255, 255, 0.7) 40%,
            rgba(96, 165, 250, 1) 50%,
            rgba(255, 255, 255, 0.7) 60%,
            rgba(255, 255, 255, 0.7) 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
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
