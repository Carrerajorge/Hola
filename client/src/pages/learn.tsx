import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BookOpen, Image, Code, Lightbulb, ArrowRight, PlayCircle } from "lucide-react";

export default function LearnPage() {
    const [, setLocation] = useLocation();

    const tutorials = [
        {
            title: "Primeros Pasos",
            desc: "Domina lo básico de ILIAGPT en menos de 5 minutos.",
            icon: BookOpen,
            color: "text-blue-700",
            bg: "bg-blue-50"
        },
        {
            title: "Ingeniería de Prompts",
            desc: "Aprende a escribir instrucciones precisas para resultados perfectos.",
            icon: Code,
            color: "text-violet-700",
            bg: "bg-violet-50"
        },
        {
            title: "Generación de Imágenes",
            desc: "Guía completa para crear arte digital impresionante.",
            icon: Image,
            color: "text-rose-700",
            bg: "bg-rose-50"
        },
        {
            title: "Casos de Uso Pro",
            desc: "Estrategias avanzadas para productividad y negocio.",
            icon: Lightbulb,
            color: "text-amber-800",
            bg: "bg-amber-50"
        }
    ];

    return (
        <div className="min-h-screen landing-luxe flex flex-col relative overflow-hidden">
            {/* Header */}
            <header className="relative z-10 flex items-center justify-between px-4 md:px-8 h-16 border-b border-black/10 bg-white/70 backdrop-blur-md">
                <Link href="/welcome">
                    <Button variant="ghost" className="rounded-full text-zinc-700 hover:text-zinc-900 hover:bg-black/5 gap-2">
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
                        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-zinc-900 tracking-tight">
                            Aprende a{" "}
                            <span className="inline-flex items-center px-2 py-1 rounded-xl bg-zinc-100 text-zinc-900">
                                Crear Magic
                            </span>
                        </h1>
                        <p className="text-lg text-zinc-600 max-w-2xl mx-auto">
                            Descubre tutoriales, guías y trucos para sacar el máximo partido a tu asistente de IA.
                        </p>
                    </section>

                    {/* Featured Video Card - Large */}
                    <div className="rounded-3xl border border-black/10 bg-white shadow-sm overflow-hidden fade-in-up fade-in-up-delay-1 card-lift">
                        <div className="relative aspect-video bg-zinc-100 overflow-hidden flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/35 z-10" />
                            <img
                                src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1200&auto=format&fit=crop"
                                alt="AI Learning"
                                className="absolute inset-0 w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 z-20 flex items-center justify-center">
                                <div className="rounded-full bg-white/90 border border-white/70 p-4 shadow-sm">
                                    <PlayCircle className="h-12 w-12 text-zinc-900" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6">
                            <span className="inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-zinc-900">
                                VIDEO DESTACADO
                            </span>
                            <h3 className="mt-3 text-2xl font-bold text-zinc-900">Introducción a ILIAGPT 2.0</h3>
                            <p className="mt-1 text-zinc-600">Un recorrido completo por todas las nuevas funcionalidades.</p>
                        </div>
                    </div>

                    {/* Tutorials Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fade-in-up fade-in-up-delay-2">
                        {tutorials.map((item, i) => (
                            <div
                                key={i}
                                className="p-6 rounded-2xl border border-black/10 bg-white shadow-sm hover:shadow-md hover:border-black/20 transition-all duration-300 group cursor-pointer"
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`p-3 rounded-xl ${item.bg} ${item.color} border border-black/5`}>
                                        <item.icon className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-lg font-bold text-zinc-900 mb-2 transition-colors">{item.title}</h4>
                                        <p className="text-sm text-zinc-600 leading-relaxed mb-4">{item.desc}</p>
                                        <div className="flex items-center text-xs font-medium text-zinc-700 group-hover:text-zinc-900 transition-colors">
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
            <section className="relative z-10 py-16 px-4 text-center border-t border-black/10 bg-white/70 backdrop-blur-md">
                <h2 className="text-2xl font-bold text-zinc-900 mb-4">¿Listo para empezar?</h2>
                <Button
                    onClick={() => setLocation("/signup")}
                    className="rounded-full bg-black text-white hover:bg-zinc-900 border border-black/10 shadow-sm transition-all duration-300 px-8 py-6 text-lg"
                >
                    Crear cuenta gratis
                </Button>
            </section>
        </div>
    );
}
