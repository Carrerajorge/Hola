import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/welcome")}
            data-testid="button-back-terms"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Términos del servicio</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm text-muted-foreground">
        <p>
          Estos términos describen el uso básico de ILIAGPT y se aplican a todas las
          personas que acceden al servicio. Al continuar, aceptas utilizar la plataforma
          de forma responsable y conforme a la ley.
        </p>
        <p>
          No está permitido compartir contenido ilegal, engañoso o que vulnere derechos
          de terceros. Podemos actualizar estos términos para mejorar la seguridad y el
          funcionamiento del producto.
        </p>
        <p>
          Si tienes dudas sobre el uso aceptable, contáctanos antes de publicar contenido
          sensible.
        </p>
      </div>
    </div>
  );
}
