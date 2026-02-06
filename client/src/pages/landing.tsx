import { useEffect, useState, useRef, useCallback, useMemo } from "react";
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
  Sparkles,
  Zap,
  Shield,
  Globe,
  Menu,
  Brain,
  FileText,
  MessageSquare,
  ArrowRight,
  ArrowUpRight,
  Check,
  Star,
  Users,
  Clock,
  Lock,
  Cpu,
  PenTool,
  BarChart3,
  GraduationCap,
  Lightbulb,
  Target,
  Play,
  ChevronUp,
  Send,
  Bot,
  Wand2,
  Code2,
  Languages,
  Microscope,
} from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";

/* ─────────────────────────────────────────────
   Hook: scroll‑triggered reveal via IntersectionObserver
   ───────────────────────────────────────────── */
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ─────────────────────────────────────────────
   Hook: animated number counter
   ───────────────────────────────────────────── */
function useCounter(end: number, duration = 1800, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);          // ease-out cubic
      setValue(Math.round(ease * end));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, end, duration]);
  return value;
}

/* ─────────────────────────────────────────────
   Typing‑text animation for the hero
   ───────────────────────────────────────────── */
const heroSuggestions = [
  "Explicame la teoria de la relatividad...",
  "Escribe un correo profesional para...",
  "Crea una imagen de un paisaje futurista...",
  "Ayudame a estudiar biologia molecular...",
  "Resume este articulo en 3 puntos clave...",
  "Genera un plan de negocios para...",
];

function useTypingPlaceholder() {
  const [text, setText] = useState("");
  const idx = useRef(0);
  const charIdx = useRef(0);
  const deleting = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      const phrase = heroSuggestions[idx.current];
      if (!deleting.current) {
        charIdx.current++;
        setText(phrase.slice(0, charIdx.current));
        if (charIdx.current === phrase.length) {
          deleting.current = true;
          timer = setTimeout(run, 2200);
          return;
        }
        timer = setTimeout(run, 45 + Math.random() * 40);
      } else {
        charIdx.current--;
        setText(phrase.slice(0, charIdx.current));
        if (charIdx.current === 0) {
          deleting.current = false;
          idx.current = (idx.current + 1) % heroSuggestions.length;
          timer = setTimeout(run, 400);
          return;
        }
        timer = setTimeout(run, 22);
      }
    };
    timer = setTimeout(run, 800);
    return () => clearTimeout(timer);
  }, []);
  return text;
}

/* ═══════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════ */

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const typingPlaceholder = useTypingPlaceholder();

  // Scroll‑reveal refs
  const statsReveal = useReveal(0.2);
  const capsReveal  = useReveal(0.1);
  const stepsReveal = useReveal(0.15);
  const testReveal  = useReveal(0.15);
  const compReveal  = useReveal(0.1);
  const faqReveal   = useReveal(0.1);
  const priceReveal = useReveal(0.1);
  const ctaReveal   = useReveal(0.15);

  // Animated counters for stats
  const c1 = useCounter(10, 1600, statsReveal.visible);
  const c2 = useCounter(150, 1600, statsReveal.visible);
  const c3 = useCounter(99, 1200, statsReveal.visible);
  const c4 = useCounter(2, 800, statsReveal.visible);

  /* ── Mobile menu body‑lock & close helpers ── */
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const k = "mobile-menu-open";
    const s = window.history.state;
    if (!s || s[k] !== true) window.history.pushState({ ...(s || {}), [k]: true }, "");
    const pop = () => setMobileMenuOpen(false);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [mobileMenuOpen]);

  /* ── Sticky header shadow on scroll ── */
  useEffect(() => {
    const fn = () => setHeaderScrolled(window.scrollY > 10);
    window.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => window.removeEventListener("scroll", fn);
  }, []);

  /* ── Testimonial auto‑rotate ── */
  useEffect(() => {
    const id = setInterval(() => setActiveTestimonial((p) => (p + 1) % testimonials.length), 5000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = () => {
    if (inputValue.trim()) setLocation("/login");
  };

  /* ══════════ DATA ══════════ */

  const features = [
    { icon: Paperclip, label: "Adjuntar" },
    { icon: Search,    label: "Buscar" },
    { icon: BookOpen,  label: "Estudiemos" },
    { icon: Image,     label: "Crear imagen" },
    { icon: Mic,       label: "Voz" },
  ];

  const capabilities = [
    {
      icon: Brain, title: "Razonamiento avanzado",
      desc: "Resuelve problemas complejos de matematicas, logica y ciencia con razonamiento paso a paso que puedes verificar.",
      tag: "IA Cognitiva",
    },
    {
      icon: PenTool, title: "Creacion de contenido",
      desc: "Redacta desde correos ejecutivos hasta novelas completas, adaptandose a tu tono, audiencia y proposito.",
      tag: "Escritura",
    },
    {
      icon: FileText, title: "Documentos profesionales",
      desc: "Genera reportes PDF, hojas de calculo, presentaciones y contratos con formato listo para enviar.",
      tag: "Productividad",
    },
    {
      icon: GraduationCap, title: "Tutor inteligente",
      desc: "Explicaciones personalizadas, ejercicios progresivos y evaluaciones adaptativas para cualquier materia.",
      tag: "Educacion",
    },
    {
      icon: Wand2, title: "Generacion de imagenes",
      desc: "Transforma texto en arte visual con mas de 20 estilos: realista, anime, acuarela, 3D, minimalista y mas.",
      tag: "Arte IA",
    },
    {
      icon: Globe, title: "Navegacion web en vivo",
      desc: "Busca, navega y extrae datos de internet en tiempo real para respuestas con fuentes verificables.",
      tag: "Investigacion",
    },
    {
      icon: Code2, title: "Asistente de codigo",
      desc: "Escribe, depura y explica codigo en mas de 40 lenguajes. Desde scripts simples hasta arquitecturas complejas.",
      tag: "Desarrollo",
    },
    {
      icon: Languages, title: "Multilenguaje nativo",
      desc: "Traduce, localiza y genera contenido en mas de 95 idiomas con contexto cultural y gramatical preciso.",
      tag: "Idiomas",
    },
  ];

  const steps = [
    { n: "01", title: "Escribe o dicta tu solicitud", desc: "Usa texto libre, voz o adjunta un archivo. ILIAGPT entiende contexto, intenciones y matices.", icon: MessageSquare },
    { n: "02", title: "La IA razona y construye", desc: "Nuestro motor multimodal analiza, investiga en la web si es necesario, y genera la respuesta optima.", icon: Cpu },
    { n: "03", title: "Resultado listo al instante", desc: "Texto, imagenes, documentos o codigo — editables, descargables y listos para compartir.", icon: Zap },
  ];

  const testimonials = [
    { quote: "ILIAGPT reemplazo 3 herramientas que usaba. Ahora todo esta en un solo lugar: investigacion, escritura y generacion de imagenes.", author: "Maria Gonzalez", role: "Estudiante de Medicina, UNAM", avatar: "MG" },
    { quote: "Nuestro equipo de marketing redujo el tiempo de creacion de contenido en un 70%. El ROI fue inmediato.", author: "Carlos Ramirez", role: "Director de Marketing, TechLatam", avatar: "CR" },
    { quote: "Como disenadora, la generacion de imagenes me da referencias visuales en segundos. Es como tener un equipo creativo completo.", author: "Ana Torres", role: "Disenadora UX, Freelance", avatar: "AT" },
    { quote: "Mis alumnos usan ILIAGPT como tutor complementario. Las explicaciones paso a paso son extraordinarias.", author: "Prof. Roberto Silva", role: "Docente Universitario, UBA", avatar: "RS" },
  ];

  const comparison = [
    { feature: "Generacion de texto avanzada",   iliagpt: true,  chatgpt: true,  gemini: true  },
    { feature: "Imagenes desde texto",            iliagpt: true,  chatgpt: true,  gemini: true  },
    { feature: "Navegacion web en vivo",          iliagpt: true,  chatgpt: true,  gemini: true  },
    { feature: "Documentos profesionales (PDF, XLSX)", iliagpt: true,  chatgpt: false, gemini: false },
    { feature: "Tutor adaptativo",                iliagpt: true,  chatgpt: false, gemini: false },
    { feature: "Interfaz 100% en espanol",        iliagpt: true,  chatgpt: false, gemini: false },
    { feature: "Plan gratuito generoso",          iliagpt: true,  chatgpt: false, gemini: true  },
    { feature: "Soporte humano en espanol",       iliagpt: true,  chatgpt: false, gemini: false },
  ];

  const faqs = [
    { q: "¿ILIAGPT es realmente gratis?", a: "Si. El plan gratuito incluye 50 mensajes diarios, generacion de texto completa, busqueda basica y 1 imagen por dia. No necesitas tarjeta de credito para empezar." },
    { q: "¿Que tan precisa es la inteligencia artificial?", a: "ILIAGPT utiliza los modelos de IA mas avanzados del mercado. Para tareas de razonamiento, redaccion y analisis, nuestra precision supera el 95% en benchmarks independientes." },
    { q: "¿Mis datos estan seguros?", a: "Absolutamente. Usamos cifrado de extremo a extremo, no compartimos datos con terceros y cumplimos con GDPR y regulaciones latinoamericanas de proteccion de datos." },
    { q: "¿Puedo usar ILIAGPT para mi empresa?", a: "Si. El plan Business incluye panel de administracion, SSO empresarial, integraciones API, SLA garantizado y un gerente de cuenta dedicado." },
    { q: "¿En que idiomas funciona?", a: "ILIAGPT soporta mas de 95 idiomas, pero esta optimizado especialmente para espanol en todas sus variantes regionales (Mexico, Espana, Argentina, Colombia, etc.)." },
    { q: "¿Puedo cancelar en cualquier momento?", a: "Si. Sin contratos, sin penalizaciones. Puedes cambiar de plan o cancelar cuando quieras desde la configuracion de tu cuenta." },
  ];

  const plans = [
    {
      name: "Gratis", price: "$0", period: "para siempre", highlighted: false,
      features: ["50 mensajes diarios", "Generacion de texto completa", "Busqueda basica en la web", "1 imagen por dia", "Historial de 7 dias"],
      cta: "Comenzar gratis",
    },
    {
      name: "Pro", price: "$12", period: "/mes", highlighted: true, badge: "Mas popular",
      features: ["Mensajes ilimitados", "Imagenes ilimitadas + 20 estilos", "Documentos profesionales", "Navegacion web avanzada", "Prioridad en cola de respuestas", "Historial ilimitado", "Soporte prioritario 24/7"],
      cta: "Prueba gratis 7 dias",
    },
    {
      name: "Business", price: "$39", period: "/usuario/mes", highlighted: false,
      features: ["Todo en Pro incluido", "Panel de administracion", "Integraciones API (REST + SDK)", "SSO y SAML empresarial", "SLA 99.95% garantizado", "Gerente de cuenta dedicado", "Facturacion consolidada"],
      cta: "Contactar ventas",
    },
  ];

  const marqueeLogos = [
    "Universidad Nacional", "TechLatam", "MedGroup", "CreativeStudio",
    "EduPro", "DataSoft", "InnovaLab", "GlobalMedia",
  ];

  /* ─── reveal helper class ─── */
  const rv = (visible: boolean, delay = 0) =>
    `transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`
    + (delay ? ` [transition-delay:${delay}ms]` : "");

  /* ═══════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-white flex flex-col relative overflow-x-hidden">

      {/* ════════════════════ HEADER ════════════════════ */}
      <header
        className={
          "sticky top-0 z-50 flex items-center justify-between px-5 md:px-10 h-16 bg-white/80 backdrop-blur-xl transition-shadow duration-300 " +
          (headerScrolled ? "shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "")
        }
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
          <span className="font-extrabold tracking-tight text-black text-lg select-none">ILIAGPT</span>
        </div>

        <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium tracking-wide uppercase">
          {[
            { label: "Sobre nosotros", to: "/about" },
            { label: "Aprender", to: "/learn" },
            { label: "Business", to: "/business" },
            { label: "Precios", to: "/pricing" },
            { label: "Imagenes", to: "/login" },
            { label: "Descargar", to: "/download" },
          ].map((n) => (
            <span key={n.to} onClick={() => setLocation(n.to)} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">
              {n.label}
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <Button
            className="rounded-full bg-black text-white hover:bg-neutral-800 transition-all h-9 px-5 text-sm font-semibold shadow-sm"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesion
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-neutral-300 text-black hover:bg-neutral-50 hover:border-neutral-400 transition-all font-semibold"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscribete gratis
          </Button>
        </div>
      </header>

      {/* ════════════════════ MOBILE DRAWER ════════════════════ */}
      <div className={"md:hidden" + (mobileMenuOpen ? "" : " pointer-events-none")} aria-hidden={!mobileMenuOpen}>
        <div
          className={"fixed left-0 right-0 top-16 bottom-0 z-40 bg-black/40 transition-opacity duration-200 " + (mobileMenuOpen ? "opacity-100" : "opacity-0")}
          onClick={() => setMobileMenuOpen(false)}
        />
        <div
          className={"fixed left-0 top-16 bottom-0 z-50 w-[80vw] max-w-[320px] border-r border-neutral-200 bg-white shadow-2xl transition-transform duration-250 ease-out " + (mobileMenuOpen ? "translate-x-0" : "-translate-x-full")}
          role="menu" aria-label="Menu" data-testid="mobile-menu"
        >
          <div className="p-3 space-y-0.5">
            {[
              { label: "Sobre nosotros", to: "/about" },
              { label: "Aprender", to: "/learn" },
              { label: "Business", to: "/business" },
              { label: "Precios", to: "/pricing" },
              { label: "Imagenes", to: "/login" },
              { label: "Descargar", to: "/download" },
            ].map((item) => (
              <button key={item.to} type="button" role="menuitem"
                className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-neutral-800 hover:text-black hover:bg-neutral-100 transition-colors"
                onClick={() => { setMobileMenuOpen(false); setLocation(item.to); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="px-3 pt-4 border-t border-neutral-100 mx-3">
            <Button className="w-full rounded-full bg-black text-white hover:bg-neutral-800 font-semibold"
              onClick={() => { setMobileMenuOpen(false); setLocation("/signup"); }}>
              Suscribete gratis
            </Button>
          </div>
        </div>
      </div>

      {/* ════════════════════ HERO ════════════════════ */}
      <section className="relative flex flex-col items-center px-5 pt-20 pb-24 md:pt-32 md:pb-36 overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.025]" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, black 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }} />
        {/* Gradient blobs */}
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-neutral-100 blur-[120px] opacity-60" />
        <div className="absolute -bottom-40 -right-40 w-[400px] h-[400px] rounded-full bg-neutral-200/60 blur-[100px] opacity-40" />

        <div className="relative w-full max-w-3xl space-y-10">
          {/* Badge */}
          <div className="flex justify-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-200 bg-white text-xs font-semibold tracking-wide uppercase text-neutral-600 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-black" />
              </span>
              Mas de 10 millones de consultas resueltas
            </div>
          </div>

          {/* Title */}
          <div className="text-center fade-in-up">
            <h1 className="text-5xl sm:text-6xl md:text-8xl font-black tracking-tight text-black leading-[1.05] mb-6">
              Tu mente,
              <br />
              <span className="relative inline-block">
                amplificada
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                  <path d="M2 8 Q75 2 150 6 Q225 10 298 4" stroke="black" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.15" />
                </svg>
              </span>
            </h1>
            <p className="text-lg md:text-xl text-neutral-500 max-w-2xl mx-auto leading-relaxed font-medium">
              El asistente de IA mas avanzado en espanol. Crea contenido, genera imagenes,
              investiga, aprende y automatiza — todo en una sola conversacion.
            </p>
          </div>

          {/* Search */}
          <div className="space-y-5 fade-in-up fade-in-up-delay-1">
            <div className="relative group">
              <div className="rounded-2xl border-2 border-neutral-200 bg-white shadow-xl shadow-black/[0.04] transition-all duration-300 group-focus-within:shadow-2xl group-focus-within:shadow-black/[0.08] group-focus-within:border-black/20 flex items-center">
                <Input
                  placeholder={typingPlaceholder}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-16 md:h-[72px] px-6 text-lg bg-transparent border-0 text-black placeholder:text-neutral-400 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                  data-testid="input-landing-search"
                />
                <Button
                  size="icon"
                  className="mr-3 h-11 w-11 rounded-xl bg-black text-white hover:bg-neutral-800 transition-all flex-shrink-0"
                  onClick={handleSubmit}
                >
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Quick-action pills */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {features.map((f, i) => (
                <Button key={f.label} variant="outline"
                  className="rounded-full gap-2 text-[13px] border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-black hover:border-neutral-300 transition-all duration-200 fade-in-up h-9 px-4"
                  style={{ animationDelay: `${(i + 2) * 80}ms` }}
                  onClick={() => setLocation("/login")}
                  data-testid={`button-${f.label.toLowerCase().replace(" ", "-")}`}
                >
                  <f.icon className="h-3.5 w-3.5" />
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Promo Card */}
          {showPromo && (
            <div className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-white p-6 md:p-8 relative overflow-hidden fade-in-up fade-in-up-delay-3 group/promo hover:shadow-lg transition-shadow duration-300">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-neutral-100 to-transparent rounded-bl-[80px] opacity-60" />
              <Button variant="ghost" size="icon"
                className="absolute top-3 right-3 h-8 w-8 text-neutral-400 hover:text-black hover:bg-neutral-200 rounded-full z-10"
                onClick={() => setShowPromo(false)} data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="relative flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-black uppercase tracking-[0.15em] bg-black/[0.04] px-3 py-1 rounded-full mb-3">
                    <Sparkles className="h-3 w-3" />
                    Nuevo
                  </span>
                  <h3 className="text-xl font-bold text-black mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-neutral-500 mb-5 leading-relaxed max-w-md">
                    Transforma cualquier idea en arte visual. Elige entre mas de 20 estilos artisticos o deja volar tu imaginacion desde cero.
                  </p>
                  <Button className="rounded-full bg-black text-white hover:bg-neutral-800 transition-all font-semibold shadow-md hover:shadow-lg"
                    onClick={() => setLocation("/login")} data-testid="button-try-now"
                  >
                    Probar ahora
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 md:overflow-visible md:flex-wrap md:justify-center md:gap-3">
                  {[
                    { emoji: "🎨", label: "Boceto",    bg: "bg-orange-50 border-orange-200 hover:bg-orange-100" },
                    { emoji: "🎄", label: "Festivo",   bg: "bg-emerald-50 border-emerald-200 hover:bg-emerald-100" },
                    { emoji: "🎭", label: "Dramatico", bg: "bg-violet-50 border-violet-200 hover:bg-violet-100" },
                    { emoji: "🧸", label: "Peluche",   bg: "bg-pink-50 border-pink-200 hover:bg-pink-100" },
                  ].map((s) => (
                    <div key={s.label} className="flex flex-col items-center gap-2 min-w-[72px] cursor-pointer group/style" onClick={() => setLocation("/login")}>
                      <div className={`w-16 h-16 md:w-[76px] md:h-[76px] rounded-2xl ${s.bg} border flex items-center justify-center transition-all duration-200 group-hover/style:scale-110 group-hover/style:shadow-md`}>
                        <span className="text-2xl">{s.emoji}</span>
                      </div>
                      <span className="text-xs text-neutral-500 group-hover/style:text-black transition-colors font-semibold">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust bar */}
          <div className="flex items-center justify-center gap-6 md:gap-10 text-neutral-400 text-xs font-medium uppercase tracking-wide fade-in-up fade-in-up-delay-4 flex-wrap">
            {[
              { icon: Shield, text: "Cifrado E2E" },
              { icon: Clock, text: "Disponible 24/7" },
              { icon: Zap, text: "Respuesta < 2s" },
              { icon: Lock, text: "Privacidad total" },
            ].map((t) => (
              <div key={t.text} className="flex items-center gap-1.5">
                <t.icon className="h-3.5 w-3.5" />
                <span>{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ MARQUEE LOGOS ════════════════════ */}
      <div className="border-y border-neutral-100 bg-neutral-50/50 py-5 overflow-hidden">
        <div className="flex items-center gap-12 animate-marquee whitespace-nowrap">
          {[...marqueeLogos, ...marqueeLogos].map((name, i) => (
            <span key={i} className="text-sm font-semibold text-neutral-300 tracking-wide uppercase select-none flex-shrink-0">
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* ════════════════════ STATS ════════════════════ */}
      <section ref={statsReveal.ref} className="py-20 md:py-24 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {[
              { val: `${c1}M+`,  label: "Consultas resueltas",  icon: MessageSquare },
              { val: `${c2}+`,   label: "Paises activos",       icon: Globe },
              { val: `${c3}.9%`, label: "Disponibilidad",       icon: Shield },
              { val: `< ${c4}s`, label: "Tiempo de respuesta",  icon: Zap },
            ].map((s, i) => (
              <div key={s.label} className={`text-center ${rv(statsReveal.visible)}`} style={{ transitionDelay: `${i * 100}ms` }}>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-neutral-100 mb-4">
                  <s.icon className="h-5 w-5 text-neutral-600" />
                </div>
                <div className="text-3xl md:text-4xl font-black text-black tracking-tight">{s.val}</div>
                <div className="text-sm text-neutral-500 mt-1 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ CAPABILITIES ════════════════════ */}
      <section ref={capsReveal.ref} className="py-20 md:py-28 px-5 bg-neutral-50">
        <div className="max-w-6xl mx-auto">
          <div className={`text-center mb-16 ${rv(capsReveal.visible)}`}>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">Capacidades</span>
            <h2 className="text-3xl md:text-5xl font-black text-black tracking-tight mb-4">
              Un asistente. Infinitas posibilidades.
            </h2>
            <p className="text-lg text-neutral-500 max-w-2xl mx-auto">
              Todo lo que necesitas para crear, investigar, aprender y automatizar — sin cambiar de herramienta.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {capabilities.map((cap, i) => (
              <div key={cap.title}
                className={`group p-6 rounded-2xl border border-neutral-200 bg-white hover:bg-black hover:border-black transition-all duration-300 cursor-pointer ${rv(capsReveal.visible)}`}
                style={{ transitionDelay: `${100 + i * 60}ms` }}
                onClick={() => setLocation("/login")}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 rounded-xl bg-neutral-100 group-hover:bg-white/10 flex items-center justify-center transition-colors duration-300">
                    <cap.icon className="h-5 w-5 text-black group-hover:text-white transition-colors duration-300" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 group-hover:text-white/40 transition-colors">{cap.tag}</span>
                </div>
                <h3 className="text-base font-bold text-black group-hover:text-white mb-2 transition-colors duration-300">{cap.title}</h3>
                <p className="text-[13px] text-neutral-500 group-hover:text-white/70 leading-relaxed transition-colors duration-300">{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ HOW IT WORKS ════════════════════ */}
      <section ref={stepsReveal.ref} className="py-20 md:py-28 px-5">
        <div className="max-w-5xl mx-auto">
          <div className={`text-center mb-16 ${rv(stepsReveal.visible)}`}>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">Como funciona</span>
            <h2 className="text-3xl md:text-5xl font-black text-black tracking-tight mb-4">
              Tres pasos. Cero complicaciones.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((item, i) => (
              <div key={item.n} className={`relative ${rv(stepsReveal.visible)}`} style={{ transitionDelay: `${150 + i * 120}ms` }}>
                <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-8 h-full hover:shadow-lg hover:shadow-black/[0.04] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-sm font-black">
                      {item.n}
                    </div>
                    <item.icon className="h-5 w-5 text-neutral-400" />
                  </div>
                  <h3 className="text-xl font-bold text-black mb-2">{item.title}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed">{item.desc}</p>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden md:flex absolute top-1/2 -right-4 -translate-y-1/2 z-10">
                    <ChevronRight className="h-5 w-5 text-neutral-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ COMPARISON TABLE ════════════════════ */}
      <section ref={compReveal.ref} className="py-20 md:py-28 px-5 bg-neutral-50">
        <div className="max-w-4xl mx-auto">
          <div className={`text-center mb-12 ${rv(compReveal.visible)}`}>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">Comparativa</span>
            <h2 className="text-3xl md:text-5xl font-black text-black tracking-tight mb-4">
              ¿Por que elegir ILIAGPT?
            </h2>
          </div>

          <div className={`rounded-2xl border border-neutral-200 bg-white overflow-hidden ${rv(compReveal.visible)}`} style={{ transitionDelay: "150ms" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <th className="text-left px-6 py-4 font-bold text-black">Funcionalidad</th>
                    <th className="px-6 py-4 font-black text-black text-center">ILIAGPT</th>
                    <th className="px-6 py-4 font-medium text-neutral-400 text-center">ChatGPT</th>
                    <th className="px-6 py-4 font-medium text-neutral-400 text-center">Gemini</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row, i) => (
                    <tr key={row.feature} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/50 transition-colors">
                      <td className="px-6 py-3.5 text-neutral-700 font-medium">{row.feature}</td>
                      <td className="px-6 py-3.5 text-center">
                        {row.iliagpt ? <Check className="h-5 w-5 text-black mx-auto" strokeWidth={3} /> : <X className="h-4 w-4 text-neutral-300 mx-auto" />}
                      </td>
                      <td className="px-6 py-3.5 text-center">
                        {row.chatgpt ? <Check className="h-4 w-4 text-neutral-400 mx-auto" /> : <X className="h-4 w-4 text-neutral-300 mx-auto" />}
                      </td>
                      <td className="px-6 py-3.5 text-center">
                        {row.gemini ? <Check className="h-4 w-4 text-neutral-400 mx-auto" /> : <X className="h-4 w-4 text-neutral-300 mx-auto" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════ TESTIMONIALS ════════════════════ */}
      <section ref={testReveal.ref} className="py-20 md:py-28 px-5">
        <div className="max-w-5xl mx-auto">
          <div className={`text-center mb-12 ${rv(testReveal.visible)}`}>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">Testimonios</span>
            <h2 className="text-3xl md:text-5xl font-black text-black tracking-tight mb-4">
              Confian en nosotros
            </h2>
          </div>

          {/* Cards grid instead of single carousel */}
          <div className="grid md:grid-cols-2 gap-5">
            {testimonials.map((t, i) => (
              <div key={t.author}
                className={`rounded-2xl border border-neutral-200 bg-neutral-50 p-6 md:p-8 hover:shadow-lg hover:shadow-black/[0.04] transition-all duration-300 ${rv(testReveal.visible)}`}
                style={{ transitionDelay: `${100 + i * 80}ms` }}
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-black text-black" />
                  ))}
                </div>
                <blockquote className="text-base md:text-lg font-medium text-black leading-relaxed mb-6">
                  "{t.quote}"
                </blockquote>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-xs font-bold">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-bold text-black text-sm">{t.author}</div>
                    <div className="text-xs text-neutral-500">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ PRICING ════════════════════ */}
      <section ref={priceReveal.ref} className="py-20 md:py-28 px-5 bg-neutral-50">
        <div className="max-w-6xl mx-auto">
          <div className={`text-center mb-16 ${rv(priceReveal.visible)}`}>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">Precios</span>
            <h2 className="text-3xl md:text-5xl font-black text-black tracking-tight mb-4">
              Simple. Transparente. Sin sorpresas.
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Comienza gratis hoy. Escala cuando tu necesites.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto items-start">
            {plans.map((plan, i) => (
              <div key={plan.name}
                className={`rounded-2xl transition-all duration-500 ${rv(priceReveal.visible)} ${
                  plan.highlighted
                    ? "bg-black text-white p-8 md:p-10 shadow-2xl shadow-black/25 md:scale-105 relative"
                    : "bg-white border border-neutral-200 p-8 hover:border-neutral-300 hover:shadow-lg"
                }`}
                style={{ transitionDelay: `${100 + i * 100}ms` }}
              >
                {"badge" in plan && plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-white text-black text-[11px] font-bold uppercase tracking-wider px-4 py-1.5 rounded-full shadow-md">
                      {plan.badge}
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className={`text-base font-bold mb-1 ${plan.highlighted ? "text-white/80" : "text-neutral-500"}`}>{plan.name}</h3>
                  <div className="flex items-baseline gap-0.5">
                    <span className={`text-5xl font-black ${plan.highlighted ? "text-white" : "text-black"}`}>{plan.price}</span>
                    <span className={`text-sm font-medium ${plan.highlighted ? "text-white/50" : "text-neutral-400"}`}>{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px]">
                      <Check className={`h-4 w-4 mt-0.5 flex-shrink-0 ${plan.highlighted ? "text-white/70" : "text-black"}`} strokeWidth={2.5} />
                      <span className={plan.highlighted ? "text-white/85" : "text-neutral-600"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button className={`w-full rounded-full font-semibold h-11 transition-all ${
                  plan.highlighted ? "bg-white text-black hover:bg-neutral-100 shadow-md" : "bg-black text-white hover:bg-neutral-800"
                }`} onClick={() => setLocation(plan.name === "Business" ? "/business" : "/signup")}>
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ FAQ ════════════════════ */}
      <section ref={faqReveal.ref} className="py-20 md:py-28 px-5">
        <div className="max-w-3xl mx-auto">
          <div className={`text-center mb-12 ${rv(faqReveal.visible)}`}>
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">FAQ</span>
            <h2 className="text-3xl md:text-5xl font-black text-black tracking-tight">
              Preguntas frecuentes
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i}
                className={`rounded-xl border border-neutral-200 bg-white overflow-hidden transition-all duration-300 hover:border-neutral-300 ${rv(faqReveal.visible)}`}
                style={{ transitionDelay: `${100 + i * 50}ms` }}
              >
                <button
                  className="w-full flex items-center justify-between px-6 py-5 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="font-bold text-black text-[15px] pr-4">{faq.q}</span>
                  <ChevronDown className={`h-5 w-5 text-neutral-400 flex-shrink-0 transition-transform duration-300 ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? "max-h-60 pb-5" : "max-h-0"}`}>
                  <p className="px-6 text-sm text-neutral-500 leading-relaxed">{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════ FINAL CTA ════════════════════ */}
      <section ref={ctaReveal.ref} className="py-24 md:py-32 px-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-black" />
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }} />

        <div className={`relative max-w-3xl mx-auto text-center ${rv(ctaReveal.visible)}`}>
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight mb-6">
            El futuro de la productividad<br />empieza aqui
          </h2>
          <p className="text-lg text-white/60 mb-10 max-w-xl mx-auto font-medium">
            Unete a mas de 10 millones de personas que ya amplifican su potencial con ILIAGPT. Gratis, para siempre.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button className="rounded-full bg-white text-black hover:bg-neutral-100 transition-all h-13 px-8 text-base font-bold shadow-lg"
              onClick={() => setLocation("/signup")}>
              Comenzar gratis
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="outline" className="rounded-full border-white/20 text-white hover:bg-white/10 hover:border-white/30 transition-all h-13 px-8 text-base font-semibold"
              onClick={() => setLocation("/pricing")}>
              Ver todos los planes
            </Button>
          </div>
          <p className="text-xs text-white/30 mt-6 font-medium">Sin tarjeta de credito requerida — Configuracion en 30 segundos</p>
        </div>
      </section>

      {/* ════════════════════ FOOTER ════════════════════ */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-14 md:py-20">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-14">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <IliaGPTLogo size={24} />
                <span className="font-black text-black">ILIAGPT</span>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed max-w-[240px]">
                La plataforma de inteligencia artificial mas avanzada del mundo hispanohablante.
              </p>
            </div>
            {[
              { title: "Producto", links: [
                { label: "Precios", to: "/pricing" },
                { label: "Descargar", to: "/download" },
                { label: "Business", to: "/business" },
                { label: "Imagenes", to: "/login" },
              ]},
              { title: "Recursos", links: [
                { label: "Aprender", to: "/learn" },
                { label: "Sobre nosotros", to: "/about" },
                { label: "Blog", to: "/learn" },
              ]},
              { title: "Soporte", links: [
                { label: "Centro de ayuda", to: "/about" },
                { label: "Contacto", to: "/about" },
                { label: "Status", to: "/about" },
              ]},
              { title: "Legal", links: [
                { label: "Terminos de uso", to: "/terms", isLink: true },
                { label: "Privacidad", to: "/privacy-policy", isLink: true },
                { label: "Cookies", to: "/privacy-policy", isLink: true },
              ]},
            ].map((col) => (
              <div key={col.title}>
                <h4 className="font-bold text-black text-xs uppercase tracking-wider mb-4">{col.title}</h4>
                <ul className="space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {"isLink" in l && l.isLink ? (
                        <Link href={l.to} className="text-neutral-500 hover:text-black transition-colors">{l.label}</Link>
                      ) : (
                        <span onClick={() => setLocation(l.to)} className="text-neutral-500 hover:text-black transition-colors cursor-pointer">{l.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-neutral-200 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-neutral-400 font-medium">
              &copy; {new Date().getFullYear()} ILIAGPT. Todos los derechos reservados.
            </p>
            <p className="text-[11px] text-neutral-400 text-center md:text-right max-w-md leading-relaxed">
              Al enviar un mensaje a ILIAGPT aceptas nuestros{" "}
              <Link href="/terms" className="underline hover:text-black transition-colors">Terminos</Link>{" "}
              y reconoces nuestra{" "}
              <Link href="/privacy-policy" className="underline hover:text-black transition-colors">Politica de privacidad</Link>.
            </p>
          </div>
        </div>
      </footer>

      {/* ════════════════════ INLINE STYLES ════════════════════ */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </div>
  );
}
