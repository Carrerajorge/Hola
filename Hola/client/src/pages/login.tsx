import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { X, Apple, Phone, Loader2, Mail, Sparkles, ArrowLeft, CheckCircle2, XCircle, AlertCircle, ShieldCheck, ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { apiFetch } from "@/lib/apiClient";

/* ── SVG Logo Components ── */
const GeminiLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2C12 2 14.5 7.5 17 10C19.5 12.5 22 12 22 12C22 12 19.5 11.5 17 14C14.5 16.5 12 22 12 22C12 22 9.5 16.5 7 14C4.5 11.5 2 12 2 12C2 12 4.5 12.5 7 10C9.5 7.5 12 2 12 2Z" fill="url(#gemini-gradient)" />
    <defs>
      <linearGradient id="gemini-gradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4285F4" />
        <stop offset="0.5" stopColor="#9B72CB" />
        <stop offset="1" stopColor="#D96570" />
      </linearGradient>
    </defs>
  </svg>
);

const OpenAILogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4114-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0974-2.3616l2.603-1.5018 2.6032 1.5018v3.0036l-2.6032 1.5018-2.603-1.5018z" />
  </svg>
);

const COUNTRY_CODES = [
  { code: "+1", country: "US", flag: "\u{1F1FA}\u{1F1F8}", name: "Estados Unidos" },
  { code: "+52", country: "MX", flag: "\u{1F1F2}\u{1F1FD}", name: "M\u00e9xico" },
  { code: "+51", country: "PE", flag: "\u{1F1F5}\u{1F1EA}", name: "Per\u00fa" },
  { code: "+54", country: "AR", flag: "\u{1F1E6}\u{1F1F7}", name: "Argentina" },
  { code: "+55", country: "BR", flag: "\u{1F1E7}\u{1F1F7}", name: "Brasil" },
  { code: "+56", country: "CL", flag: "\u{1F1E8}\u{1F1F1}", name: "Chile" },
  { code: "+57", country: "CO", flag: "\u{1F1E8}\u{1F1F4}", name: "Colombia" },
  { code: "+58", country: "VE", flag: "\u{1F1FB}\u{1F1EA}", name: "Venezuela" },
  { code: "+593", country: "EC", flag: "\u{1F1EA}\u{1F1E8}", name: "Ecuador" },
  { code: "+591", country: "BO", flag: "\u{1F1E7}\u{1F1F4}", name: "Bolivia" },
  { code: "+595", country: "PY", flag: "\u{1F1F5}\u{1F1FE}", name: "Paraguay" },
  { code: "+598", country: "UY", flag: "\u{1F1FA}\u{1F1FE}", name: "Uruguay" },
  { code: "+506", country: "CR", flag: "\u{1F1E8}\u{1F1F7}", name: "Costa Rica" },
  { code: "+507", country: "PA", flag: "\u{1F1F5}\u{1F1E6}", name: "Panam\u00e1" },
  { code: "+34", country: "ES", flag: "\u{1F1EA}\u{1F1F8}", name: "Espa\u00f1a" },
  { code: "+44", country: "GB", flag: "\u{1F1EC}\u{1F1E7}", name: "Reino Unido" },
  { code: "+49", country: "DE", flag: "\u{1F1E9}\u{1F1EA}", name: "Alemania" },
  { code: "+33", country: "FR", flag: "\u{1F1EB}\u{1F1F7}", name: "Francia" },
  { code: "+39", country: "IT", flag: "\u{1F1EE}\u{1F1F9}", name: "Italia" },
  { code: "+81", country: "JP", flag: "\u{1F1EF}\u{1F1F5}", name: "Jap\u00f3n" },
  { code: "+86", country: "CN", flag: "\u{1F1E8}\u{1F1F3}", name: "China" },
  { code: "+91", country: "IN", flag: "\u{1F1EE}\u{1F1F3}", name: "India" },
];

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Error de autenticaci\u00f3n con Google. Por favor intenta de nuevo.",
  no_user: "No se pudo obtener la informaci\u00f3n del usuario. Por favor intenta de nuevo.",
  login_failed: "Error al iniciar sesi\u00f3n. Por favor intenta de nuevo.",
  invalid_token: "Enlace m\u00e1gico inv\u00e1lido o expirado.",
  magic_link_expired: "El enlace m\u00e1gico ha expirado. Solicita uno nuevo.",
  session_error: "Error al crear la sesi\u00f3n. Por favor intenta de nuevo.",
  verification_failed: "Error al verificar el enlace. Por favor intenta de nuevo.",
  google_failed: "Error al iniciar sesi\u00f3n con Google. Por favor intenta de nuevo.",
  microsoft_failed: "Error al iniciar sesi\u00f3n con Microsoft. Por favor intenta de nuevo.",
  auth0_failed: "Error al iniciar sesi\u00f3n con Auth0. Por favor intenta de nuevo.",
  replit_disabled: "El inicio de sesi\u00f3n con Replit fue desactivado. Usa Google, tel\u00e9fono o correo.",
  gemini_failed: "Error al iniciar sesi\u00f3n con Gemini. Por favor intenta de nuevo.",
  openai_failed: "Error al iniciar sesi\u00f3n con OpenAI. Por favor intenta de nuevo.",
};

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { settings: platformSettings } = usePlatformSettings();
  const appName = platformSettings.app_name || "ILIAGPT";
  const allowRegistration = platformSettings.allow_registration;
  const supportEmail = (platformSettings.support_email || "").trim();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGeminiLoading, setIsGeminiLoading] = useState(false);
  const [isOpenAILoading, setIsOpenAILoading] = useState(false);

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
  const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[2]); // Peru default
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const countryDropdownRef = useRef<HTMLDivElement>(null);

  // MFA states (push approval and/or TOTP)
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaMethods, setMfaMethods] = useState<{ totp: boolean; push: boolean } | null>(null);
  const [mfaApprovalId, setMfaApprovalId] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<"pending" | "approved" | "denied" | "expired" | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaVerifying, setIsMfaVerifying] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefilledEmail = (params.get("email") || "").trim();
    if (prefilledEmail) {
      setEmail(prefilledEmail);
    }
    const errorCode = params.get("error");
    if (errorCode && OAUTH_ERROR_MESSAGES[errorCode]) {
      setError(OAUTH_ERROR_MESSAGES[errorCode]);
    }

    if (prefilledEmail || errorCode) {
      params.delete("email");
      params.delete("error");
      const rest = params.toString();
      const nextUrl = rest ? `${window.location.pathname}?${rest}` : window.location.pathname;
      window.history.replaceState({}, "", nextUrl);
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
            setError("Solicitud rechazada. Intenta iniciar sesi\u00f3n de nuevo.");
          } else if (status === "expired") {
            setError("La solicitud expir\u00f3. Intenta iniciar sesi\u00f3n de nuevo.");
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
            setError((verifyData as any)?.message || "No se pudo completar el inicio de sesi\u00f3n.");
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

  // Close country dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setShowCountryDropdown(false);
      }
    };
    if (showCountryDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showCountryDropdown]);

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
      setError((data as any)?.message || "No se pudo verificar el c\u00f3digo.");
    } catch {
      setError("Error al verificar el c\u00f3digo.");
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

        setError((data as any)?.message || "Credenciales inv\u00e1lidas");
      } catch (err) {
        setError("Error al iniciar sesi\u00f3n");
      } finally {
        setIsLoading(false);
      }
    } else if (email && !password) {
      setError("Por favor ingresa tu contrase\u00f1a");
    }
  };

  const handleGoogleLogin = () => {
    setIsGoogleLoading(true);
    setError("");
    window.location.href = "/api/auth/google";
  };

  const handleGeminiLogin = async () => {
    setIsGeminiLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/gemini-cli-oauth/initiate", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        throw new Error((data as any)?.error || "No se pudo iniciar Gemini OAuth");
      }
      const { authUrl } = await res.json();
      window.location.href = authUrl;
    } catch (err: any) {
      setError(err.message || "Error al iniciar Gemini OAuth");
      setIsGeminiLoading(false);
    }
  };

  const handleOpenAILogin = () => {
    setIsOpenAILoading(true);
    setError("");
    // OpenAI uses Google OAuth under the hood — redirect to Google with select_account
    window.location.href = "/api/auth/google?provider_hint=openai";
  };

  const handleMagicLink = async () => {
    if (!email) {
      setError("Ingresa tu correo electr\u00f3nico para recibir el enlace m\u00e1gico");
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
        setError(data.message || "Error al enviar el enlace m\u00e1gico");
      }
    } catch (err) {
      setError("Error al enviar el enlace m\u00e1gico");
    } finally {
      setIsMagicLinkLoading(false);
    }
  };

  // Phone authentication handlers
  const handleSendOtp = async () => {
    if (!phoneNumber) {
      setError("Ingresa tu n\u00famero de tel\u00e9fono");
      return;
    }

    setIsPhoneLoading(true);
    setError("");

    const fullPhone = `${selectedCountry.code}${phoneNumber.replace(/\D/g, "")}`;

    try {
      const response = await apiFetch("/api/auth/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setOtpSent(true);
        setSuccessMessage(data.message);
        if (data.devCode) {
          setDevCode(data.devCode);
        }
      } else {
        setError(data.message || "Error al enviar el c\u00f3digo");
      }
    } catch (err) {
      setError("Error al enviar el c\u00f3digo");
    } finally {
      setIsPhoneLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode) {
      setError("Ingresa el c\u00f3digo de verificaci\u00f3n");
      return;
    }

    setIsPhoneLoading(true);
    setError("");

    try {
      const fullPhone = `${selectedCountry.code}${phoneNumber.replace(/\D/g, "")}`;
      const response = await apiFetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone, code: otpCode }),
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

      setError((data as any)?.message || "C\u00f3digo incorrecto");
    } catch (err) {
      setError("Error al verificar el c\u00f3digo");
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
                Pr\u00f3ximamente
              </span>
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Esta opci\u00f3n estar\u00e1 disponible pronto</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div className="min-h-screen paper-grid flex items-center justify-center p-4">
      <div className={`w-full relative transition-all duration-300 ${showPhoneAuth ? "max-w-2xl" : "max-w-md"}`}>
        <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-10 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-full transition-colors"
            onClick={() => setLocation("/welcome")}
            data-testid="button-close-login"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-8 fade-in-up">
            <h1 className="text-3xl font-extrabold tracking-tight mb-3 text-foreground">
              Bienvenido a{" "}
              <span className="inline-flex items-center px-2 py-1 rounded-xl bg-muted text-foreground">
                {appName}
              </span>
            </h1>
            <p className="text-muted-foreground">
              Obt\u00e9n respuestas m\u00e1s inteligentes, carga archivos e im\u00e1genes, y m\u00e1s.
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

              {/* Gemini - Google AI */}
              <Button
                variant="outline"
                className="w-full h-12 justify-center gap-3 text-base font-semibold border-border bg-card text-foreground hover:bg-muted/40 transition-colors rounded-xl fade-in-up fade-in-up-delay-2"
                onClick={handleGeminiLogin}
                disabled={isGeminiLoading}
                data-testid="button-login-gemini"
              >
                {isGeminiLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <GeminiLogo className="h-6 w-6" />
                )}
                {isGeminiLoading ? "Conectando..." : "Continuar con Gemini"}
              </Button>

              {/* OpenAI - via Google OAuth */}
              <Button
                variant="outline"
                className="w-full h-12 justify-center gap-3 text-base font-semibold border-border bg-card text-foreground hover:bg-muted/40 transition-colors rounded-xl fade-in-up fade-in-up-delay-2"
                onClick={handleOpenAILogin}
                disabled={isOpenAILoading}
                data-testid="button-login-openai"
              >
                {isOpenAILoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <OpenAILogo className="h-6 w-6" />
                )}
                {isOpenAILoading ? "Conectando..." : "Continuar con OpenAI"}
              </Button>

              {/* Coming Soon Options */}
              <ComingSoonButton icon={Apple} label="Continuar con Apple" />

              {/* Microsoft - Coming Soon */}
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
                          Pr\u00f3ximamente
                        </span>
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Esta opci\u00f3n estar\u00e1 disponible pronto</p>
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
                Continuar con el tel\u00e9fono
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
                  <h3 className="font-semibold text-foreground mb-1">Enlace m\u00e1gico enviado</h3>
                  <p className="text-sm text-muted-foreground">{successMessage}</p>
                </div>

                {/* Development mode: show link directly */}
                {magicLinkUrl && (
                  <div className="bg-muted/20 border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-2 font-semibold">
                      Modo desarrollo: click para iniciar sesi\u00f3n
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
                  <h3 className="font-semibold text-foreground mb-1">Verificaci\u00f3n de seguridad</h3>
                  <p className="text-sm text-muted-foreground">
                    {mfaMethods?.push
                      ? "Aprueba el inicio de sesi\u00f3n en tu dispositivo de confianza o ingresa tu c\u00f3digo 2FA."
                      : "Ingresa tu c\u00f3digo 2FA para continuar."}
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
                        Revisa la notificaci\u00f3n push en tu dispositivo de confianza.
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
                      placeholder="C\u00f3digo 2FA"
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
                  placeholder="Direcci\u00f3n de correo electr\u00f3nico"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 text-base rounded-xl bg-background border-input text-foreground placeholder:text-muted-foreground"
                  data-testid="input-login-email"
                />
                <Input
                  type="password"
                  placeholder="Contrase\u00f1a"
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
                        <p>Iniciar sesi\u00f3n con enlace m\u00e1gico (sin contrase\u00f1a)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            ))}

          {/* ─── Phone Authentication View ─── */}
          {showPhoneAuth && (
            <div className="space-y-5 fade-in-up">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground hover:bg-muted/60 -ml-2"
                onClick={handleBackFromPhone}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver
              </Button>

              {/* Two-panel layout */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* LEFT: Phone number */}
                <div className={`rounded-2xl border p-5 transition-all ${
                  otpSent
                    ? "border-border/50 bg-muted/20 opacity-80"
                    : "border-primary/30 bg-card shadow-sm"
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                      otpSent
                        ? "bg-primary/20 text-primary"
                        : "bg-primary text-primary-foreground"
                    }`}>1</div>
                    <h3 className="text-sm font-semibold text-foreground">Tu n\u00famero</h3>
                  </div>

                  <p className="text-xs text-muted-foreground mb-3">
                    Selecciona tu pa\u00eds e ingresa tu n\u00famero sin el c\u00f3digo de \u00e1rea.
                  </p>

                  {/* Country selector */}
                  <div className="relative mb-3" ref={countryDropdownRef}>
                    <button
                      type="button"
                      className="w-full h-11 flex items-center gap-2 px-3 rounded-xl border border-input bg-background text-sm text-foreground hover:bg-muted/40 transition-colors"
                      onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                      disabled={otpSent}
                    >
                      <span className="text-lg">{selectedCountry.flag}</span>
                      <span className="font-medium truncate">{selectedCountry.name}</span>
                      <span className="text-muted-foreground ml-auto shrink-0">{selectedCountry.code}</span>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${showCountryDropdown ? "rotate-180" : ""}`} />
                    </button>

                    {showCountryDropdown && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                        {COUNTRY_CODES.map((c) => (
                          <button
                            key={c.country}
                            type="button"
                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                              selectedCountry.country === c.country ? "bg-primary/10 font-medium" : ""
                            }`}
                            onClick={() => {
                              setSelectedCountry(c);
                              setShowCountryDropdown(false);
                            }}
                          >
                            <span className="text-base">{c.flag}</span>
                            <span className="text-foreground">{c.name}</span>
                            <span className="text-muted-foreground ml-auto text-xs">{c.code}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Phone input with country code prefix */}
                  <div className="flex items-center">
                    <span className="text-sm font-mono text-muted-foreground bg-muted/40 px-3 h-11 flex items-center rounded-l-xl border border-r-0 border-input shrink-0">
                      {selectedCountry.code}
                    </span>
                    <Input
                      type="tel"
                      placeholder="918 714 054"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d\s]/g, ""))}
                      className="h-11 text-base rounded-r-xl rounded-l-none bg-background border-input text-foreground placeholder:text-muted-foreground font-mono"
                      data-testid="input-phone-number"
                      disabled={otpSent}
                      onKeyDown={(e) => e.key === "Enter" && !otpSent && handleSendOtp()}
                    />
                  </div>

                  {!otpSent && (
                    <Button
                      className="w-full h-11 text-sm bg-primary hover:bg-primary/90 border border-border text-primary-foreground font-semibold transition-colors rounded-xl mt-3"
                      onClick={handleSendOtp}
                      disabled={isPhoneLoading || !phoneNumber.replace(/\D/g, "")}
                      data-testid="button-send-otp"
                    >
                      {isPhoneLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar c\u00f3digo"}
                    </Button>
                  )}

                  {otpSent && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline mt-2 inline-block"
                      onClick={() => {
                        setOtpSent(false);
                        setOtpCode("");
                        setDevCode(null);
                        setError("");
                      }}
                    >
                      Cambiar n\u00famero
                    </button>
                  )}
                </div>

                {/* RIGHT: OTP Code */}
                <div className={`rounded-2xl border p-5 transition-all ${
                  otpSent
                    ? "border-primary/30 bg-card shadow-sm"
                    : "border-border/50 bg-muted/10 opacity-50 pointer-events-none"
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                      otpSent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}>2</div>
                    <h3 className="text-sm font-semibold text-foreground">C\u00f3digo de verificaci\u00f3n</h3>
                  </div>

                  <p className="text-xs text-muted-foreground mb-3">
                    {otpSent
                      ? `Enviado a ${selectedCountry.code} ${phoneNumber}`
                      : "Ingresa el c\u00f3digo de 6 d\u00edgitos que recibir\u00e1s."}
                  </p>

                  {devCode && otpSent && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5 text-center mb-3">
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold uppercase tracking-wider">Dev code</p>
                      <p className="text-xl font-mono text-amber-900 dark:text-amber-200 tracking-[0.3em]">{devCode}</p>
                    </div>
                  )}

                  {/* OTP boxes */}
                  <div className="flex justify-center mb-4">
                    <InputOTP
                      maxLength={6}
                      value={otpCode}
                      onChange={(val) => setOtpCode(val)}
                      data-testid="input-otp-code"
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} className="w-10 h-12 text-lg font-mono rounded-lg border-input" />
                        <InputOTPSlot index={1} className="w-10 h-12 text-lg font-mono rounded-lg border-input" />
                        <InputOTPSlot index={2} className="w-10 h-12 text-lg font-mono rounded-lg border-input" />
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        <InputOTPSlot index={3} className="w-10 h-12 text-lg font-mono rounded-lg border-input" />
                        <InputOTPSlot index={4} className="w-10 h-12 text-lg font-mono rounded-lg border-input" />
                        <InputOTPSlot index={5} className="w-10 h-12 text-lg font-mono rounded-lg border-input" />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  <Button
                    className="w-full h-11 text-sm bg-primary hover:bg-primary/90 border border-border text-primary-foreground font-semibold transition-colors rounded-xl"
                    onClick={handleVerifyOtp}
                    disabled={isPhoneLoading || otpCode.length !== 6}
                    data-testid="button-verify-otp"
                  >
                    {isPhoneLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar e ingresar"}
                  </Button>

                  {otpSent && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground mt-2 inline-block"
                      onClick={() => {
                        setOtpSent(false);
                        setOtpCode("");
                        setDevCode(null);
                        setError("");
                        handleSendOtp();
                      }}
                    >
                      Reenviar c\u00f3digo
                    </button>
                  )}
                </div>
              </div>

              {/* Error / success messages */}
              {error && (
                <p className="text-sm text-red-700 text-center bg-red-50 border border-red-200 py-2 px-3 rounded-lg">
                  {error}
                </p>
              )}

              {successMessage && !error && otpSent && (
                <p className="text-sm text-emerald-700 text-center bg-emerald-50 border border-emerald-200 py-2 px-3 rounded-lg">
                  {successMessage}
                </p>
              )}
            </div>
          )}

          {!showPhoneAuth && (
            allowRegistration ? (
              <p className="text-center text-sm text-zinc-500 mt-6 fade-in-up fade-in-up-delay-5">
                \u00bfNo tienes una cuenta?{" "}
                <button
                  onClick={() => setLocation("/signup")}
                  className="text-foreground font-semibold hover:underline transition-colors"
                  data-testid="link-goto-signup"
                >
                  Suscr\u00edbete gratis
                </button>
              </p>
            ) : (
              supportEmail ? (
                <p className="text-center text-sm text-zinc-500 mt-6 fade-in-up fade-in-up-delay-5">
                  Registro cerrado. Soporte:{" "}
                  <a className="text-foreground font-semibold hover:underline" href={`mailto:${supportEmail}`}>
                    {supportEmail}
                  </a>
                </p>
              ) : null
            )
          )}
        </div>
      </div>
    </div>
  );
}
