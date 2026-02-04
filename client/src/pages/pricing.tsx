import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PricingPlansSection } from "@/components/pricing/plans-section";
import { ChevronLeft, Sparkles } from "lucide-react";

export default function PricingPage() {
  const [, setLocation] = useLocation();

  // Plans are rendered via <PricingPlansSection /> to match the in-app upgrade dialog.

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

          {/* Plans (match in-app upgrade dialog) */}
          <div className="fade-in-up fade-in-up-delay-1">
            <PricingPlansSection
              onSelectPlan={() => setLocation("/signup")}
              showTabs
            />
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
