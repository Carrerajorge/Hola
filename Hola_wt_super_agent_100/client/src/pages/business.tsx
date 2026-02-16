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
    <div className="min-h-screen paper-grid flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-border bg-background/80 backdrop-blur-sm">
        <Link href="/welcome">
          <Button variant="ghost" className="rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 gap-2">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-foreground">Para empresas</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-6xl space-y-16">

          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted/30 border border-border text-xs font-semibold text-foreground mb-6">
              <Building2 className="h-3 w-3" />
              <span>Soluciones para equipos</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-6 text-foreground leading-[1.05]">
              IA para{" "}
              <span className="relative inline-block">
                <span className="absolute inset-x-0 -bottom-1 h-3 md:h-4 rounded bg-muted -z-10" />
                empresas
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-8">
              Seguridad, control y soporte para desplegar ILIAGPT en toda tu organización.
            </p>
            <div className="flex items-center justify-center gap-3 flex-col sm:flex-row">
              <Button
                onClick={() => setLocation("/signup")}
                className="rounded-full px-8 w-full sm:w-auto"
              >
                Solicitar demo
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                variant="outline"
                className="rounded-full px-8 w-full sm:w-auto bg-background text-foreground hover:bg-muted/40 transition-colors"
                onClick={() => setLocation("/pricing")}
              >
                Ver precios
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                SOC 2 y cifrado
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                SSO / SAML
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
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
                className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:bg-muted/20 transition-colors duration-200"
              >
                <div className="w-11 h-11 rounded-xl border border-border bg-background flex items-center justify-center mb-4 text-foreground">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Social Proof */}
          <section className="fade-in-up fade-in-up-delay-2">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground mb-8 text-center">
              Empresas que confían en nosotros
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {cases.map((c, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <p className="text-muted-foreground leading-relaxed mb-4">“{c.quote}”</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center font-semibold">
                      {c.company[0]}
                    </div>
                    <div>
                      <p className="text-foreground font-semibold">{c.company}</p>
                      <p className="text-xs text-muted-foreground">{c.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="rounded-3xl border border-border bg-card p-8 md:p-12 text-center shadow-sm fade-in-up fade-in-up-delay-3">
            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/30 text-foreground">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
              ¿Listo para{" "}
              <span className="inline-flex items-baseline rounded-lg bg-muted px-2 py-0.5 font-bold">
                transformar
              </span>{" "}
              tu equipo?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              Agenda una demo personalizada con nuestro equipo de soluciones empresariales.
            </p>
            <Button
              onClick={() => setLocation("/signup")}
              className="rounded-full px-8"
            >
              Contactar ventas
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}
