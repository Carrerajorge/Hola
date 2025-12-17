import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Chrome, Apple, Building2, Phone, ArrowLeft, Eye, EyeOff } from "lucide-react";

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"social" | "email">("social");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleEmailContinue = () => {
    if (email) {
      setStep("email");
    }
  };

  const handleSignup = () => {
    if (password && password === confirmPassword) {
      setLocation("/");
    }
  };

  if (step === "email") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md relative">
          <Button 
            variant="ghost" 
            size="icon"
            className="absolute -top-2 -left-2"
            onClick={() => setStep("social")}
            data-testid="button-back-signup"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <Button 
            variant="ghost" 
            size="icon"
            className="absolute -top-2 -right-2"
            onClick={() => setLocation("/")}
            data-testid="button-close-signup-email"
          >
            <X className="h-5 w-5" />
          </Button>

          <div className="text-center mb-8 mt-4">
            <h1 className="text-3xl font-semibold mb-3">Crea tu cuenta</h1>
            <p className="text-muted-foreground">
              Ingresa tu correo electrónico y crea una contraseña
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-email">Correo electrónico</Label>
              <Input 
                id="signup-email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 text-base"
                data-testid="input-signup-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password">Contraseña</Label>
              <div className="relative">
                <Input 
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-base pr-10"
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-confirm-password">Confirmar contraseña</Label>
              <div className="relative">
                <Input 
                  id="signup-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repite tu contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-12 text-base pr-10"
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
              {confirmPassword && password !== confirmPassword && (
                <p className="text-sm text-red-500">Las contraseñas no coinciden</p>
              )}
            </div>

            <Button 
              className="w-full h-12 text-base mt-4"
              onClick={handleSignup}
              disabled={!email || !password || password !== confirmPassword || password.length < 8}
              data-testid="button-create-account"
            >
              Crear cuenta
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Al crear una cuenta, aceptas nuestros{" "}
            <a href="#" className="text-primary hover:underline">Términos de servicio</a>
            {" "}y{" "}
            <a href="#" className="text-primary hover:underline">Política de privacidad</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md relative">
        <Button 
          variant="ghost" 
          size="icon"
          className="absolute -top-2 -right-2"
          onClick={() => setLocation("/")}
          data-testid="button-close-signup"
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold mb-3">Crea tu cuenta</h1>
          <p className="text-muted-foreground">
            Obtendrás respuestas más inteligentes, podrás cargar archivos e imágenes, y más.
          </p>
        </div>

        <div className="space-y-3">
          <Button 
            variant="outline" 
            className="w-full h-12 justify-start gap-3 text-base font-normal"
            data-testid="button-signup-google"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continuar con Google
          </Button>

          <Button 
            variant="outline" 
            className="w-full h-12 justify-start gap-3 text-base font-normal"
            data-testid="button-signup-apple"
          >
            <Apple className="h-5 w-5" />
            Continuar con Apple
          </Button>

          <Button 
            variant="outline" 
            className="w-full h-12 justify-start gap-3 text-base font-normal"
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
            className="w-full h-12 justify-start gap-3 text-base font-normal"
            data-testid="button-signup-phone"
          >
            <Phone className="h-5 w-5" />
            Continuar con el teléfono
          </Button>
        </div>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-sm">o</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-4">
          <Input 
            type="email"
            placeholder="Dirección de correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
            data-testid="input-signup-email-initial"
          />
          <Button 
            className="w-full h-12 text-base"
            onClick={handleEmailContinue}
            disabled={!email}
            data-testid="button-signup-continue"
          >
            Continuar
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          ¿Ya tienes una cuenta?{" "}
          <button 
            onClick={() => setLocation("/login")}
            className="text-primary hover:underline"
            data-testid="link-goto-login"
          >
            Inicia sesión
          </button>
        </p>
      </div>
    </div>
  );
}
