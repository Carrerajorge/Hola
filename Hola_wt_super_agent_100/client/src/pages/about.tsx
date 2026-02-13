import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Globe, Shield, Users, Zap } from "lucide-react";

const VALUES = [
    {
        icon: Users,
        title: "Centrado en el Usuario",
        desc: "Diseñamos para humanos, no para máquinas. Simplicidad por encima de todo.",
    },
    {
        icon: Shield,
        title: "Privacidad Primero",
        desc: "Tus datos son tuyos. Implementamos seguridad de grado empresarial.",
    },
    {
        icon: Globe,
        title: "Impacto Global",
        desc: "Rompiendo barreras de idioma y acceso en todo el mundo.",
    },
] as const;

export default function AboutPage() {
    const [, setLocation] = useLocation();

    return (
        <div className="min-h-screen paper-grid flex flex-col">
            <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-8 h-16 border-b border-border bg-background/80 backdrop-blur-sm">
                <Button
                    variant="ghost"
                    className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    onClick={() => setLocation("/welcome")}
                >
                    <ChevronLeft className="h-4 w-4" />
                    Volver
                </Button>
                <span className="text-sm font-semibold text-foreground">Sobre nosotros</span>
                <div className="w-20" /> {/* Spacer for balance */}
            </header>

            {/* Main Content */}
            <main className="relative z-0 flex-1 px-4 py-14 md:py-16">
                <div className="mx-auto w-full max-w-5xl space-y-16">
                    {/* Hero */}
                    <section className="text-center fade-in-up">
                        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" />
                            Nuestra Misión
                        </div>

                        <h1 className="mt-6 text-4xl md:text-6xl font-semibold tracking-tight text-foreground leading-[1.05]">
                            Democratizamos la
                            <br className="hidden md:block" />{" "}
                            <span className="relative inline-block">
                                <span className="absolute inset-x-0 -bottom-1 h-3 md:h-4 rounded bg-muted -z-10" />
                                Inteligencia Artificial
                            </span>
                        </h1>

                        <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                            En ILIAGPT creemos que el acceso al conocimiento y la creatividad debe ser universal.
                            Estamos construyendo el asistente más intuitivo y potente para potenciar la mente humana.
                        </p>

                        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                            <Button
                                onClick={() => setLocation("/signup")}
                                className="rounded-full px-8"
                            >
                                Únete al viaje
                            </Button>
                            <Button
                                asChild
                                variant="outline"
                                className="rounded-full px-8 bg-background text-foreground hover:bg-muted/40"
                            >
                                <a href="#historia">Conocer más</a>
                            </Button>
                        </div>
                    </section>

                    {/* Values */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 fade-in-up fade-in-up-delay-1">
                        {VALUES.map((item, i) => (
                            <div
                                key={i}
                                className="rounded-2xl border border-border bg-card p-6 shadow-sm hover:bg-muted/20 transition-colors duration-200"
                            >
                                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-foreground">
                                    <item.icon className="h-5 w-5" aria-hidden="true" />
                                </div>
                                <h3 className="text-lg font-semibold tracking-tight text-foreground">{item.title}</h3>
                                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* Story */}
                    <section
                        id="historia"
                        className="scroll-mt-24 rounded-3xl border border-border bg-card p-8 md:p-12 shadow-sm fade-in-up fade-in-up-delay-2"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                            <div className="space-y-4">
                                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
                                    Nuestra{" "}
                                    <span className="inline-flex items-baseline rounded-lg bg-muted px-2 py-0.5 font-bold">
                                        historia
                                    </span>
                                </h2>
                                <p className="text-muted-foreground leading-relaxed">
                                    Nacimos con una pregunta simple: ¿Qué pasaría si la IA fuera tan fácil de usar como
                                    hablar con un amigo?
                                    <br />
                                    <br />
                                    Desde nuestros inicios, hemos iterado obsesivamente en la interfaz y la experiencia,
                                    eliminando la fricción tecnológica para que puedas centrarte en lo que importa:
                                    <span className="font-semibold text-foreground"> crear, aprender y resolver.</span>
                                </p>

                                <div className="pt-2 flex flex-wrap gap-3">
                                    <Button
                                        onClick={() => setLocation("/signup")}
                                        className="rounded-full px-8"
                                    >
                                        Únete al viaje
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 px-8"
                                        onClick={() => setLocation("/welcome")}
                                    >
                                        Explorar
                                    </Button>
                                </div>
                            </div>

                            <div className="mx-auto w-full max-w-md">
                                <div className="relative aspect-square rounded-3xl border border-border bg-background p-8 overflow-hidden">
                                    <div
                                        aria-hidden="true"
                                        className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-muted"
                                    />
                                    <div
                                        aria-hidden="true"
                                        className="absolute -left-28 -bottom-28 h-72 w-72 rounded-full bg-muted"
                                    />
                                    <div className="relative h-full flex flex-col justify-between">
                                        <Zap className="h-10 w-10 text-foreground" />
                                        <div>
                                            <p className="text-xs font-semibold text-muted-foreground tracking-wide">ILIAGPT</p>
                                            <p className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
                                                IA, sin fricción.
                                            </p>
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                Rápida, privada y diseñada para personas.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 py-8 text-center border-t border-border bg-background/70 backdrop-blur-sm">
                <p className="text-muted-foreground text-sm">
                    © {new Date().getFullYear()} ILIAGPT. Todos los derechos reservados.
                </p>
            </footer>
        </div>
    );
}
