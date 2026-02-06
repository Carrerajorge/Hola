import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Volume2,
  Link,
  Unlink,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { isAdminUser } from "@/lib/admin";
import { useLanguage } from "@/hooks/use-language";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useModelAvailability } from "@/contexts/ModelAvailabilityContext";
import {
  Sparkles,
  CheckSquare,
  Users,
  Package,
  MessageSquare,
  Zap,
  Star,
  Share2,
  Heart,
  Gift,
  TrendingUp,
  FileText
} from "lucide-react";
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

type AuthSessionInfo = {
  sid: string;
  isCurrent: boolean;
  expiresAt: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  userAgent: string | null;
  ipAddress: string | null;
};

type AuthSessionsResponse = { sessions: AuthSessionInfo[]; currentSid: string | null };

function summarizeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "";
  const ua = userAgent.toLowerCase();

  const isIOS = ua.includes("iphone") || ua.includes("ipad");
  const isAndroid = ua.includes("android");
  const isWindows = ua.includes("windows");
  const isMac = ua.includes("mac os x") && !isIOS;
  const isLinux = ua.includes("linux") && !isAndroid;

  const os = isIOS
    ? "iOS"
    : isAndroid
      ? "Android"
      : isWindows
        ? "Windows"
        : isMac
          ? "macOS"
          : isLinux
            ? "Linux"
            : "Sistema desconocido";

  let browser = "Navegador";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/") && !ua.includes("edg/")) browser = "Chrome";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("safari/") && !ua.includes("chrome/")) browser = "Safari";

  return `${browser} en ${os}`;
}



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

interface NotificationEventType {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
}

interface NotificationPreference {
  id: string;
  eventTypeId: string;
  channels: string;
  enabled: boolean;
}

const categoryLabels: Record<string, string> = {
  ai_updates: "Actualizaciones de IA",
  tasks: "Tareas",
  social: "Social",
  product: "Producto",
};

const categoryIcons: Record<string, React.ReactNode> = {
  ai_updates: <Sparkles className="h-4 w-4" />,
  tasks: <CheckSquare className="h-4 w-4" />,
  social: <Users className="h-4 w-4" />,
  product: <Package className="h-4 w-4" />,
};

const eventTypeIcons: Record<string, React.ReactNode> = {
  ai_response: <MessageSquare className="h-4 w-4" />,
  ai_suggestion: <Zap className="h-4 w-4" />,
  task_completed: <CheckSquare className="h-4 w-4" />,
  task_assigned: <FileText className="h-4 w-4" />,
  task_reminder: <Bell className="h-4 w-4" />,
  mention: <Star className="h-4 w-4" />,
  share: <Share2 className="h-4 w-4" />,
  follow: <Heart className="h-4 w-4" />,
  new_feature: <Gift className="h-4 w-4" />,
  tips: <TrendingUp className="h-4 w-4" />,
};

function NotificationsSection() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const { data: eventTypes, isLoading: isLoadingEventTypes } = useQuery<NotificationEventType[]>({
    queryKey: ['/api/notification-event-types'],
    queryFn: async () => {
      const res = await fetch('/api/notification-event-types');
      if (!res.ok) throw new Error('Failed to fetch event types');
      return res.json();
    },
  });

  const { data: preferences, isLoading: isLoadingPreferences } = useQuery<NotificationPreference[]>({
    queryKey: ['/api/users', userId, 'notification-preferences'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/notification-preferences`);
      if (!res.ok) throw new Error('Failed to fetch preferences');
      return res.json();
    },
    enabled: !!userId,
  });

  const updatePreference = useMutation({
    mutationFn: async (data: { eventTypeId: string; channels?: string; enabled?: boolean }) => {
      const res = await fetch(`/api/users/${userId}/notification-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update preference');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'notification-preferences'] });
    },
  });

  const getPreferenceForEventType = (eventTypeId: string): NotificationPreference | undefined => {
    return preferences?.find(p => p.eventTypeId === eventTypeId);
  };

  const groupedEventTypes = eventTypes?.reduce((acc, eventType) => {
    const category = eventType.category || 'other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(eventType);
    return acc;
  }, {} as Record<string, NotificationEventType[]>) || {};

  const categoryOrder = ['ai_updates', 'tasks', 'social', 'product'];

  if (isLoadingEventTypes || isLoadingPreferences) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-notifications-title">Preferencias de Notificaciones</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-notifications-description">
            Configura cómo y cuándo recibir notificaciones
          </p>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="spinner-loading" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold" data-testid="text-notifications-title">Preferencias de Notificaciones</h2>
        <p className="text-sm text-muted-foreground mt-1" data-testid="text-notifications-description">
          Configura cómo y cuándo recibir notificaciones
        </p>
      </div>

      {categoryOrder.map((category) => {
        const categoryEventTypes = groupedEventTypes[category];
        if (!categoryEventTypes || categoryEventTypes.length === 0) return null;

        return (
          <div key={category} className="space-y-3" data-testid={`section-category-${category}`}>
            <div className="flex items-center gap-2">
              {categoryIcons[category]}
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide" data-testid={`text-category-${category}`}>
                {categoryLabels[category] || category}
              </h3>
            </div>

            <div className="space-y-2">
              {categoryEventTypes.map((eventType) => {
                const preference = getPreferenceForEventType(eventType.id);
                const channels = preference?.channels || 'none';
                const enabled = preference?.enabled ?? true;

                return (
                  <div
                    key={eventType.id}
                    className="flex items-center justify-between py-3 border-b border-border last:border-b-0"
                    data-testid={`row-notification-${eventType.id}`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="mt-0.5 text-muted-foreground">
                        {eventTypeIcons[eventType.id] || <Bell className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block" data-testid={`text-event-name-${eventType.id}`}>
                          {eventType.name}
                        </span>
                        <span className="text-xs text-muted-foreground" data-testid={`text-event-description-${eventType.id}`}>
                          {eventType.description}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <Select
                        value={channels}
                        onValueChange={(value) => updatePreference.mutate({
                          eventTypeId: eventType.id,
                          channels: value
                        })}
                        disabled={!enabled}
                      >
                        <SelectTrigger
                          className="w-36"
                          data-testid={`select-channel-${eventType.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ninguna</SelectItem>
                          <SelectItem value="push">Push</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="push_email">Push y Email</SelectItem>
                        </SelectContent>
                      </Select>

                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => updatePreference.mutate({
                          eventTypeId: eventType.id,
                          enabled: checked
                        })}
                        data-testid={`switch-enabled-${eventType.id}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Separator />

      <div className="flex items-center justify-between">
        <a
          href="/settings?tab=tasks"
          className="text-sm text-primary hover:underline flex items-center gap-1"
          data-testid="link-manage-tasks"
        >
          <CheckSquare className="h-4 w-4" />
          Administrar tareas
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

interface IntegrationProvider {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  authType: string;
  category: string | null;
  isActive: string;
}

interface IntegrationAccount {
  id: string;
  userId: string;
  providerId: string;
  displayName: string | null;
  email: string | null;
  status: string | null;
}

interface IntegrationPolicy {
  id: string;
  userId: string;
  enabledApps: string[];
  autoConfirmPolicy: string | null;
  sandboxMode: string | null;
  maxParallelCalls: number | null;
}

interface ToolCallLog {
  id: string;
  toolId: string;
  providerId: string;
  status: string;
  errorMessage: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface IntegrationsData {
  accounts: IntegrationAccount[];
  policy: IntegrationPolicy | null;
  providers: IntegrationProvider[];
}

const providerIcons: Record<string, React.ReactNode> = {
  github: <Github className="h-5 w-5" />,
  figma: <Box className="h-5 w-5" />,
  slack: <MessageSquare className="h-5 w-5" />,
  notion: <FileText className="h-5 w-5" />,
  google_drive: <Globe className="h-5 w-5" />,
  canva: <Palette className="h-5 w-5" />,
};

const categoryLabelsApps: Record<string, string> = {
  development: "Desarrollo",
  design: "Diseño",
  communication: "Comunicación",
  productivity: "Productividad",
  general: "General",
};

interface SharedLink {
  id: string;
  resourceType: string;
  resourceId: string;
  token: string;
  scope: string;
  permissions: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  isRevoked: string;
  createdAt: string;
}

interface ArchivedChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ConsentLogEntry {
  id: string;
  consentType: string;
  value: string;
  consentVersion: string;
  createdAt: string;
}

interface PrivacySettings {
  trainingOptIn: boolean;
  remoteBrowserDataAccess: boolean;
  analyticsTracking: boolean;
}

function AppsSection() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: integrationsData, isLoading: isLoadingIntegrations, refetch } = useQuery<IntegrationsData>({
    queryKey: ['/api/users', userId, 'integrations'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/integrations`);
      if (!res.ok) throw new Error('Failed to fetch integrations');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: logsData, isLoading: isLoadingLogs } = useQuery<ToolCallLog[]>({
    queryKey: ['/api/users', userId, 'integrations', 'logs'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/integrations/logs?limit=10`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!userId,
  });

  const updatePolicy = useMutation({
    mutationFn: async (data: Partial<IntegrationPolicy>) => {
      const res = await fetch(`/api/users/${userId}/integrations/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update policy');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'integrations'] });
      toast({ title: "Configuración actualizada", description: "Los cambios han sido guardados." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar la configuración.", variant: "destructive" });
    },
  });

  const connectProvider = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await fetch(`/api/users/${userId}/integrations/${providerId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to connect');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'integrations'] });
      toast({ title: "Conexión iniciada", description: data.message || "El proceso de conexión ha sido iniciado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo iniciar la conexión.", variant: "destructive" });
    },
  });

  const disconnectProvider = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await fetch(`/api/users/${userId}/integrations/${providerId}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'integrations'] });
      toast({ title: "Desconectado", description: "La integración ha sido desconectada." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo desconectar la integración.", variant: "destructive" });
    },
  });

  const providers = integrationsData?.providers || [];
  const accounts = integrationsData?.accounts || [];
  const policy = integrationsData?.policy;
  const logs = logsData || [];

  const isProviderConnected = (providerId: string) => {
    return accounts.some(a => a.providerId === providerId && a.status === 'active');
  };

  const isProviderEnabled = (providerId: string) => {
    return policy?.enabledApps?.includes(providerId) ?? false;
  };

  const toggleProviderEnabled = (providerId: string, enabled: boolean) => {
    const currentEnabled = policy?.enabledApps || [];
    const newEnabled = enabled
      ? [...currentEnabled, providerId]
      : currentEnabled.filter(id => id !== providerId);
    updatePolicy.mutate({ enabledApps: newEnabled });
  };

  const groupedProviders = providers.reduce((acc, provider) => {
    const category = provider.category || 'general';
    if (!acc[category]) acc[category] = [];
    acc[category].push(provider);
    return acc;
  }, {} as Record<string, IntegrationProvider[]>);

  if (isLoadingIntegrations) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-apps-title">Aplicaciones e Integraciones</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-apps-description">
            Conecta y administra las aplicaciones que ILIAGPT puede usar
          </p>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="spinner-loading-apps" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-apps-title">Aplicaciones e Integraciones</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-apps-description">
            Conecta y administra las aplicaciones que ILIAGPT puede usar
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoadingIntegrations}
          data-testid="button-refresh-integrations"
        >
          <RefreshCw className={cn("h-4 w-4", isLoadingIntegrations && "animate-spin")} />
        </Button>
      </div>

      {Object.entries(groupedProviders).map(([category, categoryProviders]) => (
        <div key={category} className="space-y-3" data-testid={`section-category-${category}`}>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide" data-testid={`text-category-${category}`}>
            {categoryLabelsApps[category] || category}
          </h3>

          <div className="space-y-2">
            {categoryProviders.map((provider) => {
              const connected = isProviderConnected(provider.id);
              const enabled = isProviderEnabled(provider.id);
              const account = accounts.find(a => a.providerId === provider.id);

              return (
                <div
                  key={provider.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                  data-testid={`card-provider-${provider.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center",
                      connected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {providerIcons[provider.id] || <AppWindow className="h-5 w-5" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" data-testid={`text-provider-name-${provider.id}`}>
                          {provider.name}
                        </span>
                        {connected && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />
                            Conectado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid={`text-provider-desc-${provider.id}`}>
                        {provider.description || 'Sin descripción'}
                      </p>
                      {connected && account?.email && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {account.displayName || account.email}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {connected && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Habilitado</span>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => toggleProviderEnabled(provider.id, checked)}
                          data-testid={`switch-enable-${provider.id}`}
                        />
                      </div>
                    )}

                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectProvider.mutate(provider.id)}
                        disabled={disconnectProvider.isPending}
                        className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                        data-testid={`button-disconnect-${provider.id}`}
                      >
                        {disconnectProvider.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Unlink className="h-4 w-4 mr-1" />
                            Desconectar
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => connectProvider.mutate(provider.id)}
                        disabled={connectProvider.isPending}
                        data-testid={`button-connect-${provider.id}`}
                      >
                        {connectProvider.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Link className="h-4 w-4 mr-1" />
                            Conectar
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {providers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground" data-testid="text-no-providers">
          <AppWindow className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No hay proveedores de integración disponibles</p>
        </div>
      )}

      <Separator />

      <div className="space-y-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
          data-testid="button-advanced-config"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Settings className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium">Configuración avanzada</span>
          </div>
          <ChevronRight className={cn("h-5 w-5 text-muted-foreground transition-transform", showAdvanced && "rotate-90")} />
        </button>

        {showAdvanced && (
          <div className="space-y-4 pl-4 border-l-2 border-muted ml-5">
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm block">Política de confirmación automática</span>
                <span className="text-xs text-muted-foreground">
                  Cuándo confirmar automáticamente las acciones de las herramientas
                </span>
              </div>
              <Select
                value={policy?.autoConfirmPolicy || 'ask'}
                onValueChange={(value) => updatePolicy.mutate({ autoConfirmPolicy: value })}
              >
                <SelectTrigger className="w-36" data-testid="select-auto-confirm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Siempre</SelectItem>
                  <SelectItem value="ask">Preguntar</SelectItem>
                  <SelectItem value="never">Nunca</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm block">Modo sandbox</span>
                <span className="text-xs text-muted-foreground">
                  Ejecutar acciones en modo de prueba cuando esté disponible
                </span>
              </div>
              <Switch
                checked={policy?.sandboxMode === 'true'}
                onCheckedChange={(checked) => updatePolicy.mutate({ sandboxMode: checked ? 'true' : 'false' })}
                data-testid="switch-sandbox-mode"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm block">Llamadas paralelas máximas</span>
                <span className="text-xs text-muted-foreground">
                  Número máximo de herramientas ejecutadas simultáneamente
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={10}
                value={policy?.maxParallelCalls || 3}
                onChange={(e) => updatePolicy.mutate({ maxParallelCalls: parseInt(e.target.value) || 3 })}
                className="w-20 text-center"
                data-testid="input-max-parallel"
              />
            </div>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Registro de llamadas recientes
          </h3>
          {isLoadingLogs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {logs.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm"
                data-testid={`log-entry-${log.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center",
                    log.status === 'success' ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" :
                      log.status === 'error' ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                        "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400"
                  )}>
                    {log.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> :
                      log.status === 'error' ? <XCircle className="h-3 w-3" /> :
                        <Clock className="h-3 w-3" />}
                  </div>
                  <div>
                    <span className="font-medium">{log.toolId}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {log.providerId}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {log.latencyMs && <span>{log.latencyMs}ms</span>}
                  <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground" data-testid="text-no-logs">
            <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No hay registros de llamadas recientes</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DataControlsSection() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showArchivedDialog, setShowArchivedDialog] = useState(false);
  const [showSharedLinksDialog, setShowSharedLinksDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDisableHistoryConfirm, setShowDisableHistoryConfirm] = useState(false);

  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{
    privacySettings: PrivacySettings;
    consentHistory: ConsentLogEntry[];
  }>({
    queryKey: ['/api/users', userId, 'privacy'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/privacy`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch privacy settings');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: settingsData, isLoading: isLoadingSettings } = useQuery<any>({
    queryKey: ['/api/users', userId, 'settings'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/settings`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch user settings');
      return res.json();
    },
    enabled: !!userId,
  });

  const featureFlags = settingsData?.featureFlags || {};
  const chatHistoryEnabled: boolean = featureFlags.chatHistoryEnabled ?? true;

  const lastConsentByType = useMemo(() => {
    const map = new Map<string, ConsentLogEntry>();
    for (const entry of privacyData?.consentHistory || []) {
      if (!map.has(entry.consentType)) {
        map.set(entry.consentType, entry);
      }
    }
    return map;
  }, [privacyData?.consentHistory]);

  const { data: sharedLinks = [], isLoading: isLoadingLinks } = useQuery<SharedLink[]>({
    queryKey: ['/api/users', userId, 'shared-links'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/shared-links`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch shared links');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: archivedChats = [], isLoading: isLoadingArchived } = useQuery<ArchivedChat[]>({
    queryKey: ['/api/users', userId, 'chats', 'archived'],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/chats/archived`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch archived chats');
      return res.json();
    },
    enabled: !!userId,
  });

  const updatePrivacy = useMutation({
    mutationFn: async (data: Partial<PrivacySettings>) => {
      const res = await fetch(`/api/users/${userId}/privacy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'privacy'] });
      toast({ title: "Preferencias actualizadas", description: "Tus preferencias de privacidad han sido guardadas." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar la configuración.", variant: "destructive" });
    },
  });

  const updateFeatureFlags = useMutation({
    mutationFn: async (patch: { chatHistoryEnabled?: boolean }) => {
      const res = await fetch(`/api/users/${userId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ featureFlags: patch }),
      });
      if (!res.ok) throw new Error('Failed to update settings');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'privacy'] });
      toast({ title: "Preferencias actualizadas", description: "Tus preferencias se han guardado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo guardar la configuración.", variant: "destructive" });
    },
  });

  const revokeLink = useMutation({
    mutationFn: async (linkId: string) => {
      const res = await fetch(`/api/users/${userId}/shared-links/${linkId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to revoke');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'shared-links'] });
      toast({ title: "Enlace revocado", description: "El enlace compartido ha sido revocado." });
    },
  });

  const unarchiveChat = useMutation({
    mutationFn: async (chatId: string) => {
      const res = await fetch(`/api/users/${userId}/chats/${chatId}/restore`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to unarchive');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      toast({ title: "Chat restaurado", description: "El chat ha sido restaurado." });
    },
  });

  const archiveAll = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/users/${userId}/chats/archive-all`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to archive all');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      toast({ title: "Chats archivados", description: `Se archivaron ${data.count} chats.` });
      setShowArchiveConfirm(false);
    },
  });

  const deleteAll = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/users/${userId}/chats/delete-all`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to delete all');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      toast({ title: "Chats eliminados", description: `Se eliminaron ${data.count} chats.` });
      window.dispatchEvent(new CustomEvent("iliagpt:chats-reload"));
      setShowDeleteConfirm(false);
    },
  });

  const privacySettings = privacyData?.privacySettings || { trainingOptIn: false, remoteBrowserDataAccess: false, analyticsTracking: true };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold" data-testid="text-data-controls-title">Controles de datos</h2>

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Privacidad</h3>
        <div className="space-y-3 pt-2">
	          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
	            <div className="flex-1 pr-4">
	              <span className="text-sm block">Mejora el modelo para todos</span>
	              <span className="text-xs text-muted-foreground">
	                Permite que tu contenido (prompts, respuestas, adjuntos) se use para mejorar los modelos de IA.
	              </span>
	              {privacyData?.consentHistory && (
	                <span className="text-xs text-muted-foreground block mt-1">
	                  Último cambio:{" "}
	                  {lastConsentByType.get("training_opt_in")?.createdAt
	                    ? new Date(lastConsentByType.get("training_opt_in")!.createdAt).toLocaleString()
	                    : "Sin registros"}
	                </span>
	              )}
	            </div>
	            <Switch
	              checked={privacySettings.trainingOptIn}
	              onCheckedChange={(checked) => updatePrivacy.mutate({ trainingOptIn: checked })}
	              disabled={updatePrivacy.isPending || isLoadingPrivacy}
	              data-testid="switch-training-opt-in"
	            />
	          </div>

	          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
	            <div className="flex-1 pr-4">
	              <span className="text-sm block">Seguimiento de análisis</span>
	              <span className="text-xs text-muted-foreground">
	                Estadísticas anónimas de uso para mejorar el producto.
	              </span>
	              {privacyData?.consentHistory && (
	                <span className="text-xs text-muted-foreground block mt-1">
	                  Último cambio:{" "}
	                  {lastConsentByType.get("analytics_tracking")?.createdAt
	                    ? new Date(lastConsentByType.get("analytics_tracking")!.createdAt).toLocaleString()
	                    : "Sin registros"}
	                </span>
	              )}
	            </div>
	            <Switch
	              checked={privacySettings.analyticsTracking}
	              onCheckedChange={(checked) => updatePrivacy.mutate({ analyticsTracking: checked })}
	              disabled={updatePrivacy.isPending || isLoadingPrivacy}
	              data-testid="switch-analytics-tracking"
	            />
	          </div>

	          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
	            <div className="flex-1 pr-4">
	              <span className="text-sm block">Datos del navegador remoto</span>
	              <span className="text-xs text-muted-foreground">
	                Permite que ILIAGPT acceda a datos de sesiones de navegación remota (cookies, DOM, capturas).
	              </span>
	              {privacyData?.consentHistory && (
	                <span className="text-xs text-muted-foreground block mt-1">
	                  Último cambio:{" "}
	                  {lastConsentByType.get("remote_browser_access")?.createdAt
	                    ? new Date(lastConsentByType.get("remote_browser_access")!.createdAt).toLocaleString()
	                    : "Sin registros"}
	                </span>
	              )}
	            </div>
	            <Switch
	              checked={privacySettings.remoteBrowserDataAccess}
	              onCheckedChange={(checked) => updatePrivacy.mutate({ remoteBrowserDataAccess: checked })}
	              disabled={updatePrivacy.isPending || isLoadingPrivacy}
	              data-testid="switch-remote-browser"
	            />
	          </div>
	        </div>
	      </div>

      <Separator />

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Enlaces compartidos</h3>
        <div className="flex items-center justify-between py-3 px-2">
          <div>
            <span className="text-sm block">Administrar enlaces</span>
            <span className="text-xs text-muted-foreground">
              {sharedLinks.filter(l => l.isRevoked === 'false').length} enlaces activos
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSharedLinksDialog(true)}
            data-testid="button-manage-links"
          >
            Administrar
          </Button>
        </div>
      </div>

      <Separator />

	      <div className="space-y-1">
	        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Gestión de chats</h3>
	        <div className="space-y-3 pt-2">
	          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
	            <div className="flex-1 pr-4">
	              <span className="text-sm block">Guardar historial de chat</span>
	              <span className="text-xs text-muted-foreground">
	                Conservar conversaciones anteriores en tu historial.
	              </span>
	              {privacyData?.consentHistory && (
	                <span className="text-xs text-muted-foreground block mt-1">
	                  Último cambio:{" "}
	                  {lastConsentByType.get("chat_history_enabled")?.createdAt
	                    ? new Date(lastConsentByType.get("chat_history_enabled")!.createdAt).toLocaleString()
	                    : "Sin registros"}
	                </span>
	              )}
	            </div>
	            <Switch
	              checked={chatHistoryEnabled}
	              onCheckedChange={(checked) => {
	                if (!checked && chatHistoryEnabled) {
	                  setShowDisableHistoryConfirm(true);
	                  return;
	                }
	                updateFeatureFlags.mutate({ chatHistoryEnabled: checked });
	              }}
	              disabled={updateFeatureFlags.isPending || isLoadingSettings}
	              data-testid="switch-chat-history-enabled"
	            />
	          </div>

	          <div className="flex items-center justify-between py-3 px-2">
	            <div>
	              <span className="text-sm block">Chats archivados</span>
	              <span className="text-xs text-muted-foreground">
                {archivedChats.length} chats archivados
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchivedDialog(true)}
              data-testid="button-manage-archived"
            >
              Administrar
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <span className="text-sm">Archivar todos los chats</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchiveConfirm(true)}
              disabled={archiveAll.isPending}
              data-testid="button-archive-all"
            >
              {archiveAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Archivar todo"}
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <span className="text-sm">Eliminar todos los chats</span>
            <Button
              variant="outline"
              size="sm"
              className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteAll.isPending}
              data-testid="button-delete-all"
            >
              {deleteAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar todo"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showArchivedDialog} onOpenChange={setShowArchivedDialog}>
        <DialogContent className="max-w-md max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Chats archivados</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Lista de chats archivados</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <ScrollArea className="h-[400px] pr-4">
            {isLoadingArchived ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : archivedChats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No tienes chats archivados.</p>
            ) : (
              <div className="space-y-2">
                {archivedChats.map((chat) => (
                  <div key={chat.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`archived-chat-${chat.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{chat.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(chat.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => unarchiveChat.mutate(chat.id)}
                      disabled={unarchiveChat.isPending}
                      data-testid={`button-unarchive-${chat.id}`}
                    >
                      Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={showSharedLinksDialog} onOpenChange={setShowSharedLinksDialog}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Enlaces compartidos</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Gestiona tus enlaces compartidos</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <ScrollArea className="h-[400px] pr-4">
            {isLoadingLinks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : sharedLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No tienes enlaces compartidos.</p>
            ) : (
              <div className="space-y-2">
                {sharedLinks.map((link) => (
                  <div key={link.id} className={cn("p-3 border rounded-lg", link.isRevoked === 'true' && "opacity-50")} data-testid={`shared-link-${link.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Share2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium capitalize">{link.resourceType}</span>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            link.scope === 'public' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                              link.scope === 'organization' ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                                "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          )}>
                            {link.scope === 'public' ? 'Público' : link.scope === 'organization' ? 'Organización' : 'Solo con enlace'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Creado: {new Date(link.createdAt).toLocaleDateString()} · {link.accessCount} accesos
                        </p>
                      </div>
                      {link.isRevoked === 'false' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => revokeLink.mutate(link.id)}
                          disabled={revokeLink.isPending}
                          data-testid={`button-revoke-${link.id}`}
                        >
                          Revocar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar todos los chats?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos tus chats serán archivados. Podrás restaurarlos desde "Chats archivados".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveAll.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveAll.mutate()}>
              Archivar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

	      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
	        <AlertDialogContent>
	          <AlertDialogHeader>
	            <AlertDialogTitle>¿Eliminar todos los chats?</AlertDialogTitle>
	            <AlertDialogDescription>
	              Esta acción eliminará todos tus chats. Tendrás un período de recuperación antes de que se eliminen permanentemente.
	            </AlertDialogDescription>
	          </AlertDialogHeader>
	          <AlertDialogFooter>
	            <AlertDialogCancel>Cancelar</AlertDialogCancel>
	            <AlertDialogAction
	              onClick={() => deleteAll.mutate()}
	              className="bg-red-500 hover:bg-red-600"
	            >
	              Eliminar todo
	            </AlertDialogAction>
	          </AlertDialogFooter>
	        </AlertDialogContent>
	      </AlertDialog>

	      <AlertDialog open={showDisableHistoryConfirm} onOpenChange={setShowDisableHistoryConfirm}>
	        <AlertDialogContent>
	          <AlertDialogHeader>
	            <AlertDialogTitle>¿Desactivar el historial de chat?</AlertDialogTitle>
	            <AlertDialogDescription>
	              Al desactivar, las conversaciones nuevas dejarán de aparecer en tu historial (modo temporal). Puedes desactivar solamente o desactivar y borrar tu historial actual.
	            </AlertDialogDescription>
	          </AlertDialogHeader>
	          <AlertDialogFooter>
	            <AlertDialogCancel disabled={updateFeatureFlags.isPending || deleteAll.isPending}>Cancelar</AlertDialogCancel>
	            <AlertDialogAction
	              onClick={() => {
	                setShowDisableHistoryConfirm(false);
	                updateFeatureFlags.mutate({ chatHistoryEnabled: false });
	              }}
	              disabled={updateFeatureFlags.isPending || deleteAll.isPending}
	            >
	              Solo desactivar
	            </AlertDialogAction>
	            <AlertDialogAction
	              onClick={async () => {
	                setShowDisableHistoryConfirm(false);
	                try {
	                  await updateFeatureFlags.mutateAsync({ chatHistoryEnabled: false });
	                  await deleteAll.mutateAsync();
	                } catch {
	                  // Toasts are handled by the underlying mutations.
	                }
	              }}
	              className="bg-red-500 hover:bg-red-600"
	              disabled={updateFeatureFlags.isPending || deleteAll.isPending}
	            >
	              {(updateFeatureFlags.isPending || deleteAll.isPending) ? (
	                <Loader2 className="h-4 w-4 animate-spin" />
	              ) : (
	                "Desactivar y borrar"
	              )}
	            </AlertDialogAction>
	          </AlertDialogFooter>
	        </AlertDialogContent>
	      </AlertDialog>
	    </div>
	  );
	}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
  const [showTrustedDevices, setShowTrustedDevices] = useState(false);
  const [revokingSid, setRevokingSid] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { settings, updateSetting } = useSettingsContext();
  const { language: currentLanguage, setLanguage: setAppLanguage, supportedLanguages } = useLanguage();
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const { availableModels } = useModelAvailability();
  const isAdmin = isAdminUser(user as any);
  const isAuthedUser = !!user && !(user as any)?.isAnonymous;

  const sessionsQuery = useQuery<AuthSessionsResponse>({
    queryKey: ["/api/auth/sessions"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/sessions");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as any)?.message || "No se pudo cargar las sesiones");
      }
      return res.json();
    },
    enabled: open && activeSection === "security" && isAuthedUser,
    staleTime: 1000 * 30,
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await apiFetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as any)?.message || "No se pudo revocar la sesión");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({
        title: "Sesión revocada",
        description: "La sesión fue cerrada en ese dispositivo.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "No se pudo revocar la sesión.",
      });
    },
    onSettled: () => {
      setRevokingSid(null);
    },
  });

  const logoutAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/auth/logout-all", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as any)?.message || "No se pudo cerrar todas las sesiones");
      }
    },
    onSuccess: async () => {
      setShowLogoutAllConfirm(false);
      onOpenChange(false);
      toast({
        title: "Todas las sesiones cerradas",
        description: "Se han cerrado todas las sesiones activas.",
      });
      await logout();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "No se pudo cerrar todas las sesiones.",
      });
    },
  });


  const speechLocale = useMemo(() => {
    const code = settings.spokenLanguage;
    if (!code || code === "auto") return navigator.language || "es-ES";
    if (code === "es") return "es-ES";
    if (code === "en") return "en-US";
    if (code === "fr") return "fr-FR";
    if (code === "de") return "de-DE";
    if (code === "pt") return "pt-PT";
    return navigator.language || "es-ES";
  }, [settings.spokenLanguage]);

  const handleLanguageChange = (value: string) => {
    if (value !== "auto") {
      setAppLanguage(value as any);
    }
  };

  const playVoicePreview = (voiceId: string) => {
    setPlayingVoice(voiceId);
    const utterance = new SpeechSynthesisUtterance("Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?");
    utterance.lang = speechLocale;
    utterance.rate = settings.voiceSpeed ?? 1;
    utterance.volume = settings.voiceVolume ?? 1;
    utterance.pitch = voiceId === "ember" ? 1.2 : voiceId === "breeze" ? 0.9 : 1;
    utterance.onend = () => setPlayingVoice(null);
    utterance.onerror = () => setPlayingVoice(null);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleLogout = () => {
    logout();
    onOpenChange(false);
    toast({ title: "Sesión cerrada", description: "Has cerrado sesión correctamente." });
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAllMutation.mutateAsync();
    } catch {
      // Toast is handled by the mutation.
    }
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
                      <SelectItem value="red">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-500" />
                          Rojo
                        </div>
                      </SelectItem>
                      <SelectItem value="teal">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-teal-500" />
                          Teal
                        </div>
                      </SelectItem>
                      <SelectItem value="yellow">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-yellow-500" />
                          Amarillo
                        </div>
                      </SelectItem>
                      <SelectItem value="indigo">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-indigo-500" />
                          Índigo
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
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <SelectItem key={m.id} value={m.modelId}>
                            {m.name}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                          <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                          <SelectItem value="grok-3-fast">Grok 3 Fast</SelectItem>
                        </>
                      )}
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
        return <NotificationsSection />;

      case "personalization":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Personalización</h2>

            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm font-medium">Estilo y tonos de base</span>
                  <p className="text-sm text-muted-foreground">
                    Configura el estilo y el tono que ILIAGPT utiliza al responder.
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
                placeholder="¿Cómo debería llamarte ILIAGPT?"
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
                  <span className="text-sm block">Permite que ILIAGPT guarde y use memorias al responder.</span>
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
                    Permite que ILIAGPT consulte transcripciones y notas de grabaciones anteriores.
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
                    Dejar que ILIAGPT busque automáticamente las respuestas en la web.
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
                    Dejar que ILIAGPT ejecute el código con el Intérprete de código.
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
                    Colaborar con ILIAGPT en texto y código.
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
                  <span className="text-sm block">ILIAGPT Voice</span>
                  <span className="text-xs text-muted-foreground">
                    Habilitar el modo de voz en ILIAGPT
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
                    Dejar que ILIAGPT busque automáticamente las respuestas en las fuentes conectadas.
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
        return <AppsSection />;

      case "schedules":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Programaciones</h2>
            <p className="text-sm text-muted-foreground">
              ILIAGPT puede programarse para ejecutarse nuevamente después de completar una tarea.
              Selecciona <span className="inline-flex items-center"><Calendar className="h-3 w-3 mx-1" /></span> Programar en el menú de <span className="font-medium">⋯</span> en una conversación para configurar ejecuciones futuras.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                if (isAdmin) {
                  onOpenChange(false);
                  setLocation("/admin?section=reports&tab=scheduled");
                  return;
                }
                toast({
                  title: "Programaciones",
                  description: "Para programar ejecuciones, usa el menú ⋯ en una conversación. La vista de administración está disponible solo para administradores."
                });
              }}
              data-testid="button-manage-schedules"
            >
              Administrar
            </Button>
          </div>
        );

      case "data":
        return <DataControlsSection />;

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
                onClick={() => setShowTrustedDevices((prev) => !prev)}
                data-testid="security-trusted-devices"
              >
                <span className="text-sm">Dispositivos de confianza</span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  {!isAuthedUser ? (
                    "-"
                  ) : sessionsQuery.isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    sessionsQuery.data?.sessions?.length ?? 0
                  )}
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 transition-transform",
                      showTrustedDevices ? "rotate-90" : "rotate-0"
                    )}
                  />
                </span>
              </button>

              {showTrustedDevices && (
                <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
                  {!isAuthedUser ? (
                    <div className="text-sm text-muted-foreground">
                      Inicia sesión para ver y administrar tus sesiones activas.
                    </div>
                  ) : sessionsQuery.isError ? (
                    <div className="flex items-start gap-2 text-sm text-red-600">
                      <AlertCircle className="h-4 w-4 mt-0.5" />
                      <div>
                        <div className="font-medium">No se pudo cargar</div>
                        <div className="text-xs text-muted-foreground">
                          {(sessionsQuery.error as any)?.message || "Error al cargar tus sesiones."}
                        </div>
                      </div>
                    </div>
                  ) : sessionsQuery.data?.sessions?.length ? (
                    <div className="space-y-2">
                      {sessionsQuery.data.sessions.map((s) => (
                        <div
                          key={s.sid}
                          className="flex items-start justify-between gap-3 rounded-md bg-background/60 border px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {summarizeUserAgent(s.userAgent) || "Dispositivo"}
                              </span>
                              {s.isCurrent ? (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                  Este dispositivo
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                              {s.ipAddress ? <div className="truncate">IP: {s.ipAddress}</div> : null}
                              <div className="truncate">Expira: {new Date(s.expiresAt).toLocaleString()}</div>
                              {s.createdAt ? (
                                <div className="truncate">Iniciada: {new Date(s.createdAt).toLocaleString()}</div>
                              ) : null}
                            </div>
                          </div>

                          {!s.isCurrent ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="whitespace-nowrap"
                              onClick={() => {
                                setRevokingSid(s.sid);
                                revokeSessionMutation.mutate(s.sid);
                              }}
                              disabled={revokeSessionMutation.isPending && revokingSid === s.sid}
                            >
                              {revokeSessionMutation.isPending && revokingSid === s.sid ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Revocar"
                              )}
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No se encontraron sesiones activas.</div>
                  )}

                  {isAuthedUser ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => sessionsQuery.refetch()}
                        disabled={sessionsQuery.isFetching}
                      >
                        {sessionsQuery.isFetching ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Actualizar
                      </Button>
                      {isAdmin ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            onOpenChange(false);
                            setLocation("/admin?section=security");
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                          Ver en administrador
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

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
                <h3 className="text-base font-medium">Inicio de sesión seguro con ILIAGPT</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Inicia sesión en sitios web y aplicaciones en toda la red con la seguridad confiable de ILIAGPT.
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
                <span className="text-sm">{user?.email || "Sin correo"}</span>
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
        <DialogContent className="max-w-[600px] p-0 gap-0 overflow-hidden">
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
                      "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all duration-200",
                      activeSection === item.id
                        ? "bg-background font-medium border-l-3 border-l-primary shadow-sm"
                        : "hover:bg-background/50 text-muted-foreground border-l-3 border-l-transparent"
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

      <AlertDialog open={showLogoutAllConfirm} onOpenChange={setShowLogoutAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar todas las sesiones?</AlertDialogTitle>
            <AlertDialogDescription>
              Se cerrarán todas las sesiones activas en todos los dispositivos, incluida tu sesión actual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutAllMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogoutAll}
              disabled={logoutAllMutation.isPending}
              className="bg-red-500 hover:bg-red-600"
            >
              {logoutAllMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Cerrar todas las sesiones"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
