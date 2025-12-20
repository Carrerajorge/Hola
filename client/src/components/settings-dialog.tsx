import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
  Play,
  ChevronRight,
  Plus,
  Github,
  Globe,
  Linkedin,
  Info,
  Mail,
  Box,
  Loader2,
  Check,
  Volume2
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/App";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

const voices = [
  { id: "cove", name: "Cove", description: "Voz cálida y amigable" },
  { id: "ember", name: "Ember", description: "Voz enérgica y dinámica" },
  { id: "juniper", name: "Juniper", description: "Voz clara y profesional" },
  { id: "breeze", name: "Breeze", description: "Voz suave y relajante" },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
  
  const { settings, updateSetting } = useSettingsContext();
  const { language: currentLanguage, setLanguage: setAppLanguage, supportedLanguages } = useLanguage();
  const { toast } = useToast();
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  const handleLanguageChange = (value: string) => {
    if (value !== "auto") {
      setAppLanguage(value as any);
    }
  };

  const playVoicePreview = (voiceId: string) => {
    setPlayingVoice(voiceId);
    const utterance = new SpeechSynthesisUtterance("Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?");
    utterance.lang = "es-ES";
    utterance.rate = 1;
    utterance.pitch = voiceId === "ember" ? 1.2 : voiceId === "breeze" ? 0.9 : 1;
    utterance.onend = () => setPlayingVoice(null);
    utterance.onerror = () => setPlayingVoice(null);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const archiveAllChats = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/chats/archive-all", { method: "POST" });
      if (!response.ok) throw new Error("Failed to archive chats");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      toast({ title: "Chats archivados", description: "Todos los chats han sido archivados correctamente." });
      setShowArchiveConfirm(false);
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron archivar los chats.", variant: "destructive" });
    },
  });

  const deleteAllChats = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/chats/delete-all", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete chats");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      toast({ title: "Chats eliminados", description: "Todos los chats han sido eliminados permanentemente." });
      setShowDeleteConfirm(false);
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron eliminar los chats.", variant: "destructive" });
    },
  });

  const handleLogout = () => {
    logout();
    onOpenChange(false);
    toast({ title: "Sesión cerrada", description: "Has cerrado sesión correctamente." });
  };

  const handleLogoutAll = () => {
    logout();
    onOpenChange(false);
    toast({ title: "Todas las sesiones cerradas", description: "Se han cerrado todas las sesiones activas." });
    setShowLogoutAllConfirm(false);
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">General</h2>
            
            {/* Display Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Pantalla</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Tema</span>
                    <span className="text-xs text-muted-foreground">Selecciona el aspecto visual de la aplicación</span>
                  </div>
                  <Select 
                    value={settings.appearance} 
                    onValueChange={(value) => updateSetting("appearance", value as any)}
                  >
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
                  <div>
                    <span className="text-sm block">Color de acento</span>
                    <span className="text-xs text-muted-foreground">Color principal de la interfaz</span>
                  </div>
                  <Select 
                    value={settings.accentColor} 
                    onValueChange={(value) => updateSetting("accentColor", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-accent-color">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-foreground" />
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
                      <SelectItem value="orange">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-orange-500" />
                          Naranja
                        </div>
                      </SelectItem>
                      <SelectItem value="pink">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-pink-500" />
                          Rosa
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Tamaño de fuente</span>
                    <span className="text-xs text-muted-foreground">Ajusta el tamaño del texto</span>
                  </div>
                  <Select 
                    value={settings.fontSize} 
                    onValueChange={(value) => updateSetting("fontSize", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-font-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Pequeño</SelectItem>
                      <SelectItem value="medium">Mediano</SelectItem>
                      <SelectItem value="large">Grande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Densidad</span>
                    <span className="text-xs text-muted-foreground">Espaciado entre elementos</span>
                  </div>
                  <Select 
                    value={settings.density} 
                    onValueChange={(value) => updateSetting("density", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-density">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compact">Compacto</SelectItem>
                      <SelectItem value="comfortable">Cómodo</SelectItem>
                      <SelectItem value="spacious">Espacioso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Language & Region Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Idioma y región</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Idioma de la interfaz</span>
                  <Select value={currentLanguage} onValueChange={handleLanguageChange}>
                    <SelectTrigger className="w-40" data-testid="select-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {supportedLanguages.map(lang => (
                        <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Idioma hablado</span>
                    <span className="text-xs text-muted-foreground">Para reconocimiento de voz</span>
                  </div>
                  <Select 
                    value={settings.spokenLanguage} 
                    onValueChange={(value) => updateSetting("spokenLanguage", value)}
                  >
                    <SelectTrigger className="w-40 shrink-0" data-testid="select-spoken-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automático</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="pt">Português</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Formato de fecha</span>
                  <Select 
                    value={settings.dateFormat} 
                    onValueChange={(value) => updateSetting("dateFormat", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-date-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd/mm/yyyy">DD/MM/AAAA</SelectItem>
                      <SelectItem value="mm/dd/yyyy">MM/DD/AAAA</SelectItem>
                      <SelectItem value="yyyy-mm-dd">AAAA-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Formato de hora</span>
                  <Select 
                    value={settings.timeFormat} 
                    onValueChange={(value) => updateSetting("timeFormat", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-time-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">24 horas</SelectItem>
                      <SelectItem value="12h">12 horas (AM/PM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Voice & Audio Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Voz y audio</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Voz del asistente</span>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="gap-1"
                      onClick={() => playVoicePreview(settings.voice)}
                      disabled={playingVoice !== null}
                      data-testid="button-play-voice"
                    >
                      {playingVoice === settings.voice ? (
                        <Volume2 className="h-3 w-3 animate-pulse" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </Button>
                    <Select 
                      value={settings.voice} 
                      onValueChange={(value) => updateSetting("voice", value)}
                    >
                      <SelectTrigger className="w-28" data-testid="select-voice">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {voices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Reproducir respuestas automáticamente</span>
                    <span className="text-xs text-muted-foreground">Lee las respuestas en voz alta</span>
                  </div>
                  <Switch 
                    checked={settings.autoPlayResponses} 
                    onCheckedChange={(checked) => updateSetting("autoPlayResponses", checked)}
                    data-testid="switch-auto-play"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Modo de voz independiente</span>
                    <span className="text-xs text-muted-foreground">Pantalla completa sin elementos visuales</span>
                  </div>
                  <Switch 
                    checked={settings.independentVoiceMode} 
                    onCheckedChange={(checked) => updateSetting("independentVoiceMode", checked)}
                    data-testid="switch-voice-mode"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* AI Models Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Modelos de IA</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Modelo predeterminado</span>
                    <span className="text-xs text-muted-foreground">Modelo para nuevas conversaciones</span>
                  </div>
                  <Select 
                    value={settings.defaultModel} 
                    onValueChange={(value) => updateSetting("defaultModel", value)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-default-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                      <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                      <SelectItem value="grok-3-fast">Grok 3 Fast</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Mostrar modelos adicionales</span>
                    <span className="text-xs text-muted-foreground">Ver todos los modelos disponibles</span>
                  </div>
                  <Switch 
                    checked={settings.showAdditionalModels} 
                    onCheckedChange={(checked) => updateSetting("showAdditionalModels", checked)}
                    data-testid="switch-additional-models"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Transmitir respuestas</span>
                    <span className="text-xs text-muted-foreground">Ver las respuestas mientras se generan</span>
                  </div>
                  <Switch 
                    checked={settings.streamResponses} 
                    onCheckedChange={(checked) => updateSetting("streamResponses", checked)}
                    data-testid="switch-stream"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Accessibility Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Accesibilidad</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Atajos de teclado</span>
                    <span className="text-xs text-muted-foreground">Habilitar navegación con teclado</span>
                  </div>
                  <Switch 
                    checked={settings.keyboardShortcuts} 
                    onCheckedChange={(checked) => updateSetting("keyboardShortcuts", checked)}
                    data-testid="switch-keyboard"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Reducir movimiento</span>
                    <span className="text-xs text-muted-foreground">Minimizar animaciones</span>
                  </div>
                  <Switch 
                    checked={settings.reducedMotion} 
                    onCheckedChange={(checked) => updateSetting("reducedMotion", checked)}
                    data-testid="switch-motion"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Alto contraste</span>
                    <span className="text-xs text-muted-foreground">Mejorar visibilidad de elementos</span>
                  </div>
                  <Switch 
                    checked={settings.highContrast} 
                    onCheckedChange={(checked) => updateSetting("highContrast", checked)}
                    data-testid="switch-contrast"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Notificaciones</h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Respuestas</span>
                  <Select 
                    value={settings.notifResponses} 
                    onValueChange={(value) => updateSetting("notifResponses", value as any)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-notif-responses">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="push">Push</SelectItem>
                      <SelectItem value="email">Correo electrónico</SelectItem>
                      <SelectItem value="push_email">Push, correo electrónico</SelectItem>
                      <SelectItem value="none">Ninguna</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  Recibe notificaciones cuando MICHAT responda a solicitudes que tomen tiempo.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Tareas</span>
                  <Select 
                    value={settings.notifTasks} 
                    onValueChange={(value) => updateSetting("notifTasks", value as any)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-notif-tasks">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="push">Push</SelectItem>
                      <SelectItem value="email">Correo electrónico</SelectItem>
                      <SelectItem value="push_email">Push, correo electrónico</SelectItem>
                      <SelectItem value="none">Ninguna</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  Recibe una notificación cuando haya actualizaciones de las tareas que creaste.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Projects</span>
                  <Select 
                    value={settings.notifProjects} 
                    onValueChange={(value) => updateSetting("notifProjects", value as any)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-notif-projects">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="push">Push</SelectItem>
                      <SelectItem value="email">Correo electrónico</SelectItem>
                      <SelectItem value="push_email">Push, correo electrónico</SelectItem>
                      <SelectItem value="none">Ninguna</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  Recibe una notificación cuando te llegue una invitación por correo electrónico.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Recomendaciones</span>
                  <Select 
                    value={settings.notifRecommendations} 
                    onValueChange={(value) => updateSetting("notifRecommendations", value as any)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-notif-recommendations">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="push">Push</SelectItem>
                      <SelectItem value="email">Correo electrónico</SelectItem>
                      <SelectItem value="push_email">Push, correo electrónico</SelectItem>
                      <SelectItem value="none">Ninguna</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  Mantente al tanto de las nuevas herramientas, consejos y características.
                </p>
              </div>
            </div>
          </div>
        );

      case "personalization":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Personalización</h2>
            
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm font-medium">Estilo y tonos de base</span>
                  <p className="text-sm text-muted-foreground">
                    Configura el estilo y el tono que MICHAT utiliza al responder.
                  </p>
                </div>
                <Select 
                  value={settings.styleAndTone} 
                  onValueChange={(value) => updateSetting("styleAndTone", value as any)}
                >
                  <SelectTrigger className="w-40" data-testid="select-style-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Predeterminada</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="concise">Conciso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Instrucciones personalizadas</span>
              <Textarea 
                placeholder="Preferencias adicionales de comportamiento, estilo y tono"
                value={settings.customInstructions}
                onChange={(e) => updateSetting("customInstructions", e.target.value)}
                className="min-h-[80px]"
                data-testid="textarea-custom-instructions"
              />
            </div>

            <Separator />

            <h3 className="text-lg font-medium">Acerca de ti</h3>

            <div className="space-y-2">
              <span className="text-sm font-medium">Apodo</span>
              <Input 
                placeholder="¿Cómo debería llamarte MICHAT?"
                value={settings.nickname}
                onChange={(e) => updateSetting("nickname", e.target.value)}
                data-testid="input-nickname"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Ocupación</span>
              <Input 
                placeholder="Estudiante de ingeniería, diseñador, etc."
                value={settings.occupation}
                onChange={(e) => updateSetting("occupation", e.target.value)}
                data-testid="input-occupation"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Más acerca de ti</span>
              <Textarea 
                placeholder="Intereses, valores o preferencias para tener en cuenta"
                value={settings.aboutYou}
                onChange={(e) => updateSetting("aboutYou", e.target.value)}
                className="min-h-[80px]"
                data-testid="textarea-about-you"
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Permite que MICHAT guarde y use memorias al responder.</span>
                </div>
                <Switch 
                  checked={settings.allowMemories} 
                  onCheckedChange={(checked) => updateSetting("allowMemories", checked)}
                  data-testid="switch-memories"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Consultar el historial de grabaciones</span>
                  <span className="text-xs text-muted-foreground">
                    Permite que MICHAT consulte transcripciones y notas de grabaciones anteriores.
                  </span>
                </div>
                <Switch 
                  checked={settings.allowRecordings} 
                  onCheckedChange={(checked) => updateSetting("allowRecordings", checked)}
                  data-testid="switch-recordings"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Búsqueda en la web</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que MICHAT busque automáticamente las respuestas en la web.
                  </span>
                </div>
                <Switch 
                  checked={settings.webSearch} 
                  onCheckedChange={(checked) => updateSetting("webSearch", checked)}
                  data-testid="switch-web-search"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Código</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que MICHAT ejecute el código con el Intérprete de código.
                  </span>
                </div>
                <Switch 
                  checked={settings.codeInterpreter} 
                  onCheckedChange={(checked) => updateSetting("codeInterpreter", checked)}
                  data-testid="switch-code"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Lienzo</span>
                  <span className="text-xs text-muted-foreground">
                    Colaborar con MICHAT en texto y código.
                  </span>
                </div>
                <Switch 
                  checked={settings.canvas} 
                  onCheckedChange={(checked) => updateSetting("canvas", checked)}
                  data-testid="switch-canvas"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">MICHAT Voice</span>
                  <span className="text-xs text-muted-foreground">
                    Habilitar el modo de voz en MICHAT
                  </span>
                </div>
                <Switch 
                  checked={settings.voiceMode} 
                  onCheckedChange={(checked) => updateSetting("voiceMode", checked)}
                  data-testid="switch-voice"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Modo de voz avanzado</span>
                  <span className="text-xs text-muted-foreground">
                    Ten conversaciones más naturales en el modo de voz.
                  </span>
                </div>
                <Switch 
                  checked={settings.advancedVoice} 
                  onCheckedChange={(checked) => updateSetting("advancedVoice", checked)}
                  data-testid="switch-advanced-voice"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Búsqueda del conector</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que MICHAT busque automáticamente las respuestas en las fuentes conectadas.
                  </span>
                </div>
                <Switch 
                  checked={settings.connectorSearch} 
                  onCheckedChange={(checked) => updateSetting("connectorSearch", checked)}
                  data-testid="switch-connector-search"
                />
              </div>
            </div>
          </div>
        );

      case "apps":
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Aplicaciones habilitadas</h2>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-add-app">
                <Plus className="h-4 w-4" />
                Agregar más
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Administra las aplicaciones habilitadas que MICHAT puede usar en tus chats.
            </p>
            
            <div className="space-y-1">
              <button 
                className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                data-testid="app-github"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center">
                    <Github className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-medium">GitHub</span>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>

              <Separator />

              <button 
                className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                data-testid="app-teams"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#464EB8] flex items-center justify-center">
                    <span className="text-white font-bold text-sm">T</span>
                  </div>
                  <span className="text-sm font-medium">Teams</span>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>

              <Separator />

              <button 
                className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                data-testid="app-advanced-config"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <Settings className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium">Configuración avanzada</span>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
          </div>
        );

      case "schedules":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Programaciones</h2>
            <p className="text-sm text-muted-foreground">
              MICHAT puede programarse para ejecutarse nuevamente después de completar una tarea. 
              Selecciona <span className="inline-flex items-center"><Calendar className="h-3 w-3 mx-1" /></span> Programar en el menú de <span className="font-medium">⋯</span> en una conversación para configurar ejecuciones futuras.
            </p>
            <Button variant="outline" data-testid="button-manage-schedules">
              Administrar
            </Button>
          </div>
        );

      case "data":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Controles de datos</h2>
            
            <div className="space-y-1">
              <button 
                className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
                onClick={() => updateSetting("improveModel", !settings.improveModel)}
                data-testid="data-improve-model"
              >
                <span className="text-sm">Mejora el modelo para todos</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  {settings.improveModel ? "Activado" : "Desactivado"} <ChevronRight className="h-4 w-4" />
                </span>
              </button>

              <button 
                className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
                onClick={() => updateSetting("remoteBrowser", !settings.remoteBrowser)}
                data-testid="data-remote-browser"
              >
                <span className="text-sm">Datos del navegador remoto</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  {settings.remoteBrowser ? "Activado" : "Desactivado"} <ChevronRight className="h-4 w-4" />
                </span>
              </button>

              <div className="flex items-center justify-between py-3 px-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Comparte tu ubicación precisa</span>
                  <span className="text-xs text-muted-foreground">
                    Permite que MICHAT utilice la ubicación precisa de tu dispositivo al responder preguntas.
                  </span>
                </div>
                <Switch 
                  checked={settings.shareLocation}
                  onCheckedChange={(checked) => updateSetting("shareLocation", checked)}
                  data-testid="switch-location" 
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Chats archivados</span>
                <Button variant="outline" size="sm" data-testid="button-manage-archived">
                  Administrar
                </Button>
              </div>

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Archivar todos los chats</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowArchiveConfirm(true)}
                  disabled={archiveAllChats.isPending}
                  data-testid="button-archive-all"
                >
                  {archiveAllChats.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Archivar todo"
                  )}
                </Button>
              </div>

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Eliminar todos los chats</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteAllChats.isPending}
                  data-testid="button-delete-all"
                >
                  {deleteAllChats.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Eliminar todo"
                  )}
                </Button>
              </div>
            </div>
          </div>
        );

      case "security":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Seguridad</h2>
            
            <div className="space-y-4">
              <h3 className="text-base font-medium">Autenticación multifactor (MFA)</h3>
              
              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Aplicación de autenticación</span>
                  <span className="text-xs text-muted-foreground">
                    Usa códigos únicos desde una aplicación de autenticación.
                  </span>
                </div>
                <Switch 
                  checked={settings.authApp}
                  onCheckedChange={(checked) => updateSetting("authApp", checked)}
                  data-testid="switch-auth-app" 
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Notificaciones push</span>
                  <span className="text-xs text-muted-foreground">
                    Aprueba los inicios de sesión con una notificación push enviada a tu dispositivo de confianza
                  </span>
                </div>
                <Switch 
                  checked={settings.pushNotifications}
                  onCheckedChange={(checked) => updateSetting("pushNotifications", checked)}
                  data-testid="switch-push-notif" 
                />
              </div>

              <button 
                className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
                data-testid="security-trusted-devices"
              >
                <span className="text-sm">Dispositivos de confianza</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  1 <ChevronRight className="h-4 w-4" />
                </span>
              </button>

              <Separator />

              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Cerrar la sesión en este dispositivo</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleLogout}
                  data-testid="button-logout"
                >
                  Cerrar sesión
                </Button>
              </div>

              <div className="flex items-start justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Cerrar sesión en todos los dispositivos</span>
                  <span className="text-xs text-muted-foreground">
                    Cierra todas las sesiones activas en todos los dispositivos.
                  </span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 whitespace-nowrap"
                  onClick={() => setShowLogoutAllConfirm(true)}
                  data-testid="button-logout-all"
                >
                  Cerrar todas las sesiones
                </Button>
              </div>

              <Separator />

              <div className="pt-2">
                <h3 className="text-base font-medium">Inicio de sesión seguro con MICHAT</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Inicia sesión en sitios web y aplicaciones en toda la red con la seguridad confiable de MICHAT.
                </p>
              </div>
            </div>
          </div>
        );

      case "account":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Perfil de constructor de GPT</h2>
            <p className="text-sm text-muted-foreground">
              Personaliza tu perfil de constructor para conectarte con usuarios de los GPT.
            </p>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <Box className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <span className="text-sm font-medium block">
                    {settings.nickname || "PlaceholderGPT"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Por {settings.nickname || "Usuario"}
                  </span>
                </div>
              </div>
              <span className="text-sm text-muted-foreground">Vista previa</span>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Nombre</span>
                <Switch 
                  checked={settings.showName}
                  onCheckedChange={(checked) => updateSetting("showName", checked)}
                  data-testid="switch-show-name" 
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm">{settings.nickname || "Usuario"}</span>
                <Info className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <span className="font-medium">Enlaces</span>
              
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                </div>
                <Select 
                  value={settings.websiteDomain || "none"}
                  onValueChange={(value) => updateSetting("websiteDomain", value === "none" ? "" : value)}
                >
                  <SelectTrigger className="w-48" data-testid="select-domain">
                    <SelectValue placeholder="Seleccionar un dominio" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    <SelectItem value="custom">Dominio personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Linkedin className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">LinkedIn</span>
                </div>
                {settings.linkedInUrl ? (
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => updateSetting("linkedInUrl", "")}
                    >
                      Eliminar
                    </Button>
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      const url = prompt("Ingresa tu URL de LinkedIn:");
                      if (url) updateSetting("linkedInUrl", url);
                    }}
                    data-testid="button-add-linkedin"
                  >
                    Agregar
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Github className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">GitHub</span>
                </div>
                {settings.githubUrl ? (
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => updateSetting("githubUrl", "")}
                    >
                      Eliminar
                    </Button>
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      const url = prompt("Ingresa tu URL de GitHub:");
                      if (url) updateSetting("githubUrl", url);
                    }}
                    data-testid="button-add-github"
                  >
                    Agregar
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <span className="font-medium">Correo electrónico</span>
              
              <div className="flex items-center gap-3 py-2">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">usuario@ejemplo.com</span>
              </div>

              <div className="flex items-center gap-3 py-2">
                <Checkbox 
                  id="email-comments" 
                  checked={settings.receiveEmailComments}
                  onCheckedChange={(checked) => updateSetting("receiveEmailComments", !!checked)}
                  data-testid="checkbox-email-comments" 
                />
                <label htmlFor="email-comments" className="text-sm">
                  Recibir correos electrónicos con comentarios
                </label>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
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

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar todos los chats?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán permanentemente todos tus chats y mensajes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteAllChats.mutate()}
              className="bg-red-500 hover:bg-red-600"
            >
              Eliminar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar todos los chats?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos tus chats serán archivados. Podrás acceder a ellos desde la sección de chats archivados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveAllChats.mutate()}>
              Archivar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showLogoutAllConfirm} onOpenChange={setShowLogoutAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar todas las sesiones?</AlertDialogTitle>
            <AlertDialogDescription>
              Se cerrarán todas las sesiones activas en todos los dispositivos, incluida tu sesión actual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleLogoutAll}
              className="bg-red-500 hover:bg-red-600"
            >
              Cerrar todas las sesiones
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
