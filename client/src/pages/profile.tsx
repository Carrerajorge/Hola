import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Building,
  Calendar,
  MessageSquare,
  FileText,
  Zap,
  CheckCircle2,
  Globe,
  Bell,
  Shield,
  Sparkles,
  ChevronRight
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);

  const stats = [
    { label: "Chats", value: "24", icon: MessageSquare },
    { label: "Documentos", value: "12", icon: FileText },
    { label: "Skills activos", value: "8", icon: Zap },
  ];

  const connectedServices = [
    { name: "Gmail", connected: false, icon: "📧" },
    { name: "Google Forms", connected: false, icon: "📋" },
    { name: "Figma", connected: false, icon: "🎨" },
  ];

  const quickActions = [
    { label: "Privacidad y seguridad", icon: Shield, path: "/privacy" },
    ...(user?.role === "admin" ? [{ label: "Facturación", icon: Calendar, path: "/billing" }] : []),
    { label: "Configuración", icon: Globe, path: "/workspace-settings" },
  ];

  const displayName = user?.firstName || user?.email?.split("@")[0] || "Usuario";
  const initials = (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase();

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
      <div className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            className="rounded-full"
            onClick={() => setLocation("/")}
            data-testid="button-back-profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-medium">Perfil</h1>
        </div>
      </div>
      
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-card to-card/80">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="relative group">
                <Avatar className="h-24 w-24 ring-4 ring-background shadow-xl">
                  <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-2xl font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <button 
                  className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid="button-change-avatar"
                >
                  <span className="text-white text-xs">Cambiar</span>
                </button>
              </div>
              <div className="text-center sm:text-left flex-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-2xl font-bold">{displayName}</h2>
                  {user?.role === "admin" && (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                      Admin
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">{user?.email || "usuario@email.com"}</p>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-3">
                  <Badge variant="secondary" className="gap-1">
                    <Sparkles className="h-3 w-3" />
                    {user?.email === "infosiragpt@gmail.com" ? "Enterprise" : "Free"}
                  </Badge>
                  <Badge variant="outline" className="gap-1 text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    Activo
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="border-0 shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-4 text-center">
                <stat.icon className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Información personal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs text-muted-foreground">Nombre</Label>
                <Input 
                  id="name" 
                  defaultValue={displayName}
                  className="bg-muted/50 border-0"
                  data-testid="input-profile-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
                <Input 
                  id="email" 
                  defaultValue={user?.email || ""}
                  className="bg-muted/50 border-0"
                  disabled
                  data-testid="input-profile-email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company" className="text-xs text-muted-foreground flex items-center gap-1">
                <Building className="h-3 w-3" />
                Organización
              </Label>
              <Input 
                id="company" 
                placeholder="Tu empresa u organización"
                className="bg-muted/50 border-0"
                data-testid="input-profile-company"
              />
            </div>
            <Button className="w-full sm:w-auto" data-testid="button-save-profile">
              Guardar cambios
            </Button>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Servicios conectados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {connectedServices.map((service, i) => (
              <div key={service.name}>
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{service.icon}</span>
                    <span className="font-medium">{service.name}</span>
                  </div>
                  <Badge 
                    variant={service.connected ? "default" : "outline"}
                    className={cn(
                      service.connected 
                        ? "bg-green-500/10 text-green-600 border-green-500/20" 
                        : "text-muted-foreground"
                    )}
                  >
                    {service.connected ? "Conectado" : "No conectado"}
                  </Badge>
                </div>
                {i < connectedServices.length - 1 && <Separator />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Preferencias
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Notificaciones</Label>
                <p className="text-xs text-muted-foreground">Recibir alertas cuando se complete un proceso</p>
              </div>
              <Switch 
                checked={notificationsEnabled} 
                onCheckedChange={setNotificationsEnabled}
                data-testid="switch-notifications"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Actualizaciones por email</Label>
                <p className="text-xs text-muted-foreground">Recibir novedades y consejos</p>
              </div>
              <Switch 
                checked={emailUpdates} 
                onCheckedChange={setEmailUpdates}
                data-testid="switch-email-updates"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="p-2">
            {quickActions.map((action, i) => (
              <div key={action.label}>
                <button
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                  onClick={() => setLocation(action.path)}
                  data-testid={`button-${action.path.slice(1)}`}
                >
                  <div className="flex items-center gap-3">
                    <action.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{action.label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                {i < quickActions.length - 1 && <Separator className="mx-3" />}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">
            IliaGPT v1.0 · <button className="underline hover:text-foreground">Términos</button> · <button className="underline hover:text-foreground">Privacidad</button>
          </p>
        </div>
      </div>
    </div>
  );
}
