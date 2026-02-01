import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Download, Apple, Monitor, Smartphone, Chrome, Sparkles, Check } from "lucide-react";

export default function DownloadPage() {
  const [, setLocation] = useLocation();

  const platforms = [
    {
      icon: Apple,
      name: "macOS",
      version: "v2.1.0",
      size: "98 MB",
      requirements: "macOS 11+",
      gradient: "from-zinc-700 to-zinc-900",
      available: true
    },
    {
      icon: Monitor,
      name: "Windows",
      version: "v2.1.0",
      size: "112 MB",
      requirements: "Windows 10+",
      gradient: "from-blue-600 to-blue-800",
      available: true
    },
    {
      icon: Smartphone,
      name: "iOS",
      version: "v2.0.5",
      size: "45 MB",
      requirements: "iOS 15+",
      gradient: "from-purple-600 to-purple-800",
      available: true
    },
    {
      icon: Smartphone,
      name: "Android",
      version: "v2.0.5",
      size: "38 MB",
      requirements: "Android 10+",
      gradient: "from-green-600 to-green-800",
      available: true
    },
    {
      icon: Chrome,
      name: "Extensión Chrome",
      version: "v1.5.0",
      size: "2 MB",
      requirements: "Chrome 90+",
      gradient: "from-amber-500 to-orange-600",
      available: true
    }
  ];

  const features = [
    "Acceso sin conexión a chats guardados",
    "Atajos de teclado nativos",
    "Notificaciones de escritorio",
    "Integración con el sistema",
    "Sincronización automática",
    "Modo oscuro del sistema"
  ];

  return (
    <div className="min-h-screen gradient-animated flex flex-col relative overflow-hidden">
      {/* Floating Orbs */}
      <div className="floating-orb floating-orb-1" />
      <div className="floating-orb floating-orb-2" />
      <div className="floating-orb floating-orb-3" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-white/10 backdrop-blur-sm">
        <Link href="/welcome">
          <Button variant="ghost" className="text-zinc-400 hover:text-white gap-2">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Button>
        </Link>
        <span className="font-semibold text-white">Descargar</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-5xl space-y-12">

          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-green-300 mb-6">
              <Download className="h-3 w-3" />
              <span>Aplicaciones nativas</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 text-white leading-tight">
              ILIAGPT en <span className="text-gradient-premium">todos tus dispositivos</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Descarga la app nativa para una experiencia más rápida y fluida. 
              Disponible para macOS, Windows, iOS y Android.
            </p>
          </section>

          {/* Download Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 fade-in-up fade-in-up-delay-1">
            {platforms.map((platform, i) => (
              <div
                key={i}
                className="glass-premium p-6 rounded-2xl border border-white/10 hover:border-white/20 transition-all duration-300 hover:scale-[1.02]"
              >
                <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${platform.gradient} mb-4`}>
                  <platform.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">{platform.name}</h3>
                <p className="text-xs text-zinc-500 mb-4">
                  {platform.version} • {platform.size} • {platform.requirements}
                </p>
                <Button
                  className="w-full rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20"
                  onClick={() => {
                    // In a real app, this would trigger a download
                    alert(`Descargando ${platform.name}...`);
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Descargar
                </Button>
              </div>
            ))}
          </div>

          {/* Features */}
          <section className="glass-premium rounded-3xl p-8 md:p-12 fade-in-up fade-in-up-delay-2">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white mb-4">
                  ¿Por qué usar la app nativa?
                </h2>
                <ul className="space-y-3">
                  {features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-zinc-300">
                      <Check className="h-4 w-4 text-green-400" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex-1 flex justify-center">
                <div className="relative w-64 h-64">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full blur-[60px] opacity-20 animate-pulse-slow" />
                  <div className="relative z-10 w-full h-full glass-premium rounded-2xl flex items-center justify-center border border-white/10">
                    <Sparkles className="h-16 w-16 text-purple-400" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Web App CTA */}
          <section className="text-center fade-in-up fade-in-up-delay-3">
            <p className="text-zinc-400 mb-4">
              ¿Prefieres usar el navegador?
            </p>
            <Button
              variant="outline"
              className="rounded-full border-white/20 text-white hover:bg-white/10"
              onClick={() => setLocation("/login")}
            >
              Ir a la versión web
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}
