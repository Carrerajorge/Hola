import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Bell, Moon, Globe, Volume2, Keyboard, Palette } from "lucide-react";

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const [notifications, setNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [language, setLanguage] = useState("es");

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-settings"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Configuración</h1>
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Notificaciones</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Notificaciones push</p>
                    <p className="text-sm text-muted-foreground">Recibir alertas en el navegador</p>
                  </div>
                </div>
                <Switch 
                  checked={notifications} 
                  onCheckedChange={setNotifications}
                  data-testid="switch-notifications"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Notificaciones por email</p>
                    <p className="text-sm text-muted-foreground">Recibir resúmenes y alertas</p>
                  </div>
                </div>
                <Switch 
                  checked={emailNotifications} 
                  onCheckedChange={setEmailNotifications}
                  data-testid="switch-email-notifications"
                />
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Apariencia</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Moon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Modo oscuro</p>
                    <p className="text-sm text-muted-foreground">Tema oscuro para la interfaz</p>
                  </div>
                </div>
                <Switch 
                  checked={darkMode} 
                  onCheckedChange={setDarkMode}
                  data-testid="switch-dark-mode"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Volume2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Efectos de sonido</p>
                    <p className="text-sm text-muted-foreground">Sonidos al enviar mensajes</p>
                  </div>
                </div>
                <Switch 
                  checked={soundEffects} 
                  onCheckedChange={setSoundEffects}
                  data-testid="switch-sound-effects"
                />
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Idioma y región</h2>
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Idioma</p>
                    <p className="text-sm text-muted-foreground">Idioma de la interfaz</p>
                  </div>
                </div>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-40" data-testid="select-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="pt">Português</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Accesos directos</h2>
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Keyboard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Atajos de teclado</p>
                    <p className="text-sm text-muted-foreground">Ver y personalizar atajos</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" data-testid="button-keyboard-shortcuts">
                  Ver atajos
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
