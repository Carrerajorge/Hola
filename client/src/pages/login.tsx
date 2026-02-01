import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Apple, Phone, Loader2, Mail, Sparkles, ArrowLeft } from "lucide-react";
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
  google_failed: "Error al iniciar sesión con Google. Por favor intenta de nuevo.",
  microsoft_failed: "Error al iniciar sesión con Microsoft. Por favor intenta de nuevo.",
  auth0_failed: "Error al iniciar sesión con Auth0. Por favor intenta de nuevo.",
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

  // Phone auth states
  const [showPhoneAuth, setShowPhoneAuth] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isPhoneLoading, setIsPhoneLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);



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
    window.location.href = "/api/auth/google";
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

  // Phone authentication handlers
  const handleSendOtp = async () => {
    if (!phoneNumber) {
      setError("Ingresa tu número de teléfono");
      return;
    }

    setIsPhoneLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setOtpSent(true);
        setSuccessMessage(data.message);
        if (data.devCode) {
          setDevCode(data.devCode);
        }
      } else {
        setError(data.message || "Error al enviar el código");
      }
    } catch (err) {
      setError("Error al enviar el código");
    } finally {
      setIsPhoneLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode) {
      setError("Ingresa el código de verificación");
      return;
    }

    setIsPhoneLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: phoneNumber, code: otpCode }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        window.location.href = "/";
      } else {
        setError(data.message || "Código incorrecto");
      }
    } catch (err) {
      setError("Error al verificar el código");
    } finally {
      setIsPhoneLoading(false);
    }
  };

  const handlePhoneLogin = () => {
    setShowPhoneAuth(true);
    setError("");
  };

  const handleBackFromPhone = () => {
    setShowPhoneAuth(false);
    setOtpSent(false);
    setPhoneNumber("");
    setOtpCode("");
    setDevCode(null);
    setError("");
    setSuccessMessage("");
  };

  const ComingSoonButton = ({ icon: Icon, label }: { icon: any; label: string }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative fade-in-up fade-in-up-delay-3">
            <Button
              variant="outline"
              className="w-full h-12 justify-start gap-3 text-base font-normal bg-white/5 border-white/10 cursor-default hover:bg-white/5"
              disabled
            >
              <Icon className="h-5 w-5 text-zinc-400" />
              <span className="text-zinc-400">{label}</span>
              <span className="ml-auto text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-medium">
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
    <div className="min-h-screen gradient-animated flex items-center justify-center p-4 relative overflow-hidden">
      {/* Floating Orbs */}
      <div className="floating-orb floating-orb-1" />
      <div className="floating-orb floating-orb-2" />
      <div className="floating-orb floating-orb-3" />

      {/* Glass Card Container */}
      <div className="w-full max-w-md relative z-10">
        <div className="glass-premium rounded-3xl p-8 shadow-2xl">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-all duration-200"
            onClick={() => setLocation("/welcome")}
            data-testid="button-close-login"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-8 fade-in-up">
            <h1 className="text-3xl font-bold mb-3 text-white">
              Bienvenido a <span className="text-gradient-premium">ILIAGPT</span>
            </h1>
            <p className="text-zinc-400">
              Obtén respuestas más inteligentes, carga archivos e imágenes, y más.
            </p>
          </div>

          {!showPhoneAuth && (
          <div className="space-y-3">
            {/* Google - Working */}
            <Button
              variant="outline"
              className="w-full h-14 justify-center gap-3 text-base font-medium border-2 border-white/20 
                bg-white/10 hover:bg-white/20 text-white
                hover:border-white/40 transition-all duration-300 rounded-xl 
                shadow-lg hover:shadow-xl hover:shadow-purple-500/10
                scale-hover fade-in-up fade-in-up-delay-1"
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
              className="w-full h-14 justify-center gap-3 text-base font-medium border-2 border-white/20 
                bg-white/10 hover:bg-white/20 text-white
                hover:border-white/40 transition-all duration-300 rounded-xl 
                shadow-lg hover:shadow-xl hover:shadow-blue-500/10
                scale-hover fade-in-up fade-in-up-delay-2"
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

            {/* Phone Authentication */}
            <Button
              variant="outline"
              className="w-full h-14 justify-center gap-3 text-base font-medium border-2 border-white/20 
                bg-white/10 hover:bg-white/20 text-white
                hover:border-white/40 transition-all duration-300 rounded-xl 
                shadow-lg hover:shadow-xl hover:shadow-green-500/10
                scale-hover fade-in-up fade-in-up-delay-3"
              onClick={handlePhoneLogin}
              data-testid="button-login-phone"
            >
              <Phone className="h-5 w-5" />
              Continuar con el teléfono
            </Button>
          </div>
          )}

          {!showPhoneAuth && (
          <div className="flex items-center gap-4 my-6 fade-in-up fade-in-up-delay-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <span className="text-zinc-500 text-sm">o</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
          )}

          {!showPhoneAuth && (
          /* Magic Link Success State */
          magicLinkSent ? (
            <div className="space-y-4 fade-in-up">
              <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-4 text-center">
                <Sparkles className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <h3 className="font-medium text-emerald-300 mb-1">¡Enlace mágico enviado!</h3>
                <p className="text-sm text-emerald-400/80">{successMessage}</p>
              </div>

              {/* Development mode: show link directly */}
              {magicLinkUrl && (
                <div className="bg-blue-500/20 border border-blue-500/30 rounded-xl p-4">
                  <p className="text-xs text-blue-300 mb-2 font-medium">Modo desarrollo - Click para iniciar sesión:</p>
                  <a
                    href={magicLinkUrl}
                    className="text-sm text-blue-200 underline break-all hover:text-blue-100"
                  >
                    {magicLinkUrl}
                  </a>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full border-white/20 text-white hover:bg-white/10"
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
            <div className="space-y-4 fade-in-up fade-in-up-delay-4">
              <Input
                type="email"
                placeholder="Dirección de correo electrónico"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 text-base bg-white/5 border-white/20 text-white placeholder:text-zinc-500
                  focus:border-purple-500/50 focus:ring-purple-500/20 rounded-xl input-glow"
                data-testid="input-login-email"
              />
              <Input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-base bg-white/5 border-white/20 text-white placeholder:text-zinc-500
                  focus:border-purple-500/50 focus:ring-purple-500/20 rounded-xl input-glow"
                data-testid="input-login-password"
                onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
              />
              {error && (
                <p className="text-sm text-red-400 text-center bg-red-500/10 py-2 px-3 rounded-lg" data-testid="text-login-error">{error}</p>
              )}
              <div className="flex gap-2">
                <Button
                  className="flex-1 h-12 text-base bg-gradient-to-r from-purple-600 to-pink-600 
                    hover:from-purple-500 hover:to-pink-500 border-0 text-white font-medium
                    shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40
                    transition-all duration-300 rounded-xl btn-premium"
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
                        className="h-12 px-4 border-amber-500/30 hover:border-amber-500/50 
                          bg-amber-500/10 hover:bg-amber-500/20 rounded-xl transition-all duration-300"
                        onClick={handleMagicLink}
                        disabled={isMagicLinkLoading}
                        data-testid="button-magic-link"
                      >
                        {isMagicLinkLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                        ) : (
                          <Mail className="h-5 w-5 text-amber-400" />
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
          )
          )}

          {/* Phone Authentication View */}
          {showPhoneAuth && (
            <div className="space-y-4 fade-in-up">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-white -ml-2"
                onClick={handleBackFromPhone}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver
              </Button>

              <div className="text-center mb-4">
                <Phone className="h-10 w-10 text-green-400 mx-auto mb-2" />
                <h3 className="text-lg font-medium text-white">
                  {otpSent ? "Ingresa el código" : "Ingresa tu número"}
                </h3>
                <p className="text-sm text-zinc-400">
                  {otpSent 
                    ? "Te enviamos un código de 6 dígitos" 
                    : "Te enviaremos un código de verificación"}
                </p>
              </div>

              {!otpSent ? (
                <>
                  <Input
                    type="tel"
                    placeholder="+51 918 714 054"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="h-12 text-base bg-white/5 border-white/20 text-white placeholder:text-zinc-500
                      focus:border-green-500/50 focus:ring-green-500/20 rounded-xl"
                    data-testid="input-phone-number"
                  />
                  {error && (
                    <p className="text-sm text-red-400 text-center bg-red-500/10 py-2 px-3 rounded-lg">{error}</p>
                  )}
                  <Button
                    className="w-full h-12 text-base bg-gradient-to-r from-green-600 to-emerald-600 
                      hover:from-green-500 hover:to-emerald-500 border-0 text-white font-medium
                      shadow-lg shadow-green-500/25 hover:shadow-green-500/40
                      transition-all duration-300 rounded-xl"
                    onClick={handleSendOtp}
                    disabled={isPhoneLoading}
                    data-testid="button-send-otp"
                  >
                    {isPhoneLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar código"}
                  </Button>
                </>
              ) : (
                <>
                  {devCode && (
                    <div className="bg-blue-500/20 border border-blue-500/30 rounded-xl p-3 text-center">
                      <p className="text-xs text-blue-300 font-medium">Modo desarrollo - Tu código es:</p>
                      <p className="text-2xl font-mono text-blue-200 tracking-widest">{devCode}</p>
                    </div>
                  )}
                  <Input
                    type="text"
                    placeholder="000000"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="h-14 text-2xl text-center tracking-widest font-mono bg-white/5 border-white/20 text-white placeholder:text-zinc-500
                      focus:border-green-500/50 focus:ring-green-500/20 rounded-xl"
                    maxLength={6}
                    data-testid="input-otp-code"
                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
                  />
                  {error && (
                    <p className="text-sm text-red-400 text-center bg-red-500/10 py-2 px-3 rounded-lg">{error}</p>
                  )}
                  <Button
                    className="w-full h-12 text-base bg-gradient-to-r from-green-600 to-emerald-600 
                      hover:from-green-500 hover:to-emerald-500 border-0 text-white font-medium
                      shadow-lg shadow-green-500/25 hover:shadow-green-500/40
                      transition-all duration-300 rounded-xl"
                    onClick={handleVerifyOtp}
                    disabled={isPhoneLoading || otpCode.length !== 6}
                    data-testid="button-verify-otp"
                  >
                    {isPhoneLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verificar"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full text-zinc-400 hover:text-white"
                    onClick={() => {
                      setOtpSent(false);
                      setOtpCode("");
                      setDevCode(null);
                      setError("");
                    }}
                  >
                    Reenviar código
                  </Button>
                </>
              )}
            </div>
          )}

          {!showPhoneAuth && (
            <p className="text-center text-sm text-zinc-500 mt-6 fade-in-up fade-in-up-delay-5">
              ¿No tienes una cuenta?{" "}
              <button
                onClick={() => setLocation("/signup")}
                className="text-purple-400 hover:text-purple-300 hover:underline transition-colors"
                data-testid="link-goto-signup"
              >
                Suscríbete gratis
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

