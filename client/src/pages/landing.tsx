import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paperclip, Search, BookOpen, Image, Mic, X, ChevronDown, HelpCircle } from "lucide-react";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [showPromo, setShowPromo] = useState(true);

  const handleSubmit = () => {
    if (inputValue.trim()) {
      setLocation("/login");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 md:px-8 h-16 border-b">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center">
            <span className="text-background text-sm font-bold">S</span>
          </div>
          <span className="font-semibold">Sira GPT</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">Sobre nosotros</a>
          <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">Aprender</a>
          <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">Business</a>
          <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">Precios</a>
          <a href="#" className="text-primary hover:text-primary/80 transition-colors">Imágenes</a>
          <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">Descargar</a>
        </nav>

        <div className="flex items-center gap-3">
          <Button 
            variant="default"
            className="rounded-full"
            onClick={() => setLocation("/login")}
            data-testid="button-header-login"
          >
            Inicia sesión
          </Button>
          <Button 
            variant="outline"
            className="rounded-full hidden sm:flex"
            onClick={() => setLocation("/signup")}
            data-testid="button-header-signup"
          >
            Suscríbete gratis
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full">
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-8">
          <h1 className="text-3xl md:text-4xl font-semibold text-center">
            ¿Con qué puedo ayudarte?
          </h1>

          <div className="space-y-4">
            <div className="relative">
              <Input
                placeholder="Pregunta lo que quieras"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className="h-14 px-4 pr-12 text-base rounded-2xl border-2"
                data-testid="input-landing-search"
              />
            </div>

            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Button 
                variant="outline" 
                className="rounded-full gap-2 text-sm"
                onClick={() => setLocation("/login")}
                data-testid="button-attach"
              >
                <Paperclip className="h-4 w-4" />
                Adjuntar
              </Button>
              <Button 
                variant="outline" 
                className="rounded-full gap-2 text-sm"
                onClick={() => setLocation("/login")}
                data-testid="button-search"
              >
                <Search className="h-4 w-4" />
                Buscar
              </Button>
              <Button 
                variant="outline" 
                className="rounded-full gap-2 text-sm"
                onClick={() => setLocation("/login")}
                data-testid="button-study"
              >
                <BookOpen className="h-4 w-4" />
                Estudiemos
              </Button>
              <Button 
                variant="outline" 
                className="rounded-full gap-2 text-sm"
                onClick={() => setLocation("/login")}
                data-testid="button-create-image"
              >
                <Image className="h-4 w-4" />
                Crear imagen
              </Button>
              <Button 
                variant="outline" 
                className="rounded-full gap-2 text-sm"
                onClick={() => setLocation("/login")}
                data-testid="button-voice"
              >
                <Mic className="h-4 w-4" />
                Voz
              </Button>
            </div>
          </div>

          {showPromo && (
            <div className="bg-muted/50 rounded-2xl p-4 md:p-6 relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-8 w-8"
                onClick={() => setShowPromo(false)}
                data-testid="button-close-promo"
              >
                <X className="h-4 w-4" />
              </Button>
              
              <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                <div className="flex-1">
                  <h3 className="font-semibold mb-2">Crea tu primera imagen</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    ¿Tienes una idea? Prueba nuestros estilos y filtros seleccionados o imagina algo desde cero.
                  </p>
                  <Button 
                    className="rounded-full"
                    onClick={() => setLocation("/login")}
                    data-testid="button-try-now"
                  >
                    Probar ahora
                  </Button>
                </div>
                
                <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                  <div className="flex flex-col items-center gap-1 min-w-[70px]">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-amber-200 to-amber-400 flex items-center justify-center">
                      <span className="text-2xl">🎨</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Boceto</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 min-w-[70px]">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-green-200 to-green-400 flex items-center justify-center">
                      <span className="text-2xl">🎄</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Retrato festivo</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 min-w-[70px]">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-purple-200 to-purple-400 flex items-center justify-center">
                      <span className="text-2xl">🎭</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Dramático</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 min-w-[70px]">
                    <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gradient-to-br from-pink-200 to-pink-400 flex items-center justify-center">
                      <span className="text-2xl">🧸</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Peluche</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="py-4 text-center text-sm text-muted-foreground border-t">
        Al enviar un mensaje a Sira GPT, un chatbot de IA, aceptas nuestros{" "}
        <a href="#" className="underline hover:text-foreground">Términos</a>
        {" "}y reconoces que leíste nuestra{" "}
        <a href="#" className="underline hover:text-foreground">Política de privacidad</a>.
      </footer>
    </div>
  );
}
