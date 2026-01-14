import { memo, useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

type ThinkingPhase = 
  | "connecting"
  | "searching" 
  | "analyzing" 
  | "processing"
  | "generating"
  | "responding"
  | "finalizing";

interface ThinkingIndicatorProps {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  variant?: "minimal" | "detailed" | "inline" | "phase-narrator";
  isSearching?: boolean;
}

const phaseSequence: ThinkingPhase[] = [
  "connecting",
  "searching",
  "analyzing", 
  "processing",
  "generating",
  "responding",
  "finalizing"
];

const phaseNarrations: Record<ThinkingPhase, string[]> = {
  connecting: [
    "Preparando respuesta",
    "Iniciando"
  ],
  searching: [
    "Analizando solicitud",
    "Procesando consulta",
    "Preparando información"
  ],
  analyzing: [
    "Analizando contexto",
    "Evaluando opciones",
    "Procesando"
  ],
  processing: [
    "Procesando",
    "Organizando ideas",
    "Preparando contenido"
  ],
  generating: [
    "Preparando respuesta",
    "Estructurando contenido"
  ],
  responding: [
    "Generando respuesta",
    "Escribiendo"
  ],
  finalizing: [
    "Finalizando",
    "Completando"
  ]
};

const phaseDurations: Record<ThinkingPhase, number> = {
  connecting: 800,
  searching: 3500,
  analyzing: 2500,
  processing: 2000,
  generating: 1500,
  responding: 2000,
  finalizing: 1000
};

export const PhaseNarrator = memo(function PhaseNarrator({
  phase,
  message,
  className,
  autoProgress = true
}: {
  phase?: ThinkingPhase;
  message?: string;
  className?: string;
  autoProgress?: boolean;
}) {
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [currentNarration, setCurrentNarration] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const narrationIndex = useRef(0);
  const phaseStartTime = useRef(Date.now());
  const animationFrame = useRef<number | null>(null);

  const currentPhase = phase || phaseSequence[currentPhaseIndex];
  const narrations = phaseNarrations[currentPhase] || phaseNarrations.searching;

  useEffect(() => {
    if (message) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentNarration(message);
        setIsTransitioning(false);
      }, 100);
      return;
    }

    setCurrentNarration(narrations[0]);
    narrationIndex.current = 0;

    const narrationInterval = setInterval(() => {
      narrationIndex.current = (narrationIndex.current + 1) % narrations.length;
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentNarration(narrations[narrationIndex.current]);
        setIsTransitioning(false);
      }, 100);
    }, 1800);

    return () => clearInterval(narrationInterval);
  }, [currentPhase, message, narrations]);

  useEffect(() => {
    if (!autoProgress || phase) return;

    phaseStartTime.current = Date.now();
    
    const progressPhase = () => {
      const elapsed = Date.now() - phaseStartTime.current;
      const currentPhaseDuration = phaseDurations[phaseSequence[currentPhaseIndex]];
      
      if (elapsed >= currentPhaseDuration && currentPhaseIndex < phaseSequence.length - 2) {
        setCurrentPhaseIndex(prev => prev + 1);
        phaseStartTime.current = Date.now();
      }
      
      animationFrame.current = requestAnimationFrame(progressPhase);
    };
    
    animationFrame.current = requestAnimationFrame(progressPhase);
    
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [autoProgress, phase, currentPhaseIndex]);

  useEffect(() => {
    setCurrentPhaseIndex(0);
    phaseStartTime.current = Date.now();
  }, []);

  return (
    <div className={cn("phase-narrator-wrapper", className)}>
      <span 
        className={cn(
          "phase-narrator-text",
          isTransitioning && "transitioning"
        )}
      >
        {currentNarration}
      </span>

      <style>{`
        .phase-narrator-wrapper {
          position: relative;
          display: inline-block;
        }
        
        .phase-narrator-text {
          font-size: 0.875rem;
          font-weight: 500;
          display: inline-block;
          position: relative;
          background: linear-gradient(
            90deg,
            rgb(120, 120, 120) 0%,
            rgb(120, 120, 120) 35%,
            rgb(0, 180, 255) 45%,
            rgb(0, 220, 255) 50%,
            rgb(0, 180, 255) 55%,
            rgb(120, 120, 120) 65%,
            rgb(120, 120, 120) 100%
          );
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: lightning-flash 1.5s linear infinite;
          transition: opacity 0.1s ease-out, transform 0.1s ease-out;
        }
        
        .phase-narrator-text.transitioning {
          opacity: 0;
          transform: translateY(-3px);
        }
        
        @keyframes lightning-flash {
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
            rgb(180, 180, 180) 0%,
            rgb(180, 180, 180) 35%,
            rgb(0, 200, 255) 45%,
            rgb(80, 240, 255) 50%,
            rgb(0, 200, 255) 55%,
            rgb(180, 180, 180) 65%,
            rgb(180, 180, 180) 100%
          );
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .phase-narrator-text {
            animation: none;
            background: currentColor;
            -webkit-text-fill-color: currentColor;
          }
        }
      `}</style>
    </div>
  );
});

export const ThinkingIndicator = memo(function ThinkingIndicator({
  phase,
  message,
  className,
  variant = "phase-narrator",
  isSearching = false,
}: ThinkingIndicatorProps) {

  const effectivePhase = isSearching ? "searching" : phase;

  if (variant === "phase-narrator") {
    return (
      <div 
        className={cn(
          "inline-flex items-center py-2",
          className
        )}
        data-testid="thinking-indicator"
      >
        <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} />
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} />
      </span>
    );
  }

  if (variant === "minimal") {
    return (
      <div className={cn("flex items-center gap-2 py-2", className)}>
        <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <PhaseNarrator phase={effectivePhase} message={message} autoProgress={!effectivePhase} />
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

export default ThinkingIndicator;
