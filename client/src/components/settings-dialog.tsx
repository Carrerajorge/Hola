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
  Box
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [notifResponses, setNotifResponses] = useState("push");
  const [notifTasks, setNotifTasks] = useState("push_email");
  const [notifProjects, setNotifProjects] = useState("email");
  const [notifRecommendations, setNotifRecommendations] = useState("push_email");
  const [styleAndTone, setStyleAndTone] = useState("default");
  const [customInstructions, setCustomInstructions] = useState("");
  const [nickname, setNickname] = useState("");
  const [occupation, setOccupation] = useState("");
  const [aboutYou, setAboutYou] = useState("");
  const [allowMemories, setAllowMemories] = useState(true);
  const [allowRecordings, setAllowRecordings] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [codeInterpreter, setCodeInterpreter] = useState(true);
  const [canvas, setCanvas] = useState(true);
  const [voiceMode, setVoiceMode] = useState(true);
  const [advancedVoice, setAdvancedVoice] = useState(false);
  const [connectorSearch, setConnectorSearch] = useState(false);

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
            
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Respuestas</span>
                  <Select value={notifResponses} onValueChange={setNotifResponses}>
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
                  Recibe notificaciones cuando Sira responda a solicitudes que tomen tiempo, como investigaciones o generación de imágenes.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Tareas</span>
                  <Select value={notifTasks} onValueChange={setNotifTasks}>
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
                <button className="text-sm text-primary hover:underline" data-testid="link-manage-tasks">
                  Administrar tareas
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Projects</span>
                  <Select value={notifProjects} onValueChange={setNotifProjects}>
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
                  Recibe una notificación cuando te llegue una invitación por correo electrónico a un proyecto compartido.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium">Recomendaciones</span>
                  <Select value={notifRecommendations} onValueChange={setNotifRecommendations}>
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
                  Mantente al tanto de las nuevas herramientas, consejos y características de Sira.
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
                    Configura el estilo y el tono que Sira utiliza al responder.
                  </p>
                </div>
                <Select value={styleAndTone} onValueChange={setStyleAndTone}>
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
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="min-h-[80px]"
                data-testid="textarea-custom-instructions"
              />
            </div>

            <Separator />

            <h3 className="text-lg font-medium">Acerca de ti</h3>

            <div className="space-y-2">
              <span className="text-sm font-medium">Apodo</span>
              <Input 
                placeholder="¿Cómo debería llamarte Sira?"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                data-testid="input-nickname"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Ocupación</span>
              <Input 
                placeholder="Estudiante de ingeniería, diseñador, etc."
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                data-testid="input-occupation"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Más acerca de ti</span>
              <Textarea 
                placeholder="Intereses, valores o preferencias para tener en cuenta"
                value={aboutYou}
                onChange={(e) => setAboutYou(e.target.value)}
                className="min-h-[80px]"
                data-testid="textarea-about-you"
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium block">Administrar</span>
                  <button className="text-sm text-primary hover:underline" data-testid="link-manage-memories">
                    Consultar memorias guardadas
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Permite que Sira guarde y use memorias al responder.</span>
                </div>
                <Switch 
                  checked={allowMemories} 
                  onCheckedChange={setAllowMemories}
                  data-testid="switch-memories"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Consultar el historial de grabaciones</span>
                  <span className="text-xs text-muted-foreground">
                    Permite que Sira consulte todas las transcripciones y notas de grabaciones anteriores al responder.
                  </span>
                </div>
                <Switch 
                  checked={allowRecordings} 
                  onCheckedChange={setAllowRecordings}
                  data-testid="switch-recordings"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Búsqueda en la web</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que Sira busque automáticamente las respuestas en la web.
                  </span>
                </div>
                <Switch 
                  checked={webSearch} 
                  onCheckedChange={setWebSearch}
                  data-testid="switch-web-search"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Código</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que Sira ejecute el código con el Intérprete de código.
                  </span>
                </div>
                <Switch 
                  checked={codeInterpreter} 
                  onCheckedChange={setCodeInterpreter}
                  data-testid="switch-code"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Lienzo</span>
                  <span className="text-xs text-muted-foreground">
                    Colaborar con Sira en texto y código.
                  </span>
                </div>
                <Switch 
                  checked={canvas} 
                  onCheckedChange={setCanvas}
                  data-testid="switch-canvas"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Sira Voice</span>
                  <span className="text-xs text-muted-foreground">
                    Habilitar el modo de voz en Sira
                  </span>
                </div>
                <Switch 
                  checked={voiceMode} 
                  onCheckedChange={setVoiceMode}
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
                  checked={advancedVoice} 
                  onCheckedChange={setAdvancedVoice}
                  data-testid="switch-advanced-voice"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Búsqueda del conector</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que Sira busque automáticamente las respuestas en las fuentes conectadas.
                  </span>
                </div>
                <Switch 
                  checked={connectorSearch} 
                  onCheckedChange={setConnectorSearch}
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
              Administra las aplicaciones habilitadas que Sira puede usar en tus chats.
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
              Sira puede programarse para ejecutarse nuevamente después de completar una tarea. 
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
                data-testid="data-improve-model"
              >
                <span className="text-sm">Mejora el modelo para todos</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  Desactivado <ChevronRight className="h-4 w-4" />
                </span>
              </button>

              <button 
                className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
                data-testid="data-remote-browser"
              >
                <span className="text-sm">Datos del navegador remoto</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  Activado <ChevronRight className="h-4 w-4" />
                </span>
              </button>

              <div className="flex items-center justify-between py-3 px-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Comparte tu ubicación precisa</span>
                  <span className="text-xs text-muted-foreground">
                    Permite que Sira utilice la ubicación precisa de tu dispositivo al responder preguntas.
                  </span>
                </div>
                <Switch data-testid="switch-location" />
              </div>

              <Separator />

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Enlaces compartidos</span>
                <Button variant="outline" size="sm" data-testid="button-manage-links">
                  Administrar
                </Button>
              </div>

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Chats archivados</span>
                <Button variant="outline" size="sm" data-testid="button-manage-archived">
                  Administrar
                </Button>
              </div>

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Archivar todos los chats</span>
                <Button variant="outline" size="sm" data-testid="button-archive-all">
                  Archivar todo
                </Button>
              </div>

              <div className="flex items-center justify-between py-3 px-2">
                <span className="text-sm">Eliminar todos los chats</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600"
                  data-testid="button-delete-all"
                >
                  Eliminar todo
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
                <Switch data-testid="switch-auth-app" />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Notificaciones push</span>
                  <span className="text-xs text-muted-foreground">
                    Aprueba los inicios de sesión con una notificación push enviada a tu dispositivo de confianza
                  </span>
                </div>
                <Switch data-testid="switch-push-notif" />
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
                <Button variant="outline" size="sm" data-testid="button-logout">
                  Cerrar sesión
                </Button>
              </div>

              <div className="flex items-start justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Cerrar sesión en todos los dispositivos</span>
                  <span className="text-xs text-muted-foreground">
                    Cierra todas las sesiones activas en todos los dispositivos, incluida tu sesión actual. En los otros dispositivos, el cierre de sesión puede demorar hasta 30 minutos.
                  </span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 whitespace-nowrap"
                  data-testid="button-logout-all"
                >
                  Cerrar todas las sesiones
                </Button>
              </div>

              <Separator />

              <div className="pt-2">
                <h3 className="text-base font-medium">Inicio de sesión seguro con Sira</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Inicia sesión en sitios web y aplicaciones en toda la red con la seguridad confiable de Sira.{" "}
                  <button className="text-primary hover:underline" data-testid="link-more-info">
                    Obtener más información
                  </button>
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
              Personaliza tu perfil de constructor para conectarte con usuarios de los GPT. Esta configuración se aplica en los GPT compartidos públicamente.
            </p>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <Box className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <span className="text-sm font-medium block">PlaceholderGPT</span>
                  <span className="text-xs text-muted-foreground">Por Usuario</span>
                </div>
              </div>
              <span className="text-sm text-muted-foreground">Vista previa</span>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Nombre</span>
                <Switch defaultChecked data-testid="switch-show-name" />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm">Usuario</span>
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
                <Select>
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
                <Button variant="outline" size="sm" data-testid="button-add-linkedin">
                  Agregar
                </Button>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Github className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">GitHub</span>
                </div>
                <Button variant="outline" size="sm" data-testid="button-add-github">
                  Agregar
                </Button>
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
                <Checkbox id="email-comments" data-testid="checkbox-email-comments" />
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
