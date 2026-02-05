import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TermsPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-terms"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Términos de servicio</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
        <p>
          Al utilizar ILIAGPT aceptas usar el servicio de forma responsable, legal y respetuosa.
        </p>
        <p>
          El contenido generado por IA puede contener errores. Debes verificar cualquier información
          importante antes de tomar decisiones.
        </p>
        <p>
          Nos reservamos el derecho de actualizar estos términos para mejorar la seguridad, la
          calidad y el cumplimiento normativo del servicio.
        </p>
      </div>
    </div>
  );
}
