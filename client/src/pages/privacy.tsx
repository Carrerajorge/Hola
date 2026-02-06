import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";
import { isAdminUser } from "@/lib/admin";
import { ArrowLeft, Shield, Eye, Download, Trash2, History, FileText, Loader2, Lock, Settings } from "lucide-react";

type PrivacySettings = {
  trainingOptIn: boolean;
  remoteBrowserDataAccess: boolean;
  analyticsTracking: boolean;
};

type ConsentLogEntry = {
  id: string;
  consentType: string;
  value: string;
  createdAt: string;
};

type FeatureFlags = {
  memoryEnabled: boolean;
  recordingHistoryEnabled: boolean;
  chatHistoryEnabled: boolean;
  webSearchAuto: boolean;
  codeInterpreterEnabled: boolean;
  canvasEnabled: boolean;
  voiceEnabled: boolean;
  voiceAdvanced: boolean;
  connectorSearchAuto: boolean;
};

export default function PrivacyPage() {
  const [, setLocation] = useLocation();
  const { user, isLoading: isLoadingAuth, isAuthenticated, login, logout } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
  const [showDisableHistoryConfirm, setShowDisableHistoryConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);

  const privacyKey = useMemo(() => ["/api/users", userId, "privacy"] as const, [userId]);
  const settingsKey = useMemo(() => ["/api/users", userId, "settings"] as const, [userId]);

  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{ privacySettings: PrivacySettings; consentHistory: ConsentLogEntry[] }>({
    queryKey: ["/api/users", userId, "privacy"],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/privacy`);
      if (!res.ok) throw new Error("Failed to fetch privacy settings");
      return res.json();
    },
    enabled: !!userId && isAuthenticated,
  });

  const { data: settingsData, isLoading: isLoadingSettings } = useQuery<{ featureFlags?: Partial<FeatureFlags> }>({
    queryKey: ["/api/users", userId, "settings"],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
    enabled: !!userId && isAuthenticated,
  });

  const featureFlags = useMemo<FeatureFlags>(() => {
    const defaults: FeatureFlags = {
      memoryEnabled: false,
      recordingHistoryEnabled: false,
      chatHistoryEnabled: true,
      webSearchAuto: true,
      codeInterpreterEnabled: true,
      canvasEnabled: true,
      voiceEnabled: true,
      voiceAdvanced: false,
      connectorSearchAuto: false,
    };
    return { ...defaults, ...(settingsData?.featureFlags || {}) };
  }, [settingsData?.featureFlags]);

  const privacySettings: PrivacySettings = useMemo(() => {
    const defaults: PrivacySettings = { trainingOptIn: false, remoteBrowserDataAccess: false, analyticsTracking: true };
    return { ...defaults, ...(privacyData?.privacySettings || {}) };
  }, [privacyData?.privacySettings]);

  const lastConsentByType = useMemo(() => {
    const map = new Map<string, ConsentLogEntry>();
    for (const entry of privacyData?.consentHistory || []) {
      if (!map.has(entry.consentType)) {
        map.set(entry.consentType, entry);
      }
    }
    return map;
  }, [privacyData?.consentHistory]);

  const updatePrivacy = useMutation({
    mutationFn: async (patch: Partial<PrivacySettings>) => {
      const res = await apiFetch(`/api/users/${userId}/privacy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to update privacy settings");
      return res.json();
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: privacyKey });
      const previous = queryClient.getQueryData<{ privacySettings: PrivacySettings; consentHistory: ConsentLogEntry[] }>(privacyKey);
      queryClient.setQueryData(privacyKey, (current) => {
        const currentSettings = (current as any)?.privacySettings || {};
        return {
          ...(current as any),
          privacySettings: { ...currentSettings, ...patch },
          consentHistory: (current as any)?.consentHistory || [],
        };
      });
      return { previous };
    },
    onSuccess: () => {
      toast({
        title: "Preferencias actualizadas",
        description: "Tus preferencias de privacidad han sido guardadas.",
      });
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(privacyKey, context.previous);
      }
      toast({
        title: "Error",
        description: "No se pudo actualizar la configuración.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: privacyKey });
    },
  });

  const updateFeatureFlags = useMutation({
    mutationFn: async (patch: Partial<FeatureFlags>) => {
      const res = await apiFetch(`/api/users/${userId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureFlags: patch }),
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return res.json();
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: settingsKey });
      const previous = queryClient.getQueryData<any>(settingsKey);
      queryClient.setQueryData(settingsKey, (current: any) => {
        const currentFlags = (current as any)?.featureFlags || {};
        return { ...(current as any), featureFlags: { ...currentFlags, ...patch } };
      });
      return { previous };
    },
    onSuccess: () => {
      toast({
        title: "Preferencias actualizadas",
        description: "Tus preferencias se han guardado.",
      });
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsKey, context.previous);
      }
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: settingsKey });
    },
  });

  const clearHistory = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/chats/delete-all`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to clear history");
      return res.json() as Promise<{ count?: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Historial borrado",
        description: `Se eliminaron ${data?.count ?? 0} chats.`,
      });
      window.dispatchEvent(new CustomEvent("iliagpt:chats-reload"));
      setShowClearHistoryConfirm(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo borrar el historial.",
        variant: "destructive",
      });
    },
  });

  const downloadData = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/user/export");
      if (!res.ok) throw new Error("Failed to export data");

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename=\"?([^\";]+)\"?/i.exec(disposition);
      const filename = match?.[1] || `iliagpt-export-${Date.now()}.json`;
      return { blob, filename };
    },
    onSuccess: ({ blob, filename }) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast({
        title: "Descarga iniciada",
        description: "Se está descargando tu exportación.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo descargar tu información. Inicia sesión e inténtalo de nuevo.",
        variant: "destructive",
      });
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/user/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to delete account");
      }
      return payload as { message?: string };
    },
    onSuccess: async (data) => {
      toast({
        title: "Cuenta eliminada",
        description: data?.message || "Tu cuenta fue marcada para eliminación.",
      });
      setShowDeleteAccountConfirm(false);
      await logout();
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "No se pudo eliminar la cuenta.",
        variant: "destructive",
      });
    },
  });

  const isSaving = updatePrivacy.isPending || updateFeatureFlags.isPending;
  const isAdmin = useMemo(() => isAdminUser(user as any), [user]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-privacy"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">Privacidad</h1>
            <p className="text-xs text-muted-foreground truncate">
              Controla tus datos, exportaciones y acciones sensibles.
            </p>
          </div>
          {isAuthenticated && (
            <div className="flex items-center gap-2">
              {isSaving ? (
                <Badge variant="info" pulse dot>
                  Guardando
                </Badge>
              ) : (
                <Badge variant="success" dot>
                  Guardado
                </Badge>
              )}
              {isAdmin && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLocation("/admin")}
                    data-testid="button-go-admin"
                    className="hidden sm:inline-flex"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Admin
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setLocation("/admin")}
                    aria-label="Admin"
                    title="Admin"
                    data-testid="button-go-admin-mobile"
                    className="sm:hidden"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        {!isLoadingAuth && !isAuthenticated && (
          <Card className="mb-8">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Acceso requerido</CardTitle>
              <CardDescription>
                Inicia sesión para administrar tus controles de datos, descargar tu información y eliminar tu cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button onClick={login} data-testid="button-login-privacy">
                Iniciar sesión
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Control de datos</h2>
            <Card>
              <CardContent className="p-0 divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Compartir datos de uso</p>
                    <p className="text-sm text-muted-foreground">Ayuda a mejorar el servicio</p>
                    {isAuthenticated && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Último cambio:{" "}
                        {lastConsentByType.get("training_opt_in")?.createdAt
                          ? new Date(lastConsentByType.get("training_opt_in")!.createdAt).toLocaleString()
                          : "Sin registros"}
                      </p>
                    )}
                  </div>
                </div>
                <Switch 
                  checked={privacySettings.trainingOptIn} 
                  onCheckedChange={(checked) => updatePrivacy.mutate({ trainingOptIn: checked })}
                  disabled={!isAuthenticated || updatePrivacy.isPending || isLoadingPrivacy}
                  data-testid="switch-share-data"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Seguimiento de análisis</p>
                    <p className="text-sm text-muted-foreground">Estadísticas anónimas de uso</p>
                    {isAuthenticated && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Último cambio:{" "}
                        {lastConsentByType.get("analytics_tracking")?.createdAt
                          ? new Date(lastConsentByType.get("analytics_tracking")!.createdAt).toLocaleString()
                          : "Sin registros"}
                      </p>
                    )}
                  </div>
                </div>
                <Switch 
                  checked={privacySettings.analyticsTracking} 
                  onCheckedChange={(checked) => updatePrivacy.mutate({ analyticsTracking: checked })}
                  disabled={!isAuthenticated || updatePrivacy.isPending || isLoadingPrivacy}
                  data-testid="switch-analytics"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Datos del navegador remoto</p>
                    <p className="text-sm text-muted-foreground">Cookies, DOM y capturas durante navegación remota</p>
                    {isAuthenticated && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Último cambio:{" "}
                        {lastConsentByType.get("remote_browser_access")?.createdAt
                          ? new Date(lastConsentByType.get("remote_browser_access")!.createdAt).toLocaleString()
                          : "Sin registros"}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  checked={privacySettings.remoteBrowserDataAccess}
                  onCheckedChange={(checked) => updatePrivacy.mutate({ remoteBrowserDataAccess: checked })}
                  disabled={!isAuthenticated || updatePrivacy.isPending || isLoadingPrivacy}
                  data-testid="switch-remote-browser"
                />
              </div>
            </CardContent>
            </Card>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Historial</h2>
            <Card>
              <CardContent className="p-0 divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <History className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Guardar historial de chat</p>
                    <p className="text-sm text-muted-foreground">Conservar conversaciones anteriores</p>
                    {isAuthenticated && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Último cambio:{" "}
                        {lastConsentByType.get("chat_history_enabled")?.createdAt
                          ? new Date(lastConsentByType.get("chat_history_enabled")!.createdAt).toLocaleString()
                          : "Sin registros"}
                      </p>
                    )}
                  </div>
                </div>
                <Switch 
                  checked={featureFlags.chatHistoryEnabled} 
                  onCheckedChange={(checked) => {
                    // When disabling history, prompt for optional cleanup for a more logical flow.
                    if (!checked && featureFlags.chatHistoryEnabled) {
                      setShowDisableHistoryConfirm(true);
                      return;
                    }
                    updateFeatureFlags.mutate({ chatHistoryEnabled: checked });
                  }}
                  disabled={!isAuthenticated || updateFeatureFlags.isPending || isLoadingSettings}
                  data-testid="switch-save-history"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Trash2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Borrar historial</p>
                    <p className="text-sm text-muted-foreground">Eliminar todas las conversaciones</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-clear-history"
                  onClick={() => setShowClearHistoryConfirm(true)}
                  disabled={!isAuthenticated || clearHistory.isPending}
                >
                  Borrar todo
                </Button>
              </div>
              </CardContent>
            </Card>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Tus datos</h2>
            <Card>
              <CardContent className="p-0 divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Download className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Descargar mis datos</p>
                    <p className="text-sm text-muted-foreground">Exportar toda tu información</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-download-data"
                  onClick={() => downloadData.mutate()}
                  disabled={!isAuthenticated || downloadData.isPending}
                >
                  {downloadData.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Descargar"}
                </Button>
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Política de privacidad</p>
                    <p className="text-sm text-muted-foreground">Leer términos completos</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-privacy-policy"
                  onClick={() => setLocation("/privacy-policy")}
                >
                  Ver
                </Button>
              </div>
              </CardContent>
            </Card>
          </div>
          
          <Separator />
          
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
            <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Trash2 className="h-5 w-5 text-red-500" />
                <div>
                  <p className="font-medium text-red-600 dark:text-red-400">Eliminar cuenta</p>
                  <p className="text-sm text-red-500/80">Esta acción es permanente e irreversible</p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                data-testid="button-delete-account"
                onClick={() => setShowDeleteAccountConfirm(true)}
                disabled={!isAuthenticated || deleteAccount.isPending}
              >
                Eliminar
              </Button>
            </div>
            </CardContent>
          </Card>

          <AlertDialog open={showClearHistoryConfirm} onOpenChange={setShowClearHistoryConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar todo el historial?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará todas tus conversaciones. Tendrás un período de recuperación de 30 días antes de que se eliminen permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => clearHistory.mutate()}
                  className="bg-red-500 hover:bg-red-600"
                >
                  {clearHistory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Borrar todo"}
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
                <AlertDialogCancel disabled={updateFeatureFlags.isPending || clearHistory.isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setShowDisableHistoryConfirm(false);
                    updateFeatureFlags.mutate({ chatHistoryEnabled: false });
                  }}
                  disabled={updateFeatureFlags.isPending || clearHistory.isPending}
                >
                  Solo desactivar
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={async () => {
                    setShowDisableHistoryConfirm(false);
                    try {
                      await updateFeatureFlags.mutateAsync({ chatHistoryEnabled: false });
                      await clearHistory.mutateAsync();
                    } catch {
                      // Toasts are handled by the underlying mutations.
                    }
                  }}
                  className="bg-red-500 hover:bg-red-600"
                  disabled={updateFeatureFlags.isPending || clearHistory.isPending}
                >
                  {updateFeatureFlags.isPending || clearHistory.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Desactivar y borrar"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={showDeleteAccountConfirm} onOpenChange={setShowDeleteAccountConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar tu cuenta?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción es permanente e irreversible. Tu cuenta quedará marcada para eliminación.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteAccount.mutate()}
                  className="bg-red-500 hover:bg-red-600"
                >
                  {deleteAccount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar cuenta"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
