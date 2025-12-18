import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Settings, 
  Bell, 
  Palette, 
  AppWindow, 
  Calendar, 
  Database, 
  Shield, 
  User,
  X,
  Play
} from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsSection = "general" | "notifications" | "personalization" | "apps" | "schedules" | "data" | "security" | "account";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const menuItems: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "notifications", label: "Notificaciones", icon: <Bell className="h-4 w-4" /> },
  { id: "personalization", label: "Personalización", icon: <Palette className="h-4 w-4" /> },
  { id: "apps", label: "Aplicaciones", icon: <AppWindow className="h-4 w-4" /> },
  { id: "schedules", label: "Programaciones", icon: <Calendar className="h-4 w-4" /> },
  { id: "data", label: "Controles de datos", icon: <Database className="h-4 w-4" /> },
  { id: "security", label: "Seguridad", icon: <Shield className="h-4 w-4" /> },
  { id: "account", label: "Cuenta", icon: <User className="h-4 w-4" /> },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [appearance, setAppearance] = useState("system");
  const [accentColor, setAccentColor] = useState("default");
  const [language, setLanguage] = useState("auto");
  const [spokenLanguage, setSpokenLanguage] = useState("auto");
  const [voice, setVoice] = useState("cove");
  const [independentVoiceMode, setIndependentVoiceMode] = useState(false);
  const [showAdditionalModels, setShowAdditionalModels] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">General</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Aspecto</span>
                <Select value={appearance} onValueChange={setAppearance}>
                  <SelectTrigger className="w-40" data-testid="select-appearance">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">Sistema</SelectItem>
                    <SelectItem value="light">Claro</SelectItem>
                    <SelectItem value="dark">Oscuro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Color de acento</span>
                <Select value={accentColor} onValueChange={setAccentColor}>
                  <SelectTrigger className="w-40" data-testid="select-accent-color">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-primary" />
                        Predeterminada
                      </div>
                    </SelectItem>
                    <SelectItem value="blue">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                        Azul
                      </div>
                    </SelectItem>
                    <SelectItem value="green">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                        Verde
                      </div>
                    </SelectItem>
                    <SelectItem value="purple">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-purple-500" />
                        Morado
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Idioma</span>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-40" data-testid="select-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="pt">Português</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm block">Idioma hablado</span>
                  <span className="text-xs text-muted-foreground">
                    Para obtener mejores resultados, selecciona el idioma principal. Si no está incluido, podría estar disponible a través de la detección automática.
                  </span>
                </div>
                <Select value={spokenLanguage} onValueChange={setSpokenLanguage}>
                  <SelectTrigger className="w-40 shrink-0" data-testid="select-spoken-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Voz</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="gap-1">
                    <Play className="h-3 w-3" />
                    Reproducir
                  </Button>
                  <Select value={voice} onValueChange={setVoice}>
                    <SelectTrigger className="w-28" data-testid="select-voice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cove">Cove</SelectItem>
                      <SelectItem value="ember">Ember</SelectItem>
                      <SelectItem value="juniper">Juniper</SelectItem>
                      <SelectItem value="breeze">Breeze</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm block">Modo de voz independiente</span>
                  <span className="text-xs text-muted-foreground">
                    Mantén Sira Voice en una pantalla completa independiente, sin transcripciones ni elementos visuales en tiempo real.
                  </span>
                </div>
                <Switch 
                  checked={independentVoiceMode} 
                  onCheckedChange={setIndependentVoiceMode}
                  data-testid="switch-voice-mode"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Mostrar modelos adicionales</span>
                <Switch 
                  checked={showAdditionalModels} 
                  onCheckedChange={setShowAdditionalModels}
                  data-testid="switch-additional-models"
                />
              </div>
            </div>
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Notificaciones</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm block">Notificaciones push</span>
                  <span className="text-xs text-muted-foreground">
                    Recibir alertas en el navegador
                  </span>
                </div>
                <Switch 
                  checked={pushNotifications} 
                  onCheckedChange={setPushNotifications}
                  data-testid="switch-push-notifications"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm block">Notificaciones por email</span>
                  <span className="text-xs text-muted-foreground">
                    Recibir resúmenes y alertas importantes
                  </span>
                </div>
                <Switch 
                  checked={emailNotifications} 
                  onCheckedChange={setEmailNotifications}
                  data-testid="switch-email-notifications"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="text-sm block">Sonidos</span>
                  <span className="text-xs text-muted-foreground">
                    Reproducir sonidos al enviar y recibir mensajes
                  </span>
                </div>
                <Switch 
                  checked={soundEnabled} 
                  onCheckedChange={setSoundEnabled}
                  data-testid="switch-sound"
                />
              </div>
            </div>
          </div>
        );

      case "personalization":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Personalización</h2>
            <p className="text-sm text-muted-foreground">
              Personaliza cómo Sira responde y se comporta contigo.
            </p>
            <div className="text-sm text-muted-foreground">
              Próximamente: instrucciones personalizadas, memoria y preferencias de estilo.
            </div>
          </div>
        );

      case "apps":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Aplicaciones</h2>
            <p className="text-sm text-muted-foreground">
              Administra las aplicaciones conectadas y los GPTs personalizados.
            </p>
            <div className="text-sm text-muted-foreground">
              No tienes aplicaciones conectadas aún.
            </div>
          </div>
        );

      case "schedules":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Programaciones</h2>
            <p className="text-sm text-muted-foreground">
              Configura tareas automáticas y recordatorios.
            </p>
            <div className="text-sm text-muted-foreground">
              No tienes programaciones activas.
            </div>
          </div>
        );

      case "data":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Controles de datos</h2>
            <p className="text-sm text-muted-foreground">
              Administra tus datos y privacidad.
            </p>
            <div className="space-y-4">
              <Button variant="outline" className="w-full justify-start">
                Exportar mis datos
              </Button>
              <Button variant="outline" className="w-full justify-start text-red-500 hover:text-red-600">
                Eliminar historial de chats
              </Button>
            </div>
          </div>
        );

      case "security":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Seguridad</h2>
            <p className="text-sm text-muted-foreground">
              Configura la seguridad de tu cuenta.
            </p>
            <div className="space-y-4">
              <Button variant="outline" className="w-full justify-start">
                Cambiar contraseña
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Autenticación de dos factores
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Sesiones activas
              </Button>
            </div>
          </div>
        );

      case "account":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Cuenta</h2>
            <p className="text-sm text-muted-foreground">
              Administra tu información de cuenta.
            </p>
            <div className="space-y-4">
              <Button variant="outline" className="w-full justify-start">
                Editar perfil
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Plan y facturación
              </Button>
              <Button variant="outline" className="w-full justify-start text-red-500 hover:text-red-600">
                Eliminar cuenta
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <div className="flex h-[500px]">
          <div className="w-48 border-r bg-muted/30 p-2">
            <div className="flex items-center justify-between p-2 mb-2">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-settings"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="space-y-1">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                    activeSection === item.id 
                      ? "bg-background font-medium" 
                      : "hover:bg-background/50 text-muted-foreground"
                  )}
                  data-testid={`settings-menu-${item.id}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto">
            {renderSectionContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
