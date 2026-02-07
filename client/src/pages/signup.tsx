import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Chrome, Apple, Building2, Phone, ArrowLeft, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";
import { validateEmail, validatePassword, validatePasswordMatch, getPasswordStrength } from "@/lib/validation";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { settings: platformSettings, isLoading: platformLoading } = usePlatformSettings();
  const allowRegistration = platformSettings.allow_registration;
  const supportEmail = (platformSettings.support_email || "").trim();
  const [step, setStep] = useState<"social" | "email">("social");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Validation results
  const emailValidation = useMemo(() => validateEmail(email), [email]);
  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const passwordMatchValidation = useMemo(() => validatePasswordMatch(password, confirmPassword), [password, confirmPassword]);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  const isFormValid = emailValidation.isValid && passwordValidation.isValid && passwordMatchValidation.isValid;

  const handleEmailContinue = () => {
    setTouched(prev => ({ ...prev, email: true }));
    if (emailValidation.isValid) {
      setStep("email");
    }
  };

  const handleSignup = () => {
    setTouched({ email: true, password: true, confirmPassword: true });
    if (isFormValid) {
      // Redirect to Replit Auth
      window.location.href = "/api/login";
    }
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  // Password strength indicator colors
  const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-lime-500', 'bg-green-500'];

  const handleSocialSignup = () => {
    // Redirect to Replit Auth (supports Google, Apple, etc.)
    window.location.href = "/api/login";
  };

  if (!platformLoading && !allowRegistration) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="w-full max-w-md relative space-y-4 bg-white/80 backdrop-blur-xl rounded-3xl p-8 shadow-xl shadow-fuchsia-100/30 border border-fuchsia-200/25">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-zinc-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-full"
            onClick={() => setLocation("/welcome")}
            data-testid="button-close-signup-disabled"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-2 mt-4">
            <h1 className="text-2xl font-bold mb-2 text-zinc-900">Registro deshabilitado</h1>
            <p className="text-zinc-500">
              En este momento no se aceptan nuevas cuentas.
            </p>
            {supportEmail ? (
              <p className="text-sm text-zinc-500 mt-2">
                Soporte:{" "}
                <a className="text-fuchsia-600 hover:text-fuchsia-500 hover:underline" href={`mailto:${supportEmail}`}>
                  {supportEmail}
                </a>
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-fuchsia-200 text-zinc-700 hover:bg-fuchsia-50 rounded-xl" onClick={() => setLocation("/login")}>
              Iniciar sesion
            </Button>
            <Button className="flex-1 bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-500 hover:to-purple-600 text-white rounded-xl" onClick={() => setLocation("/welcome")}>
              Volver
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "email") {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4 relative overflow-hidden">
        {/* Futuristic background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-fuchsia-300/15 rounded-full blur-3xl animate-[float_14s_ease-in-out_infinite]" />
          <div className="absolute -bottom-40 -left-40 w-[450px] h-[450px] bg-purple-300/12 rounded-full blur-3xl animate-[float_18s_ease-in-out_infinite_-6s]" />
        </div>

        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(192,38,211,0.04) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
          }}
        />

        <div className="w-full max-w-md relative z-10">
          <div className="gradient-border-animated">
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl shadow-fuchsia-100/30">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 left-4 text-zinc-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-full"
            onClick={() => setStep("social")}
            data-testid="button-back-signup"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-zinc-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-full"
            onClick={() => setLocation("/welcome")}
            data-testid="button-close-signup-email"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-8 mt-4">
            <h1 className="text-3xl font-bold mb-3 text-zinc-900">Crea tu cuenta</h1>
            <p className="text-zinc-500">
              Ingresa tu correo electrónico y crea una contraseña
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-email" className="text-zinc-700">Correo electrónico</Label>
              <Input
                id="signup-email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => handleBlur('email')}
                className={`h-12 text-base bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-fuchsia-200 rounded-xl ${touched.email && !emailValidation.isValid ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
                data-testid="input-signup-email"
              />
              {touched.email && !emailValidation.isValid && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {emailValidation.error}
                </p>
              )}
              {touched.email && emailValidation.warnings?.map((warning, i) => (
                <p key={i} className="text-sm text-yellow-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {warning}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password" className="text-zinc-700">Contraseña</Label>
              <div className="relative">
                <Input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => handleBlur('password')}
                  className={`h-12 text-base pr-10 bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-fuchsia-200 rounded-xl ${touched.password && !passwordValidation.isValid ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
                  data-testid="input-signup-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-12 w-12"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {touched.password && !passwordValidation.isValid && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {passwordValidation.error}
                </p>
              )}
              {/* Password strength indicator */}
              {password && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i <= passwordStrength.score ? strengthColors[passwordStrength.score] : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${passwordStrength.score >= 3 ? 'text-green-600' : passwordStrength.score >= 2 ? 'text-yellow-600' : 'text-red-500'}`}>
                    Fortaleza: {passwordStrength.label}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-confirm-password" className="text-zinc-700">Confirmar contraseña</Label>
              <div className="relative">
                <Input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repite tu contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => handleBlur('confirmPassword')}
                  className={`h-12 text-base pr-10 bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-fuchsia-200 rounded-xl ${touched.confirmPassword && !passwordMatchValidation.isValid ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
                  data-testid="input-signup-confirm-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-12 w-12"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  data-testid="button-toggle-confirm-password"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {touched.confirmPassword && !passwordMatchValidation.isValid && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {passwordMatchValidation.error}
                </p>
              )}
              {touched.confirmPassword && passwordMatchValidation.isValid && confirmPassword && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Las contraseñas coinciden
                </p>
              )}
            </div>

            <Button
              className="w-full h-12 text-base mt-4 bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-500 hover:to-purple-600 text-white font-medium shadow-lg shadow-fuchsia-300/30 hover:shadow-fuchsia-400/40 transition-all duration-300 rounded-xl"
              onClick={handleSignup}
              disabled={!isFormValid}
              data-testid="button-create-account"
            >
              Crear cuenta
            </Button>
          </div>

          <p className="text-center text-xs text-zinc-500 mt-6">
            Al crear una cuenta, aceptas nuestros{" "}
            <a href="#" className="text-fuchsia-600 hover:text-fuchsia-500 hover:underline">Términos de servicio</a>
            {" "}y{" "}
            <a href="#" className="text-fuchsia-600 hover:text-fuchsia-500 hover:underline">Política de privacidad</a>
          </p>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4 relative overflow-hidden">
      {/* Futuristic background mesh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-fuchsia-300/15 rounded-full blur-3xl animate-[float_14s_ease-in-out_infinite]" />
        <div className="absolute -bottom-40 -left-40 w-[450px] h-[450px] bg-purple-300/12 rounded-full blur-3xl animate-[float_18s_ease-in-out_infinite_-6s]" />
      </div>

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(192,38,211,0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md relative z-10">
        <div className="gradient-border-animated">
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl shadow-fuchsia-100/30">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-zinc-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded-full"
            onClick={() => setLocation("/welcome")}
            data-testid="button-close-signup"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-3 text-zinc-900">Crea tu cuenta</h1>
            <p className="text-zinc-500">
              Obtendrás respuestas más inteligentes, podrás cargar archivos e imágenes, y más.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full h-14 justify-center gap-3 text-base font-medium border-2 border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-900 hover:border-fuchsia-300/60 transition-all duration-200 rounded-xl shadow-sm"
              onClick={handleSocialSignup}
              data-testid="button-signup-google"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar con Google
            </Button>

            <Button
              variant="outline"
              className="w-full h-12 justify-start gap-3 text-base font-normal bg-zinc-50/50 border-zinc-200 text-zinc-400 cursor-not-allowed"
              disabled
              data-testid="button-signup-apple"
            >
              <Apple className="h-5 w-5" />
              Continuar con Apple
            </Button>

            <Button
              variant="outline"
              className="w-full h-12 justify-start gap-3 text-base font-normal bg-zinc-50/50 border-zinc-200 text-zinc-400 cursor-not-allowed"
              disabled
              data-testid="button-signup-microsoft"
            >
              <svg className="h-5 w-5" viewBox="0 0 23 23">
                <path fill="#f35325" d="M1 1h10v10H1z"/>
                <path fill="#81bc06" d="M12 1h10v10H12z"/>
                <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                <path fill="#ffba08" d="M12 12h10v10H12z"/>
              </svg>
              Continuar con Microsoft
            </Button>

            <Button
              variant="outline"
              className="w-full h-12 justify-start gap-3 text-base font-normal bg-zinc-50/50 border-zinc-200 text-zinc-400 cursor-not-allowed"
              disabled
              data-testid="button-signup-phone"
            >
              <Phone className="h-5 w-5" />
              Continuar con el teléfono
            </Button>
          </div>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />
            <span className="text-zinc-400 text-sm">o</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />
          </div>

          <div className="space-y-4">
            <Input
              type="email"
              placeholder="Dirección de correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 text-base bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-fuchsia-200 rounded-xl"
              data-testid="input-signup-email-initial"
            />
            <Button
              className="w-full h-12 text-base bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-500 hover:to-purple-600 text-white font-medium shadow-lg shadow-fuchsia-300/30 hover:shadow-fuchsia-400/40 transition-all duration-300 rounded-xl"
              onClick={handleEmailContinue}
              disabled={!email}
              data-testid="button-signup-continue"
            >
              Continuar
            </Button>
          </div>

          <p className="text-center text-sm text-zinc-500 mt-6">
            ¿Ya tienes una cuenta?{" "}
            <button
              onClick={() => setLocation("/login")}
              className="text-fuchsia-600 hover:text-fuchsia-500 hover:underline font-medium transition-colors"
              data-testid="link-goto-login"
            >
              Inicia sesión
            </button>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
