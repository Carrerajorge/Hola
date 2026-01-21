import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Apple, Phone, Loader2, Mail, Sparkles } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Error de autenticación con Google. Por favor intenta de nuevo.",
  no_user: "No se pudo obtener la información del usuario. Por favor intenta de nuevo.",
  login_failed: "Error al iniciar sesión. Por favor intenta de nuevo.",
  invalid_token: "Enlace mágico inválido o expirado.",
  magic_link_expired: "El enlace mágico ha expirado. Solicita uno nuevo.",
  session_error: "Error al crear la sesión. Por favor intenta de nuevo.",
  verification_failed: "Error al verificar el enlace. Por favor intenta de nuevo.",
};

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false);

  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");



  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    if (errorCode && OAUTH_ERROR_MESSAGES[errorCode]) {
      setError(OAUTH_ERROR_MESSAGES[errorCode]);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleContinue = async () => {
    if (email && password) {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            localStorage.setItem("siragpt_auth_user", JSON.stringify(data.user));
            queryClient.setQueryData(["/api/auth/user"], data.user);
          }
          window.location.href = "/";
        } else {
          const data = await response.json();
          setError(data.message || "Credenciales inválidas");
        }
      } catch (err) {
        setError("Error al iniciar sesión");
      } finally {
        setIsLoading(false);
      }
    } else if (email && !password) {
      setError("Por favor ingresa tu contraseña");
    }
  };

  const handleGoogleLogin = () => {
    setIsGoogleLoading(true);
    setError("");
    window.location.href = "/api/login";
  };

  const handleMicrosoftLogin = () => {
    setIsMicrosoftLoading(true);
    setError("");
    window.location.href = "/api/auth/microsoft";
  };

  const handleMagicLink = async () => {
    if (!email) {
      setError("Ingresa tu correo electrónico para recibir el enlace mágico");
      return;
    }

    setIsMagicLinkLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch("/api/auth/magic-link/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMagicLinkSent(true);
        setSuccessMessage(data.message);
        // In development, store the URL for testing
        if (data.magicLinkUrl) {
          setMagicLinkUrl(data.magicLinkUrl);
        }
      } else {
        setError(data.message || "Error al enviar el enlace mágico");
      }
    } catch (err) {
      setError("Error al enviar el enlace mágico");
    } finally {
      setIsMagicLinkLoading(false);
    }
  };

  const ComingSoonButton = ({ icon: Icon, label }: { icon: any; label: string }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">
            <Button
              variant="outline"
              className="w-full h-12 justify-start gap-3 text-base font-normal bg-muted/30 border-muted cursor-default"
              disabled
            >
              <Icon className="h-5 w-5 text-muted-foreground" />
              <span className="text-muted-foreground">{label}</span>
              <span className="ml-auto text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
                Próximamente
              </span>
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Esta opción estará disponible pronto</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md relative">
        <Button
          variant="ghost"
          size="icon"
          className="absolute -top-2 -right-2"
          onClick={() => setLocation("/welcome")}
          data-testid="button-close-login"
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold mb-3">Inicia sesión o suscríbete</h1>
          <p className="text-muted-foreground">
            Obtendrás respuestas más inteligentes, podrás cargar archivos e imágenes, y más.
          </p>
        </div>

        <div className="space-y-3">
          {/* Google - Working */}
          <Button
            variant="outline"
            className="w-full h-14 justify-center gap-3 text-base font-medium border-2 hover:bg-muted/50 hover:border-primary/30 transition-all duration-200 rounded-xl shadow-sm"
            onClick={handleGoogleLogin}
            disabled={isGoogleLoading}
            data-testid="button-login-google"
          >
            {isGoogleLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <svg className="h-6 w-6" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            {isGoogleLoading ? "Conectando..." : "Continuar con Google"}
          </Button>

          {/* Coming Soon Options */}
          <ComingSoonButton icon={Apple} label="Continuar con Apple" />

          {/* Microsoft - Active when configured */}
          <Button
            variant="outline"
            className="w-full h-14 justify-center gap-3 text-base font-medium border-2 hover:bg-muted/50 hover:border-primary/30 transition-all duration-200 rounded-xl shadow-sm"
            onClick={handleMicrosoftLogin}
            disabled={isMicrosoftLoading}
            data-testid="button-login-microsoft"
          >
            {isMicrosoftLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <svg className="h-6 w-6" viewBox="0 0 23 23">
                <path fill="#f35325" d="M1 1h10v10H1z" />
                <path fill="#81bc06" d="M12 1h10v10H12z" />
                <path fill="#05a6f0" d="M1 12h10v10H1z" />
                <path fill="#ffba08" d="M12 12h10v10H12z" />
              </svg>
            )}
            {isMicrosoftLoading ? "Conectando..." : "Continuar con Microsoft"}
          </Button>

          <ComingSoonButton icon={Phone} label="Continuar con el teléfono" />
        </div>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-sm">o</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Magic Link Success State */}
        {magicLinkSent ? (
          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 text-center">
              <Sparkles className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <h3 className="font-medium text-green-700 dark:text-green-300 mb-1">¡Enlace mágico enviado!</h3>
              <p className="text-sm text-green-600 dark:text-green-400">{successMessage}</p>
            </div>

            {/* Development mode: show link directly */}
            {magicLinkUrl && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2 font-medium">Modo desarrollo - Click para iniciar sesión:</p>
                <a
                  href={magicLinkUrl}
                  className="text-sm text-blue-700 dark:text-blue-300 underline break-all hover:text-blue-800"
                >
                  {magicLinkUrl}
                </a>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setMagicLinkSent(false);
                setMagicLinkUrl(null);
                setSuccessMessage("");
              }}
            >
              Enviar otro enlace
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              type="email"
              placeholder="Dirección de correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base"
              data-testid="input-login-email"
            />
            <Input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 text-base"
              data-testid="input-login-password"
              onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
            />
            {error && (
              <p className="text-sm text-red-500 text-center" data-testid="text-login-error">{error}</p>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1 h-12 text-base"
                onClick={handleContinue}
                disabled={isLoading}
                data-testid="button-login-continue"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continuar"}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-12 px-4 border-amber-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      onClick={handleMagicLink}
                      disabled={isMagicLinkLoading}
                      data-testid="button-magic-link"
                    >
                      {isMagicLinkLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Mail className="h-5 w-5 text-amber-600" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Iniciar sesión con enlace mágico (sin contraseña)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground mt-6">
          ¿No tienes una cuenta?{" "}
          <button
            onClick={() => setLocation("/signup")}
            className="text-primary hover:underline"
            data-testid="link-goto-signup"
          >
            Suscríbete gratis
          </button>
        </p>
      </div>
    </div>
  );
}
