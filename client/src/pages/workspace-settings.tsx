import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { IliaGPTLogo } from "@/components/sira-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  const searchString = useSearch();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("general");
  const [workspaceName, setWorkspaceName] = useState("Espacio de trabajo de Usuario");
  
  const orgId = "org-jafx80c2QSREjgK800cnLCwe";
  const workspaceId = "09c512b0-ee54-4546-9016-b5f13fa0477a";

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const section = params.get("section") as WorkspaceSection | null;
    if (section && menuItems.some(item => item.id === section)) {
      setActiveSection(section);
    }
  }, [searchString]);

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
                          Administra si los miembros pueden activar la memoria. Esto permite que MICHAT se vuelva más útil recordando detalles y preferencias a través de los chats.{" "}
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
                    <h3 className="font-medium">MICHAT Record</h3>
                    <p className="text-xs text-muted-foreground">
                      Administra si los usuarios pueden usar MICHAT para grabar, transcribir y resumir audio de formato largo. Las grabaciones solo se usarán para fines de transcripción y no las almacenará.{" "}
                      <button className="text-primary hover:underline">Obtener más información</button>
                    </p>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm">Permitir que los miembros usen MICHAT Record</span>
                      <Switch defaultChecked data-testid="switch-record" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir que MICHAT consulte notas y transcripciones anteriores.</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros consulten notas y transcripciones anteriores en MICHAT Record.
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
                          Controla si los usuarios de este espacio de trabajo pueden permitir que MICHAT edite archivos de código al usar la aplicación de escritorio para macOS. Esto permite que MICHAT lea y edite el contenido de aplicaciones específicas en su escritorio para dar mejores respuestas.{" "}
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
            <div>
              <h1 className="text-2xl font-semibold">Facturación</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Ciclo actual: Nov 28 - Dec 28
              </p>
            </div>

            <Tabs defaultValue="plan" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0">
                <TabsTrigger 
                  value="plan" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                  data-testid="tab-billing-plan"
                >
                  Plan
                </TabsTrigger>
                <TabsTrigger 
                  value="invoices" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                  data-testid="tab-billing-invoices"
                >
                  Facturas
                </TabsTrigger>
              </TabsList>

              <TabsContent value="plan" className="mt-6 space-y-6">
                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">Plan Business</span>
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Mensualmente</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">Se desactiva el 28 de diciembre de 2025</p>
                    </div>
                    <Select>
                      <SelectTrigger className="w-auto gap-2" data-testid="select-manage-plan">
                        <SelectValue placeholder="Administrar plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="change">Cambiar plan</SelectItem>
                        <SelectItem value="cancel">Cancelar plan</SelectItem>
                        <SelectItem value="reactivate">Reactivar plan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="pt-2">
                    <div className="flex items-baseline">
                      <span className="text-4xl font-bold">$30</span>
                      <span className="text-muted-foreground ml-1">/participante</span>
                    </div>
                  </div>
                  
                  <p className="text-sm text-muted-foreground">1/2 participantes en uso</p>
                </div>

                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Uso de créditos</h3>
                      <p className="text-sm text-muted-foreground">Próximo ciclo en 9 días</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-credits-menu">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-credits-prev">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-credits-next">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <p className="text-sm">
                    <span className="font-semibold">0</span>
                    <span className="text-muted-foreground"> / 0 créditos usados (100%)</span>
                  </p>
                </div>

                <div className="border rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-semibold">Agregar más créditos</h3>
                      <p className="text-sm text-muted-foreground max-w-md">
                        Permite que tu equipo siga teniendo acceso incluso después de alcanzar los límites de su plan. Los créditos son válidos durante 12 meses.
                      </p>
                    </div>
                    <Button variant="outline" data-testid="button-add-credits">
                      Agregar créditos
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="border rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-semibold">Alertas de uso de créditos</h3>
                      <p className="text-sm text-muted-foreground">
                        Enviar alertas a los propietarios cuando estén por agotarse los créditos
                      </p>
                    </div>
                    <Button variant="outline" data-testid="button-manage-alerts">
                      Administrar
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="invoices" className="mt-6">
                <div className="border rounded-lg p-6">
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No hay facturas disponibles
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        );

      case "gpt":
        const gptItems = [
          { id: 1, name: "1.3 Discusiones de tesis. 2", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 508, created: "Jan 21", updated: "Dec 18", icon: "T20" },
          { id: 2, name: "REALIDAD PROBLEMATICA LOCAL", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 400, created: "Jan 21", updated: "Dec 18", icon: "T20" },
          { id: 3, name: "ANTECENTE DE TESIS", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 5779, created: "Jan 21", updated: "Dec 17", icon: "T20" },
          { id: 4, name: "REALIDAD PROBLEMATICA GLOBAL", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 669, created: "Jan 21", updated: "Dec 17", icon: "T20" },
          { id: 5, name: "BASES TEORICAS", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 821, created: "Jan 21", updated: "Dec 17", icon: "T20" },
          { id: 6, name: "TSP CAPÍTULO III. - Problema actual.", constructor: "Jorge Carrera", actions: "—", access: "Enlace", chats: 73, created: "Feb 5", updated: "Dec 17", icon: "doc" },
          { id: 7, name: "1.6. - Justificación", constructor: "Sin asignar", actions: "—", access: "Público", chats: 845, created: "Feb 20", updated: "Dec 17", icon: "doc" },
        ];
        return (
          <div className="space-y-8">
            <h1 className="text-2xl font-semibold">GPT</h1>

            <div className="space-y-4">
              <h2 className="font-medium">Terceros</h2>
              <p className="text-sm text-muted-foreground">
                Administra si los miembros pueden usar GPT creados fuera de tu espacio de trabajo.
              </p>
              <Select defaultValue="allow">
                <SelectTrigger className="w-40" data-testid="select-third-party">
                  <SelectValue placeholder="Permitir todo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Permitir todo</SelectItem>
                  <SelectItem value="restrict">Restringir</SelectItem>
                  <SelectItem value="block">Bloquear</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <h2 className="font-medium">GPT</h2>
              
              <Tabs defaultValue="workspace" className="w-full">
                <div className="flex items-center justify-between">
                  <TabsList className="bg-transparent border-b rounded-none h-auto p-0">
                    <TabsTrigger 
                      value="workspace" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                      data-testid="tab-gpt-workspace"
                    >
                      Espacio de trabajo
                    </TabsTrigger>
                    <TabsTrigger 
                      value="unassigned" 
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                      data-testid="tab-gpt-unassigned"
                    >
                      Sin asignar
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-gpt-filter">
                      <Filter className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-gpt-search">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <TabsContent value="workspace" className="mt-4">
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Nombre</th>
                          <th className="px-4 py-3 font-medium">Constructor</th>
                          <th className="px-4 py-3 font-medium">Acciones personalizadas</th>
                          <th className="px-4 py-3 font-medium">Quién tiene acceso</th>
                          <th className="px-4 py-3 font-medium">Chats</th>
                          <th className="px-4 py-3 font-medium">Creado</th>
                          <th className="px-4 py-3 font-medium">Actualiz.</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {gptItems.map((item) => (
                          <tr key={item.id} className="border-t hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                                  item.icon === "T20" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"
                                )}>
                                  {item.icon === "T20" ? "T20" : "📄"}
                                </div>
                                <span className="font-medium text-primary hover:underline cursor-pointer">{item.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item.constructor}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.actions}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.access}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.chats}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.created}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.updated}</td>
                            <td className="px-4 py-3">
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-center gap-4 mt-4">
                    <Button variant="ghost" size="sm" data-testid="button-gpt-prev">Anterior</Button>
                    <span className="text-sm text-muted-foreground">Página 1</span>
                    <Button variant="ghost" size="sm" className="font-medium" data-testid="button-gpt-next">Siguiente</Button>
                  </div>
                </TabsContent>

                <TabsContent value="unassigned" className="mt-4">
                  <div className="border rounded-lg p-6">
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay GPTs sin asignar
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="font-medium">Compartir</h2>
                <Badge variant="secondary" className="text-xs">Enterprise</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Los GPT se pueden compartir con...</span>
                <Select defaultValue="anyone">
                  <SelectTrigger className="w-48" data-testid="select-gpt-share">
                    <SelectValue placeholder="Cualquier persona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anyone">Cualquier persona</SelectItem>
                    <SelectItem value="workspace">Solo espacio de trabajo</SelectItem>
                    <SelectItem value="restricted">Restringido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h2 className="font-medium">Acciones de GPT</h2>
              <p className="text-sm text-muted-foreground">
                Las acciones de GPT permiten que los GPT utilicen API de terceros para tareas como recuperar o modificar datos. Las acciones de GPT son definidas por los constructores de los GPT, por lo que puedes limitar los dominios que se pueden usar para los GPT creados en tu espacio de trabajo.
              </p>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="allow-domains" 
                  defaultChecked 
                  className="h-4 w-4 rounded border-gray-300"
                  data-testid="checkbox-allow-domains"
                />
                <label htmlFor="allow-domains" className="text-sm">
                  Permitir todos los dominios para acciones de GPT
                </label>
                <Info className="h-3 w-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        );

      case "apps":
        const appItems = [
          { id: 1, name: "Adobe Acrobat", description: "Trusted PDF editing tools", icon: "Ac", bgColor: "bg-red-600" },
          { id: 2, name: "Adobe Express", description: "Design flyers and invites", icon: "Ae", bgColor: "bg-gradient-to-br from-purple-500 to-pink-500" },
          { id: 3, name: "Adobe Photoshop", description: "Edit, stylize, refine images", icon: "Ps", bgColor: "bg-blue-600" },
          { id: 4, name: "Agentforce Sales", description: "Sales insights to close deals", icon: "⚡", bgColor: "bg-blue-500" },
          { id: 5, name: "Aha!", description: "Connect to sync Aha! product roadmaps and features for use in ChatGPT.", icon: "!", bgColor: "bg-blue-600" },
          { id: 6, name: "Airtable", description: "Add structured data to ChatGPT", icon: "📊", bgColor: "bg-blue-400" },
          { id: 7, name: "Alpaca", description: "Market data: stocks & crypto", icon: "🦙", bgColor: "bg-yellow-400" },
          { id: 8, name: "Apple Music", description: "Build playlists and find music", icon: "♪", bgColor: "bg-pink-500" },
          { id: 9, name: "Asana", description: "Convierte las tareas de Asana en actualizaciones y planes claros", icon: "◉", bgColor: "bg-orange-500" },
          { id: 10, name: "Atlassian Rovo", description: "Manage Jira and Confluence fast", icon: "A", bgColor: "bg-blue-600" },
          { id: 11, name: "Azure Boards", description: "Connect to sync Azure DevOps work items and repos for use in ChatGPT.", icon: "Az", bgColor: "bg-blue-500" },
          { id: 12, name: "Basecamp", description: "Connect to sync Basecamp projects and to-dos for use in ChatGPT.", icon: "⛺", bgColor: "bg-green-600" },
          { id: 13, name: "BioRender", description: "Science visuals on demand", icon: "🧬", bgColor: "bg-teal-500" },
          { id: 14, name: "Booking.com", description: "Search stays worldwide", icon: "B", bgColor: "bg-blue-700" },
          { id: 15, name: "Box", description: "Busca y consulta tus documentos", icon: "📦", bgColor: "bg-blue-500" },
          { id: 16, name: "Calendario de Outlook", description: "Consulta eventos y disponibilidad.", icon: "📅", bgColor: "bg-blue-600" },
          { id: 17, name: "Canva", description: "Search, create, edit designs", icon: "C", bgColor: "bg-cyan-500" },
          { id: 18, name: "Clay", description: "Find and engage prospects", icon: "🏺", bgColor: "bg-orange-400" },
          { id: 19, name: "ClickUp", description: "Connect to sync ClickUp tasks and docs for use in ChatGPT.", icon: "✓", bgColor: "bg-purple-600" },
          { id: 20, name: "Cloudinary", description: "Manage, modify, and host your images & videos", icon: "☁", bgColor: "bg-blue-500" },
          { id: 21, name: "Conductor", description: "Track brand sentiment in AI", icon: "C", bgColor: "bg-indigo-600" },
          { id: 22, name: "Contactos de Google", description: "Consulta detalles de contacto guardados.", icon: "👤", bgColor: "bg-blue-500" },
          { id: 23, name: "Correo electrónico de Outlook", description: "Busca y consulta tus correos electrónicos de Outlook.", icon: "✉", bgColor: "bg-blue-600" },
          { id: 24, name: "Coupler.io", description: "Unified business data access", icon: "⚡", bgColor: "bg-purple-500" },
          { id: 25, name: "Coursera", description: "Skill-building course videos", icon: "C", bgColor: "bg-blue-600" },
          { id: 26, name: "Coveo", description: "Search your enterprise content", icon: "C", bgColor: "bg-orange-500" },
          { id: 27, name: "Daloopa", description: "Financial KPIs with links", icon: "D", bgColor: "bg-blue-700" },
          { id: 28, name: "Dropbox", description: "Encuentra y accede a tus archivos almacenados.", icon: "📁", bgColor: "bg-blue-500" },
          { id: 29, name: "Egnyte", description: "Explore and analyze your content", icon: "E", bgColor: "bg-green-600" },
          { id: 30, name: "Figma", description: "Make diagrams, slides, assets", icon: "F", bgColor: "bg-purple-600" },
          { id: 31, name: "Fireflies", description: "Search meeting transcripts", icon: "🔥", bgColor: "bg-purple-500" },
          { id: 32, name: "GitHub", description: "Accede a repositorios, problemas y solicitudes de extracción.", icon: "🐙", bgColor: "bg-gray-800" },
          { id: 33, name: "GitLab Issues", description: "Connect to sync GitLab Issues and merge requests for use in ChatGPT.", icon: "🦊", bgColor: "bg-orange-600" },
          { id: 34, name: "Gmail", description: "Busca y consulta correos electrónicos en tu bandeja de entrada.", icon: "✉", bgColor: "bg-red-500" },
          { id: 35, name: "Google Drive", description: "Upload Google Drive files in messages sent to ChatGPT.", icon: "📁", bgColor: "bg-yellow-500", badge: "CARGAS DE ARCHIVOS" },
          { id: 36, name: "Google Calendar", description: "Consulta eventos y disponibilidad.", icon: "📅", bgColor: "bg-blue-500" },
          { id: 37, name: "Google Drive", description: "Busca y consulta archivos de tu Drive.", icon: "📁", bgColor: "bg-green-500", hasSync: true },
          { id: 38, name: "Help Scout", description: "Connect to sync Help Scout mailboxes and conversations for use in ChatGPT.", icon: "H", bgColor: "bg-blue-500" },
          { id: 39, name: "Hex", description: "Ask questions, run analyses", icon: "⬡", bgColor: "bg-purple-600" },
          { id: 40, name: "HighLevel", description: "Interact with your CRM business data", icon: "H", bgColor: "bg-blue-600" },
          { id: 41, name: "HubSpot", description: "Analiza datos de CRM y destaca insights", icon: "H", bgColor: "bg-orange-500" },
          { id: 42, name: "Hugging Face", description: "Inspect models, datasets, Spaces, and research", icon: "🤗", bgColor: "bg-yellow-400" },
          { id: 43, name: "Intercom", description: "Look up past user chats and tickets.", icon: "💬", bgColor: "bg-blue-500" },
          { id: 44, name: "Jam", description: "Screen record with context", icon: "🍇", bgColor: "bg-purple-600" },
          { id: 45, name: "Jotform", description: "Build forms, analyze responses", icon: "J", bgColor: "bg-orange-500" },
          { id: 46, name: "Klaviyo", description: "Marketing performance insights", icon: "K", bgColor: "bg-green-600" },
          { id: 47, name: "LSEG", description: "LSEG financial data access", icon: "L", bgColor: "bg-blue-700" },
          { id: 48, name: "Linear", description: "Busca y consulta incidencias y proyectos.", icon: "◇", bgColor: "bg-indigo-600" },
          { id: 49, name: "Lovable", description: "Build apps and websites", icon: "♥", bgColor: "bg-pink-500" },
          { id: 50, name: "Microsoft OneDrive (personal)", description: "Upload personal OneDrive files in messages sent to ChatGPT.", icon: "☁", bgColor: "bg-blue-500", badge: "CARGAS DE ARCHIVOS" },
          { id: 51, name: "Microsoft OneDrive (work/school)", description: "Upload SharePoint and OneDrive for Business files in messages sent to ChatGPT.", icon: "☁", bgColor: "bg-blue-600", badge: "CARGAS DE ARCHIVOS" },
          { id: 52, name: "Monday.com", description: "Manage work in monday.com", icon: "M", bgColor: "bg-red-500" },
          { id: 53, name: "Netlify", description: "Build and deploy on Netlify", icon: "N", bgColor: "bg-teal-500" },
          { id: 54, name: "Notion", description: "Busca y consulta tus páginas de Notion.", icon: "N", bgColor: "bg-gray-800" },
          { id: 55, name: "OpenTable", description: "Find restaurant reservations", icon: "🍽", bgColor: "bg-red-600" },
          { id: 56, name: "Pipedrive", description: "Connect to sync Pipedrive deals and contacts for use in ChatGPT.", icon: "P", bgColor: "bg-green-500" },
          { id: 57, name: "PitchBook", description: "Faster workflows with market intelligence", icon: "P", bgColor: "bg-blue-700" },
          { id: 58, name: "Replit", description: "Build web apps with AI", icon: "R", bgColor: "bg-orange-500" },
          { id: 59, name: "Semrush", description: "Site metrics and traffic data", icon: "S", bgColor: "bg-orange-600" },
          { id: 60, name: "SharePoint", description: "Busca y extrae datos de sitios compartidos y OneDrive.", icon: "S", bgColor: "bg-teal-600" },
          { id: 61, name: "Slack", description: "Consulta chats y mensajes.", icon: "S", bgColor: "bg-purple-600" },
          { id: 62, name: "Spaceship", description: "Search domain availability", icon: "🚀", bgColor: "bg-indigo-600" },
          { id: 63, name: "Stripe", description: "Payments and business tools", icon: "S", bgColor: "bg-purple-500" },
          { id: 64, name: "Teams", description: "Consulta chats y mensajes.", icon: "T", bgColor: "bg-purple-700" },
          { id: 65, name: "Teamwork.com", description: "Connect to sync Teamwork projects and tasks for use in ChatGPT.", icon: "T", bgColor: "bg-purple-500" },
          { id: 66, name: "Tripadvisor", description: "Book top-rated hotels", icon: "🦉", bgColor: "bg-green-500" },
          { id: 67, name: "Vercel", description: "Search docs and deploy apps", icon: "▲", bgColor: "bg-gray-800" },
          { id: 68, name: "Zoho", description: "Connect to sync Zoho CRM records and activities for use in ChatGPT.", icon: "Z", bgColor: "bg-red-600" },
          { id: 69, name: "Zoho Desk", description: "Connect to sync Zoho Desk tickets and customer conversations for use in ChatGPT.", icon: "Z", bgColor: "bg-green-600" },
          { id: 70, name: "Zoom", description: "Smart meeting insights from Zoom", icon: "Z", bgColor: "bg-blue-500" },
        ];
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Aplicaciones</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Administra a qué aplicaciones pueden conectarse los usuarios de este espacio de trabajo.{" "}
                <button className="text-primary hover:underline">Obtener más información</button>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar" 
                  className="pl-9"
                  data-testid="input-apps-search"
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="button-apps-filters">
                    <Filter className="h-4 w-4" />
                    Filtros
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="end">
                  <div className="p-4 space-y-4">
                    <Collapsible defaultOpen>
                      <CollapsibleTrigger className="flex items-center justify-between w-full">
                        <span className="font-medium">Categorías</span>
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-3 space-y-2">
                        {["Diseño", "Empresa", "Herramientas del desarrollador", "Productividad", "Colaboración", "Finanzas"].map((cat) => (
                          <label key={cat} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                            <span className="text-sm">{cat}</span>
                          </label>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible defaultOpen>
                      <CollapsibleTrigger className="flex items-center justify-between w-full">
                        <span className="font-medium">Funcionalidades</span>
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-3 space-y-2">
                        {["Búsqueda de archivos", "Cargas de archivos", "Sincronización", "Capacidad de escritura", "Interactiva"].map((func) => (
                          <label key={func} className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                            <span className="text-sm">{func}</span>
                          </label>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="pt-2 border-t">
                      <button className="text-sm text-muted-foreground hover:text-foreground w-full text-right">
                        Borrar todo
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button className="gap-2" data-testid="button-apps-create">
                <Plus className="h-4 w-4" />
                Crear
              </Button>
            </div>

            <Tabs defaultValue="enabled" className="w-full">
              <div className="flex items-center justify-between">
                <TabsList className="bg-transparent border-b rounded-none h-auto p-0">
                  <TabsTrigger 
                    value="enabled" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    data-testid="tab-apps-enabled"
                  >
                    Enabled (70)
                  </TabsTrigger>
                  <TabsTrigger 
                    value="directory" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    data-testid="tab-apps-directory"
                  >
                    Directorio
                  </TabsTrigger>
                  <TabsTrigger 
                    value="drafts" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                    data-testid="tab-apps-drafts"
                  >
                    Drafts (0)
                  </TabsTrigger>
                </TabsList>
                <button className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="button-explore-directory">
                  Explorar directorio
                  <span className="text-xs">↗</span>
                </button>
              </div>

              <TabsContent value="enabled" className="mt-4">
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center px-4 py-3 bg-muted/50 border-b">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300 mr-4" data-testid="checkbox-apps-all" />
                    <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                      Nombre
                      <ChevronDown className="h-3 w-3 rotate-180" />
                    </button>
                  </div>
                  <div className="divide-y">
                    {appItems.map((app: any) => (
                      <div key={app.id} className="flex items-center px-4 py-3 hover:bg-muted/30">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 mr-4" data-testid={`checkbox-app-${app.id}`} />
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold mr-4", app.bgColor)}>
                          {app.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{app.name}</p>
                            {app.badge && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{app.badge}</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{app.description}</p>
                          {app.hasSync && (
                            <button className="text-xs text-primary hover:underline mt-1">Habilitar sincronización</button>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="directory" className="mt-4">
                <div className="border rounded-lg p-6">
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Explora el directorio de aplicaciones disponibles
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="drafts" className="mt-4">
                <div className="border rounded-lg p-6">
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay borradores de aplicaciones
                  </p>
                </div>
              </TabsContent>
            </Tabs>
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
              <IliaGPTLogo size={24} />
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
