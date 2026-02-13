import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, BookOpen, Image, Mic, X, ChevronDown, HelpCircle, Sparkles, Zap, Shield, Globe, Menu } from "lucide-react";
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
    { icon: Sparkles, label: "Adjuntar" },
    { icon: Search, label: "Buscar" },
    { icon: BookOpen, label: "Estudiemos" },
    { icon: Image, label: "Crear imagen" },
    { icon: Mic, label: "Voz" },
  ];

  return (
    <div className="min-h-screen paper-grid flex flex-col">
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {/* Mobile menu trigger moved to the left so it never gets pushed off-screen by CTA buttons */}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileMenuOpen}
            data-testid="button-mobile-menu-left"
          >
            <Menu className="h-5 w-5" />
          </Button>


          <IliaGPTLogo size={32} className="shadow-sm" />
          <span className="font-semibold tracking-tight text-foreground">ILIAGPT</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <span onClick={() => setLocation("/about")} className="text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer">Sobre nosotros</span>
          <span onClick={() => setLocation("/learn")} className="text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer">Aprender</span>
          <span onClick={() => setLocation("/business")} className="text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer">Business</span>
          <span onClick={() => setLocation("/pricing")} className="text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer">Precios</span>
          <span onClick={() => setLocation("/login")} className="text-foreground underline underline-offset-4 transition-colors duration-200 cursor-pointer">Imágenes</span>
          <span onClick={() => setLocation("/download")} className="text-muted-foreground hover:text-foreground transition-colors duration-200 cursor-pointer">Descargar</span>
        </nav>

        <div className="flex items-center gap-3">
          {/* Mobile nav trigger (kept in the top-right corner) */}
          <Button
            className="rounded-full h-9 px-4 text-sm sm:h-10 sm:px-5 sm:text-base"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesión
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex bg-background text-foreground hover:bg-muted/40 transition-colors"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscríbete gratis
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full hidden sm:inline-flex text-muted-foreground hover:text-foreground hover:bg-muted/60">
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
        {/* Scrim blocks interactions with the page, but starts below the header so the hamburger stays clickable */}
        <div
          className={
            "fixed left-0 right-0 top-16 bottom-0 z-40 bg-black/20 transition-opacity duration-200 " +
            (mobileMenuOpen ? "opacity-100" : "opacity-0")
          }
        />

        {/* Drawer */}
        <div
          className={
            "fixed left-0 top-16 bottom-0 z-50 w-[78vw] max-w-[320px] border-r border-border bg-background shadow-lg " +
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
                    ? "text-foreground bg-muted/50 hover:bg-muted/70"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60")
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
      <main className="relative z-0 flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-3xl space-y-10">
          {/* Hero Title */}
          <div className="text-center fade-in-up">
            <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-4 text-foreground">
              ¿Con qué puedo{" "}
              <span className="relative inline-block">
                <span className="absolute inset-x-0 -bottom-1 h-3 md:h-4 rounded bg-muted -z-10" />
                ayudarte?
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              El asistente de IA para crear, investigar y aprender.
            </p>
          </div>

          {/* Search Input */}
          <div className="space-y-6 fade-in-up fade-in-up-delay-1">
            <div className="rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-3 px-4">
                <Search className="h-5 w-5 text-muted-foreground" />
                <Input
                  placeholder="Pregunta lo que quieras..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-16 flex-1 border-0 shadow-none bg-transparent px-0 text-lg placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="input-landing-search"
                />
                <Button
                  className="h-10 rounded-full px-4 text-sm"
                  onClick={handleSubmit}
                  disabled={!inputValue.trim()}
                  data-testid="button-landing-continue"
                >
                  Continuar
                </Button>
              </div>
            </div>

            {/* Feature Buttons */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {features.map((feature, index) => (
                <Button
                  key={feature.label}
                  variant="outline"
                  className="rounded-full gap-2 text-sm bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors fade-in-up"
                  style={{ animationDelay: `${(index + 2) * 100}ms` }}
                  onClick={() => setLocation("/login")}
                  data-testid={`button-${feature.label.toLowerCase().replace(' ', '-')}`}
                >
                  <feature.icon className="h-4 w-4" />
                  {feature.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Promo Card with Premium Design */}
          {showPromo && (
            <div className="rounded-3xl border border-border bg-card p-6 md:p-8 relative overflow-hidden fade-in-up fade-in-up-delay-3 shadow-sm">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-full"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-foreground" />
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Nuevo</span>
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    ¿Tienes una idea? Prueba estilos listos o imagina algo desde cero.
                  </p>
                  <Button
                    className="rounded-full"
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
                    { emoji: "🎨", label: "Boceto" },
                    { emoji: "🎄", label: "Festivo" },
                    { emoji: "🎭", label: "Dramático" },
                    { emoji: "🧸", label: "Peluche" },
                  ].map((style) => (
                    <div
                      key={style.label}
                      className="flex flex-col items-center gap-2 min-w-[70px] cursor-pointer group"
                      onClick={() => setLocation("/login")}
                    >
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-background flex items-center justify-center border border-border transition-colors group-hover:bg-muted/40">
                        <span className="text-2xl">{style.emoji}</span>
                      </div>
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{style.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex items-center justify-center gap-8 text-muted-foreground text-sm fade-in-up fade-in-up-delay-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span>Seguro y privado</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              <span>Disponible 24/7</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              <span>Respuestas instantáneas</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 text-center text-sm text-muted-foreground border-t border-border bg-background/70 backdrop-blur-sm">
        Al enviar un mensaje a ILIAGPT, un chatbot de IA, aceptas nuestros{" "}
        <Link href="/terms" className="text-foreground underline underline-offset-4 hover:no-underline transition-colors">Términos</Link>
        {" "}y reconoces que leíste nuestra{" "}
        <Link href="/privacy-policy" className="text-foreground underline underline-offset-4 hover:no-underline transition-colors">Política de privacidad</Link>.
      </footer>
    </div>
  );
}
