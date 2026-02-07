import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Download, Apple, Monitor, Smartphone, Chrome, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function DownloadPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const platforms = [
    {
      icon: Apple,
      name: "macOS",
      version: "v2.1.0",
      size: "98 MB",
      requirements: "macOS 11+",
      available: true
    },
    {
      icon: Monitor,
      name: "Windows",
      version: "v2.1.0",
      size: "112 MB",
      requirements: "Windows 10+",
      available: true
    },
    {
      icon: Smartphone,
      name: "iOS",
      version: "v2.0.5",
      size: "45 MB",
      requirements: "iOS 15+",
      available: true
    },
    {
      icon: Smartphone,
      name: "Android",
      version: "v2.0.5",
      size: "38 MB",
      requirements: "Android 10+",
      available: true
    },
    {
      icon: Chrome,
      name: "Extensión Chrome",
      version: "v1.5.0",
      size: "2 MB",
      requirements: "Chrome 90+",
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
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col relative">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-zinc-200 bg-white/80 backdrop-blur-sm">
        <Button
          asChild
          variant="ghost"
          className="gap-2 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100"
        >
          <Link href="/welcome">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Link>
        </Button>
        <span className="font-semibold text-zinc-900">Descargar</span>
        <div className="w-20" />
      </header>

      {/* Main Content */}
      <main className="relative flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-5xl space-y-12">

          {/* Hero Section */}
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-sky-200 text-xs font-medium text-sky-700 mb-6 shadow-sm">
              <Download className="h-3 w-3" />
              <span>Aplicaciones nativas</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-semibold tracking-tight mb-6 text-zinc-900 leading-[1.05]">
              ILIAGPT en{" "}
              <span className="bg-gradient-to-r from-sky-700 via-cyan-600 to-emerald-600 bg-clip-text text-transparent">
                todos tus dispositivos
              </span>
            </h1>
            <p className="text-lg text-zinc-600 max-w-2xl mx-auto leading-relaxed">
              Descarga la app nativa para una experiencia más rápida y fluida. 
              Disponible para macOS, Windows, iOS y Android.
            </p>
          </section>

          {/* Download Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 fade-in-up fade-in-up-delay-1">
            {platforms.map((platform) => (
              <div
                key={platform.name}
                className="group p-6 rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:border-zinc-300"
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="inline-flex p-3 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-900">
                    <platform.icon className="h-6 w-6" />
                  </div>
                  {platform.available ? (
                    <span className="mt-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                      Disponible
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                      Próximamente
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-semibold text-zinc-900 mb-1 transition-colors group-hover:text-sky-700">{platform.name}</h3>
                <p className="text-xs text-zinc-600 mb-5">
                  {platform.version} • {platform.size} • {platform.requirements}
                </p>
                <Button
                  className="w-full rounded-full"
                  disabled={!platform.available}
                  onClick={() => {
                    // In a real app, this should trigger a real download.
                    toast({
                      title: "Descarga iniciada",
                      description: `Preparando ${platform.name} (${platform.version})`,
                    });
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {platform.available ? "Descargar" : "No disponible"}
                </Button>
              </div>
            ))}
          </div>

          {/* Features */}
          <section className="rounded-3xl p-8 md:p-12 border border-zinc-200 bg-zinc-50 fade-in-up fade-in-up-delay-2">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold text-zinc-900 mb-2 tracking-tight">
                  ¿Por qué usar la app nativa?
                </h2>
                <p className="text-sm text-zinc-600 mb-6">
                  Menos fricción, más velocidad. Todo integrado con tu sistema.
                </p>
                <ul className="space-y-3">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-zinc-800">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sky-200 bg-white">
                        <Check className="h-4 w-4 text-sky-700" />
                      </span>
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold bg-gradient-to-r from-sky-700 via-cyan-600 to-emerald-600 bg-clip-text text-transparent">
                    ILIAGPT
                  </div>
                  <div className="text-xs text-zinc-500">Apps oficiales</div>
                </div>
                <div className="mt-6 space-y-4">
                  <div className="h-3 w-5/6 rounded-full bg-zinc-100" />
                  <div className="h-3 w-4/6 rounded-full bg-zinc-100" />
                  <div className="h-3 w-3/6 rounded-full bg-zinc-100" />
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-xs font-medium text-zinc-900">Sincronización</div>
                      <div className="mt-2 h-2 w-3/4 rounded-full bg-zinc-100" />
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <div className="text-xs font-medium text-zinc-900">Notificaciones</div>
                      <div className="mt-2 h-2 w-2/3 rounded-full bg-zinc-100" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Web App CTA */}
          <section className="text-center fade-in-up fade-in-up-delay-3">
            <p className="text-zinc-600 mb-4">
              ¿Prefieres usar el navegador?
            </p>
            <Button
              variant="outline"
              className="rounded-full text-zinc-900 border-zinc-300 hover:bg-zinc-100"
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
