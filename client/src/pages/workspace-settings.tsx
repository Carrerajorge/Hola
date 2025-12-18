import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { 
  ArrowLeft, 
  Settings, 
  Users, 
  Key, 
  CreditCard, 
  Bot, 
  AppWindow, 
  UsersRound, 
  BarChart3, 
  ShieldCheck,
  Copy,
  Upload,
  AlertTriangle,
  Info,
  Search,
  Plus,
  MoreHorizontal,
  ChevronDown
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SiraLogo } from "@/components/sira-logo";

type WorkspaceSection = "general" | "members" | "permissions" | "billing" | "gpt" | "apps" | "groups" | "analytics" | "identity";

const menuItems: { id: WorkspaceSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "members", label: "Miembros", icon: <Users className="h-4 w-4" /> },
  { id: "permissions", label: "Permisos y roles", icon: <Key className="h-4 w-4" /> },
  { id: "billing", label: "Facturación", icon: <CreditCard className="h-4 w-4" /> },
  { id: "gpt", label: "GPT", icon: <Bot className="h-4 w-4" /> },
  { id: "apps", label: "Aplicaciones", icon: <AppWindow className="h-4 w-4" /> },
  { id: "groups", label: "Grupos", icon: <UsersRound className="h-4 w-4" /> },
  { id: "analytics", label: "Análisis de usuario", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "identity", label: "Identidad y acceso", icon: <ShieldCheck className="h-4 w-4" /> },
];

export default function WorkspaceSettingsPage() {
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("general");
  const [workspaceName, setWorkspaceName] = useState("Espacio de trabajo de Usuario");
  
  const orgId = "org-jafx80c2QSREjgK800cnLCwe";
  const workspaceId = "09c512b0-ee54-4546-9016-b5f13fa0477a";

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const renderContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-semibold">General</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Personaliza el aspecto, el nombre, las instrucciones y más de tu espacio de trabajo.
              </p>
            </div>

            <div className="space-y-6">
              <h2 className="text-lg font-medium">Aspecto</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Nombre de espacio de trabajo</span>
                  <Input 
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-72"
                    data-testid="input-workspace-name"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm">Logotipo</span>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center">
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Suelta el archivo aquí para cargarlo.</p>
                    <button className="text-sm text-primary hover:underline mt-1" data-testid="button-browse-files">
                      Explorar archivos
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-6">
              <h2 className="text-lg font-medium">Detalles del espacio de trabajo</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">ID de la organización</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-muted px-3 py-1.5 rounded font-mono">{orgId}</code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => copyToClipboard(orgId)}
                      data-testid="button-copy-org-id"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">ID del espacio de trabajo</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-muted px-3 py-1.5 rounded font-mono">{workspaceId}</code>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => copyToClipboard(workspaceId)}
                      data-testid="button-copy-workspace-id"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "members":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Miembros</h1>
              <p className="text-sm text-muted-foreground">Empresa · 1 miembro</p>
            </div>

            <Tabs defaultValue="users" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0 gap-6">
                <TabsTrigger 
                  value="users" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                  data-testid="tab-users"
                >
                  Usuarios
                </TabsTrigger>
                <TabsTrigger 
                  value="pending-invites" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                  data-testid="tab-pending-invites"
                >
                  Invitaciones pendientes
                </TabsTrigger>
                <TabsTrigger 
                  value="pending-requests" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                  data-testid="tab-pending-requests"
                >
                  Solicitudes pendientes
                </TabsTrigger>
              </TabsList>

              <TabsContent value="users" className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Filtrar por nombre" 
                      className="pl-9 w-64"
                      data-testid="input-filter-members"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2" data-testid="button-invite-member">
                      <Plus className="h-4 w-4" />
                      Invitar a un miembro
                    </Button>
                    <Button variant="ghost" size="icon" data-testid="button-members-more">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="border rounded-lg">
                  <div className="grid grid-cols-3 gap-4 px-4 py-3 border-b bg-muted/30 text-sm font-medium text-muted-foreground">
                    <span>Nombre</span>
                    <span>Tipo de cuenta</span>
                    <span>Fecha agregada</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 px-4 py-3 items-center">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-blue-100 text-blue-700 text-sm">JC</AvatarFallback>
                      </Avatar>
                      <div>
                        <span className="text-sm font-medium block">Jorge Carrera (Tú)</span>
                        <span className="text-xs text-muted-foreground">carrerajorge874@gmail.com</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm">Propietario</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm">28 ago 2025</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="pending-invites" className="mt-6">
                <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>
              </TabsContent>

              <TabsContent value="pending-requests" className="mt-6">
                <p className="text-sm text-muted-foreground">No hay solicitudes pendientes.</p>
              </TabsContent>
            </Tabs>
          </div>
        );

      case "permissions":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Permisos y roles</h1>
              <p className="text-sm text-muted-foreground">
                Configura los permisos básicos para tu espacio de trabajo y personaliza el acceso con roles personalizados.
              </p>
            </div>

            <Tabs defaultValue="workspace" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0">
                <TabsTrigger 
                  value="workspace" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 pb-2"
                >
                  Espacio de trabajo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="workspace" className="mt-6 space-y-6">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Buscar 13 permisos" 
                    className="pl-9 w-64"
                    data-testid="input-search-permissions"
                  />
                </div>

                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Compartir</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Permitir que los miembros compartan un chat, canvas o un proyecto con...</span>
                      <Select defaultValue="members">
                        <SelectTrigger className="w-64" data-testid="select-share-permission">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="members">Solo miembros del espacio de trabajo</SelectItem>
                          <SelectItem value="anyone">Cualquier persona</SelectItem>
                          <SelectItem value="none">Nadie</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Memoria</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir a los miembros usar la memoria</span>
                        <span className="text-xs text-muted-foreground">
                          Administra si los miembros pueden activar la memoria. Esto permite que Sira se vuelva más útil recordando detalles y preferencias a través de los chats.{" "}
                          <button className="text-primary hover:underline">Obtener más información</button>
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-memory" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Política de retención del chat</span>
                        <span className="text-xs text-muted-foreground">
                          Comunícate con el administrador de la cuenta para modificar esta configuración.
                        </span>
                      </div>
                      <span className="text-sm">Infinito</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Canvas</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Ejecución del código del lienzo</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros ejecuten fragmentos de código dentro de Canvas.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-canvas-code" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Acceso a red del código en Canvas</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros ejecuten código con acceso a red dentro de Canvas.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-canvas-network" />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="font-medium">Sira Record</h3>
                    <p className="text-xs text-muted-foreground">
                      Administra si los usuarios pueden usar Sira para grabar, transcribir y resumir audio de formato largo. Las grabaciones solo se usarán para fines de transcripción y no las almacenará.{" "}
                      <button className="text-primary hover:underline">Obtener más información</button>
                    </p>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm">Permitir que los miembros usen Sira Record</span>
                      <Switch defaultChecked data-testid="switch-record" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir que Sira consulte notas y transcripciones anteriores.</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros consulten notas y transcripciones anteriores en Sira Record.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-record-notes" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permite que los miembros compartan su pantalla o video mientras usan el modo de voz.</span>
                        <span className="text-xs text-muted-foreground">
                          Permite que los miembros compartan su pantalla o video mientras usan el modo de voz.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-screen-share" />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">Código en macOS</h3>
                      <Badge variant="secondary" className="text-xs">Enterprise</Badge>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir la edición de código en macOS</span>
                        <span className="text-xs text-muted-foreground">
                          Controla si los usuarios de este espacio de trabajo pueden permitir que Sira edite archivos de código al usar la aplicación de escritorio para macOS. Esto permite que Sira lea y edite el contenido de aplicaciones específicas en su escritorio para dar mejores respuestas.{" "}
                          <button className="text-primary hover:underline">Obtener más información</button>
                        </span>
                      </div>
                      <Switch data-testid="switch-macos-code" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir que los miembros vinculen Apple Intelligence</span>
                        <span className="text-xs text-muted-foreground">
                          Administra si los miembros pueden vincularse con Apple Intelligence.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-apple-intelligence" />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium">Modelos</h3>
                      <p className="text-xs text-muted-foreground">Administra el acceso de los miembros a los modelos</p>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Habilitar modelos adicionales</span>
                        <span className="text-xs text-muted-foreground">
                          Permite que los miembros usen modelos adicionales.
                        </span>
                      </div>
                      <Switch defaultChecked data-testid="switch-additional-models" />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        );

      case "billing":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Facturación</h1>
            <p className="text-sm text-muted-foreground">
              Administra la facturación de tu espacio de trabajo.
            </p>
          </div>
        );

      case "gpt":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">GPT</h1>
            <p className="text-sm text-muted-foreground">
              Configura los GPTs de tu espacio de trabajo.
            </p>
          </div>
        );

      case "apps":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Aplicaciones</h1>
            <p className="text-sm text-muted-foreground">
              Administra las aplicaciones conectadas a tu espacio de trabajo.
            </p>
          </div>
        );

      case "groups":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Grupos</h1>
            <p className="text-sm text-muted-foreground">
              Administra los grupos de tu espacio de trabajo.
            </p>
          </div>
        );

      case "analytics":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Análisis de usuario</h1>
            <p className="text-sm text-muted-foreground">
              Visualiza estadísticas y análisis de uso.
            </p>
          </div>
        );

      case "identity":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Identidad y acceso</h1>
            <p className="text-sm text-muted-foreground">
              Configura la identidad y el acceso de tu espacio de trabajo.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex justify-end px-6 py-3">
        <div className="inline-flex items-center gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-medium">Este espacio de trabajo se desactivará.</span>
            <span className="text-muted-foreground ml-1">
              Tendrás acceso al espacio de trabajo hasta que finalice el ciclo de facturación el 28 de diciembre de 2025.
            </span>
          </div>
          <Button variant="outline" size="sm" className="ml-2 flex-shrink-0" data-testid="button-reactivate">
            Reactivar
          </Button>
        </div>
      </div>

      <div className="flex">
        <div className="w-64 border-r min-h-[calc(100vh-49px)] p-4">
          <button 
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
            data-testid="button-back-to-chat"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al chat
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <SiraLogo size={24} />
            </div>
            <span className="text-sm font-medium truncate">Espacio de trabajo de Jor...</span>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                  activeSection === item.id 
                    ? "bg-muted font-medium" 
                    : "hover:bg-muted/50 text-muted-foreground"
                )}
                data-testid={`workspace-menu-${item.id}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 p-8 max-w-3xl">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
