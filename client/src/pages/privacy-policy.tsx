import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Eye, Lock, Database, Trash2 } from "lucide-react";

export default function PrivacyPolicyPage() {
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
            data-testid="button-back-privacy-policy"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Política de Privacidad</h1>
          </div>
        </div>

        <div className="space-y-8 text-sm text-muted-foreground leading-relaxed">
          {/* Intro */}
          <section>
            <p className="text-foreground text-base">
              Última actualización: 4 de febrero de 2025
            </p>
            <p className="mt-3">
              En ILIAGPT, tu privacidad es nuestra prioridad. Esta Política de Privacidad describe cómo
              recopilamos, utilizamos, almacenamos y protegemos tu información personal cuando utilizas
              nuestros servicios.
            </p>
          </section>

          {/* Section 1 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              1. Información que Recopilamos
            </h2>
            <p className="mb-3">Podemos recopilar los siguientes tipos de información:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-foreground">Información de la cuenta:</strong> nombre, dirección de correo electrónico,
                y datos de autenticación cuando creas una cuenta.
              </li>
              <li>
                <strong className="text-foreground">Contenido de conversaciones:</strong> los mensajes que envías y las
                respuestas generadas durante tus interacciones con ILIAGPT.
              </li>
              <li>
                <strong className="text-foreground">Archivos subidos:</strong> documentos, imágenes y otros archivos que
                compartas a través del Servicio.
              </li>
              <li>
                <strong className="text-foreground">Datos de uso:</strong> información sobre cómo interactúas con el Servicio,
                incluyendo funcionalidades utilizadas y patrones de uso.
              </li>
              <li>
                <strong className="text-foreground">Información técnica:</strong> dirección IP, tipo de navegador, dispositivo
                y sistema operativo.
              </li>
            </ul>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              2. Cómo Utilizamos tu Información
            </h2>
            <p className="mb-3">Utilizamos la información recopilada para:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Proporcionar, mantener y mejorar el Servicio.</li>
              <li>Personalizar tu experiencia de usuario.</li>
              <li>Procesar y responder a tus solicitudes y consultas.</li>
              <li>Enviar notificaciones relacionadas con el Servicio.</li>
              <li>Detectar, prevenir y abordar problemas técnicos y de seguridad.</li>
              <li>Cumplir con obligaciones legales aplicables.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3 flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              3. Protección de Datos
            </h2>
            <p>
              Implementamos medidas de seguridad técnicas y organizativas para proteger tu información
              personal contra acceso no autorizado, alteración, divulgación o destrucción. Esto incluye
              cifrado de datos en tránsito y en reposo, controles de acceso estrictos y auditorías
              regulares de seguridad.
            </p>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              4. Compartir Información
            </h2>
            <p className="mb-3">
              No vendemos, alquilamos ni compartimos tu información personal con terceros, excepto en
              las siguientes circunstancias:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Con tu consentimiento explícito.</li>
              <li>Para cumplir con obligaciones legales o responder a solicitudes legales válidas.</li>
              <li>Para proteger los derechos, privacidad, seguridad o propiedad de ILIAGPT y sus usuarios.</li>
              <li>Con proveedores de servicios que nos ayudan a operar el Servicio, bajo acuerdos de confidencialidad.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              5. Retención de Datos
            </h2>
            <p>
              Conservamos tu información personal mientras tu cuenta esté activa o según sea necesario
              para proporcionarte el Servicio. Puedes solicitar la eliminación de tus datos en cualquier
              momento a través de la configuración de tu cuenta o contactándonos directamente.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-primary" />
              6. Tus Derechos
            </h2>
            <p className="mb-3">Tienes derecho a:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Acceder a tu información personal que tenemos almacenada.</li>
              <li>Solicitar la corrección de datos inexactos.</li>
              <li>Solicitar la eliminación de tus datos personales.</li>
              <li>Exportar tus datos en un formato legible por máquina.</li>
              <li>Retirar tu consentimiento para el procesamiento de datos en cualquier momento.</li>
              <li>Presentar una reclamación ante la autoridad de protección de datos correspondiente.</li>
            </ul>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              7. Cookies y Tecnologías Similares
            </h2>
            <p>
              Utilizamos cookies y tecnologías similares para mantener tu sesión activa, recordar tus
              preferencias y mejorar tu experiencia. Puedes gestionar tus preferencias de cookies a
              través de la configuración de tu navegador.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              8. Uso de Datos para Entrenamiento
            </h2>
            <p>
              Por defecto, tus datos no se utilizan para entrenar nuestros modelos de IA. Puedes
              optar por compartir datos de forma voluntaria para mejorar el Servicio a través de la
              configuración de privacidad en tu cuenta.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              9. Cambios en esta Política
            </h2>
            <p>
              Podemos actualizar esta Política de Privacidad periódicamente. Te notificaremos sobre
              cambios significativos mediante un aviso en el Servicio o por correo electrónico. Te
              recomendamos revisar esta política regularmente.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-foreground font-semibold text-base mb-3">
              10. Contacto
            </h2>
            <p>
              Si tienes preguntas o inquietudes sobre esta Política de Privacidad o sobre cómo manejamos
              tus datos, puedes contactarnos a través del Servicio o enviando un correo electrónico a
              nuestro equipo de soporte.
            </p>
          </section>

          {/* Footer */}
          <div className="pt-6 border-t">
            <p className="text-xs text-muted-foreground">
              Al utilizar ILIAGPT, confirmas que has leído y aceptas esta Política de Privacidad y nuestros{" "}
              <span
                onClick={() => setLocation("/terms")}
                className="text-primary hover:underline cursor-pointer"
              >
                Términos de Servicio
              </span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
