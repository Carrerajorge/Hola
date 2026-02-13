import { useState, useCallback, ErrorInfo, Component, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Monitor,
  X,
  Minimize2,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrowserSessionState } from "@/hooks/use-browser-session";

// ─── Error Boundary ───
class VirtualComputerErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[VirtualComputer] Error caught by boundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

interface VirtualComputerProps {
  state: BrowserSessionState;
  onClose?: () => void;
  onCancel?: () => void;
  className?: string;
  compact?: boolean;
}

/* ───────────────────────────────────────────────────────────
 * OLED-quality CSS styles for Super Retina XDR-like display
 * - Pure black backgrounds (#000) for infinite contrast
 * - High saturation filter for vibrant OLED colors
 * - Crisp sub-pixel rendering
 * - HDR-like shadow glow effects
 * ─────────────────────────────────────────────────────────── */
const oledScreenStyles: React.CSSProperties = {
  imageRendering: "auto",                    // Let browser pick best quality (crisp-edges can pixelate)
  WebkitFontSmoothing: "antialiased",
  backfaceVisibility: "hidden",
  transform: "translateZ(0)",                // GPU acceleration
  willChange: "transform",
  filter: "saturate(1.22) contrast(1.12) brightness(1.03)", // OLED vibrant colors + deep blacks
};

const oledContainerStyles: React.CSSProperties = {
  background: "#000",                        // True OLED black
  WebkitBackdropFilter: "blur(20px)",
  backdropFilter: "blur(20px)",
};
const MINI_COMPUTER_SIZE = "2cm";

function VirtualComputerInner({ state, onClose, onCancel, className }: VirtualComputerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleExpand = useCallback(() => setIsExpanded(true), []);
  const handleCollapse = useCallback(() => setIsExpanded(false), []);

  const getStatusDotColor = () => {
    switch (state.status) {
      case "active": return "bg-green-500";
      case "connecting": return "bg-yellow-500";
      case "completed": return "bg-blue-500";
      case "error": return "bg-red-500";
      default: return "bg-gray-400";
    }
  };

  const getStatusText = () => {
    switch (state.status) {
      case "idle": return "En espera";
      case "connecting": return "Conectando";
      case "active": return "Activo";
      case "completed": return "Completado";
      case "error": return "Error";
      case "cancelled": return "Cancelado";
      default: return state.status;
    }
  };

  const getStatusColor = () => {
    switch (state.status) {
      case "active": return "text-green-500";
      case "connecting": return "text-yellow-500";
      case "completed": return "text-blue-500";
      case "error": return "text-red-500";
      default: return "text-gray-400";
    }
  };

  // ─── Don't render if idle with no session ───
  if (state.status === "idle" && !state.sessionId) {
    return null;
  }

  // ═══════════════════════════════════════════════════
  // FULLSCREEN EXPANDED — OLED Super Retina XDR mode
  // ═══════════════════════════════════════════════════
  if (isExpanded) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm"
          data-testid="virtual-computer-expanded-overlay"
          onClick={handleCollapse}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-3 sm:inset-6 z-[10000] rounded-2xl overflow-hidden flex flex-col"
            style={{
              ...oledContainerStyles,
              boxShadow: "0 0 60px rgba(0,0,0,0.8), 0 0 120px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.08)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — OLED glass bar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 shrink-0"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Monitor className="h-4 w-4 text-white/70 shrink-0" />
                <span className="text-sm font-medium text-white/90">Computadora Virtual</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    getStatusDotColor(),
                    state.status === "active" && "animate-pulse shadow-lg shadow-green-500/50"
                  )} />
                  <span className={cn("text-xs font-medium", getStatusColor())}>{getStatusText()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {state.status === "active" && onCancel && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-white/50 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                    onClick={onCancel}
                    title="Cancelar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10 rounded-lg"
                  onClick={handleCollapse}
                  title="Minimizar"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* URL bar — subtle OLED glass */}
            {state.currentUrl && (
              <div
                className="flex items-center gap-2 px-4 py-1.5 shrink-0"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <Globe className="h-3 w-3 text-white/40 shrink-0" />
                <span className="text-xs text-white/50 truncate font-mono">{state.currentUrl}</span>
              </div>
            )}

            {/* Screenshot area — OLED quality, full space */}
            <div className="flex-1 relative flex items-center justify-center min-h-0 overflow-hidden" style={oledContainerStyles}>
              {state.screenshot ? (
                <img
                  src={state.screenshot}
                  alt="Browser Screenshot"
                  className="w-full h-full object-contain"
                  style={oledScreenStyles}
                  draggable={false}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-white/30">
                  {state.status === "connecting" || state.status === "active" ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-sm">Cargando...</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="h-8 w-8" />
                      <span className="text-sm">Sin vista previa</span>
                    </>
                  )}
                </div>
              )}
              {/* Live badge */}
              {state.status === "active" && (
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)", border: "1px solid rgba(34,197,94,0.3)" }}
                >
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                  <span className="text-[11px] font-medium text-green-400">En vivo</span>
                </div>
              )}
            </div>

            {/* Objective bar */}
            {state.objective && (
              <div className="px-4 py-2 shrink-0" style={{ background: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <p className="text-xs text-white/50 truncate">
                  <span className="font-medium text-white/70">Objetivo:</span> {state.objective}
                </p>
              </div>
            )}

            {/* Error */}
            {state.error && (
              <div className="px-4 py-2 shrink-0" style={{ background: "rgba(239,68,68,0.1)", borderTop: "1px solid rgba(239,68,68,0.2)" }}>
                <p className="text-xs text-red-400 truncate">Error: {state.error}</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ═══════════════════════════════════════════════════
  // MINI SQUARE — 2cm × 2cm (76px) OLED thumbnail
  // Click ANYWHERE on it to expand to fullscreen
  // ═══════════════════════════════════════════════════

  // Extract progress from latest action's goalProgress
  const lastAction = state.actions[state.actions.length - 1];
  const progressPercent = lastAction?.params?.goalProgress
    ? parseInt(lastAction.params.goalProgress) || 0
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
      className={cn(
        "rounded-2xl overflow-hidden cursor-pointer select-none touch-manipulation shrink-0",
        "transition-shadow duration-300",
        className
      )}
      style={{
        ...oledContainerStyles,
        width: MINI_COMPUTER_SIZE,
        height: MINI_COMPUTER_SIZE,
        minWidth: MINI_COMPUTER_SIZE,
        minHeight: MINI_COMPUTER_SIZE,
        maxWidth: MINI_COMPUTER_SIZE,
        maxHeight: MINI_COMPUTER_SIZE,
        boxShadow: state.status === "active"
          ? "0 0 20px rgba(34,197,94,0.25), 0 4px 20px rgba(0,0,0,0.5), inset 0 0 0 1.5px rgba(34,197,94,0.4)"
          : state.status === "completed"
          ? "0 0 15px rgba(59,130,246,0.2), 0 4px 15px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(59,130,246,0.3)"
          : "0 4px 15px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.08)",
      }}
      onClick={handleExpand}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleExpand();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Abrir computadora virtual en pantalla completa"
      data-testid="virtual-computer-mini"
    >
      {/* Screenshot fills entire square — OLED quality */}
      <div className="w-full h-full relative overflow-hidden" style={oledContainerStyles}>
        {state.screenshot ? (
          <img
            src={state.screenshot}
            alt="Preview"
            className="w-full h-full object-cover"
            style={oledScreenStyles}
            draggable={false}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {state.status === "connecting" || state.status === "active" ? (
              <Loader2 className="h-5 w-5 animate-spin text-white/30" />
            ) : (
              <Monitor className="h-5 w-5 text-white/20" />
            )}
          </div>
        )}

        {/* Top-left: circular progress ring + step count */}
        {state.status === "active" && (
          <div className="absolute top-1 left-1 flex items-center gap-0.5">
            <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
              {/* Background ring */}
              <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
              {/* Progress ring */}
              <circle
                cx="9" cy="9" r="7" fill="none"
                stroke="rgb(34,197,94)" strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 7}`}
                strokeDashoffset={`${2 * Math.PI * 7 * (1 - (progressPercent / 100))}`}
                transform="rotate(-90 9 9)"
                style={{ transition: "stroke-dashoffset 0.5s ease", filter: "drop-shadow(0 0 3px rgba(34,197,94,0.6))" }}
              />
              {/* Center dot */}
              <circle cx="9" cy="9" r="2" fill="rgb(34,197,94)" className="animate-pulse" />
            </svg>
            {state.actions.length > 0 && (
              <span className="text-[8px] font-bold text-white/80" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                {state.actions.length}
              </span>
            )}
          </div>
        )}

        {/* Connecting state */}
        {state.status === "connecting" && (
          <div className="absolute top-1.5 left-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500 animate-pulse"
              style={{ boxShadow: "0 0 6px rgba(234,179,8,0.5)" }}
            />
          </div>
        )}

        {/* Completed badge */}
        {state.status === "completed" && (
          <div className="absolute top-1 left-1">
            <CheckCircle2 className="h-4 w-4 text-blue-400" style={{ filter: "drop-shadow(0 0 4px rgba(59,130,246,0.5))" }} />
          </div>
        )}

        {/* Error badge */}
        {state.status === "error" && (
          <div className="absolute top-1 left-1">
            <XCircle className="h-4 w-4 text-red-400" style={{ filter: "drop-shadow(0 0 4px rgba(239,68,68,0.5))" }} />
          </div>
        )}

        {/* Bottom gradient bar showing progress */}
        {state.status === "active" && progressPercent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div
              className="h-full bg-green-500"
              style={{
                width: `${progressPercent}%`,
                transition: "width 0.5s ease",
                boxShadow: "0 0 6px rgba(34,197,94,0.5)",
              }}
            />
          </div>
        )}

        {/* Subtle "tap to expand" hint on hover */}
        <div
          className="absolute inset-x-0 bottom-0 h-5 opacity-0 hover:opacity-100 transition-opacity duration-200 flex items-end justify-center pb-1"
          style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }}
        >
          <span className="text-[7px] text-white/70 font-medium tracking-wide">AMPLIAR</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Export with Error Boundary ───
export function VirtualComputer(props: VirtualComputerProps) {
  return (
    <VirtualComputerErrorBoundary>
      <VirtualComputerInner {...props} />
    </VirtualComputerErrorBoundary>
  );
}
