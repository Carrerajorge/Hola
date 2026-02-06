import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { ArrowLeft, Shield, Eye, Download, Trash2, History, FileText, Loader2 } from "lucide-react";

type PrivacySettings = {
  trainingOptIn: boolean;
  remoteBrowserDataAccess: boolean;
  analyticsTracking: boolean;
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
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);

  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{ privacySettings: PrivacySettings }>({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "privacy"] });
      toast({
        title: "Preferencias actualizadas",
        description: "Tus preferencias de privacidad han sido guardadas.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar la configuración.",
        variant: "destructive",
      });
    },
  });

  const updateFeatureFlags = useMutation({
    mutationFn: async (flags: FeatureFlags) => {
      const res = await apiFetch(`/api/users/${userId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureFlags: flags }),
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "settings"] });
      toast({
        title: "Preferencias actualizadas",
        description: "Tus preferencias se han guardado.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración.",
        variant: "destructive",
      });
    },
  });

  const clearHistory = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/chats/delete-all`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to clear history");
      return res.json() as Promise<{ count?: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      toast({
        title: "Historial borrado",
        description: `Se eliminaron ${data?.count ?? 0} chats.`,
      });
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

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-privacy"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Privacidad</h1>
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        {!isLoadingAuth && !isAuthenticated && (
          <div className="mb-8 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Inicia sesión para administrar tus controles de datos, descargar tu información y eliminar tu cuenta.
            </p>
            <div className="mt-3">
              <Button onClick={login} data-testid="button-login-privacy">
                Iniciar sesión
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Control de datos</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Compartir datos de uso</p>
                    <p className="text-sm text-muted-foreground">Ayuda a mejorar el servicio</p>
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
                  </div>
                </div>
                <Switch 
                  checked={privacySettings.analyticsTracking} 
                  onCheckedChange={(checked) => updatePrivacy.mutate({ analyticsTracking: checked })}
                  disabled={!isAuthenticated || updatePrivacy.isPending || isLoadingPrivacy}
                  data-testid="switch-analytics"
                />
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Historial</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <History className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Guardar historial de chat</p>
                    <p className="text-sm text-muted-foreground">Conservar conversaciones anteriores</p>
                  </div>
                </div>
                <Switch 
                  checked={featureFlags.chatHistoryEnabled} 
                  onCheckedChange={(checked) => updateFeatureFlags.mutate({ ...featureFlags, chatHistoryEnabled: checked })}
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
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Tus datos</h2>
            <div className="rounded-lg border divide-y">
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
            </div>
          </div>
          
          <Separator />
          
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-4">
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
          </div>

          <AlertDialog open={showClearHistoryConfirm} onOpenChange={setShowClearHistoryConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar todo el historial?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará todas tus conversaciones. Tendrás un período de recuperación antes de que se eliminen permanentemente.
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
