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
  Info
} from "lucide-react";
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
            <h1 className="text-2xl font-semibold">Miembros</h1>
            <p className="text-sm text-muted-foreground">
              Administra los miembros de tu espacio de trabajo.
            </p>
          </div>
        );

      case "permissions":
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Permisos y roles</h1>
            <p className="text-sm text-muted-foreground">
              Configura los permisos y roles de tu espacio de trabajo.
            </p>
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
