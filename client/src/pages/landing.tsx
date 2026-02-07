import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paperclip, Search, BookOpen, Image, Mic, X, ChevronDown, HelpCircle, Sparkles, Zap, Shield, Globe, Menu } from "lucide-react";
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
    { icon: Sparkles, label: "Adjuntar", iconColor: "text-fuchsia-500" },
    { icon: Search, label: "Buscar", iconColor: "text-purple-500" },
    { icon: BookOpen, label: "Estudiemos", iconColor: "text-violet-500" },
    { icon: Image, label: "Crear imagen", iconColor: "text-fuchsia-600" },
    { icon: Mic, label: "Voz", iconColor: "text-purple-600" },
  ];

  return (
    <div className="min-h-screen landing-luxe flex flex-col relative overflow-hidden">
      {/* Floating Particles */}
      <div className="landing-particles">
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-fuchsia-200/40 bg-white/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-zinc-700 hover:text-fuchsia-700 hover:bg-fuchsia-50 md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileMenuOpen}
            data-testid="button-mobile-menu-left"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <IliaGPTLogo size={32} className="shadow-sm" />
          <span className="font-semibold tracking-wide text-luxe text-luxe-sm" data-text="ILIAGPT">ILIAGPT</span>
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <span onClick={() => setLocation("/about")} className="nav-neon-hover text-zinc-600 hover:text-fuchsia-700 transition-colors duration-200 cursor-pointer">Sobre nosotros</span>
          <span onClick={() => setLocation("/learn")} className="nav-neon-hover text-zinc-600 hover:text-fuchsia-700 transition-colors duration-200 cursor-pointer">Aprender</span>
          <span onClick={() => setLocation("/business")} className="nav-neon-hover text-zinc-600 hover:text-fuchsia-700 transition-colors duration-200 cursor-pointer">Business</span>
          <span onClick={() => setLocation("/pricing")} className="nav-neon-hover text-zinc-600 hover:text-fuchsia-700 transition-colors duration-200 cursor-pointer">Precios</span>
          <span onClick={() => setLocation("/login")} className="nav-neon-hover text-fuchsia-600 hover:text-fuchsia-500 font-medium transition-colors duration-200 cursor-pointer">Imágenes</span>
          <span onClick={() => setLocation("/download")} className="nav-neon-hover text-zinc-600 hover:text-fuchsia-700 transition-colors duration-200 cursor-pointer">Descargar</span>
        </nav>

        <div className="flex items-center gap-3">
          <Button
            className="btn-luxe rounded-full bg-gradient-to-r from-fuchsia-600 to-purple-700 text-white border border-fuchsia-400/40 hover:from-fuchsia-500 hover:to-purple-600 shadow-[0_0_24px_rgba(192,38,211,0.20)] hover:shadow-[0_0_32px_rgba(192,38,211,0.35)] transition-all duration-300 h-9 px-4 text-sm sm:h-10 sm:px-5 sm:text-base"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesión
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-fuchsia-300/50 text-zinc-900 hover:bg-fuchsia-50 hover:border-fuchsia-400/70 transition-all duration-300"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscríbete gratis
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hidden sm:inline-flex text-zinc-500 hover:text-fuchsia-600 hover:bg-fuchsia-50">
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Mobile menu: left drawer + scrim (keeps header clickable so user can close via hamburger) */}
      <div
        className={
          "md:hidden" +
          (mobileMenuOpen ? "" : " pointer-events-none")
        }
        aria-hidden={!mobileMenuOpen}
      >
        {/* Scrim */}
        <div
          className={
            "fixed left-0 right-0 top-16 bottom-0 z-40 bg-black/40 transition-opacity duration-200 " +
            (mobileMenuOpen ? "opacity-100" : "opacity-0")
          }
        />

        {/* Drawer */}
        <div
          className={
            "fixed left-0 top-16 bottom-0 z-50 w-[78vw] max-w-[320px] border-r border-fuchsia-200/30 bg-white/95 backdrop-blur-xl shadow-2xl " +
            "transition-transform duration-200 ease-out " +
            (mobileMenuOpen ? "translate-x-0" : "-translate-x-full")
          }
          role="menu"
          aria-label="Menú"
          data-testid="mobile-menu"
        >
          <div className="p-2">
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
                  "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors " +
                  (item.label === "Imágenes"
                    ? "text-fuchsia-600 hover:text-fuchsia-500 hover:bg-fuchsia-50 font-medium"
                    : "text-zinc-800 hover:text-fuchsia-700 hover:bg-fuchsia-50")
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
          <div className="text-center fade-in-up">
            <h1 className="text-4xl md:text-7xl font-extrabold mb-5 tracking-tight">
              <span className="text-luxe text-luxe-lg" data-text="¿Con qué puedo">¿Con qué puedo</span>
              <br />
              <span className="text-luxe text-luxe-lg" data-text="ayudarte?">ayudarte?</span>
            </h1>
            <p className="text-lg subtitle-shimmer max-w-xl mx-auto font-medium">
              El asistente de IA más inteligente para crear, investigar y aprender
            </p>
          </div>

          {/* Search Input */}
          <div className="space-y-6 fade-in-up fade-in-up-delay-1">
            <div className="relative search-glow-ring">
              <div className="glass-luxe-glow rounded-2xl p-1">
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
              {/* Subtle fuchsia glow effect */}
              <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-r from-fuchsia-300/30 via-purple-200/20 to-fuchsia-300/30 blur-xl opacity-80" />
            </div>

            {/* Feature Buttons */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {features.map((feature, index) => (
                <Button
                  key={feature.label}
                  variant="outline"
                  className={`rounded-full gap-2 text-sm border-fuchsia-200/40 bg-white/70 text-zinc-800
                    hover:bg-fuchsia-50 hover:border-fuchsia-400/50 hover:text-fuchsia-700 transition-all duration-300
                    hover:scale-105 hover:shadow-lg hover:shadow-fuchsia-200/30 fade-in-up`}
                  style={{ animationDelay: `${(index + 2) * 100}ms` }}
                  onClick={() => setLocation("/login")}
                  data-testid={`button-${feature.label.toLowerCase().replace(' ', '-')}`}
                >
                  <feature.icon className={`h-4 w-4 ${feature.iconColor}`} />
                  {feature.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Promo Card with Premium Design */}
          {showPromo && (
            <div className="glass-luxe-glow rounded-3xl p-6 md:p-8 relative overflow-hidden isolate fade-in-up fade-in-up-delay-3 card-hover-glow">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 h-8 w-8 text-zinc-500 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-full"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-fuchsia-500" />
                    <span className="text-xs font-medium text-fuchsia-500 uppercase tracking-wider">Nuevo</span>
                  </div>
                  <h3 className="text-xl font-bold text-zinc-900 mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-zinc-600 mb-5 leading-relaxed">
                    ¿Tienes una idea? Prueba nuestros estilos y filtros seleccionados o imagina algo desde cero.
                  </p>
                  <Button
                    className="btn-luxe rounded-full bg-gradient-to-r from-fuchsia-600 to-purple-700 text-white border border-fuchsia-400/40 hover:from-fuchsia-500 hover:to-purple-600 shadow-[0_0_24px_rgba(192,38,211,0.20)] hover:shadow-[0_0_32px_rgba(192,38,211,0.35)] transition-all duration-300"
                    onClick={() => setLocation("/login")}
                    data-testid="button-try-now"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Probar ahora
                  </Button>
                </div>

                {/* Style Cards */}
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible md:flex-wrap md:justify-center md:items-center md:gap-4">
                  {[
                    { emoji: "🎨", label: "Boceto", gradient: "from-fuchsia-500/25 to-pink-500/25" },
                    { emoji: "🎄", label: "Festivo", gradient: "from-emerald-500/25 to-teal-500/25" },
                    { emoji: "🎭", label: "Dramático", gradient: "from-purple-500/25 to-violet-500/25" },
                    { emoji: "🧸", label: "Peluche", gradient: "from-pink-400/25 to-rose-400/25" },
                  ].map((style) => (
                    <div
                      key={style.label}
                      className="flex flex-col items-center gap-2 min-w-[70px] cursor-pointer group"
                      onClick={() => setLocation("/login")}
                    >
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br ${style.gradient}
                        flex items-center justify-center border border-fuchsia-200/30
                        transition-all duration-300 group-hover:scale-105 group-hover:border-fuchsia-400/50
                        group-hover:shadow-lg group-hover:shadow-fuchsia-200/20`}>
                        <span className="text-2xl">{style.emoji}</span>
                      </div>
                      <span className="text-xs text-zinc-600 group-hover:text-fuchsia-600 transition-colors">{style.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex items-center justify-center gap-8 text-zinc-400 text-sm fade-in-up fade-in-up-delay-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-fuchsia-400" />
              <span>Seguro y privado</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-purple-400" />
              <span>Disponible 24/7</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-fuchsia-400" />
              <span>Respuestas instantáneas</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 text-center text-sm text-zinc-500 border-t border-fuchsia-200/30 bg-white/80 backdrop-blur-md">
        Al enviar un mensaje a ILIAGPT, un chatbot de IA, aceptas nuestros{" "}
        <Link href="/terms" className="text-fuchsia-600 hover:text-fuchsia-500 underline transition-colors">Términos</Link>
        {" "}y reconoces que leíste nuestra{" "}
        <Link href="/privacy-policy" className="text-fuchsia-600 hover:text-fuchsia-500 underline transition-colors">Política de privacidad</Link>.
      </footer>
    </div>
  );
}
