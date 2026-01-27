import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BookOpen, Video, Code, Lightbulb, ArrowRight, PlayCircle } from "lucide-react";

export default function LearnPage() {
    const [, setLocation] = useLocation();

    const tutorials = [
        {
            title: "Primeros Pasos",
            desc: "Domina lo básico de ILIAGPT en menos de 5 minutos.",
            icon: BookOpen,
            color: "text-blue-400",
            bg: "bg-blue-500/10"
        },
        {
            title: "Ingeniería de Prompts",
            desc: "Aprende a escribir instrucciones precisas para resultados perfectos.",
            icon: Code,
            color: "text-purple-400",
            bg: "bg-purple-500/10"
        },
        {
            title: "Generación de Imágenes",
            desc: "Guía completa para crear arte digital impresionante.",
            icon: Video,
            color: "text-pink-400",
            bg: "bg-pink-500/10"
        },
        {
            title: "Casos de Uso Pro",
            desc: "Estrategias avanzadas para productividad y negocio.",
            icon: Lightbulb,
            color: "text-amber-400",
            bg: "bg-amber-500/10"
        }
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
                <span className="font-semibold text-white">Centro de Aprendizaje</span>
                <div className="w-20" />
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
                <div className="w-full max-w-5xl space-y-12">

                    {/* Hero Section */}
                    <section className="text-center fade-in-up">
                        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-white">
                            Aprende a <span className="text-gradient-premium">Crear Magic</span>
                        </h1>
                        <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                            Descubre tutoriales, guías y trucos para sacar el máximo partido a tu asistente de IA.
                        </p>
                    </section>

                    {/* Featured Video Card - Large */}
                    <div className="glass-premium rounded-3xl p-1 overflow-hidden fade-in-up fade-in-up-delay-1 group cursor-pointer hover:shadow-2xl hover:shadow-purple-500/10 transition-all duration-500">
                        <div className="relative aspect-video rounded-2xl bg-black overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/60 z-10" />
                            <img
                                src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1200&auto=format&fit=crop"
                                alt="AI Learning"
                                className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700"
                            />
                            <PlayCircle className="h-20 w-20 text-white/80 z-20 transition-transform duration-300 group-hover:scale-110 drop-shadow-lg" />

                            <div className="absolute bottom-6 left-6 z-20">
                                <span className="inline-block px-3 py-1 bg-purple-600 text-white text-xs font-bold rounded-full mb-3">VIDEO DETACADO</span>
                                <h3 className="text-2xl font-bold text-white mb-1">Introducción a ILIAGPT 2.0</h3>
                                <p className="text-zinc-300">Un recorrido completo por todas las nuevas funcionalidades.</p>
                            </div>
                        </div>
                    </div>

                    {/* Tutorials Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fade-in-up fade-in-up-delay-2">
                        {tutorials.map((item, i) => (
                            <div
                                key={i}
                                className="glass-premium p-6 rounded-2xl border border-white/5 hover:border-white/20 hover:bg-white/5 transition-all duration-300 group cursor-pointer"
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`p-3 rounded-xl ${item.bg} ${item.color}`}>
                                        <item.icon className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-lg font-bold text-white mb-2 group-hover:text-purple-300 transition-colors">{item.title}</h4>
                                        <p className="text-sm text-zinc-400 leading-relaxed mb-4">{item.desc}</p>
                                        <div className="flex items-center text-xs font-medium text-white/40 group-hover:text-white transition-colors">
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
            <section className="relative z-10 py-16 px-4 text-center border-t border-white/5">
                <h2 className="text-2xl font-bold text-white mb-4">¿Listo para empezar?</h2>
                <Button
                    onClick={() => setLocation("/signup")}
                    className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 
            border-0 shadow-lg shadow-purple-500/25 transition-all duration-300 px-8 py-6 text-lg"
                >
                    Crear cuenta gratis
                </Button>
            </section>
        </div>
    );
}
