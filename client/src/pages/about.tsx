import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Users, Globe, Shield, Zap, Sparkles } from "lucide-react";

export default function AboutPage() {
    const [, setLocation] = useLocation();

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
                <span className="font-semibold text-white">Sobre Nosotros</span>
                <div className="w-20" /> {/* Spacer for balance */}
            </header>

            {/* Main Content */}
            <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12 overflow-y-auto">
                <div className="w-full max-w-4xl space-y-16">

                    {/* Hero Section */}
                    <section className="text-center fade-in-up">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-purple-300 mb-6">
                            <Sparkles className="h-3 w-3" />
                            <span>Nuestra Misión</span>
                        </div>
                        <h1 className="text-4xl md:text-6xl font-bold mb-6 text-white leading-tight">
                            Democratizando la <br />
                            <span className="text-gradient-premium">Inteligencia Artificial</span>
                        </h1>
                        <p className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
                            En ILIAGPT creemos que el acceso al conocimiento y la creatividad debe ser universal.
                            Estamos construyendo el asistente más intuitivo y potente para potenciar la mente humana.
                        </p>
                    </section>

                    {/* Stats / Values Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
                        {[
                            {
                                icon: Users,
                                title: "Centrado en el Usuario",
                                desc: "Diseñamos para humanos, no para máquinas. Simplicidad por encima de todo."
                            },
                            {
                                icon: Shield,
                                title: "Privacidad Primero",
                                desc: "Tus datos son tuyos. Implementamos seguridad de grado empresarial."
                            },
                            {
                                icon: Globe,
                                title: "Impacto Global",
                                desc: "Rompiendo barreras de idioma y acceso en todo el mundo."
                            }
                        ].map((item, i) => (
                            <div key={i} className="glass-premium p-6 rounded-2xl border border-white/5 hover:border-white/20 transition-all duration-300">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/10 to-transparent flex items-center justify-center mb-4 text-white">
                                    <item.icon className="h-6 w-6" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
                                <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* Team / Story Section */}
                    <div className="glass-premium rounded-3xl p-8 md:p-12 relative overflow-hidden fade-in-up fade-in-up-delay-2">
                        <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                            <div className="flex-1 space-y-4">
                                <h2 className="text-3xl font-bold text-white">Nuestra Historia</h2>
                                <p className="text-zinc-400 leading-relaxed">
                                    Nacimos con una pregunta simple: ¿Qué pasaría si la IA fuera tan fácil de usar como hablar con un amigo?
                                    <br /><br />
                                    Desde nuestros inicios, hemos iterado obsesivamente en la interfaz y la experiencia,
                                    eliminando la fricción tecnológica para que puedas centrarte en lo que importa:
                                    <strong>crear, aprender y resolver.</strong>
                                </p>
                                <Button
                                    onClick={() => setLocation("/signup")}
                                    className="mt-4 rounded-full bg-white text-black hover:bg-zinc-200 transition-colors font-medium px-8"
                                >
                                    Únete al viaje
                                </Button>
                            </div>

                            {/* Visual Element */}
                            <div className="flex-1 flex justify-center">
                                <div className="relative w-64 h-64">
                                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full blur-[60px] opacity-20 animate-pulse-slow" />
                                    <div className="relative z-10 w-full h-full glass-premium rounded-2xl flex items-center justify-center border border-white/10">
                                        <Zap className="h-24 w-24 text-white/20" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 py-8 text-center border-t border-white/5 bg-black/20 backdrop-blur-md">
                <p className="text-zinc-500 text-sm">© 2026 ILIAGPT. Todos los derechos reservados.</p>
            </footer>
        </div>
    );
}
