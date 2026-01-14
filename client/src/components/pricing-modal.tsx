import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Check, Zap, Crown, Building2, Clock } from "lucide-react";

interface QuotaInfo {
  remaining: number;
  limit: number;
  resetAt: string | null;
  plan: string;
}

interface PricingModalProps {
  open: boolean;
  onClose: () => void;
  quota: QuotaInfo;
}

interface PlanFeature {
  text: string;
  included: boolean;
}

interface PlanInfo {
  id: string;
  name: string;
  price: string;
  priceId: string | null;
  description: string;
  features: PlanFeature[];
  icon: React.ReactNode;
  gradient: string;
  popular?: boolean;
}

const plans: PlanInfo[] = [
  {
    id: "free",
    name: "Gratis",
    price: "$0",
    priceId: null,
    description: "Perfecto para comenzar",
    icon: <Zap className="h-6 w-6" />,
    gradient: "from-gray-500 to-gray-600",
    features: [
      { text: "10 solicitudes por día", included: true },
      { text: "Generación de documentos básica", included: true },
      { text: "Soporte por email", included: true },
      { text: "Análisis avanzado", included: false },
      { text: "Prioridad en cola", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    priceId: "price_pro_monthly",
    description: "Para profesionales y equipos pequeños",
    icon: <Crown className="h-6 w-6" />,
    gradient: "from-blue-500 to-purple-600",
    popular: true,
    features: [
      { text: "500 solicitudes por mes", included: true },
      { text: "Generación de documentos ilimitada", included: true },
      { text: "Soporte prioritario", included: true },
      { text: "Análisis avanzado con IA", included: true },
      { text: "Prioridad en cola", included: false },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "$99",
    priceId: "price_enterprise_monthly",
    description: "Para grandes organizaciones",
    icon: <Building2 className="h-6 w-6" />,
    gradient: "from-amber-500 to-orange-600",
    features: [
      { text: "Solicitudes ilimitadas", included: true },
      { text: "Generación de documentos ilimitada", included: true },
      { text: "Soporte dedicado 24/7", included: true },
      { text: "Análisis avanzado con IA", included: true },
      { text: "Prioridad máxima en cola", included: true },
    ],
  },
];

function formatResetTime(resetAt: string | null): string {
  if (!resetAt) return "No disponible";
  
  try {
    const resetDate = new Date(resetAt);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    
    if (diffMs <= 0) return "Ahora";
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHours > 24) {
      const diffDays = Math.floor(diffHours / 24);
      return `en ${diffDays} día${diffDays > 1 ? "s" : ""}`;
    }
    
    if (diffHours > 0) {
      return `en ${diffHours}h ${diffMinutes}m`;
    }
    
    return `en ${diffMinutes} minuto${diffMinutes > 1 ? "s" : ""}`;
  } catch {
    return "No disponible";
  }
}

export function PricingModal({ open, onClose, quota }: PricingModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const handleSubscribe = async (priceId: string, planId: string) => {
    if (!priceId) return;
    
    setLoadingPlan(planId);
    
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ priceId }),
      });
      
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        console.error("Checkout error:", data.error);
      }
    } catch (error) {
      console.error("Error initiating checkout:", error);
    } finally {
      setLoadingPlan(null);
    }
  };

  const currentPlanId = quota.plan.toLowerCase();
  const usagePercentage = quota.limit > 0 ? Math.round((1 - quota.remaining / quota.limit) * 100) : 100;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent 
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        data-testid="pricing-modal"
      >
        <DialogHeader className="text-center pb-4">
          <DialogTitle 
            className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"
            data-testid="pricing-modal-title"
          >
            Mejora tu Plan
          </DialogTitle>
          <DialogDescription data-testid="pricing-modal-description">
            Has alcanzado el límite de tu plan actual. Elige un plan superior para continuar.
          </DialogDescription>
        </DialogHeader>

        <div 
          className="mb-6 p-4 rounded-lg bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/30 dark:to-orange-950/30 border border-red-200 dark:border-red-800"
          data-testid="quota-status"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Uso actual del plan
            </span>
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">
              {quota.remaining} de {quota.limit} solicitudes restantes
            </span>
          </div>
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-red-500 to-orange-500 transition-all duration-300"
              style={{ width: `${usagePercentage}%` }}
              data-testid="quota-progress-bar"
            />
          </div>
          <div className="flex items-center mt-2 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="h-3 w-3 mr-1" />
            <span data-testid="quota-reset-time">
              Se restablece {formatResetTime(quota.resetAt)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrentPlan = currentPlanId === plan.id;
            const isLoading = loadingPlan === plan.id;
            
            return (
              <Card 
                key={plan.id}
                className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg ${
                  plan.popular ? "ring-2 ring-blue-500 dark:ring-blue-400" : ""
                } ${isCurrentPlan ? "opacity-75" : ""}`}
                data-testid={`plan-card-${plan.id}`}
              >
                {plan.popular && (
                  <div className="absolute top-0 right-0 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs font-semibold px-3 py-1 rounded-bl-lg">
                    Popular
                  </div>
                )}
                
                <div className={`h-2 bg-gradient-to-r ${plan.gradient}`} />
                
                <CardHeader className="text-center pb-2">
                  <div className={`mx-auto w-12 h-12 rounded-full bg-gradient-to-r ${plan.gradient} flex items-center justify-center text-white mb-3`}>
                    {plan.icon}
                  </div>
                  <CardTitle className="text-xl" data-testid={`plan-name-${plan.id}`}>
                    {plan.name}
                  </CardTitle>
                  <div className="mt-2">
                    <span 
                      className="text-3xl font-bold"
                      data-testid={`plan-price-${plan.id}`}
                    >
                      {plan.price}
                    </span>
                    {plan.price !== "$0" && (
                      <span className="text-gray-500 dark:text-gray-400">/mes</span>
                    )}
                  </div>
                  <CardDescription className="mt-1">
                    {plan.description}
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="pt-0">
                  <ul className="space-y-2 mb-4">
                    {plan.features.map((feature, index) => (
                      <li 
                        key={index}
                        className={`flex items-start text-sm ${
                          feature.included 
                            ? "text-gray-700 dark:text-gray-300" 
                            : "text-gray-400 dark:text-gray-600"
                        }`}
                      >
                        <Check 
                          className={`h-4 w-4 mr-2 mt-0.5 flex-shrink-0 ${
                            feature.included 
                              ? "text-green-500" 
                              : "text-gray-300 dark:text-gray-600"
                          }`}
                        />
                        <span className={!feature.included ? "line-through" : ""}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                  
                  {isCurrentPlan ? (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      disabled
                      data-testid={`plan-button-${plan.id}`}
                    >
                      Plan Actual
                    </Button>
                  ) : plan.priceId ? (
                    <Button 
                      className={`w-full bg-gradient-to-r ${plan.gradient} hover:opacity-90 text-white border-0`}
                      onClick={() => handleSubscribe(plan.priceId!, plan.id)}
                      disabled={isLoading}
                      data-testid={`plan-button-${plan.id}`}
                    >
                      {isLoading ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Procesando...
                        </span>
                      ) : (
                        "Suscribirse"
                      )}
                    </Button>
                  ) : (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      disabled
                      data-testid={`plan-button-${plan.id}`}
                    >
                      Gratis
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>¿Tienes preguntas? Contáctanos en soporte@iliagpt.com</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PricingModal;
