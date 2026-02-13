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
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-black/10 bg-white/80 backdrop-blur-md">
        <Link href="/welcome">
          <Button variant="ghost" className="rounded-full text-zinc-700 hover:text-zinc-900 hover:bg-black/5 gap-2">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-zinc-900">Para Empresas</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-6xl space-y-16">

          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-50 border border-black/10 text-xs font-semibold text-zinc-700 mb-6">
              <Building2 className="h-3 w-3 text-violet-700" />
              <span>
                Soluciones{" "}
                <span className="bg-gradient-to-r from-cyan-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                  Enterprise
                </span>
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-zinc-950 leading-[1.05]">
              <span className="text-zinc-950">
                <span className="bg-gradient-to-r from-cyan-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                  IA
                </span>{" "}
                que escala con
              </span>
              <br />
              <span className="bg-gradient-to-r from-cyan-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent drop-shadow-[0_1px_0_rgba(0,0,0,0.06)]">
                tu empresa
              </span>
            </h1>
            <p className="text-lg text-zinc-600 max-w-2xl mx-auto leading-relaxed mb-8">
              Desde startups hasta Fortune 500. Seguridad de grado bancario, 
              integraciones personalizadas y soporte dedicado.
            </p>
            <div className="flex items-center justify-center gap-3 flex-col sm:flex-row">
              <Button
                onClick={() => setLocation("/signup")}
                className="rounded-full bg-black text-white hover:bg-zinc-900 px-8 w-full sm:w-auto"
              >
                Solicitar demo
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="rounded-full border-black/20 text-zinc-900 hover:bg-black/5 px-8 w-full sm:w-auto"
                onClick={() => setLocation("/pricing")}
              >
                Ver precios
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
              <span className="flex items-center gap-2 text-emerald-700">
                <Shield className="h-3.5 w-3.5" />
                SOC 2 y cifrado
              </span>
              <span className="flex items-center gap-2 text-violet-700">
                <Lock className="h-3.5 w-3.5" />
                SSO / SAML
              </span>
              <span className="flex items-center gap-2 text-cyan-700">
                <Zap className="h-3.5 w-3.5" />
                SLA 99.9%
              </span>
            </div>
          </section>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
            {features.map((feature, i) => (
              <div
                key={i}
                className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm hover:shadow-md transition-shadow duration-300"
              >
                <div className="w-11 h-11 rounded-xl border border-black/10 bg-zinc-50 flex items-center justify-center mb-4 text-zinc-900">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-zinc-950 mb-2">{feature.title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Social Proof */}
          <section className="fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-extrabold tracking-tight text-zinc-950 mb-8 text-center">
              Empresas que confían en nosotros
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {cases.map((c, i) => (
                <div key={i} className="rounded-2xl border border-black/10 bg-zinc-50 p-6">
                  <p className="text-zinc-800 leading-relaxed mb-4">“{c.quote}”</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-semibold">
                      {c.company[0]}
                    </div>
                    <div>
                      <p className="text-zinc-950 font-semibold">{c.company}</p>
                      <p className="text-xs text-zinc-500">{c.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="rounded-3xl border border-black/10 bg-white p-8 md:p-12 text-center fade-in-up fade-in-up-delay-3">
            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-black/10 bg-zinc-50 text-violet-700">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-zinc-950 mb-4">
              ¿Listo para{" "}
              <span className="bg-gradient-to-r from-cyan-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                transformar
              </span>{" "}
              tu empresa?
            </h2>
            <p className="text-zinc-600 mb-6 max-w-xl mx-auto">
              Agenda una demo personalizada con nuestro equipo de soluciones empresariales.
            </p>
            <Button
              onClick={() => setLocation("/signup")}
              className="rounded-full bg-black text-white hover:bg-zinc-900 px-8"
            >
              Contactar ventas
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}
