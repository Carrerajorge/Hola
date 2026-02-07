import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PricingPlansSection } from "@/components/pricing/plans-section";
import { ChevronLeft, Sparkles } from "lucide-react";

export default function PricingPage() {
  const [, setLocation] = useLocation();

  // Plans are rendered via <PricingPlansSection /> to match the in-app upgrade dialog.

  return (
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-black/10 bg-white/80 backdrop-blur-md">
        <Link href="/welcome">
          <Button variant="ghost" className="rounded-full gap-2 text-zinc-700 hover:text-zinc-900 hover:bg-black/5">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-zinc-900">Precios</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-6xl space-y-12">
          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-50 border border-black/10 text-xs font-semibold text-zinc-700 mb-6">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Planes flexibles</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-zinc-950 leading-[1.05]">
              Elige tu{" "}
              <span className="underline decoration-zinc-300 underline-offset-8">
                plan perfecto
              </span>
            </h1>
            <p className="text-lg text-zinc-600 max-w-2xl mx-auto leading-relaxed">
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
          <section className="rounded-3xl border border-black/10 bg-zinc-50 p-8 md:p-12 fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-extrabold tracking-tight text-zinc-950 mb-8 text-center">
              Preguntas frecuentes
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              {[
                { q: "¿Puedo cambiar de plan?", a: "Sí, puedes actualizar o degradar tu plan en cualquier momento desde tu configuración." },
                { q: "¿Hay contratos?", a: "No, todos los planes son mensuales y puedes cancelar cuando quieras." },
                { q: "¿Qué métodos de pago aceptan?", a: "Visa, Mastercard, American Express, PayPal y transferencia bancaria para Enterprise." },
                { q: "¿Ofrecen descuentos para estudiantes?", a: "Sí, 50% de descuento en Pro con verificación educativa." }
              ].map((faq, i) => (
                <div key={i} className="space-y-2">
                  <h4 className="text-sm font-semibold text-zinc-950">{faq.q}</h4>
                  <p className="text-sm text-zinc-600 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
