import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Apple, Phone, Loader2, Mail, Sparkles, ArrowLeft, CheckCircle2, XCircle, AlertCircle, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/apiClient";

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

  // MFA states (push approval and/or TOTP)
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaMethods, setMfaMethods] = useState<{ totp: boolean; push: boolean } | null>(null);
  const [mfaApprovalId, setMfaApprovalId] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<"pending" | "approved" | "denied" | "expired" | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaVerifying, setIsMfaVerifying] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    if (errorCode && OAUTH_ERROR_MESSAGES[errorCode]) {
      setError(OAUTH_ERROR_MESSAGES[errorCode]);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // If a previous login flow (OAuth/magic-link/phone/etc) initiated MFA and redirected here,
  // resume it automatically.
  useEffect(() => {
    let cancelled = false;

    const resume = async () => {
      try {
        const res = await apiFetch("/api/auth/mfa/status");
        if (!res.ok) return;
        const data = await res.json() as any;
        if (!data?.active) return;
        if (cancelled) return;

        setMfaRequired(true);
        setMfaMethods(data.methods || { totp: false, push: false });
        setMfaApprovalId(data.approvalId || null);
        setMfaStatus((data.status as any) || "pending");
        setError("");

        // Ensure we don't keep showing the phone OTP UI once MFA is active.
        setShowPhoneAuth(false);
        setOtpSent(false);
      } catch {
        // Ignore.
      }
    };

    if (!mfaRequired) {
      resume();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mfaRequired || !mfaMethods?.push) return;

    let cancelled = false;
    let intervalId: number | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await apiFetch("/api/auth/mfa/status");
        if (!res.ok) return;
        const data = await res.json() as { active: boolean; status?: string };
        const status = (data.status as any) || null;
        if (status) setMfaStatus(status);

        if (!data.active) {
          if (status === "denied") {
            setError("Solicitud rechazada. Intenta iniciar sesión de nuevo.");
          } else if (status === "expired") {
            setError("La solicitud expiró. Intenta iniciar sesión de nuevo.");
          }
          if (intervalId) window.clearInterval(intervalId);
          intervalId = null;
          return;
        }

        if (status === "approved" && !isMfaVerifying) {
          setIsMfaVerifying(true);
          setError("");
          try {
            const verifyRes = await apiFetch("/api/auth/mfa/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const verifyData = await verifyRes.json().catch(() => ({}));
            if (verifyRes.ok && (verifyData as any)?.success) {
              window.location.href = "/";
              return;
            }
            setError((verifyData as any)?.message || "No se pudo completar el inicio de sesión.");
          } finally {
            setIsMfaVerifying(false);
          }
        }
      } catch {
        // Ignore transient polling errors.
      }
    };

    poll();
    intervalId = window.setInterval(poll, 2000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [mfaRequired, mfaMethods?.push, isMfaVerifying]);

  const cancelMfa = async () => {
    try {
      await apiFetch("/api/auth/mfa/cancel", { method: "POST" });
    } catch {
      // Ignore.
    }
    setMfaRequired(false);
    setMfaMethods(null);
    setMfaApprovalId(null);
    setMfaStatus(null);
    setMfaCode("");
    setIsMfaVerifying(false);
  };

  const verifyMfaWithCode = async () => {
    setIsMfaVerifying(true);
    setError("");
    try {
      const res = await apiFetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data as any)?.success) {
        window.location.href = "/";
        return;
      }
      setError((data as any)?.message || "No se pudo verificar el código.");
    } catch {
      setError("Error al verificar el código.");
    } finally {
      setIsMfaVerifying(false);
    }
  };

  const handleContinue = async () => {
    if (email && password) {
      setIsLoading(true);
      setError("");
      try {
        const response = await apiFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await response.json().catch(() => ({} as any));
        if (response.ok && (data as any)?.mfaRequired) {
          setMfaRequired(true);
          setMfaMethods((data as any)?.methods || { totp: false, push: false });
          setMfaApprovalId((data as any)?.approvalId || null);
          setMfaStatus("pending");
          setMfaCode("");
          setSuccessMessage((data as any)?.message || "");
          return;
        }

        if (response.ok && (data as any)?.success) {
          window.location.href = "/";
          return;
        }

        setError((data as any)?.message || "Credenciales inválidas");
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

  const handleMagicLink = async () => {
    if (!email) {
      setError("Ingresa tu correo electrónico para recibir el enlace mágico");
      return;
    }

    setIsMagicLinkLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await apiFetch("/api/auth/magic-link/send", {
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
      const response = await apiFetch("/api/auth/phone/send-code", {
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
      const response = await apiFetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber, code: otpCode }),
      });

      const data = await response.json().catch(() => ({} as any));

      if (response.ok && (data as any)?.mfaRequired) {
        setMfaRequired(true);
        setMfaMethods((data as any)?.methods || { totp: false, push: false });
        setMfaApprovalId((data as any)?.approvalId || null);
        setMfaStatus("pending");
        setMfaCode("");
        setSuccessMessage((data as any)?.message || "");
        setShowPhoneAuth(false);
        setOtpSent(false);
        return;
      }

      if (response.ok && (data as any)?.success) {
        window.location.href = "/";
        return;
      }

      setError((data as any)?.message || "Código incorrecto");
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
              className="w-full h-12 justify-start gap-3 rounded-xl text-base font-normal bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Icon className="h-5 w-5 text-muted-foreground" />
              <span className="text-muted-foreground">{label}</span>
              <span className="ml-auto text-xs bg-background text-muted-foreground border border-border px-2 py-0.5 rounded-full font-medium">
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
    <div className="min-h-screen paper-grid flex items-center justify-center p-4">
      <div className="w-full max-w-md relative">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-full transition-colors"
            onClick={() => setLocation("/welcome")}
            data-testid="button-close-login"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-8 fade-in-up">
            <h1 className="text-3xl font-extrabold tracking-tight mb-3 text-foreground">
              Bienvenido a{" "}
              <span className="inline-flex items-center px-2 py-1 rounded-xl bg-muted text-foreground">
                ILIAGPT
              </span>
            </h1>
            <p className="text-muted-foreground">
              Obtén respuestas más inteligentes, carga archivos e imágenes, y más.
            </p>
          </div>

          {!showPhoneAuth && !mfaRequired && (
            <div className="space-y-3">
              {/* Google - Working */}
              <Button
                variant="outline"
                className="w-full h-12 justify-center gap-3 text-base font-semibold border-border bg-card text-foreground hover:bg-muted/40 transition-colors rounded-xl fade-in-up fade-in-up-delay-1"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
                data-testid="button-login-google"
              >
                {isGoogleLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                {isGoogleLoading ? "Conectando..." : "Continuar con Google"}
              </Button>

              {/* Coming Soon Options */}
              <ComingSoonButton icon={Apple} label="Continuar con Apple" />

              {/* Microsoft - Coming Soon (requires Azure AD setup) */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="relative fade-in-up fade-in-up-delay-3">
                      <Button
                        variant="outline"
                        className="w-full h-12 justify-start gap-3 rounded-xl text-base font-normal bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                        disabled
                      >
                        <svg className="h-5 w-5" viewBox="0 0 23 23" aria-hidden="true">
                          <path fill="#f35325" d="M1 1h10v10H1z" />
                          <path fill="#81bc06" d="M12 1h10v10H12z" />
                          <path fill="#05a6f0" d="M1 12h10v10H1z" />
                          <path fill="#ffba08" d="M12 12h10v10H12z" />
                        </svg>
                        <span className="text-muted-foreground">Continuar con Microsoft</span>
                        <span className="ml-auto text-xs bg-background text-muted-foreground border border-border px-2 py-0.5 rounded-full font-medium">
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

              {/* Phone Authentication */}
              <Button
                variant="outline"
                className="w-full h-12 justify-center gap-3 text-base font-semibold border-border bg-card text-foreground hover:bg-muted/40 transition-colors rounded-xl fade-in-up fade-in-up-delay-3"
                onClick={handlePhoneLogin}
                data-testid="button-login-phone"
              >
                <Phone className="h-5 w-5" />
                Continuar con el teléfono
              </Button>
            </div>
          )}

          {!showPhoneAuth && !mfaRequired && (
            <div className="flex items-center gap-4 my-6 fade-in-up fade-in-up-delay-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-muted-foreground text-sm">o</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {!showPhoneAuth &&
            (magicLinkSent ? (
              <div className="space-y-4 fade-in-up">
                <div className="bg-muted/30 border border-border rounded-xl p-4 text-center">
                  <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <h3 className="font-semibold text-foreground mb-1">Enlace mágico enviado</h3>
                  <p className="text-sm text-muted-foreground">{successMessage}</p>
                </div>

                {/* Development mode: show link directly */}
                {magicLinkUrl && (
                  <div className="bg-muted/20 border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-2 font-semibold">
                      Modo desarrollo: click para iniciar sesión
                    </p>
                    <a href={magicLinkUrl} className="text-sm text-foreground underline break-all">
                      {magicLinkUrl}
                    </a>
                  </div>
                )}

                <Button
                  variant="outline"
                  className="w-full border-border text-foreground hover:bg-muted/50"
                  onClick={() => {
                    setMagicLinkSent(false);
                    setMagicLinkUrl(null);
                    setSuccessMessage("");
                  }}
                >
                  Enviar otro enlace
                </Button>
              </div>
            ) : mfaRequired ? (
              <div className="space-y-4 fade-in-up fade-in-up-delay-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted/60 -ml-2"
                  onClick={cancelMfa}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Volver
                </Button>

                <div className="bg-muted/30 border border-border rounded-xl p-4 text-center">
                  <ShieldCheck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <h3 className="font-semibold text-foreground mb-1">Verificación de seguridad</h3>
                  <p className="text-sm text-muted-foreground">
                    {mfaMethods?.push
                      ? "Aprueba el inicio de sesión en tu dispositivo de confianza o ingresa tu código 2FA."
                      : "Ingresa tu código 2FA para continuar."}
                  </p>
                </div>

                {mfaMethods?.push && (
                  <div className="bg-muted/20 border border-border rounded-xl p-4 flex items-start gap-3">
                    <div className="mt-0.5 text-muted-foreground">
                      {mfaStatus === "approved" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : mfaStatus === "denied" ? (
                        <XCircle className="h-5 w-5" />
                      ) : (
                        <AlertCircle className="h-5 w-5" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {mfaStatus === "approved"
                          ? "Aprobado"
                          : mfaStatus === "denied"
                            ? "Rechazado"
                            : mfaStatus === "expired"
                              ? "Expirado"
                              : "Pendiente"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Revisa la notificación push en tu dispositivo de confianza.
                      </p>
                      {mfaApprovalId ? (
                        <p className="text-[11px] text-muted-foreground mt-2 break-all">
                          Solicitud: {mfaApprovalId}
                        </p>
                      ) : null}
                    </div>
                    {isMfaVerifying && (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                )}

                {mfaMethods?.totp && (
                  <div className="space-y-3">
                    <Input
                      type="text"
                      placeholder="Código 2FA"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      className="h-12 text-base rounded-xl bg-background border-input text-foreground placeholder:text-muted-foreground"
                      data-testid="input-mfa-code"
                      onKeyDown={(e) => e.key === "Enter" && verifyMfaWithCode()}
                    />
                    <Button
                      className="w-full h-12 text-base bg-primary hover:bg-primary/90 border border-border text-primary-foreground font-semibold transition-colors rounded-xl"
                      onClick={verifyMfaWithCode}
                      disabled={isMfaVerifying || mfaCode.trim().length < 6}
                      data-testid="button-mfa-verify"
                    >
                      {isMfaVerifying ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verificar"}
                    </Button>
                  </div>
                )}

                {error && (
                  <p
                    className="text-sm text-red-700 text-center bg-red-50 border border-red-200 py-2 px-3 rounded-lg"
                    data-testid="text-login-error"
                  >
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4 fade-in-up fade-in-up-delay-4">
                <Input
                  type="email"
                  placeholder="Dirección de correo electrónico"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 text-base rounded-xl bg-background border-input text-foreground placeholder:text-muted-foreground"
                  data-testid="input-login-email"
                />
                <Input
                  type="password"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-base rounded-xl bg-background border-input text-foreground placeholder:text-muted-foreground"
                  data-testid="input-login-password"
                  onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                />
                {error && (
                  <p
                    className="text-sm text-red-700 text-center bg-red-50 border border-red-200 py-2 px-3 rounded-lg"
                    data-testid="text-login-error"
                  >
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-12 text-base bg-primary hover:bg-primary/90 border border-border text-primary-foreground font-semibold transition-colors rounded-xl"
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
                          className="h-12 px-4 border-border bg-card hover:bg-muted/50 rounded-xl transition-colors"
                          onClick={handleMagicLink}
                          disabled={isMagicLinkLoading}
                          data-testid="button-magic-link"
                        >
                          {isMagicLinkLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          ) : (
                            <Mail className="h-5 w-5 text-muted-foreground" />
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
            ))}

	          {/* Phone Authentication View */}
	          {showPhoneAuth && (
	            <div className="space-y-4 fade-in-up">
	              <Button
	                variant="ghost"
	                size="sm"
	                className="text-muted-foreground hover:text-foreground hover:bg-muted/60 -ml-2"
	                onClick={handleBackFromPhone}
	              >
	                <ArrowLeft className="h-4 w-4 mr-1" />
	                Volver
	              </Button>

	              <div className="text-center mb-4">
	                <Phone className="h-10 w-10 text-foreground mx-auto mb-2" />
	                <h3 className="text-lg font-semibold text-foreground">
	                  {otpSent ? "Ingresa el código" : "Ingresa tu número"}
	                </h3>
	                <p className="text-sm text-muted-foreground">
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
	                    className="h-12 text-base rounded-xl bg-background border-input text-foreground placeholder:text-muted-foreground"
	                    data-testid="input-phone-number"
	                  />
	                  {error && (
	                    <p className="text-sm text-red-700 text-center bg-red-50 border border-red-200 py-2 px-3 rounded-lg">{error}</p>
	                  )}
	                  <Button
	                    className="w-full h-12 text-base bg-primary hover:bg-primary/90 border border-border text-primary-foreground font-semibold transition-colors rounded-xl"
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
	                    <div className="bg-muted/20 border border-border rounded-xl p-3 text-center">
	                      <p className="text-xs text-muted-foreground font-semibold">Modo desarrollo: tu código es</p>
	                      <p className="text-2xl font-mono text-foreground tracking-widest">{devCode}</p>
	                    </div>
	                  )}
	                  <Input
	                    type="text"
	                    placeholder="000000"
	                    value={otpCode}
	                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
	                    className="h-14 text-2xl text-center tracking-widest font-mono rounded-xl bg-white border-black/10 text-zinc-900 placeholder:text-zinc-400"
	                    maxLength={6}
	                    data-testid="input-otp-code"
	                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
	                  />
	                  {error && (
	                    <p className="text-sm text-red-700 text-center bg-red-50 border border-red-200 py-2 px-3 rounded-lg">{error}</p>
	                  )}
	                  <Button
	                    className="w-full h-12 text-base bg-black hover:bg-zinc-900 border border-black/10 text-white font-semibold transition-colors rounded-xl"
	                    onClick={handleVerifyOtp}
	                    disabled={isPhoneLoading || otpCode.length !== 6}
	                    data-testid="button-verify-otp"
	                  >
	                    {isPhoneLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verificar"}
	                  </Button>
	                  <Button
	                    variant="ghost"
	                    className="w-full text-zinc-700 hover:text-zinc-900 hover:bg-black/5"
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
                className="text-zinc-900 font-semibold hover:underline transition-colors"
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
