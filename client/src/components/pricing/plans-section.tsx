import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Brain,
  Clock,
  Code,
  FileText,
  Image,
  Loader2,
  MessageSquare,
  Sparkles,
  Star,
  Target,
  Video,
  Zap,
} from "lucide-react";

type PlanTab = "personal" | "empresa";

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | null | undefined;

type PlanFeature = {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
};

type PlanCard = {
  name: string;
  price: number;
  description: string;
  buttonText: string;
  buttonVariant: ButtonVariant;
  badge?: string;
  highlight?: boolean;
  isCurrentPlan?: boolean;
  footerNote?: string;
  features: PlanFeature[];
};

const PERSONAL_PLANS: PlanCard[] = [
  {
    name: "Gratis",
    price: 0,
    description: "Mira lo que la IA puede hacer",
    buttonText: "Empezar",
    buttonVariant: "outline",
    features: [
      { icon: Sparkles, text: "Obtén explicaciones sencillas" },
      { icon: MessageSquare, text: "Mantén chats breves para preguntas frecuentes" },
      { icon: Image, text: "Prueba la generación de imágenes" },
      { icon: Brain, text: "Guardar memoria y contexto limitados" },
    ],
  },
  {
    name: "Go",
    price: 5,
    badge: "NUEVO",
    description: "Logra más con una IA más avanzada",
    buttonText: "Mejorar el plan a Go",
    buttonVariant: "default",
    highlight: true,
    features: [
      { icon: Target, text: "Explora a fondo preguntas más complejas" },
      { icon: Clock, text: "Chatea más tiempo y carga más contenido" },
      { icon: Image, text: "Crea imágenes realistas para tus proyectos" },
      { icon: Brain, text: "Almacena más contexto y obtén respuestas más inteligentes" },
      { icon: Zap, text: "Obtén ayuda con la planificación y las tareas" },
      { icon: Star, text: "Explora proyectos, tareas y GPT personalizados" },
    ],
    footerNote: "Solo disponible en algunas regiones. Se aplican límites",
  },
  {
    name: "Plus",
    price: 10,
    description: "Descubre toda la experiencia",
    buttonText: "Obtener Plus",
    buttonVariant: "outline",
    features: [
      { icon: Sparkles, text: "Resuelve problemas complejos" },
      { icon: MessageSquare, text: "Ten largas charlas en varias sesiones" },
      { icon: Image, text: "Cree más imágenes, más rápido" },
      { icon: Brain, text: "Recuerda objetivos y conversaciones pasadas" },
      { icon: Target, text: "Planifica viajes y tareas con el modo Agente" },
      { icon: FileText, text: "Organiza proyectos y GPT personalizados" },
      { icon: Video, text: "Produce y comparte videos en Sora" },
      { icon: Code, text: "Escribe código y crea aplicaciones con OpenClaw" },
    ],
    footerNote: "Se aplican límites",
  },
];

function PlanBadge({
  label,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { label: string }) {
  const normalized = label.trim().toUpperCase();
  const isRecommended = normalized === "RECOMENDADO";
  const isNew = normalized === "NUEVO";

  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        isRecommended
          ? "border-foreground/10 bg-foreground text-background"
          : isNew
            ? "border-[hsl(var(--future-b,195_95%_35%)/0.25)] bg-[hsl(var(--future-b,195_95%_35%)/0.08)] text-[hsl(var(--future-b,195_95%_35%))]"
            : "border-border bg-background text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function PricingPlansSection(props: {
  /** Deprecated. The catalog now exposes only personal plans. */
  showTabs?: boolean;
  /** Called when user clicks a plan CTA. */
  onSelectPlan: (planName: string, tab: PlanTab) => void;
  /** Provide current plan name to disable its CTA and show "Tu plan actual". */
  currentPlanName?: string;
  /** External loading state by plan name (lowercase). */
  loadingPlanName?: string | null;
  /** Deprecated. Personal plans are always shown. */
  defaultTab?: PlanTab;
}) {
  const {
    onSelectPlan,
    currentPlanName,
    loadingPlanName = null,
  } = props;

  const plans = PERSONAL_PLANS;

  const normalizedCurrent = (currentPlanName || "").toLowerCase();

  return (
    <div>
      <div className="p-6">
        <div
          className={cn(
            "grid gap-5",
            "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {plans.map((plan) => {
            const planKey = plan.name.toLowerCase();
            const isCurrent = normalizedCurrent && planKey === normalizedCurrent;
            const isLoading = loadingPlanName === planKey;

            return (
              <div
                key={plan.name}
                className={cn(
                  "rounded-2xl border border-border p-6 flex flex-col bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md",
                  plan.highlight &&
                    "bg-muted/20 ring-1 ring-[hsl(var(--future-b,195_95%_35%)/0.18)] shadow-md",
                )}
                data-testid={`plan-card-${plan.name.toLowerCase()}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className={cn("text-lg font-semibold tracking-tight", plan.highlight && "text-future-gradient")}>
                    {plan.name}
                  </h3>
                  {plan.badge && (
                    <PlanBadge label={plan.badge} data-testid={`badge-${plan.badge.toLowerCase()}`} />
                  )}
                </div>

                <div className="flex items-baseline gap-0.5 mb-2">
                  <span className="text-sm">$</span>
                  <span
                    className={cn(
                      "text-4xl font-semibold tracking-tight tabular-nums",
                      plan.highlight && "text-future-gradient",
                    )}
                  >
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">USD / mes</span>
                </div>

                <p className="text-sm text-muted-foreground mb-4 min-h-[2.5rem] md:min-h-[3rem]">
                  {plan.description}
                </p>

                <Button
                  variant={plan.buttonVariant}
                  className={cn(
                    "w-full mb-6",
                    plan.buttonVariant === "outline" && "hover:bg-accent/60",
                    plan.buttonVariant === "default" && "hover:bg-primary/90 hover:border-primary/90",
                    plan.highlight && plan.buttonVariant === "default" && "shadow-sm",
                  )}
                  disabled={isCurrent || isLoading}
                  onClick={() => !isCurrent && onSelectPlan(plan.name, "personal")}
                  data-testid={`button-${plan.name.toLowerCase()}`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : isCurrent ? (
                    "Tu plan actual"
                  ) : (
                    plan.buttonText
                  )}
                </Button>

                <div className="space-y-3 flex-1">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <feature.icon className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-foreground/80 leading-snug">{feature.text}</span>
                    </div>
                  ))}
                </div>

                {plan.footerNote && (
                  <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
                    {plan.footerNote.includes("Obtener más información") ? (
                      <>
                        {plan.footerNote.replace("Obtener más información", "")}
                        <button
                          type="button"
                          className="underline underline-offset-4 decoration-muted-foreground/40 hover:text-foreground"
                        >
                          Obtener más información
                        </button>
                      </>
                    ) : plan.footerNote.includes("Se aplican límites") ? (
                      <>
                        {plan.footerNote.replace("Se aplican límites", "")}
                        <button
                          type="button"
                          className="underline underline-offset-4 decoration-muted-foreground/40 hover:text-foreground"
                        >
                          Se aplican límites
                        </button>
                      </>
                    ) : (
                      plan.footerNote
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
