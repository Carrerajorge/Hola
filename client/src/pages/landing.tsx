import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paperclip, Search, BookOpen, Image, Mic, X, ChevronDown, HelpCircle, Sparkles, Zap, Shield, Globe, Menu, ArrowRight, Clock } from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const stateKey = "mobile-menu-open";
    const currentState = window.history.state;
    if (!currentState || currentState[stateKey] !== true) {
      window.history.pushState({ ...(currentState || {}), [stateKey]: true }, "");
    }
    const onPopState = () => {
      setMobileMenuOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [mobileMenuOpen]);

  const handleSubmit = () => {
    if (inputValue.trim()) {
      setLocation("/login");
    }
  };

  const features = [
    { icon: Paperclip, label: "Adjuntar" },
    { icon: Search, label: "Buscar" },
    { icon: BookOpen, label: "Estudiemos" },
    { icon: Image, label: "Crear imagen" },
    { icon: Mic, label: "Voz" },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col relative">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-8 h-16 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-neutral-700 hover:text-black hover:bg-neutral-100 md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Cerrar menu" : "Abrir menu"}
            aria-expanded={mobileMenuOpen}
            data-testid="button-mobile-menu-left"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <IliaGPTLogo size={30} className="shadow-sm" />
          <span className="font-bold tracking-wide text-black text-base">ILIAGPT</span>
        </div>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          <span onClick={() => setLocation("/about")} className="text-neutral-600 hover:text-black transition-colors cursor-pointer">Sobre nosotros</span>
          <span onClick={() => setLocation("/learn")} className="text-neutral-600 hover:text-black transition-colors cursor-pointer">Aprender</span>
          <span onClick={() => setLocation("/business")} className="text-neutral-600 hover:text-black transition-colors cursor-pointer">Business</span>
          <span onClick={() => setLocation("/pricing")} className="text-neutral-600 hover:text-black transition-colors cursor-pointer">Precios</span>
          <span onClick={() => setLocation("/login")} className="text-neutral-600 hover:text-black transition-colors cursor-pointer">Imagenes</span>
          <span onClick={() => setLocation("/download")} className="text-neutral-600 hover:text-black transition-colors cursor-pointer">Descargar</span>
        </nav>

        <div className="flex items-center gap-2.5">
          <Button
            className="rounded-full bg-black text-white hover:bg-neutral-800 transition-colors h-9 px-4 text-sm sm:h-10 sm:px-5 sm:text-sm font-medium"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesion
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-neutral-300 text-black hover:bg-neutral-50 hover:border-neutral-400 transition-colors font-medium text-sm"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscribete gratis
          </Button>
        </div>
      </header>

      {/* Mobile menu drawer */}
      <div
        className={"md:hidden" + (mobileMenuOpen ? "" : " pointer-events-none")}
        aria-hidden={!mobileMenuOpen}
      >
        <div
          className={
            "fixed left-0 right-0 top-16 bottom-0 z-40 bg-black/40 transition-opacity duration-200 " +
            (mobileMenuOpen ? "opacity-100" : "opacity-0")
          }
          onClick={() => setMobileMenuOpen(false)}
        />

        <div
          className={
            "fixed left-0 top-16 bottom-0 z-50 w-[78vw] max-w-[300px] border-r border-neutral-200 bg-white shadow-xl " +
            "transition-transform duration-200 ease-out " +
            (mobileMenuOpen ? "translate-x-0" : "-translate-x-full")
          }
          role="menu"
          aria-label="Menu"
          data-testid="mobile-menu"
        >
          <div className="p-3 flex flex-col gap-0.5">
            {[
              { label: "Sobre nosotros", to: "/about" },
              { label: "Aprender", to: "/learn" },
              { label: "Business", to: "/business" },
              { label: "Precios", to: "/pricing" },
              { label: "Imagenes", to: "/login" },
              { label: "Descargar", to: "/download" },
            ].map((item) => (
              <button
                key={item.to}
                type="button"
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-700 hover:text-black hover:bg-neutral-100 transition-colors"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setLocation(item.to);
                }}
                role="menuitem"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 md:py-20">
        <div className="w-full max-w-2xl space-y-10">
          {/* Hero Title */}
          <div className="text-center fade-in-up">
            <h1 className="text-4xl md:text-[3.5rem] md:leading-tight font-bold text-black mb-4 tracking-tight">
              ¿Con que puedo ayudarte?
            </h1>
            <p className="text-lg text-neutral-500 max-w-lg mx-auto leading-relaxed">
              El asistente de IA mas inteligente para crear, investigar y aprender
            </p>
          </div>

          {/* Search Input */}
          <div className="space-y-5 fade-in-up fade-in-up-delay-1">
            <div className="relative group">
              <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm transition-shadow duration-300 group-focus-within:shadow-md group-focus-within:border-neutral-300">
                <Input
                  placeholder="Pregunta lo que quieras..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-14 md:h-16 px-5 md:px-6 text-base md:text-lg bg-transparent border-0 text-black placeholder:text-neutral-400
                    focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="input-landing-search"
                />
              </div>
            </div>

            {/* Feature Buttons */}
            <div className="flex items-center justify-center gap-2.5 flex-wrap">
              {features.map((feature, index) => (
                <Button
                  key={feature.label}
                  variant="outline"
                  className={`rounded-full gap-2 text-sm border-neutral-200 bg-white text-neutral-700
                    hover:bg-neutral-50 hover:text-black hover:border-neutral-300 transition-all duration-200
                    fade-in-up`}
                  style={{ animationDelay: `${(index + 2) * 80}ms` }}
                  onClick={() => setLocation("/login")}
                  data-testid={`button-${feature.label.toLowerCase().replace(' ', '-')}`}
                >
                  <feature.icon className="h-4 w-4" />
                  {feature.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Promo Card */}
          {showPromo && (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 md:p-8 relative fade-in-up fade-in-up-delay-3">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3 h-8 w-8 text-neutral-400 hover:text-black hover:bg-neutral-200/60 rounded-full"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-black uppercase tracking-wider bg-neutral-200 px-2.5 py-1 rounded-full">
                      <Sparkles className="h-3.5 w-3.5" />
                      Nuevo
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-black mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-neutral-500 mb-5 leading-relaxed">
                    ¿Tienes una idea? Prueba nuestros estilos y filtros seleccionados o imagina algo desde cero.
                  </p>
                  <Button
                    className="rounded-full bg-black text-white hover:bg-neutral-800 transition-colors font-medium gap-2"
                    onClick={() => setLocation("/login")}
                    data-testid="button-try-now"
                  >
                    Probar ahora
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>

                {/* Style Cards */}
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible md:flex-wrap md:justify-center md:items-center md:gap-3">
                  {[
                    { emoji: "🎨", label: "Boceto" },
                    { emoji: "🎄", label: "Festivo" },
                    { emoji: "🎭", label: "Dramatico" },
                    { emoji: "🧸", label: "Peluche" },
                  ].map((style) => (
                    <div
                      key={style.label}
                      className="flex flex-col items-center gap-2 min-w-[68px] cursor-pointer group"
                      onClick={() => setLocation("/login")}
                    >
                      <div className="w-16 h-16 md:w-[72px] md:h-[72px] rounded-2xl bg-white border border-neutral-200
                        flex items-center justify-center
                        transition-all duration-200 group-hover:border-neutral-400 group-hover:shadow-md">
                        <span className="text-2xl">{style.emoji}</span>
                      </div>
                      <span className="text-xs text-neutral-500 group-hover:text-black transition-colors font-medium">{style.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex items-center justify-center gap-6 md:gap-8 text-neutral-400 text-sm fade-in-up fade-in-up-delay-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span>Seguro y privado</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Disponible 24/7</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              <span>Respuestas instantaneas</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-5 text-center text-sm text-neutral-400 border-t border-neutral-200 bg-white px-4">
        Al enviar un mensaje a ILIAGPT, un chatbot de IA, aceptas nuestros{" "}
        <Link href="/terms" className="text-neutral-600 hover:text-black underline underline-offset-2 transition-colors">Terminos</Link>
        {" "}y reconoces que leiste nuestra{" "}
        <Link href="/privacy-policy" className="text-neutral-600 hover:text-black underline underline-offset-2 transition-colors">Politica de privacidad</Link>.
      </footer>
    </div>
  );
}
