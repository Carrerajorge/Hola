import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Paperclip,
  Search,
  BookOpen,
  Image,
  Mic,
  X,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Sparkles,
  Zap,
  Shield,
  Globe,
  Menu,
  Brain,
  FileText,
  MessageSquare,
  ArrowRight,
  Check,
  Star,
  Users,
  Clock,
  Lock,
  Cpu,
  Layers,
  PenTool,
  BarChart3,
  GraduationCap,
  Lightbulb,
  Target,
} from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTestimonial((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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

  const capabilities = [
    {
      icon: Brain,
      title: "Razonamiento avanzado",
      description:
        "Analiza problemas complejos, descompone conceptos y genera soluciones paso a paso con precisión excepcional.",
    },
    {
      icon: PenTool,
      title: "Creacion de contenido",
      description:
        "Redacta ensayos, articulos, correos y textos creativos con fluidez nativa en cualquier tono y estilo.",
    },
    {
      icon: FileText,
      title: "Documentos profesionales",
      description:
        "Genera reportes, presentaciones y hojas de calculo con formato impecable listos para compartir.",
    },
    {
      icon: GraduationCap,
      title: "Tutor personal",
      description:
        "Aprende cualquier materia con explicaciones adaptadas a tu nivel, ejercicios y retroalimentacion inmediata.",
    },
    {
      icon: Image,
      title: "Generacion de imagenes",
      description:
        "Crea imagenes originales a partir de texto con estilos artisticos, filtros y personalizacion total.",
    },
    {
      icon: Globe,
      title: "Navegacion autonoma",
      description:
        "Busca, investiga y extrae informacion de la web en tiempo real para respuestas actualizadas al instante.",
    },
  ];

  const stats = [
    { value: "10M+", label: "Consultas respondidas" },
    { value: "150+", label: "Paises activos" },
    { value: "99.9%", label: "Disponibilidad" },
    { value: "< 2s", label: "Tiempo de respuesta" },
  ];

  const steps = [
    {
      step: "01",
      title: "Escribe tu pregunta",
      description: "Describe lo que necesitas en lenguaje natural. Sin comandos, sin complicaciones.",
    },
    {
      step: "02",
      title: "ILIAGPT analiza y procesa",
      description: "Nuestro motor de IA evalua tu consulta, busca contexto y genera la mejor respuesta.",
    },
    {
      step: "03",
      title: "Recibe resultados al instante",
      description: "Obtien texto, imagenes, documentos o analisis en segundos. Listo para usar.",
    },
  ];

  const testimonials = [
    {
      quote:
        "ILIAGPT cambio por completo como estudio. Me explica temas complejos de manera simple y puedo repasar a mi ritmo.",
      author: "Maria Gonzalez",
      role: "Estudiante de Medicina",
    },
    {
      quote:
        "Lo uso todos los dias para redactar propuestas y correos. Me ahorra horas de trabajo cada semana.",
      author: "Carlos Ramirez",
      role: "Director de Marketing",
    },
    {
      quote:
        "La generacion de imagenes es impresionante. Creo contenido visual para mis redes en minutos.",
      author: "Ana Torres",
      role: "Disenadora Freelance",
    },
  ];

  const plans = [
    {
      name: "Gratis",
      price: "$0",
      period: "para siempre",
      features: [
        "50 mensajes diarios",
        "Generacion de texto",
        "Busqueda basica",
        "1 imagen por dia",
      ],
      cta: "Comenzar gratis",
      highlighted: false,
    },
    {
      name: "Pro",
      price: "$12",
      period: "por mes",
      features: [
        "Mensajes ilimitados",
        "Generacion de imagenes ilimitada",
        "Documentos profesionales",
        "Navegacion web avanzada",
        "Prioridad en respuestas",
        "Soporte prioritario",
      ],
      cta: "Prueba gratis 7 dias",
      highlighted: true,
    },
    {
      name: "Business",
      price: "$39",
      period: "por usuario/mes",
      features: [
        "Todo en Pro",
        "Panel de administracion",
        "Integraciones API",
        "SSO empresarial",
        "SLA garantizado",
        "Gerente de cuenta dedicado",
      ],
      cta: "Contactar ventas",
      highlighted: false,
    },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col relative overflow-hidden">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-5 md:px-10 h-16 border-b border-neutral-200 bg-white/80 backdrop-blur-lg">
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
          <span className="font-bold tracking-tight text-black text-lg">ILIAGPT</span>
        </div>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          <span
            onClick={() => setLocation("/about")}
            className="text-neutral-600 hover:text-black transition-colors cursor-pointer"
          >
            Sobre nosotros
          </span>
          <span
            onClick={() => setLocation("/learn")}
            className="text-neutral-600 hover:text-black transition-colors cursor-pointer"
          >
            Aprender
          </span>
          <span
            onClick={() => setLocation("/business")}
            className="text-neutral-600 hover:text-black transition-colors cursor-pointer"
          >
            Business
          </span>
          <span
            onClick={() => setLocation("/pricing")}
            className="text-neutral-600 hover:text-black transition-colors cursor-pointer"
          >
            Precios
          </span>
          <span
            onClick={() => setLocation("/login")}
            className="text-neutral-600 hover:text-black transition-colors cursor-pointer"
          >
            Imagenes
          </span>
          <span
            onClick={() => setLocation("/download")}
            className="text-neutral-600 hover:text-black transition-colors cursor-pointer"
          >
            Descargar
          </span>
        </nav>

        <div className="flex items-center gap-2.5">
          <Button
            className="rounded-full bg-black text-white hover:bg-neutral-800 transition-all h-9 px-5 text-sm font-medium"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesion
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-neutral-300 text-black hover:bg-neutral-50 hover:border-neutral-400 transition-all font-medium"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscribete gratis
          </Button>
        </div>
      </header>

      {/* ===== MOBILE DRAWER ===== */}
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
            "fixed left-0 top-16 bottom-0 z-50 w-[80vw] max-w-[320px] border-r border-neutral-200 bg-white shadow-2xl " +
            "transition-transform duration-200 ease-out " +
            (mobileMenuOpen ? "translate-x-0" : "-translate-x-full")
          }
          role="menu"
          aria-label="Menu"
          data-testid="mobile-menu"
        >
          <div className="p-3 space-y-1">
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
                className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-neutral-800 hover:text-black hover:bg-neutral-100 transition-colors"
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
          <div className="px-3 pt-4 border-t border-neutral-200 mx-3">
            <Button
              className="w-full rounded-full bg-black text-white hover:bg-neutral-800 font-medium"
              onClick={() => {
                setMobileMenuOpen(false);
                setLocation("/signup");
              }}
            >
              Suscribete gratis
            </Button>
          </div>
        </div>
      </div>

      {/* ===== HERO SECTION ===== */}
      <section
        ref={heroRef}
        className="relative flex flex-col items-center justify-center px-5 pt-16 pb-20 md:pt-24 md:pb-28"
      >
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, black 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }} />

        <div className="relative w-full max-w-3xl space-y-8">
          {/* Badge */}
          <div className="flex justify-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-neutral-200 bg-neutral-50 text-sm text-neutral-700">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Impulsado por inteligencia artificial de ultima generacion</span>
            </div>
          </div>

          {/* Hero Title */}
          <div className="text-center fade-in-up">
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-black leading-[1.1] mb-5">
              ¿Con que puedo
              <br />
              ayudarte?
            </h1>
            <p className="text-lg md:text-xl text-neutral-500 max-w-2xl mx-auto leading-relaxed">
              El asistente de IA mas inteligente del mundo hispanohablante.
              <br className="hidden md:block" />
              Crea, investiga, aprende y genera imagenes — todo en un solo lugar.
            </p>
          </div>

          {/* Search Input */}
          <div className="space-y-5 fade-in-up fade-in-up-delay-1">
            <div className="relative group">
              <div className="rounded-2xl border border-neutral-200 bg-white shadow-lg shadow-black/5 transition-shadow duration-300 group-focus-within:shadow-xl group-focus-within:shadow-black/10 group-focus-within:border-neutral-300">
                <Input
                  placeholder="Pregunta lo que quieras..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-16 px-6 text-lg bg-transparent border-0 text-black placeholder:text-neutral-400 focus-visible:ring-0 focus-visible:ring-offset-0"
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
                  className="rounded-full gap-2 text-sm border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-black hover:border-neutral-300 transition-all duration-200 fade-in-up"
                  style={{ animationDelay: `${(index + 2) * 80}ms` }}
                  onClick={() => setLocation("/login")}
                  data-testid={`button-${feature.label.toLowerCase().replace(" ", "-")}`}
                >
                  <feature.icon className="h-4 w-4" />
                  {feature.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Promo Card */}
          {showPromo && (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6 md:p-8 relative overflow-hidden fade-in-up fade-in-up-delay-3">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3 h-8 w-8 text-neutral-400 hover:text-black hover:bg-neutral-200 rounded-full"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-black uppercase tracking-widest bg-black/5 px-2.5 py-1 rounded-full">
                      <Sparkles className="h-3 w-3" />
                      Nuevo
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-black mb-2">
                    Crea tu primera imagen
                  </h3>
                  <p className="text-sm text-neutral-600 mb-5 leading-relaxed">
                    ¿Tienes una idea? Prueba nuestros estilos y filtros seleccionados o imagina algo completamente nuevo desde cero.
                  </p>
                  <Button
                    className="rounded-full bg-black text-white hover:bg-neutral-800 transition-all duration-200 font-medium"
                    onClick={() => setLocation("/login")}
                    data-testid="button-try-now"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Probar ahora
                  </Button>
                </div>

                {/* Style Cards */}
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible md:flex-wrap md:justify-center md:items-center md:gap-3">
                  {[
                    { emoji: "🎨", label: "Boceto", bg: "bg-orange-50 border-orange-200" },
                    { emoji: "🎄", label: "Festivo", bg: "bg-green-50 border-green-200" },
                    { emoji: "🎭", label: "Dramatico", bg: "bg-purple-50 border-purple-200" },
                    { emoji: "🧸", label: "Peluche", bg: "bg-pink-50 border-pink-200" },
                  ].map((style) => (
                    <div
                      key={style.label}
                      className="flex flex-col items-center gap-2 min-w-[72px] cursor-pointer group"
                      onClick={() => setLocation("/login")}
                    >
                      <div
                        className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl ${style.bg} border flex items-center justify-center transition-all duration-200 group-hover:scale-105 group-hover:shadow-md`}
                      >
                        <span className="text-2xl">{style.emoji}</span>
                      </div>
                      <span className="text-xs text-neutral-600 group-hover:text-black transition-colors font-medium">
                        {style.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex items-center justify-center gap-6 md:gap-8 text-neutral-400 text-sm fade-in-up fade-in-up-delay-4 flex-wrap">
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
              <span>Respuestas instantaneas</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== STATS BAR ===== */}
      <section className="border-y border-neutral-200 bg-neutral-50">
        <div className="max-w-6xl mx-auto px-5 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-extrabold text-black tracking-tight">
                  {stat.value}
                </div>
                <div className="text-sm text-neutral-500 mt-1 font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CAPABILITIES ===== */}
      <section className="py-20 md:py-28 px-5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold text-black tracking-tight mb-4">
              Todo lo que necesitas, un solo asistente
            </h2>
            <p className="text-lg text-neutral-500 max-w-2xl mx-auto">
              ILIAGPT combina las capacidades mas avanzadas de inteligencia artificial en una interfaz simple e intuitiva.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {capabilities.map((cap) => (
              <div
                key={cap.title}
                className="group p-6 rounded-2xl border border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-lg hover:shadow-black/5 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-neutral-100 flex items-center justify-center mb-4 group-hover:bg-black group-hover:text-white transition-all duration-300">
                  <cap.icon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-black mb-2">{cap.title}</h3>
                <p className="text-sm text-neutral-500 leading-relaxed">{cap.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="py-20 md:py-28 px-5 bg-neutral-50 border-y border-neutral-200">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold text-black tracking-tight mb-4">
              Asi de simple funciona
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Tres pasos para obtener la respuesta perfecta.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {steps.map((item, i) => (
              <div key={item.step} className="relative text-center md:text-left">
                <div className="text-6xl md:text-7xl font-black text-neutral-100 mb-4 leading-none">
                  {item.step}
                </div>
                <h3 className="text-xl font-bold text-black mb-2">{item.title}</h3>
                <p className="text-sm text-neutral-500 leading-relaxed">{item.description}</p>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-8 -right-6">
                    <ArrowRight className="h-5 w-5 text-neutral-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS ===== */}
      <section className="py-20 md:py-28 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold text-black tracking-tight mb-4">
              Lo que dicen nuestros usuarios
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Miles de personas ya confian en ILIAGPT para su dia a dia.
            </p>
          </div>

          <div className="relative">
            <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-8 md:p-12 text-center transition-all duration-500">
              <div className="flex justify-center gap-1 mb-6">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-5 w-5 fill-black text-black" />
                ))}
              </div>
              <blockquote className="text-xl md:text-2xl font-medium text-black leading-relaxed mb-8 max-w-2xl mx-auto">
                "{testimonials[activeTestimonial].quote}"
              </blockquote>
              <div>
                <div className="font-bold text-black">
                  {testimonials[activeTestimonial].author}
                </div>
                <div className="text-sm text-neutral-500">
                  {testimonials[activeTestimonial].role}
                </div>
              </div>
            </div>

            {/* Dots */}
            <div className="flex justify-center gap-2 mt-6">
              {testimonials.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveTestimonial(i)}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i === activeTestimonial
                      ? "bg-black w-6"
                      : "bg-neutral-300 hover:bg-neutral-400"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== PRICING PREVIEW ===== */}
      <section className="py-20 md:py-28 px-5 bg-neutral-50 border-y border-neutral-200">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-extrabold text-black tracking-tight mb-4">
              Planes para cada necesidad
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Comienza gratis. Escala cuando quieras.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-8 transition-all duration-300 ${
                  plan.highlighted
                    ? "bg-black text-white shadow-2xl shadow-black/20 scale-[1.02] md:scale-105"
                    : "bg-white border border-neutral-200 hover:border-neutral-300 hover:shadow-lg"
                }`}
              >
                <div className="mb-6">
                  <h3
                    className={`text-lg font-bold mb-1 ${
                      plan.highlighted ? "text-white" : "text-black"
                    }`}
                  >
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-1">
                    <span
                      className={`text-4xl font-extrabold ${
                        plan.highlighted ? "text-white" : "text-black"
                      }`}
                    >
                      {plan.price}
                    </span>
                    <span
                      className={`text-sm ${
                        plan.highlighted ? "text-white/60" : "text-neutral-500"
                      }`}
                    >
                      {plan.period}
                    </span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check
                        className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                          plan.highlighted ? "text-white/80" : "text-black"
                        }`}
                      />
                      <span
                        className={
                          plan.highlighted ? "text-white/90" : "text-neutral-600"
                        }
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>

                <Button
                  className={`w-full rounded-full font-medium transition-all ${
                    plan.highlighted
                      ? "bg-white text-black hover:bg-neutral-100"
                      : "bg-black text-white hover:bg-neutral-800"
                  }`}
                  onClick={() =>
                    setLocation(plan.name === "Business" ? "/business" : "/signup")
                  }
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="py-24 md:py-32 px-5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-extrabold text-black tracking-tight mb-5">
            Empieza a crear con ILIAGPT hoy
          </h2>
          <p className="text-lg text-neutral-500 mb-10 max-w-xl mx-auto">
            Unete a millones de usuarios que ya usan la IA mas avanzada en espanol. Sin tarjeta de credito requerida.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              className="rounded-full bg-black text-white hover:bg-neutral-800 transition-all h-12 px-8 text-base font-medium"
              onClick={() => setLocation("/signup")}
            >
              Comenzar gratis
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-neutral-300 text-black hover:bg-neutral-50 hover:border-neutral-400 transition-all h-12 px-8 text-base font-medium"
              onClick={() => setLocation("/pricing")}
            >
              Ver precios
            </Button>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-neutral-200 bg-neutral-50">
        <div className="max-w-6xl mx-auto px-5 py-12 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <IliaGPTLogo size={24} />
                <span className="font-bold text-black">ILIAGPT</span>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                La plataforma de inteligencia artificial mas avanzada en espanol.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-black text-sm mb-3">Producto</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <span onClick={() => setLocation("/pricing")} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">
                    Precios
                  </span>
                </li>
                <li>
                  <span onClick={() => setLocation("/download")} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">
                    Descargar
                  </span>
                </li>
                <li>
                  <span onClick={() => setLocation("/business")} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">
                    Business
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-black text-sm mb-3">Recursos</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <span onClick={() => setLocation("/learn")} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">
                    Aprender
                  </span>
                </li>
                <li>
                  <span onClick={() => setLocation("/about")} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">
                    Sobre nosotros
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-black text-sm mb-3">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/terms" className="text-neutral-500 hover:text-black transition-colors">
                    Terminos de uso
                  </Link>
                </li>
                <li>
                  <Link href="/privacy-policy" className="text-neutral-500 hover:text-black transition-colors">
                    Politica de privacidad
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-neutral-200 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-neutral-400">
              &copy; {new Date().getFullYear()} ILIAGPT. Todos los derechos reservados.
            </p>
            <p className="text-xs text-neutral-400 text-center md:text-right max-w-lg">
              Al enviar un mensaje a ILIAGPT, un chatbot de IA, aceptas nuestros{" "}
              <Link href="/terms" className="underline hover:text-black transition-colors">
                Terminos
              </Link>{" "}
              y reconoces que leiste nuestra{" "}
              <Link href="/privacy-policy" className="underline hover:text-black transition-colors">
                Politica de privacidad
              </Link>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
