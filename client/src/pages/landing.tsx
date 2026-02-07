import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paperclip, Search, BookOpen, Image, Mic, X, ChevronDown, HelpCircle, Sparkles, Zap, Shield, Globe, Menu, ArrowRight, Star } from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Prevent background scroll while the mobile drawer is open.
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    // Close drawer on Escape (desktop / mobile keyboards)
    if (!mobileMenuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    // Close drawer with browser back (Android back button / history back)
    if (!mobileMenuOpen) return;

    const stateKey = "mobile-menu-open";
    const currentState = window.history.state;

    // Only push a state if we aren't already in one created for this menu.
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
    <div className="min-h-screen landing-luxe cyber-grid flex flex-col relative overflow-hidden">
      {/* Futuristic background orbs */}
      <div className="floating-orb-light floating-orb-light-1" />
      <div className="floating-orb-light floating-orb-light-2" />
      <div className="floating-orb-light floating-orb-light-3" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-purple-200/30 bg-white/80 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-zinc-700 hover:text-fuchsia-600 hover:bg-fuchsia-50 md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileMenuOpen}
            data-testid="button-mobile-menu-left"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <IliaGPTLogo size={32} className="shadow-sm" />
          <span className="font-semibold tracking-wide text-luxe text-luxe-sm" data-text="ILIAGPT">ILIAGPT</span>
          <ChevronDown className="h-4 w-4 text-purple-400" />
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <span onClick={() => setLocation("/about")} className="text-zinc-500 hover:text-fuchsia-600 transition-colors duration-200 cursor-pointer">Sobre nosotros</span>
          <span onClick={() => setLocation("/learn")} className="text-zinc-500 hover:text-fuchsia-600 transition-colors duration-200 cursor-pointer">Aprender</span>
          <span onClick={() => setLocation("/business")} className="text-zinc-500 hover:text-fuchsia-600 transition-colors duration-200 cursor-pointer">Business</span>
          <span onClick={() => setLocation("/pricing")} className="text-zinc-500 hover:text-fuchsia-600 transition-colors duration-200 cursor-pointer">Precios</span>
          <span onClick={() => setLocation("/login")} className="text-fuchsia-600 font-medium hover:text-purple-700 transition-colors duration-200 cursor-pointer">Imágenes</span>
          <span onClick={() => setLocation("/download")} className="text-zinc-500 hover:text-fuchsia-600 transition-colors duration-200 cursor-pointer">Descargar</span>
        </nav>

        <div className="flex items-center gap-3">
          <Button
            className="btn-luxe rounded-full bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-700 text-white border-0 shadow-[0_4px_20px_rgba(168,85,247,0.3)] hover:shadow-[0_6px_30px_rgba(168,85,247,0.4)] transition-all duration-300 h-9 px-4 text-sm sm:h-10 sm:px-5 sm:text-base"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesión
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-purple-200/50 text-purple-700 hover:bg-fuchsia-50 hover:border-fuchsia-400/60 hover:text-fuchsia-700 transition-all duration-300"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscríbete gratis
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hidden sm:inline-flex text-purple-400 hover:text-fuchsia-600 hover:bg-fuchsia-50">
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Mobile menu: left drawer + scrim */}
      <div
        className={
          "md:hidden" +
          (mobileMenuOpen ? "" : " pointer-events-none")
        }
        aria-hidden={!mobileMenuOpen}
      >
        <div
          className={
            "fixed left-0 right-0 top-16 bottom-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 " +
            (mobileMenuOpen ? "opacity-100" : "opacity-0")
          }
        />

        <div
          className={
            "fixed left-0 top-16 bottom-0 z-50 w-[78vw] max-w-[320px] border-r border-purple-200/30 bg-white/95 backdrop-blur-xl shadow-2xl shadow-purple-900/10 " +
            "transition-transform duration-200 ease-out " +
            (mobileMenuOpen ? "translate-x-0" : "-translate-x-full")
          }
          role="menu"
          aria-label="Menú"
          data-testid="mobile-menu"
        >
          <div className="p-3">
            {[
              { label: "Sobre nosotros", to: "/about" },
              { label: "Aprender", to: "/learn" },
              { label: "Business", to: "/business" },
              { label: "Precios", to: "/pricing" },
              { label: "Imágenes", to: "/login" },
              { label: "Descargar", to: "/download" },
            ].map((item) => (
              <button
                key={item.to}
                type="button"
                className={
                  "w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 " +
                  (item.label === "Imágenes"
                    ? "text-fuchsia-600 hover:text-fuchsia-700 hover:bg-fuchsia-50"
                    : "text-zinc-700 hover:text-fuchsia-600 hover:bg-fuchsia-50/50")
                }
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
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl space-y-10">

          {/* Hero Title */}
          <div className="text-center fade-in-up space-y-5">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-fuchsia-50 border border-fuchsia-200/60">
              <Star className="h-3.5 w-3.5 text-fuchsia-500 fill-fuchsia-500" />
              <span className="text-xs font-semibold text-fuchsia-600 uppercase tracking-wider">IA de nueva generación</span>
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight">
              <span className="text-futuristic-hero">¿Con qué puedo</span>
              <br />
              <span className="text-luxe text-luxe-lg" data-text="ayudarte?">ayudarte?</span>
            </h1>
            <p className="text-base md:text-lg text-zinc-400 max-w-lg mx-auto leading-relaxed">
              El asistente de IA más inteligente para crear, investigar y aprender
            </p>
          </div>

          {/* Neon line separator */}
          <div className="neon-line-animated max-w-xs mx-auto fade-in-up fade-in-up-delay-1" />

          {/* Search Input */}
          <div className="space-y-6 fade-in-up fade-in-up-delay-1">
            <div className="relative group">
              <div className="glass-luxe rounded-2xl p-1 neon-border pulse-neon">
                <Input
                  placeholder="Pregunta lo que quieras..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-16 px-6 text-lg bg-transparent border-0 text-zinc-900 placeholder:text-zinc-400
                    focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="input-landing-search"
                />
              </div>
              <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-r from-fuchsia-400/25 via-purple-300/20 to-violet-400/25 blur-2xl opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
            </div>

            {/* Feature Buttons */}
            <div className="flex items-center justify-center gap-2.5 flex-wrap">
              {features.map((feature, index) => (
                <Button
                  key={feature.label}
                  variant="outline"
                  className="rounded-full gap-2 text-sm border-purple-200/40 bg-white/80 text-zinc-600
                    hover:bg-fuchsia-50 hover:border-fuchsia-300 hover:text-fuchsia-700 transition-all duration-300
                    hover:scale-105 hover:shadow-lg hover:shadow-fuchsia-200/20 fade-in-up"
                  style={{ animationDelay: `${(index + 2) * 100}ms` }}
                  onClick={() => setLocation("/login")}
                  data-testid={`button-${feature.label.toLowerCase().replace(' ', '-')}`}
                >
                  <div className="icon-gradient rounded-md p-0.5">
                    <feature.icon className="h-3.5 w-3.5 text-fuchsia-600" />
                  </div>
                  {feature.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Promo Card with Premium Design */}
          {showPromo && (
            <div className="glass-luxe rounded-3xl p-6 md:p-8 relative overflow-hidden isolate fade-in-up fade-in-up-delay-3 card-lift neon-border">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 h-8 w-8 text-zinc-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-full z-10"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              {/* Subtle background gradient inside the card */}
              <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-50/50 via-transparent to-purple-50/50 pointer-events-none" />

              <div className="relative flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="icon-gradient-strong rounded-lg p-1.5">
                      <Sparkles className="h-4 w-4 text-fuchsia-600" />
                    </div>
                    <span className="text-xs font-bold text-fuchsia-600 uppercase tracking-wider">Nuevo</span>
                  </div>
                  <h3 className="text-xl font-bold text-zinc-900 mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-zinc-500 mb-5 leading-relaxed">
                    ¿Tienes una idea? Prueba nuestros estilos y filtros seleccionados o imagina algo desde cero.
                  </p>
                  <Button
                    className="btn-luxe rounded-full bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-700 text-white border-0 shadow-[0_4px_20px_rgba(168,85,247,0.3)] hover:shadow-[0_6px_30px_rgba(168,85,247,0.4)] transition-all duration-300"
                    onClick={() => setLocation("/login")}
                    data-testid="button-try-now"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Probar ahora
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>

                {/* Style Cards */}
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible md:flex-wrap md:justify-center md:items-center md:gap-4">
                  {[
                    { emoji: "🎨", label: "Boceto", gradient: "from-fuchsia-500/20 to-purple-500/20" },
                    { emoji: "🎄", label: "Festivo", gradient: "from-violet-500/20 to-indigo-500/20" },
                    { emoji: "🎭", label: "Dramático", gradient: "from-purple-500/20 to-fuchsia-500/20" },
                    { emoji: "🧸", label: "Peluche", gradient: "from-pink-500/20 to-fuchsia-500/20" },
                  ].map((style) => (
                    <div
                      key={style.label}
                      className="flex flex-col items-center gap-2 min-w-[70px] cursor-pointer group"
                      onClick={() => setLocation("/login")}
                    >
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br ${style.gradient}
                        flex items-center justify-center border border-purple-200/40
                        transition-all duration-300 group-hover:scale-110 group-hover:border-fuchsia-400/60
                        group-hover:shadow-lg group-hover:shadow-fuchsia-200/30`}>
                        <span className="text-2xl group-hover:scale-110 transition-transform">{style.emoji}</span>
                      </div>
                      <span className="text-xs text-zinc-500 group-hover:text-fuchsia-600 font-medium transition-colors">{style.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex items-center justify-center gap-6 md:gap-8 text-sm fade-in-up fade-in-up-delay-4">
            <div className="flex items-center gap-2 text-zinc-400">
              <Shield className="h-4 w-4 text-purple-400" />
              <span>Seguro y privado</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <Globe className="h-4 w-4 text-fuchsia-400" />
              <span>Disponible 24/7</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <Zap className="h-4 w-4 text-violet-400" />
              <span>Respuestas instantáneas</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 text-center text-sm text-zinc-400 border-t border-purple-200/30 bg-white/80 backdrop-blur-xl">
        Al enviar un mensaje a ILIAGPT, un chatbot de IA, aceptas nuestros{" "}
        <Link href="/terms" className="text-purple-500 hover:text-fuchsia-600 underline transition-colors">Términos</Link>
        {" "}y reconoces que leíste nuestra{" "}
        <Link href="/privacy-policy" className="text-purple-500 hover:text-fuchsia-600 underline transition-colors">Política de privacidad</Link>.
      </footer>
    </div>
  );
}
