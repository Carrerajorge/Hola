import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Download, Apple, Monitor, Chrome, Check } from "lucide-react";

export default function DownloadPage() {
  const [, setLocation] = useLocation();

  const platforms = [
    {
      icon: Apple,
      name: "macOS",
      version: "v2.1.0",
      size: "98 MB",
      requirements: "macOS 11+",
      available: true,
      downloadUrl: "/releases/ILIAGPT-macOS-v2.1.0.dmg",
      filename: "ILIAGPT-macOS-v2.1.0.dmg",
    },
    {
      icon: Monitor,
      name: "Windows",
      version: "v2.1.0",
      size: "112 MB",
      requirements: "Windows 10+",
      available: true,
      downloadUrl: "/releases/ILIAGPT-Windows-v2.1.0.exe",
      filename: "ILIAGPT-Windows-v2.1.0.exe",
    },
    {
      icon: Chrome,
      name: "Extensión Chrome",
      version: "v1.5.0",
      size: "2 MB",
      requirements: "Chrome 90+",
      available: true,
      downloadUrl: "/releases/ILIAGPT-Chrome-Extension-v1.5.0.zip",
      filename: "ILIAGPT-Chrome-Extension-v1.5.0.zip",
    },
  ];

  const features = [
    "Descarga inmediata sin pasos extra",
    "Instalación limpia y rápida",
    "Compatibilidad validada por versión",
    "Actualizaciones directas desde ILIAGPT",
    "Experiencia optimizada para rendimiento",
    "Entrega segura de artefactos oficiales",
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col relative">
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <Button asChild variant="ghost" className="gap-2 text-zinc-300 hover:text-white hover:bg-zinc-800">
          <Link href="/welcome">
            <ChevronLeft className="h-4 w-4" />
            Volver
          </Link>
        </Button>
        <span className="font-semibold text-zinc-100">Descargas</span>
        <div className="w-20" />
      </header>

      <main className="relative flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-5xl space-y-12">
          <section className="text-center fade-in-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-xs font-medium text-zinc-200 mb-6 shadow-sm">
              <Download className="h-3 w-3" />
              <span>Builds oficiales</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6 text-white leading-[1.05]">
              Descarga <span className="text-cyan-400">ILIAGPT</span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Versiones listas para instalar. Profesional, minimalista y directo a producción.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 fade-in-up fade-in-up-delay-1">
            {platforms.map((platform) => (
              <div
                key={platform.name}
                className="group p-6 rounded-2xl border border-zinc-800 bg-zinc-900/80 shadow-sm transition-all duration-200 hover:shadow-xl hover:border-cyan-500/60"
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="inline-flex p-3 rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100">
                    <platform.icon className="h-6 w-6" />
                  </div>
                  {platform.available ? (
                    <span className="mt-1 inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                      Disponible
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
                      Próximamente
                    </span>
                  )}
                </div>

                <h3 className="text-xl font-semibold text-zinc-100 mb-1 transition-colors group-hover:text-cyan-400">
                  {platform.name}
                </h3>
                <p className="text-xs text-zinc-400 mb-5">
                  {platform.version} • {platform.size} • {platform.requirements}
                </p>

                <Button asChild className="w-full rounded-full bg-cyan-500 text-zinc-950 hover:bg-cyan-400 font-bold">
                  <a href={platform.downloadUrl} download={platform.filename}>
                    <Download className="h-4 w-4 mr-2" />
                    Descargar
                  </a>
                </Button>
              </div>
            ))}
          </div>

          <section className="rounded-3xl p-8 md:p-12 border border-zinc-800 bg-zinc-900/60 fade-in-up fade-in-up-delay-2">
            <div className="grid gap-10 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold text-zinc-100 mb-2 tracking-tight">¿Qué obtienes?</h2>
                <p className="text-sm text-zinc-400 mb-6">Instaladores directos, sin ruido y con enfoque en velocidad.</p>
                <ul className="space-y-3">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-zinc-200">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/40 bg-zinc-950">
                        <Check className="h-4 w-4 text-cyan-400" />
                      </span>
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-cyan-400">ILIAGPT</div>
                  <div className="text-xs text-zinc-500">Release channel</div>
                </div>
                <div className="mt-6 space-y-4">
                  <div className="h-3 w-5/6 rounded-full bg-zinc-800" />
                  <div className="h-3 w-4/6 rounded-full bg-zinc-800" />
                  <div className="h-3 w-3/6 rounded-full bg-zinc-800" />
                </div>
              </div>
            </div>
          </section>

          <section className="text-center fade-in-up fade-in-up-delay-3">
            <p className="text-zinc-400 mb-4">¿Prefieres usar la versión web?</p>
            <Button
              variant="outline"
              className="rounded-full text-zinc-100 border-zinc-600 hover:bg-zinc-800"
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
