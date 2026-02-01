import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Check, Sparkles, Zap, Shield, Crown, Star } from "lucide-react";

export default function PricingPage() {
  const [, setLocation] = useLocation();

  const plans = [
    {
      name: "Gratis",
      price: "0",
      description: "Perfecto para comenzar",
      features: [
        "Chat ilimitado con IA",
        "Generación básica de imágenes",
        "Acceso a modelos estándar",
        "5 archivos por chat",
        "Historial de 7 días"
      ],
      cta: "Comenzar gratis",
      popular: false,
      gradient: "from-zinc-500 to-zinc-600"
    },
    {
      name: "Pro",
      price: "19.99",
      description: "Para profesionales y equipos",
      features: [
        "Todo lo de Gratis, más:",
        "Modelos avanzados (GPT-4, Claude, Gemini)",
        "Generación ilimitada de imágenes",
        "Creación de documentos (Word, Excel, PPT)",
        "Modo agente con herramientas",
        "100GB de almacenamiento",
        "Soporte prioritario 24/7"
      ],
      cta: "Iniciar prueba gratis",
      popular: true,
      gradient: "from-purple-500 to-pink-500"
    },
    {
      name: "Enterprise",
      price: "Contactar",
      description: "Soluciones a medida",
      features: [
        "Todo lo de Pro, más:",
        "API access ilimitado",
        "Modelos personalizados",
        "SSO y seguridad avanzada",
        "SLA garantizado 99.9%",
        "Gerente de cuenta dedicado",
        "Integración con sistemas internos"
      ],
      cta: "Contactar ventas",
      popular: false,
      gradient: "from-amber-500 to-orange-500"
    }
  ];

  return (
    <div className="min-h-screen gradient-animated flex flex-col relative overflow-hidden">
      {/* Floating Orbs */}
      <div className="floating-orb floating-orb-1" />
      <div className="floating-orb floating-orb-2" />
      <div className="floating-orb floating-orb-3" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-white/10 backdrop-blur-sm">
        <Link href="/welcome">
          <Button variant="ghost" className="text-zinc-400 hover:text-white gap-2">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-white">Precios</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-6xl space-y-12">

          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-purple-300 mb-6">
              <Sparkles className="h-3 w-3" />
              <span>Planes flexibles</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 text-white leading-tight">
              Elige tu <span className="text-gradient-premium">plan perfecto</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Desde uso personal hasta soluciones empresariales. 
              Comienza gratis, escala cuando lo necesites.
            </p>
          </section>

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
            {plans.map((plan, i) => (
              <div
                key={plan.name}
                className={`relative glass-premium p-8 rounded-3xl border transition-all duration-300 hover:scale-[1.02] ${
                  plan.popular
                    ? "border-purple-500/50 shadow-lg shadow-purple-500/20"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-xs font-medium text-white flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    Más popular
                  </div>
                )}

                <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${plan.gradient} mb-4`}>
                  {plan.name === "Gratis" && <Zap className="h-6 w-6 text-white" />}
                  {plan.name === "Pro" && <Crown className="h-6 w-6 text-white" />}
                  {plan.name === "Enterprise" && <Shield className="h-6 w-6 text-white" />}
                </div>

                <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                <p className="text-sm text-zinc-400 mb-4">{plan.description}</p>

                <div className="flex items-baseline gap-1 mb-6">
                  {plan.price !== "Contactar" && <span className="text-sm text-zinc-400">$</span>}
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  {plan.price !== "Contactar" && <span className="text-sm text-zinc-400">/mes</span>}
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-zinc-300">
                      <Check className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => setLocation("/signup")}
                  className={`w-full rounded-full ${
                    plan.popular
                      ? "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white"
                      : "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                  }`}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>

          {/* FAQ Section */}
          <section className="glass-premium rounded-3xl p-8 md:p-12 fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Preguntas frecuentes</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                { q: "¿Puedo cambiar de plan?", a: "Sí, puedes actualizar o degradar tu plan en cualquier momento desde tu configuración." },
                { q: "¿Hay contratos?", a: "No, todos los planes son mensuales y puedes cancelar cuando quieras." },
                { q: "¿Qué métodos de pago aceptan?", a: "Visa, Mastercard, American Express, PayPal y transferencia bancaria para Enterprise." },
                { q: "¿Ofrecen descuentos para estudiantes?", a: "Sí, 50% de descuento en Pro con verificación educativa." }
              ].map((faq, i) => (
                <div key={i} className="space-y-2">
                  <h4 className="font-medium text-white">{faq.q}</h4>
                  <p className="text-sm text-zinc-400">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
