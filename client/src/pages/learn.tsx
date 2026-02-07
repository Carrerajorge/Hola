import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BookOpen, Video, Code, Lightbulb, ArrowRight, PlayCircle, Sparkles, Users, Clock, Star, Zap } from "lucide-react";

export default function LearnPage() {
    const [, setLocation] = useLocation();

    const tutorials = [
        {
            title: "Primeros Pasos",
            desc: "Domina lo básico de ILIAGPT en menos de 5 minutos.",
            icon: BookOpen,
            color: "text-violet-600",
            bg: "from-violet-500/15 to-purple-500/10",
            duration: "5 min",
            level: "Básico"
        },
        {
            title: "Ingeniería de Prompts",
            desc: "Aprende a escribir instrucciones precisas para resultados perfectos.",
            icon: Code,
            color: "text-fuchsia-600",
            bg: "from-fuchsia-500/15 to-purple-500/10",
            duration: "12 min",
            level: "Intermedio"
        },
        {
            title: "Generación de Imágenes",
            desc: "Guía completa para crear arte digital impresionante.",
            icon: Video,
            color: "text-purple-600",
            bg: "from-purple-500/15 to-violet-500/10",
            duration: "8 min",
            level: "Intermedio"
        },
        {
            title: "Casos de Uso Pro",
            desc: "Estrategias avanzadas para productividad y negocio.",
            icon: Lightbulb,
            color: "text-pink-600",
            bg: "from-pink-500/15 to-fuchsia-500/10",
            duration: "15 min",
            level: "Avanzado"
        }
    ];

    const stats = [
        { value: "50K+", label: "Usuarios activos", icon: Users },
        { value: "200+", label: "Tutoriales", icon: BookOpen },
        { value: "4.9", label: "Valoración", icon: Star },
        { value: "24/7", label: "Disponible", icon: Clock },
    ];

    return (
        <div className="min-h-screen bg-white cyber-grid flex flex-col relative overflow-hidden">
            {/* Futuristic background orbs */}
            <div className="floating-orb-light floating-orb-light-1" />
            <div className="floating-orb-light floating-orb-light-2" />
            <div className="floating-orb-light floating-orb-light-3" />

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-purple-200/30 bg-white/80 backdrop-blur-xl">
                <Link href="/welcome">
                    <Button variant="ghost" className="text-zinc-500 hover:text-fuchsia-600 hover:bg-fuchsia-50 gap-2">
                        <ChevronLeft className="h-4 w-4" />
                        Volver
                    </Button>
                </Link>
                <span className="font-semibold text-zinc-900">Centro de Aprendizaje</span>
                <div className="w-20" />
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
                <div className="w-full max-w-5xl space-y-14">

                    {/* Hero Section */}
                    <section className="text-center fade-in-up space-y-5">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-fuchsia-50 border border-fuchsia-200/60">
                            <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />
                            <span className="text-xs font-semibold text-fuchsia-600 uppercase tracking-wider">Centro de Aprendizaje</span>
                        </div>
                        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight">
                            <span className="text-zinc-900">Aprende a </span>
                            <span className="text-futuristic">Crear Magic</span>
                        </h1>
                        <p className="text-base md:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
                            Descubre tutoriales, guías y trucos para sacar el máximo partido a tu asistente de IA.
                        </p>
                    </section>

                    {/* Neon line separator */}
                    <div className="neon-line-animated max-w-md mx-auto" />

                    {/* Stats Row */}
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-4 fade-in-up fade-in-up-delay-1">
                        {stats.map((stat) => (
                            <div key={stat.label} className="glass-luxe rounded-2xl p-5 text-center neon-border group">
                                <stat.icon className="h-5 w-5 mx-auto mb-2 text-fuchsia-500 group-hover:scale-110 transition-transform" />
                                <div className="stat-number text-2xl md:text-3xl font-bold mb-1">{stat.value}</div>
                                <div className="text-xs text-zinc-400 font-medium">{stat.label}</div>
                            </div>
                        ))}
                    </section>

                    {/* Featured Video Card - Large */}
                    <div className="glass-luxe rounded-3xl p-1.5 overflow-hidden fade-in-up fade-in-up-delay-1 group cursor-pointer neon-border hover:shadow-2xl hover:shadow-fuchsia-200/15 transition-all duration-500">
                        <div className="relative aspect-video rounded-2xl bg-zinc-900 overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70 z-10" />
                            <img
                                src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1200&auto=format&fit=crop"
                                alt="AI Learning"
                                className="absolute inset-0 w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-700"
                            />
                            <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-600/10 to-purple-700/10 z-10 group-hover:from-fuchsia-600/20 group-hover:to-purple-700/20 transition-all duration-500" />

                            {/* Play button with neon glow */}
                            <div className="relative z-20">
                                <div className="absolute inset-0 bg-fuchsia-500/30 rounded-full blur-xl scale-150 group-hover:bg-fuchsia-500/40 transition-all" />
                                <PlayCircle className="relative h-20 w-20 text-white/90 transition-all duration-300 group-hover:scale-110 group-hover:text-fuchsia-300 drop-shadow-lg" />
                            </div>

                            <div className="absolute bottom-6 left-6 z-20">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-fuchsia-600 to-purple-700 text-white text-xs font-bold rounded-full mb-3 shadow-lg shadow-fuchsia-500/25">
                                    <Star className="h-3 w-3 fill-white" />
                                    VIDEO DESTACADO
                                </span>
                                <h3 className="text-2xl font-bold text-white mb-1">Introducción a ILIAGPT 2.0</h3>
                                <p className="text-zinc-300 text-sm">Un recorrido completo por todas las nuevas funcionalidades.</p>
                            </div>
                        </div>
                    </div>

                    {/* Tutorials Grid */}
                    <section className="space-y-6 fade-in-up fade-in-up-delay-2">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-zinc-900">Guías populares</h2>
                            <button className="text-sm font-medium text-fuchsia-600 hover:text-purple-700 flex items-center gap-1 transition-colors">
                                Ver todas <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {tutorials.map((item, i) => (
                                <div
                                    key={i}
                                    className="glass-luxe p-6 rounded-2xl neon-border group cursor-pointer hover:shadow-xl hover:shadow-fuchsia-100/30 transition-all duration-300"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className={`p-3 rounded-xl bg-gradient-to-br ${item.bg} ${item.color} transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-fuchsia-200/20`}>
                                            <item.icon className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-2">
                                                <h4 className="text-lg font-bold text-zinc-900 group-hover:text-fuchsia-700 transition-colors">{item.title}</h4>
                                            </div>
                                            <p className="text-sm text-zinc-500 leading-relaxed mb-4">{item.desc}</p>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                                                        <Clock className="h-3 w-3" />
                                                        {item.duration}
                                                    </span>
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-600 font-medium border border-fuchsia-200/50">
                                                        {item.level}
                                                    </span>
                                                </div>
                                                <div className="flex items-center text-xs font-medium text-zinc-400 group-hover:text-fuchsia-600 transition-colors">
                                                    <span>Leer guía</span>
                                                    <ArrowRight className="h-3 w-3 ml-1.5 group-hover:translate-x-1 transition-transform" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                </div>
            </main>

            {/* CTA Footer */}
            <section className="relative z-10 py-16 px-4 text-center border-t border-purple-200/30 overflow-hidden">
                {/* Background glow for CTA */}
                <div className="absolute inset-0 bg-gradient-to-t from-fuchsia-50/80 via-transparent to-transparent pointer-events-none" />

                <div className="relative space-y-5">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-fuchsia-50 border border-fuchsia-200/60">
                        <Zap className="h-3 w-3 text-fuchsia-500" />
                        <span className="text-[10px] font-bold text-fuchsia-600 uppercase tracking-wider">Empieza gratis</span>
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold text-zinc-900">¿Listo para empezar?</h2>
                    <p className="text-zinc-400 max-w-md mx-auto">Únete a miles de usuarios que ya crean con IA</p>
                    <Button
                        onClick={() => setLocation("/signup")}
                        className="btn-luxe rounded-full bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-700 text-white border-0
                            shadow-[0_4px_20px_rgba(168,85,247,0.3)] hover:shadow-[0_8px_40px_rgba(168,85,247,0.4)]
                            transition-all duration-300 px-8 py-6 text-lg"
                    >
                        Crear cuenta gratis
                        <ArrowRight className="h-5 w-5 ml-2" />
                    </Button>
                </div>
            </section>
        </div>
    );
}
