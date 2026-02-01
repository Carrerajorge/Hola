import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Building2, Users, Shield, Zap, LineChart, Lock, Globe, Sparkles, ArrowRight } from "lucide-react";

export default function BusinessPage() {
  const [, setLocation] = useLocation();

  const features = [
    {
      icon: Users,
      title: "Equipos ilimitados",
      desc: "Gestiona permisos, roles y accesos para toda tu organización."
    },
    {
      icon: Shield,
      title: "Seguridad empresarial",
      desc: "SSO, SAML, encriptación en reposo y en tránsito, cumplimiento SOC 2."
    },
    {
      icon: LineChart,
      title: "Analytics avanzados",
      desc: "Dashboards de uso, productividad y ROI en tiempo real."
    },
    {
      icon: Lock,
      title: "Control de datos",
      desc: "Tus datos nunca salen de tu región. Cumplimiento GDPR/CCPA."
    },
    {
      icon: Globe,
      title: "API sin límites",
      desc: "Integra ILIAGPT en tus sistemas internos con nuestra API REST."
    },
    {
      icon: Zap,
      title: "Rendimiento garantizado",
      desc: "SLA 99.9%, soporte dedicado 24/7, tiempos de respuesta garantizados."
    }
  ];

  const cases = [
    {
      company: "TechCorp",
      quote: "Redujimos el tiempo de investigación en un 60% con ILIAGPT.",
      role: "VP de Innovación"
    },
    {
      company: "GlobalBank",
      quote: "La seguridad empresarial nos dio la confianza para implementarlo en toda la organización.",
      role: "CISO"
    },
    {
      company: "HealthPlus",
      quote: "Nuestros equipos de soporte resuelven tickets 3x más rápido.",
      role: "Director de Operaciones"
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
        <span className="font-semibold text-white">Para Empresas</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-6xl space-y-16">

          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-amber-300 mb-6">
              <Building2 className="h-3 w-3" />
              <span>Soluciones Enterprise</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 text-white leading-tight">
              IA que escala con <br />
              <span className="text-gradient-premium">tu empresa</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed mb-8">
              Desde startups hasta Fortune 500. Seguridad de grado bancario, 
              integraciones personalizadas y soporte dedicado.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Button
                onClick={() => setLocation("/signup")}
                className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 px-8"
              >
                Solicitar demo
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="rounded-full border-white/20 text-white hover:bg-white/10"
                onClick={() => setLocation("/pricing")}
              >
                Ver precios
              </Button>
            </div>
          </section>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
            {features.map((feature, i) => (
              <div
                key={i}
                className="glass-premium p-6 rounded-2xl border border-white/5 hover:border-white/20 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-4 text-purple-400">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Social Proof */}
          <section className="fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-bold text-white mb-8 text-center">
              Empresas que confían en nosotros
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {cases.map((c, i) => (
                <div key={i} className="glass-premium p-6 rounded-2xl border border-white/10">
                  <p className="text-zinc-300 italic mb-4">"{c.quote}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
                      {c.company[0]}
                    </div>
                    <div>
                      <p className="text-white font-medium">{c.company}</p>
                      <p className="text-xs text-zinc-500">{c.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="glass-premium rounded-3xl p-8 md:p-12 text-center fade-in-up fade-in-up-delay-3">
            <Sparkles className="h-8 w-8 text-amber-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white mb-4">
              ¿Listo para transformar tu empresa?
            </h2>
            <p className="text-zinc-400 mb-6 max-w-xl mx-auto">
              Agenda una demo personalizada con nuestro equipo de soluciones empresariales.
            </p>
            <Button
              onClick={() => setLocation("/signup")}
              className="rounded-full bg-white text-black hover:bg-zinc-200 px-8"
            >
              Contactar ventas
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}
