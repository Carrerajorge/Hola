import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paperclip, Search, BookOpen, Image, Mic, X, ChevronDown, HelpCircle, Sparkles, Zap, Shield, Globe } from "lucide-react";
import { IliaGPTLogo } from "@/components/iliagpt-logo";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);

  const handleSubmit = () => {
    if (inputValue.trim()) {
      setLocation("/login");
    }
  };

  const features = [
    { icon: Sparkles, label: "Adjuntar", color: "from-purple-500 to-pink-500" },
    { icon: Search, label: "Buscar", color: "from-blue-500 to-cyan-500" },
    { icon: BookOpen, label: "Estudiemos", color: "from-emerald-500 to-teal-500" },
    { icon: Image, label: "Crear imagen", color: "from-orange-500 to-amber-500" },
    { icon: Mic, label: "Voz", color: "from-rose-500 to-pink-500" },
  ];

  return (
    <div className="min-h-screen gradient-animated flex flex-col relative overflow-hidden">
      {/* Floating Orbs */}
      <div className="floating-orb floating-orb-1" />
      <div className="floating-orb floating-orb-2" />
      <div className="floating-orb floating-orb-3" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-white/10 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <IliaGPTLogo size={32} />
          <span className="font-semibold text-white">ILIAGPT</span>
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <span onClick={() => setLocation("/about")} className="text-zinc-400 hover:text-white transition-colors duration-200 cursor-pointer">Sobre nosotros</span>
          <span onClick={() => setLocation("/learn")} className="text-zinc-400 hover:text-white transition-colors duration-200 cursor-pointer">Aprender</span>
          <span onClick={() => setLocation("/business")} className="text-zinc-400 hover:text-white transition-colors duration-200 cursor-pointer">Business</span>
          <span onClick={() => setLocation("/pricing")} className="text-zinc-400 hover:text-white transition-colors duration-200 cursor-pointer">Precios</span>
          <span onClick={() => setLocation("/login")} className="text-purple-400 hover:text-purple-300 transition-colors duration-200 cursor-pointer">Imágenes</span>
          <span onClick={() => setLocation("/download")} className="text-zinc-400 hover:text-white transition-colors duration-200 cursor-pointer">Descargar</span>
        </nav>

        <div className="flex items-center gap-3">
          <Button
            className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 
              border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesión
          </Button>
          <Button
            variant="outline"
            className="rounded-full hidden sm:flex border-white/20 text-white hover:bg-white/10 hover:border-white/40 transition-all duration-300"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscríbete gratis
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full text-zinc-400 hover:text-white hover:bg-white/10">
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl space-y-10">
          {/* Hero Title */}
          <div className="text-center fade-in-up">
            <h1 className="text-4xl md:text-6xl font-bold mb-4">
              <span className="text-white">¿Con qué puedo </span>
              <span className="text-gradient-premium">ayudarte?</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto">
              El asistente de IA más inteligente para crear, investigar y aprender
            </p>
          </div>

          {/* Search Input */}
          <div className="space-y-6 fade-in-up fade-in-up-delay-1">
            <div className="relative">
              <div className="glass-premium rounded-2xl p-1">
                <Input
                  placeholder="Pregunta lo que quieras..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-16 px-6 text-lg bg-transparent border-0 text-white placeholder:text-zinc-500 
                    focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="input-landing-search"
                />
              </div>
              {/* Subtle glow effect */}
              <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-blue-500/20 blur-xl opacity-50" />
            </div>

            {/* Feature Buttons */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {features.map((feature, index) => (
                <Button
                  key={feature.label}
                  variant="outline"
                  className={`rounded-full gap-2 text-sm border-white/20 bg-white/5 text-white
                    hover:bg-white/10 hover:border-white/40 transition-all duration-300
                    hover:scale-105 hover:shadow-lg fade-in-up`}
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
            <div className="glass-premium rounded-3xl p-6 md:p-8 relative fade-in-up fade-in-up-delay-3 card-lift">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 h-8 w-8 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>

              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Nuevo</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-zinc-400 mb-5 leading-relaxed">
                    ¿Tienes una idea? Prueba nuestros estilos y filtros seleccionados o imagina algo desde cero.
                  </p>
                  <Button
                    className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 
                      border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 
                      transition-all duration-300 btn-premium"
                    onClick={() => setLocation("/login")}
                    data-testid="button-try-now"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Probar ahora
                  </Button>
                </div>

                {/* Style Cards */}
                <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0">
                  {[
                    { emoji: "🎨", label: "Boceto", gradient: "from-amber-500/30 to-orange-500/30" },
                    { emoji: "🎄", label: "Festivo", gradient: "from-emerald-500/30 to-green-500/30" },
                    { emoji: "🎭", label: "Dramático", gradient: "from-purple-500/30 to-violet-500/30" },
                    { emoji: "🧸", label: "Peluche", gradient: "from-pink-500/30 to-rose-500/30" },
                  ].map((style) => (
                    <div
                      key={style.label}
                      className="flex flex-col items-center gap-2 min-w-[70px] cursor-pointer group"
                      onClick={() => setLocation("/login")}
                    >
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br ${style.gradient} 
                        flex items-center justify-center border border-white/10
                        transition-all duration-300 group-hover:scale-110 group-hover:border-white/30
                        group-hover:shadow-lg`}>
                        <span className="text-2xl">{style.emoji}</span>
                      </div>
                      <span className="text-xs text-zinc-400 group-hover:text-white transition-colors">{style.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trust Indicators */}
          <div className="flex items-center justify-center gap-8 text-zinc-500 text-sm fade-in-up fade-in-up-delay-4">
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
      <footer className="relative z-10 py-4 text-center text-sm text-zinc-500 border-t border-white/10 backdrop-blur-sm">
        Al enviar un mensaje a ILIAGPT, un chatbot de IA, aceptas nuestros{" "}
        <a href="#" className="text-zinc-400 hover:text-white underline transition-colors">Términos</a>
        {" "}y reconoces que leíste nuestra{" "}
        <a href="#" className="text-zinc-400 hover:text-white underline transition-colors">Política de privacidad</a>.
      </footer>
    </div>
  );
}

