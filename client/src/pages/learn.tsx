import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BookOpen, Video, Code, Lightbulb, ArrowRight, PlayCircle, Sparkles } from "lucide-react";

export default function LearnPage() {
    const [, setLocation] = useLocation();

    const tutorials = [
        {
            title: "Primeros Pasos",
            desc: "Domina lo básico de ILIAGPT en menos de 5 minutos.",
            icon: BookOpen,
            color: "text-violet-600",
            bg: "bg-violet-100",
            border: "border-violet-200/60",
            glow: "group-hover:shadow-violet-200/40"
        },
        {
            title: "Ingeniería de Prompts",
            desc: "Aprende a escribir instrucciones precisas para resultados perfectos.",
            icon: Code,
            color: "text-fuchsia-600",
            bg: "bg-fuchsia-100",
            border: "border-fuchsia-200/60",
            glow: "group-hover:shadow-fuchsia-200/40"
        },
        {
            title: "Generación de Imágenes",
            desc: "Guía completa para crear arte digital impresionante.",
            icon: Video,
            color: "text-purple-600",
            bg: "bg-purple-100",
            border: "border-purple-200/60",
            glow: "group-hover:shadow-purple-200/40"
        },
        {
            title: "Casos de Uso Pro",
            desc: "Estrategias avanzadas para productividad y negocio.",
            icon: Lightbulb,
            color: "text-pink-600",
            bg: "bg-pink-100",
            border: "border-pink-200/60",
            glow: "group-hover:shadow-pink-200/40"
        }
    ];

    return (
        <div className="min-h-screen bg-white flex flex-col relative overflow-hidden">
            {/* Futuristic background orbs */}
            <div className="floating-orb-light floating-orb-light-1" />
            <div className="floating-orb-light floating-orb-light-2" />
            <div className="floating-orb-light floating-orb-light-3" />

            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-purple-200/40 bg-white/70 backdrop-blur-md">
                <Link href="/welcome">
                    <Button variant="ghost" className="text-zinc-500 hover:text-zinc-900 gap-2">
                        <ChevronLeft className="h-4 w-4" />
                        Volver
                    </Button>
                </Link>
                <span className="font-semibold text-zinc-900">Centro de Aprendizaje</span>
                <div className="w-20" />
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
                <div className="w-full max-w-5xl space-y-12">

                    {/* Hero Section */}
                    <section className="text-center fade-in-up">
                        <div className="flex items-center justify-center gap-2 mb-4">
                            <Sparkles className="h-5 w-5 text-fuchsia-500" />
                            <span className="text-xs font-semibold text-fuchsia-500 uppercase tracking-widest">Centro de Aprendizaje</span>
                            <Sparkles className="h-5 w-5 text-fuchsia-500" />
                        </div>
                        <h1 className="text-4xl md:text-6xl font-bold mb-5">
                            <span className="text-zinc-900">Aprende a </span>
                            <span className="text-futuristic">Crear Magic</span>
                        </h1>
                        <p className="text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed">
                            Descubre tutoriales, guías y trucos para sacar el máximo partido a tu asistente de IA.
                        </p>
                    </section>

                    {/* Featured Video Card - Large */}
                    <div className="glass-luxe rounded-3xl p-1.5 overflow-hidden fade-in-up fade-in-up-delay-1 group cursor-pointer hover:shadow-2xl hover:shadow-fuchsia-200/20 transition-all duration-500">
                        <div className="relative aspect-video rounded-2xl bg-zinc-900 overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70 z-10" />
                            <img
                                src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1200&auto=format&fit=crop"
                                alt="AI Learning"
                                className="absolute inset-0 w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-700"
                            />
                            <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-600/10 to-purple-700/10 z-10 group-hover:from-fuchsia-600/20 group-hover:to-purple-700/20 transition-all duration-500" />
                            <PlayCircle className="h-20 w-20 text-white/90 z-20 transition-all duration-300 group-hover:scale-110 group-hover:text-fuchsia-300 drop-shadow-lg" />

                            <div className="absolute bottom-6 left-6 z-20">
                                <span className="inline-block px-3 py-1 bg-gradient-to-r from-fuchsia-600 to-purple-700 text-white text-xs font-bold rounded-full mb-3 shadow-lg shadow-fuchsia-500/25">VIDEO DESTACADO</span>
                                <h3 className="text-2xl font-bold text-white mb-1">Introducción a ILIAGPT 2.0</h3>
                                <p className="text-zinc-300">Un recorrido completo por todas las nuevas funcionalidades.</p>
                            </div>
                        </div>
                    </div>

                    {/* Tutorials Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 fade-in-up fade-in-up-delay-2">
                        {tutorials.map((item, i) => (
                            <div
                                key={i}
                                className={`bg-white/80 backdrop-blur-sm p-6 rounded-2xl border ${item.border} hover:bg-white hover:border-fuchsia-300/60 transition-all duration-300 group cursor-pointer hover:shadow-xl ${item.glow}`}
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`p-3 rounded-xl ${item.bg} ${item.color} transition-transform duration-300 group-hover:scale-110`}>
                                        <item.icon className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-lg font-bold text-zinc-900 mb-2 group-hover:text-fuchsia-700 transition-colors">{item.title}</h4>
                                        <p className="text-sm text-zinc-500 leading-relaxed mb-4">{item.desc}</p>
                                        <div className="flex items-center text-xs font-medium text-zinc-400 group-hover:text-fuchsia-600 transition-colors">
                                            <span>Leer guía</span>
                                            <ArrowRight className="h-3 w-3 ml-2 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            </main>

            {/* CTA Footer */}
            <section className="relative z-10 py-16 px-4 text-center border-t border-purple-200/40">
                <h2 className="text-2xl font-bold text-zinc-900 mb-2">¿Listo para empezar?</h2>
                <p className="text-zinc-500 mb-6">Únete a miles de usuarios que ya crean con IA</p>
                <Button
                    onClick={() => setLocation("/signup")}
                    className="btn-luxe rounded-full bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-500 hover:to-purple-600
            text-white border border-fuchsia-400/40 shadow-lg shadow-fuchsia-500/25 hover:shadow-xl hover:shadow-fuchsia-500/30 transition-all duration-300 px-8 py-6 text-lg"
                >
                    Crear cuenta gratis
                </Button>
            </section>
        </div>
    );
}
