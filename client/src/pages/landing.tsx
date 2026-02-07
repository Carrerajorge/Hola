import { useEffect, useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Paperclip, Search, BookOpen, Image, Mic, X, Sparkles, Zap, Shield,
  Menu, ArrowRight, Clock, Brain, Globe, Lock, MessageSquare, FileText,
  Code, Lightbulb, GraduationCap, Palette, ChevronRight, Star, Users,
  CheckCircle2, ArrowUpRight, Play,
} from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";

/* ------------------------------------------------------------------ */
/*  Typing animation hook                                              */
/* ------------------------------------------------------------------ */
function useTypingAnimation(phrases: string[], typingSpeed = 80, deletingSpeed = 40, pauseTime = 2000) {
  const [text, setText] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[phraseIndex];
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && text === current) {
      timeout = setTimeout(() => setIsDeleting(true), pauseTime);
    } else if (isDeleting && text === "") {
      setIsDeleting(false);
      setPhraseIndex((prev) => (prev + 1) % phrases.length);
    } else {
      timeout = setTimeout(() => {
        setText(isDeleting ? current.substring(0, text.length - 1) : current.substring(0, text.length + 1));
      }, isDeleting ? deletingSpeed : typingSpeed);
    }
    return () => clearTimeout(timeout);
  }, [text, phraseIndex, isDeleting, phrases, typingSpeed, deletingSpeed, pauseTime]);

  return text;
}

/* ------------------------------------------------------------------ */
/*  Intersection observer hook for scroll animations                    */
/* ------------------------------------------------------------------ */
function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsInView(true); },
      { threshold: 0.15, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, isInView };
}

/* ------------------------------------------------------------------ */
/*  Animated counter                                                    */
/* ------------------------------------------------------------------ */
function AnimatedCounter({ target, suffix = "", duration = 2000 }: { target: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const { ref, isInView } = useInView();

  useEffect(() => {
    if (!isInView) return;
    let start = 0;
    const increment = target / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [isInView, target, duration]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

/* ------------------------------------------------------------------ */
/*  Section wrapper with scroll animation                               */
/* ------------------------------------------------------------------ */
function AnimatedSection({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, isInView } = useInView();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ================================================================== */
/*  LANDING PAGE                                                        */
/* ================================================================== */
export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const typedText = useTypingAnimation([
    "Escribe un ensayo sobre IA...",
    "Resuelve esta ecuacion...",
    "Crea una imagen futurista...",
    "Resume este articulo...",
    "Traduce al ingles...",
    "Explica la relatividad...",
  ]);

  /* Track scroll for header shadow */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Mobile menu body lock */
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileMenuOpen(false); };
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
    const onPopState = () => setMobileMenuOpen(false);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [mobileMenuOpen]);

  const handleSubmit = () => { if (inputValue.trim()) setLocation("/login"); };

  const features = [
    { icon: Paperclip, label: "Adjuntar" },
    { icon: Search, label: "Buscar" },
    { icon: BookOpen, label: "Estudiemos" },
    { icon: Image, label: "Crear imagen" },
    { icon: Mic, label: "Voz" },
  ];

  const navLinks = [
    { label: "Sobre nosotros", to: "/about" },
    { label: "Aprender", to: "/learn" },
    { label: "Business", to: "/business" },
    { label: "Precios", to: "/pricing" },
    { label: "Imagenes", to: "/login" },
    { label: "Descargar", to: "/download" },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col relative overflow-x-hidden">
      {/* ============================================================ */}
      {/*  HEADER                                                       */}
      {/* ============================================================ */}
      <header
        className={`sticky top-0 z-30 flex items-center justify-between px-4 md:px-8 h-16 bg-white/80 backdrop-blur-md border-b transition-shadow duration-300 ${
          scrolled ? "border-neutral-200 shadow-sm" : "border-transparent"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost" size="icon"
            className="rounded-full text-neutral-700 hover:text-black hover:bg-neutral-100 md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Cerrar menu" : "Abrir menu"}
            aria-expanded={mobileMenuOpen}
            data-testid="button-mobile-menu-left"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <IliaGPTLogo size={30} className="shadow-sm" />
          <span className="font-bold tracking-wide text-black text-base select-none">ILIAGPT</span>
        </div>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navLinks.map((l) => (
            <span key={l.to} onClick={() => setLocation(l.to)} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">{l.label}</span>
          ))}
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

      {/* ============================================================ */}
      {/*  MOBILE MENU DRAWER                                           */}
      {/* ============================================================ */}
      <div className={"md:hidden" + (mobileMenuOpen ? "" : " pointer-events-none")} aria-hidden={!mobileMenuOpen}>
        <div
          className={"fixed left-0 right-0 top-16 bottom-0 z-40 bg-black/40 transition-opacity duration-200 " + (mobileMenuOpen ? "opacity-100" : "opacity-0")}
          onClick={() => setMobileMenuOpen(false)}
        />
        <div
          className={"fixed left-0 top-16 bottom-0 z-50 w-[78vw] max-w-[300px] border-r border-neutral-200 bg-white shadow-xl transition-transform duration-200 ease-out " + (mobileMenuOpen ? "translate-x-0" : "-translate-x-full")}
          role="menu" aria-label="Menu" data-testid="mobile-menu"
        >
          <div className="p-3 flex flex-col gap-0.5">
            {navLinks.map((item) => (
              <button
                key={item.to} type="button" role="menuitem"
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-700 hover:text-black hover:bg-neutral-100 transition-colors"
                onClick={() => { setMobileMenuOpen(false); setLocation(item.to); }}
              >
                {item.label}
              </button>
            ))}
            <div className="border-t border-neutral-100 mt-2 pt-2">
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-black hover:bg-neutral-100 transition-colors"
                onClick={() => { setMobileMenuOpen(false); setLocation("/signup"); }}
              >
                Suscribete gratis
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  HERO SECTION                                                 */}
      {/* ============================================================ */}
      <section className="relative flex flex-col items-center justify-center px-4 pt-16 pb-20 md:pt-24 md:pb-28">
        {/* Subtle decorative grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, #000 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

        <div className="w-full max-w-2xl space-y-10 relative z-10">
          {/* Hero Title */}
          <div className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 bg-neutral-100 text-neutral-600 text-xs font-semibold px-3.5 py-1.5 rounded-full mb-6 tracking-wide uppercase">
              <Sparkles className="h-3.5 w-3.5" />
              Potenciado por IA avanzada
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-black mb-5 tracking-tight leading-[1.1]">
              ¿Con que puedo<br />ayudarte?
            </h1>
            <p className="text-lg md:text-xl text-neutral-400 max-w-md mx-auto leading-relaxed">
              El asistente de IA mas inteligente para crear, investigar y aprender
            </p>
          </div>

          {/* Search Input with typing animation */}
          <div className="space-y-5 fade-in-up fade-in-up-delay-1">
            <div className="relative group">
              <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm transition-all duration-300 group-focus-within:shadow-lg group-focus-within:border-neutral-300">
                <Input
                  placeholder={typedText + "|"}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-14 md:h-16 px-5 md:px-6 text-base md:text-lg bg-transparent border-0 text-black placeholder:text-neutral-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="input-landing-search"
                />
              </div>
            </div>

            {/* Feature Buttons */}
            <div className="flex items-center justify-center gap-2 md:gap-2.5 flex-wrap">
              {features.map((feature, index) => (
                <Button
                  key={feature.label}
                  variant="outline"
                  className="rounded-full gap-2 text-sm border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-black hover:border-neutral-300 transition-all duration-200 fade-in-up"
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
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-6 md:p-8 relative fade-in-up fade-in-up-delay-3">
              <Button
                variant="ghost" size="icon"
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
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible md:flex-wrap md:justify-center md:items-center md:gap-3">
                  {[
                    { emoji: "🎨", label: "Boceto" },
                    { emoji: "🎄", label: "Festivo" },
                    { emoji: "🎭", label: "Dramatico" },
                    { emoji: "🧸", label: "Peluche" },
                  ].map((style) => (
                    <div key={style.label} className="flex flex-col items-center gap-2 min-w-[68px] cursor-pointer group" onClick={() => setLocation("/login")}>
                      <div className="w-16 h-16 md:w-[72px] md:h-[72px] rounded-2xl bg-white border border-neutral-200 flex items-center justify-center transition-all duration-200 group-hover:border-neutral-400 group-hover:shadow-md">
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
            <div className="flex items-center gap-2"><Shield className="h-4 w-4" /><span>Seguro y privado</span></div>
            <div className="flex items-center gap-2"><Clock className="h-4 w-4" /><span>Disponible 24/7</span></div>
            <div className="flex items-center gap-2"><Zap className="h-4 w-4" /><span>Respuestas instantaneas</span></div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  STATS BAR                                                    */}
      {/* ============================================================ */}
      <section className="border-y border-neutral-200 bg-neutral-50/50">
        <div className="max-w-5xl mx-auto px-4 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 text-center">
            {[
              { value: 5, suffix: "M+", label: "Usuarios activos" },
              { value: 150, suffix: "M+", label: "Preguntas respondidas" },
              { value: 99, suffix: "%", label: "Tiempo activo" },
              { value: 50, suffix: "+", label: "Idiomas soportados" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl md:text-4xl font-extrabold text-black mb-1">
                  <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                </div>
                <div className="text-sm text-neutral-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CAPABILITIES GRID                                            */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14 md:mb-16">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-100 px-3 py-1.5 rounded-full mb-4">
              Capacidades
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Todo lo que necesitas, en un solo lugar
            </h2>
            <p className="text-neutral-400 text-lg max-w-lg mx-auto">
              Desde investigacion profunda hasta creacion de contenido visual
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {[
              { icon: Brain, title: "Razonamiento avanzado", desc: "Analisis profundo y respuestas contextuales con capacidad de razonamiento de ultima generacion.", color: "bg-neutral-900" },
              { icon: Palette, title: "Generacion de imagenes", desc: "Crea imagenes unicas con estilos artisticos, desde bocetos hasta arte fotorrealista.", color: "bg-neutral-900" },
              { icon: Code, title: "Codigo y programacion", desc: "Escribe, depura y explica codigo en mas de 40 lenguajes de programacion.", color: "bg-neutral-900" },
              { icon: GraduationCap, title: "Tutor inteligente", desc: "Aprende cualquier tema con explicaciones adaptadas a tu nivel y estilo de aprendizaje.", color: "bg-neutral-900" },
              { icon: FileText, title: "Analisis de documentos", desc: "Sube PDFs, Word, Excel y obtiene resumenes, analisis y respuestas precisas.", color: "bg-neutral-900" },
              { icon: Globe, title: "Busqueda en la web", desc: "Accede a informacion actualizada con busqueda integrada en tiempo real.", color: "bg-neutral-900" },
            ].map((cap, i) => (
              <AnimatedSection key={cap.title} delay={i * 80}>
                <div className="group rounded-2xl border border-neutral-200 p-6 hover:border-neutral-300 hover:shadow-lg transition-all duration-300 bg-white cursor-pointer h-full"
                  onClick={() => setLocation("/signup")}
                >
                  <div className={`${cap.color} w-10 h-10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <cap.icon className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="font-bold text-black text-base mb-2">{cap.title}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed">{cap.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  HOW IT WORKS                                                 */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4 bg-neutral-50/50 border-y border-neutral-200">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14 md:mb-16">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-white border border-neutral-200 px-3 py-1.5 rounded-full mb-4">
              Como funciona
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Simple, rapido e intuitivo
            </h2>
            <p className="text-neutral-400 text-lg max-w-lg mx-auto">
              Empieza a usar ILIAGPT en segundos. Sin configuracion complicada.
            </p>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
              { step: "01", title: "Escribe tu pregunta", desc: "Escribe cualquier pregunta, sube un archivo o describe una imagen que quieras crear.", icon: MessageSquare },
              { step: "02", title: "IA analiza y procesa", desc: "Nuestro motor de IA avanzado analiza tu solicitud y genera la mejor respuesta posible.", icon: Brain },
              { step: "03", title: "Obtiene resultados", desc: "Recibe respuestas detalladas, imagenes, codigo o analisis en cuestion de segundos.", icon: Zap },
            ].map((item, i) => (
              <AnimatedSection key={item.step} delay={i * 150}>
                <div className="text-center md:text-left">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-black text-white font-extrabold text-lg mb-5">
                    {item.step}
                  </div>
                  <h3 className="font-bold text-black text-lg mb-2">{item.title}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed max-w-xs mx-auto md:mx-0">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SHOWCASE / DEMO PREVIEW                                      */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-100 px-3 py-1.5 rounded-full mb-4">
              En accion
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Mira lo que puedes hacer
            </h2>
          </AnimatedSection>

          <AnimatedSection delay={100}>
            <div className="rounded-3xl border border-neutral-200 bg-neutral-50/50 overflow-hidden">
              {/* Mock chat header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-neutral-300" />
                  <div className="w-3 h-3 rounded-full bg-neutral-300" />
                  <div className="w-3 h-3 rounded-full bg-neutral-300" />
                </div>
                <span className="text-sm font-medium text-neutral-400 ml-2">ILIAGPT</span>
              </div>

              {/* Mock conversation */}
              <div className="p-6 md:p-8 space-y-6">
                {/* User message */}
                <div className="flex justify-end">
                  <div className="bg-black text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-sm text-sm">
                    Explicame la teoria de la relatividad de forma simple
                  </div>
                </div>
                {/* AI response */}
                <div className="flex justify-start">
                  <div className="bg-white border border-neutral-200 px-5 py-4 rounded-2xl rounded-tl-md max-w-lg text-sm text-neutral-700 leading-relaxed shadow-sm">
                    <p className="mb-3">Imagina que estas en un tren que se mueve muy rapido. Para ti, todo dentro del tren parece normal. Pero para alguien que te observa desde afuera, las cosas se ven diferentes:</p>
                    <ul className="space-y-1.5 ml-4">
                      <li className="flex items-start gap-2"><span className="text-black font-bold mt-0.5">1.</span> El tiempo pasa mas lento para ti</li>
                      <li className="flex items-start gap-2"><span className="text-black font-bold mt-0.5">2.</span> Tu tren se ve mas corto</li>
                      <li className="flex items-start gap-2"><span className="text-black font-bold mt-0.5">3.</span> Tu masa aumenta</li>
                    </ul>
                    <p className="mt-3 text-neutral-500">Einstein descubrio que la velocidad de la luz es el limite absoluto, y todo lo demas es relativo al observador.</p>
                  </div>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  TESTIMONIALS / SOCIAL PROOF                                  */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4 bg-neutral-50/50 border-y border-neutral-200">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-white border border-neutral-200 px-3 py-1.5 rounded-full mb-4">
              Testimonios
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Lo que dicen nuestros usuarios
            </h2>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              { name: "Maria G.", role: "Estudiante de Medicina", quote: "ILIAGPT me ayudo a estudiar anatomia de una forma que nunca habia experimentado. Las explicaciones son claras y adaptadas a mi nivel.", stars: 5 },
              { name: "Carlos R.", role: "Desarrollador Full Stack", quote: "Lo uso todos los dias para depurar codigo y aprender nuevas tecnologias. Es como tener un senior developer disponible 24/7.", stars: 5 },
              { name: "Ana P.", role: "Disenadora Grafica", quote: "La generacion de imagenes es increible. Puedo crear conceptos visuales en segundos que antes me tomaban horas de trabajo.", stars: 5 },
            ].map((t, i) => (
              <AnimatedSection key={t.name} delay={i * 100}>
                <div className="rounded-2xl border border-neutral-200 bg-white p-6 h-full flex flex-col">
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: t.stars }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-black text-black" />
                    ))}
                  </div>
                  <p className="text-sm text-neutral-600 leading-relaxed flex-1 mb-5">"{t.quote}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-bold text-neutral-600">
                      {t.name[0]}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-black">{t.name}</div>
                      <div className="text-xs text-neutral-400">{t.role}</div>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  USE CASES                                                    */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-100 px-3 py-1.5 rounded-full mb-4">
              Casos de uso
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Hecho para todos
            </h2>
            <p className="text-neutral-400 text-lg max-w-lg mx-auto">
              Desde estudiantes hasta empresas Fortune 500
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: GraduationCap, title: "Estudiantes", desc: "Estudia mas rapido con explicaciones adaptativas, resumenes inteligentes y ayuda con tareas.", features: ["Resolucion de problemas", "Resumenes automaticos", "Practica con ejercicios"] },
              { icon: Code, title: "Desarrolladores", desc: "Escribe codigo mas limpio, depura errores al instante y aprende nuevos frameworks.", features: ["Autocompletado inteligente", "Depuracion de errores", "Documentacion al instante"] },
              { icon: Lightbulb, title: "Creativos", desc: "Genera ideas, crea contenido visual y escribe textos que cautivan a tu audiencia.", features: ["Generacion de imagenes", "Copywriting asistido", "Brainstorming creativo"] },
              { icon: Users, title: "Empresas", desc: "Automatiza procesos, analiza datos y potencia la productividad de tu equipo.", features: ["Analisis de documentos", "Reportes automaticos", "Integracion con APIs"] },
            ].map((uc, i) => (
              <AnimatedSection key={uc.title} delay={i * 80}>
                <div className="rounded-2xl border border-neutral-200 p-6 md:p-7 hover:border-neutral-300 hover:shadow-md transition-all duration-300 bg-white group cursor-pointer h-full"
                  onClick={() => setLocation("/signup")}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0 group-hover:bg-black group-hover:text-white transition-colors duration-300">
                      <uc.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-black text-base mb-1.5">{uc.title}</h3>
                      <p className="text-sm text-neutral-500 leading-relaxed mb-4">{uc.desc}</p>
                      <div className="space-y-1.5">
                        {uc.features.map((f) => (
                          <div key={f} className="flex items-center gap-2 text-sm text-neutral-600">
                            <CheckCircle2 className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SECURITY & PRIVACY                                           */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4 bg-black text-white">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-wider bg-white/10 px-3 py-1.5 rounded-full mb-4">
              <Lock className="h-3.5 w-3.5" />
              Seguridad
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
              Tu privacidad es nuestra prioridad
            </h2>
            <p className="text-neutral-400 text-lg max-w-lg mx-auto">
              Cifrado de extremo a extremo y cumplimiento con los mas altos estandares
            </p>
          </AnimatedSection>

          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: Shield, title: "Cifrado E2E", desc: "Tus conversaciones estan protegidas con cifrado de extremo a extremo de grado militar." },
              { icon: Lock, title: "Sin almacenamiento", desc: "No almacenamos tus datos personales. Tu informacion se procesa y se elimina." },
              { icon: Globe, title: "Cumplimiento GDPR", desc: "Cumplimos con las normativas GDPR, CCPA y los mas altos estandares internacionales." },
            ].map((item, i) => (
              <AnimatedSection key={item.title} delay={i * 100}>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-4">
                    <item.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="font-bold text-white text-base mb-2">{item.title}</h3>
                  <p className="text-sm text-neutral-400 leading-relaxed">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  PRICING TEASER                                               */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4">
        <div className="max-w-4xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-100 px-3 py-1.5 rounded-full mb-4">
              Precios
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Empieza gratis, crece sin limites
            </h2>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                name: "Gratis",
                price: "$0",
                period: "/ mes",
                desc: "Para empezar a explorar",
                features: ["50 mensajes al dia", "Generacion basica de imagenes", "Acceso al modelo estandar"],
                cta: "Empezar gratis",
                highlighted: false,
              },
              {
                name: "Pro",
                price: "$12",
                period: "/ mes",
                desc: "Para usuarios avanzados",
                features: ["Mensajes ilimitados", "Imagenes en alta definicion", "Modelo avanzado (GPT-4)", "Analisis de documentos", "Prioridad en respuestas"],
                cta: "Comenzar prueba",
                highlighted: true,
              },
              {
                name: "Enterprise",
                price: "Custom",
                period: "",
                desc: "Para equipos y empresas",
                features: ["Todo lo de Pro", "API dedicada", "Soporte prioritario 24/7", "SLA garantizado", "Integraciones personalizadas"],
                cta: "Contactar ventas",
                highlighted: false,
              },
            ].map((plan, i) => (
              <AnimatedSection key={plan.name} delay={i * 100}>
                <div className={`rounded-2xl border p-6 md:p-7 h-full flex flex-col ${
                  plan.highlighted
                    ? "border-black bg-black text-white shadow-xl relative"
                    : "border-neutral-200 bg-white"
                }`}>
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-neutral-700 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      Popular
                    </div>
                  )}
                  <div className="mb-5">
                    <h3 className="font-bold text-base mb-1">{plan.name}</h3>
                    <p className={`text-xs ${plan.highlighted ? "text-neutral-400" : "text-neutral-500"}`}>{plan.desc}</p>
                  </div>
                  <div className="mb-6">
                    <span className="text-4xl font-extrabold">{plan.price}</span>
                    <span className={`text-sm ${plan.highlighted ? "text-neutral-400" : "text-neutral-500"}`}>{plan.period}</span>
                  </div>
                  <div className="space-y-2.5 mb-7 flex-1">
                    {plan.features.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className={`h-4 w-4 shrink-0 ${plan.highlighted ? "text-neutral-400" : "text-neutral-400"}`} />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    className={`rounded-full w-full font-medium ${
                      plan.highlighted
                        ? "bg-white text-black hover:bg-neutral-200"
                        : "bg-black text-white hover:bg-neutral-800"
                    }`}
                    onClick={() => setLocation(plan.highlighted ? "/signup" : "/pricing")}
                  >
                    {plan.cta}
                  </Button>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FAQ                                                          */}
      {/* ============================================================ */}
      <section className="py-20 md:py-28 px-4 bg-neutral-50/50 border-y border-neutral-200">
        <div className="max-w-2xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold text-black tracking-tight mb-4">
              Preguntas frecuentes
            </h2>
          </AnimatedSection>

          <div className="space-y-4">
            {[
              { q: "¿ILIAGPT es realmente gratis?", a: "Si, nuestro plan gratuito te da acceso a 50 mensajes al dia y generacion basica de imagenes. Puedes usar ILIAGPT sin tarjeta de credito." },
              { q: "¿Mis datos estan seguros?", a: "Absolutamente. Usamos cifrado de extremo a extremo y no almacenamos tus conversaciones de forma permanente. Cumplimos con GDPR y CCPA." },
              { q: "¿Que puedo hacer con ILIAGPT?", a: "Puedes hacer preguntas sobre cualquier tema, generar imagenes, escribir codigo, analizar documentos, estudiar, traducir textos y mucho mas." },
              { q: "¿Funciona en movil?", a: "Si, ILIAGPT esta optimizado para todos los dispositivos. Tambien puedes descargar nuestra app nativa para iOS y Android." },
              { q: "¿Puedo usar ILIAGPT para mi empresa?", a: "Si, nuestro plan Enterprise ofrece API dedicada, SLA garantizado y soporte prioritario 24/7. Contacta con nuestro equipo de ventas para mas informacion." },
            ].map((faq, i) => (
              <AnimatedSection key={i} delay={i * 60}>
                <FAQItem question={faq.q} answer={faq.a} />
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FINAL CTA                                                    */}
      {/* ============================================================ */}
      <section className="py-24 md:py-32 px-4">
        <AnimatedSection>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-5xl font-extrabold text-black tracking-tight mb-5 leading-tight">
              Empieza a crear con IA hoy
            </h2>
            <p className="text-neutral-400 text-lg mb-8 max-w-md mx-auto">
              Unete a millones de personas que ya usan ILIAGPT para trabajar, estudiar y crear.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button
                className="rounded-full bg-black text-white hover:bg-neutral-800 transition-colors font-medium gap-2 h-12 px-7 text-base"
                onClick={() => setLocation("/signup")}
              >
                Comenzar gratis
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="rounded-full border-neutral-300 text-black hover:bg-neutral-50 hover:border-neutral-400 transition-colors font-medium h-12 px-7 text-base gap-2"
                onClick={() => setLocation("/pricing")}
              >
                Ver precios
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </AnimatedSection>
      </section>

      {/* ============================================================ */}
      {/*  FOOTER                                                       */}
      {/* ============================================================ */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <IliaGPTLogo size={24} />
                <span className="font-bold text-black text-sm">ILIAGPT</span>
              </div>
              <p className="text-sm text-neutral-400 leading-relaxed">
                El asistente de IA mas avanzado del mercado. Diseñado para potenciar tu creatividad y productividad.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-black text-sm mb-3">Producto</h4>
              <div className="space-y-2">
                {["Precios", "Descargar", "Business"].map((l) => (
                  <div key={l}>
                    <span onClick={() => setLocation(`/${l.toLowerCase()}`)} className="text-sm text-neutral-500 hover:text-black transition-colors cursor-pointer">{l}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-black text-sm mb-3">Compania</h4>
              <div className="space-y-2">
                {[{ l: "Sobre nosotros", t: "/about" }, { l: "Aprender", t: "/learn" }].map(({ l, t }) => (
                  <div key={l}>
                    <span onClick={() => setLocation(t)} className="text-sm text-neutral-500 hover:text-black transition-colors cursor-pointer">{l}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-black text-sm mb-3">Legal</h4>
              <div className="space-y-2">
                <div><Link href="/terms" className="text-sm text-neutral-500 hover:text-black transition-colors">Terminos</Link></div>
                <div><Link href="/privacy-policy" className="text-sm text-neutral-500 hover:text-black transition-colors">Privacidad</Link></div>
              </div>
            </div>
          </div>

          <div className="border-t border-neutral-200 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-neutral-400">
              © 2026 ILIAGPT. Todos los derechos reservados.
            </p>
            <p className="text-xs text-neutral-400">
              Al enviar un mensaje a ILIAGPT, aceptas nuestros{" "}
              <Link href="/terms" className="underline underline-offset-2 hover:text-black transition-colors">Terminos</Link>
              {" "}y{" "}
              <Link href="/privacy-policy" className="underline underline-offset-2 hover:text-black transition-colors">Politica de privacidad</Link>.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ Accordion Item                                                  */
/* ------------------------------------------------------------------ */
function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <button
        type="button"
        className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-neutral-50 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-semibold text-sm text-black">{question}</span>
        <ChevronRight className={`h-4 w-4 text-neutral-400 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
        <p className="px-5 pb-4 text-sm text-neutral-500 leading-relaxed">{answer}</p>
      </div>
    </div>
  );
}
