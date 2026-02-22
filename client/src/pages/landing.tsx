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
  Sparkles,
  Zap,
  Shield,
  Menu,
  ArrowRight,
  Clock,
  Lock,
  Send,
  Palette,
  Gift,
  Drama,
  Wand2,
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
   Typing‑text animation for the hero
   ───────────────────────────────────────────── */
const heroSuggestions = [
  "Explícame la teoría de la relatividad...",
  "Escribe un correo profesional para...",
  "Crea una imagen de un paisaje futurista...",
  "Ayúdame a estudiar biología molecular...",
  "Resume este artículo en 3 puntos clave...",
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
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const typingPlaceholder = useTypingPlaceholder();

  // Scroll‑reveal refs
  const ctaReveal = useReveal(0.15);

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

  const handleSubmit = () => {
    if (inputValue.trim()) setLocation("/login");
  };

  /* ══════════ DATA ══════════ */

  const features = [
    { icon: Paperclip, label: "Adjuntar" },
    { icon: Search, label: "Buscar" },
    { icon: BookOpen, label: "Estudiemos" },
    { icon: Image, label: "Crear imagen" },
    { icon: Mic, label: "Voz" },
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
            Inicia sesión
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-neutral-300 text-black hover:bg-neutral-50 hover:border-neutral-400 transition-all font-semibold"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscríbete gratis
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
              Suscríbete gratis
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
              Más de 10 millones de consultas resueltas
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
              El asistente de IA más avanzado en español. Crea contenido, genera imágenes,
              investiga, aprende y automatiza — todo en una sola conversación.
            </p>
          </div>

          {/* Search */}
          <div className="space-y-5 fade-in-up fade-in-up-delay-1 relative z-10">
            <div className="relative group mx-auto max-w-2xl">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#A5A0FF]/0 via-[#A5A0FF]/30 to-[#A5A0FF]/0 rounded-[24px] blur-md opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
              <div className="relative rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-500 group-focus-within:shadow-[0_8px_40px_rgba(165,160,255,0.25)] group-focus-within:border-white group-focus-within:-translate-y-1 group-hover:-translate-y-0.5 flex items-center overflow-hidden">
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
                  className="mr-3 h-11 w-11 rounded-xl bg-black text-white hover:bg-neutral-800 transition-all flex-shrink-0 group-focus-within:bg-[#A5A0FF] group-focus-within:text-white"
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
                  className="rounded-full gap-2 text-[13px] border-neutral-200 bg-white text-neutral-600 hover:bg-black hover:text-white hover:border-black transition-all duration-300 hover:scale-105 hover:shadow-md fade-in-up h-9 px-4"
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
                    Transforma cualquier idea en arte visual. Elige entre más de 20 estilos artísticos o deja volar tu imaginación desde cero.
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
                    { icon: Palette, label: "Boceto", bg: "bg-orange-50 border-orange-200 text-orange-500 hover:bg-orange-100 hover:border-orange-300 hover:text-orange-600" },
                    { icon: Gift, label: "Festivo", bg: "bg-emerald-50 border-emerald-200 text-emerald-500 hover:bg-emerald-100 hover:border-emerald-300 hover:text-emerald-600" },
                    { icon: Drama, label: "Dramático", bg: "bg-violet-50 border-violet-200 text-violet-500 hover:bg-violet-100 hover:border-violet-300 hover:text-violet-600" },
                    { icon: Wand2, label: "Magia", bg: "bg-pink-50 border-pink-200 text-pink-500 hover:bg-pink-100 hover:border-pink-300 hover:text-pink-600" },
                  ].map((s) => (
                    <div key={s.label} className="flex flex-col items-center gap-2 min-w-[72px] cursor-pointer group/style" onClick={() => setLocation("/login")}>
                      <div className={`w-16 h-16 md:w-[76px] md:h-[76px] rounded-2xl ${s.bg} border flex items-center justify-center transition-all duration-300 group-hover/style:scale-110 group-hover/style:shadow-md`}>
                        <s.icon className="w-8 h-8 opacity-90 transition-opacity" strokeWidth={1.5} />
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
      <div className="border-y border-neutral-100 bg-neutral-50/50 py-7 overflow-hidden relative">
        <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-neutral-50/50 to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-neutral-50/50 to-transparent z-10 pointer-events-none" />
        <div className="flex items-center gap-16 animate-marquee whitespace-nowrap opacity-70 hover:opacity-100 transition-opacity duration-500">
          {[...marqueeLogos, ...marqueeLogos].map((name, i) => (
            <div key={i} className="flex items-center gap-2 flex-shrink-0 grayscale hover:grayscale-0 transition-all duration-300 cursor-default">
              <div className="w-7 h-7 rounded-[10px] bg-white border border-neutral-200 shadow-sm flex items-center justify-center text-[13px] font-black text-neutral-900 font-sans">
                {name.charAt(0)}
              </div>
              <span className="text-[17px] font-bold text-neutral-400 tracking-tight select-none">
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ════════════════════ FINAL CTA ════════════════════ */}
      <section ref={ctaReveal.ref} className="py-24 md:py-32 px-5 relative overflow-hidden">
        <div className="absolute inset-0 bg-black" />
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }} />

        <div className={`relative max-w-3xl mx-auto text-center ${rv(ctaReveal.visible)}`}>
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight mb-6">
            El futuro de la productividad<br />empieza aquí
          </h2>
          <p className="text-lg text-white/60 mb-10 max-w-xl mx-auto font-medium">
            Únete a más de 10 millones de personas que ya amplifican su potencial con ILIAGPT. Gratis, para siempre.
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
          <p className="text-xs text-white/30 mt-6 font-medium">Sin tarjeta de crédito requerida — Configuración en 30 segundos</p>
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
                La plataforma de inteligencia artificial más avanzada del mundo hispanohablante.
              </p>
            </div>
            {[
              {
                title: "Producto", links: [
                  { label: "Precios", to: "/pricing" },
                  { label: "Descargar", to: "/download" },
                  { label: "Business", to: "/business" },
                  { label: "Imagenes", to: "/login" },
                ]
              },
              {
                title: "Recursos", links: [
                  { label: "Aprender", to: "/learn" },
                  { label: "Sobre nosotros", to: "/about" },
                  { label: "Blog", to: "/learn" },
                ]
              },
              {
                title: "Soporte", links: [
                  { label: "Centro de ayuda", to: "/about" },
                  { label: "Contacto", to: "/about" },
                  { label: "Status", to: "/about" },
                ]
              },
              {
                title: "Legal", links: [
                  { label: "Términos de uso", to: "/terms", isLink: true },
                  { label: "Privacidad", to: "/privacy-policy", isLink: true },
                  { label: "Cookies", to: "/privacy-policy", isLink: true },
                ]
              },
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
              <Link href="/terms" className="underline hover:text-black transition-colors">Términos</Link>{" "}
              y reconoces nuestra{" "}
              <Link href="/privacy-policy" className="underline hover:text-black transition-colors">Política de privacidad</Link>.
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
