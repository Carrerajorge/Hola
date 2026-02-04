import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, FileText, Scale } from "lucide-react";

export default function TermsPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/welcome")}
            data-testid="button-back-terms"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Términos de Servicio</h1>
          </div>
        </div>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          {/* Intro */}
          <section>
            <p className="text-foreground text-base">
              Última actualización: 4 de febrero de 2025
            </p>
            <p className="mt-3">
              Bienvenido a ILIAGPT. Estos Términos de Servicio ("Términos") rigen tu acceso y uso de los
              servicios, aplicaciones y sitios web de ILIAGPT (colectivamente, el "Servicio"). Al utilizar
              el Servicio, aceptas estar sujeto a estos Términos.
            </p>
          </section>

          {/* Section 1 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              1. Aceptación de los Términos
            </h2>
            <p>
              Al acceder o utilizar ILIAGPT, confirmas que has leído, comprendido y aceptas estar vinculado
              por estos Términos. Si no estás de acuerdo con alguno de estos Términos, no deberás acceder
              ni utilizar el Servicio.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              2. Descripción del Servicio
            </h2>
            <p>
              ILIAGPT es un asistente de inteligencia artificial que permite a los usuarios interactuar
              mediante conversaciones de texto, generar contenido, analizar archivos, crear documentos,
              imágenes y otros materiales. El Servicio puede incluir funcionalidades adicionales que se
              añadan periódicamente.
            </p>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              3. Registro y Cuenta
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Para acceder a ciertas funcionalidades del Servicio, es posible que debas crear una cuenta.</li>
              <li>Eres responsable de mantener la confidencialidad de tu cuenta y contraseña.</li>
              <li>Debes proporcionar información precisa y mantenerla actualizada.</li>
              <li>Eres responsable de todas las actividades que ocurran bajo tu cuenta.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              4. Uso Aceptable
            </h2>
            <p className="mb-2">Te comprometes a no utilizar el Servicio para:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Generar contenido ilegal, dañino, amenazante, abusivo o difamatorio.</li>
              <li>Infringir derechos de propiedad intelectual de terceros.</li>
              <li>Distribuir malware, virus o cualquier código malicioso.</li>
              <li>Intentar acceder de forma no autorizada a sistemas o datos.</li>
              <li>Utilizar el Servicio para actividades fraudulentas o engañosas.</li>
              <li>Sobrecargar o interferir con la infraestructura del Servicio.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              5. Contenido Generado
            </h2>
            <p>
              El contenido generado por ILIAGPT se proporciona "tal cual". Aunque nos esforzamos por
              ofrecer respuestas precisas y útiles, no garantizamos la exactitud, integridad o idoneidad
              del contenido generado. Debes verificar la información importante antes de tomar decisiones
              basadas en las respuestas de ILIAGPT.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              6. Propiedad Intelectual
            </h2>
            <p>
              El Servicio y su contenido original, características y funcionalidad son propiedad de
              ILIAGPT y están protegidos por leyes de derechos de autor, marcas registradas y otras
              leyes de propiedad intelectual. El contenido que generes utilizando el Servicio te pertenece,
              sujeto a las limitaciones aplicables.
            </p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              7. Limitación de Responsabilidad
            </h2>
            <p>
              En la medida máxima permitida por la ley aplicable, ILIAGPT no será responsable por daños
              indirectos, incidentales, especiales, consecuentes o punitivos, ni por cualquier pérdida
              de beneficios o ingresos, ya sea incurrida directa o indirectamente, ni por cualquier
              pérdida de datos, uso, fondo de comercio u otras pérdidas intangibles.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              8. Modificaciones
            </h2>
            <p>
              Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios
              entrarán en vigor inmediatamente después de su publicación. Tu uso continuado del Servicio
              después de la publicación de los cambios constituye tu aceptación de los nuevos Términos.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              9. Terminación
            </h2>
            <p>
              Podemos suspender o cancelar tu acceso al Servicio en cualquier momento, sin previo aviso,
              por cualquier motivo, incluyendo, entre otros, el incumplimiento de estos Términos. Puedes
              dejar de utilizar el Servicio en cualquier momento.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              10. Contacto
            </h2>
            <p>
              Si tienes preguntas sobre estos Términos, puedes contactarnos a través del Servicio o
              enviando un correo electrónico a nuestro equipo de soporte.
            </p>
          </section>

          {/* Footer */}
          <div className="pt-6 border-t">
            <p className="text-xs text-muted-foreground">
              Al utilizar ILIAGPT, confirmas que has leído y aceptas estos Términos de Servicio y nuestra{" "}
              <span
                onClick={() => setLocation("/privacy-policy")}
                className="text-primary hover:underline cursor-pointer"
              >
                Política de Privacidad
              </span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
