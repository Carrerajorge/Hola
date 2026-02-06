import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { format } from "date-fns";
import {
  Ban,
  CheckCircle,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

type UserInspectorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  onNavigate?: (section: string, params?: { userId?: string }) => void;
};

function safeDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function UserInspectorDialog({ open, onOpenChange, userId, onNavigate }: UserInspectorDialogProps) {
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<null | "block" | "unblock" | "clear-chats">(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["/api/admin/dashboard/user-activity", userId],
    queryFn: async () => {
      if (!userId) return null;
      const res = await apiFetch(`/api/admin/dashboard/user-activity?userId=${encodeURIComponent(userId)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || "Failed to load user activity");
      }
      return res.json();
    },
    enabled: !!userId && open,
  });

  const { data: controlsData, isLoading: isLoadingControls, refetch: refetchControls, isFetching: isFetchingControls } = useQuery({
    queryKey: ["/api/admin/users", userId, "data-controls"],
    queryFn: async () => {
      if (!userId) return null;
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/data-controls`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || "Failed to load data controls");
      }
      return res.json();
    },
    enabled: !!userId && open,
  });

  const user = data?.user || null;
  const activity = data?.activity || { conversationCount: 0, recentConversations: [], recentAuditLogs: [] };

  const controls = controlsData || null;
  const privacySettings = controls?.privacySettings || { trainingOptIn: false, remoteBrowserDataAccess: false, analyticsTracking: true };
  const featureFlags = controls?.featureFlags || { chatHistoryEnabled: true };
  const consentHistory = controls?.consentHistory || [];

  const lastConsentByType = (() => {
    const map = new Map<string, any>();
    for (const entry of consentHistory || []) {
      if (!map.has(entry.consentType)) map.set(entry.consentType, entry);
    }
    return map;
  })();

  const updateControlsMutation = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      if (!userId) throw new Error("Missing userId");
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/data-controls`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Failed to update data controls");
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success("Data controls updated");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "data-controls"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/user-activity", userId] }),
      ]);
      refetchControls();
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to update data controls");
    },
  });

  const clearChatsMutation = useMutation({
    mutationFn: async (input: { reason: string }) => {
      if (!userId) throw new Error("Missing userId");
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/chats/delete-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: input.reason }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Failed to clear chats");
      }
      return payload as { count?: number };
    },
    onSuccess: async (data) => {
      setConfirmAction(null);
      toast.success(`Cleared ${data?.count ?? 0} chats`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/user-activity", userId] }),
      ]);
      refetch();
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to clear chats");
    },
  });

  const blockMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Missing userId");
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Blocked by admin" }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || "Failed to block user");
      }
      return res.json();
    },
    onSuccess: async () => {
      setConfirmAction(null);
      toast.success("User blocked");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/user-activity"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
      ]);
      refetch();
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to block user");
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Missing userId");
      const res = await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/unblock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || "Failed to unblock user");
      }
      return res.json();
    },
    onSuccess: async () => {
      setConfirmAction(null);
      toast.success("User unblocked");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard/user-activity"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
      ]);
      refetch();
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to unblock user");
    },
  });

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const status = String(user?.status || "");
  const statusBadge =
    status === "active" ? (
      <Badge variant="default" className="text-xs">active</Badge>
    ) : status === "blocked" || status === "suspended" ? (
      <Badge variant="destructive" className="text-xs">{status}</Badge>
    ) : (
      <Badge variant="outline" className="text-xs">{status || "unknown"}</Badge>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="truncate">User Inspector</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching || isFetchingControls}
                title="Refresh"
                data-testid="button-refresh-user-inspector"
              >
                {(isFetching || isFetchingControls) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !userId ? (
          <div className="py-8 text-sm text-muted-foreground">No user selected.</div>
        ) : !user ? (
          <div className="py-8 text-sm text-muted-foreground">User not found.</div>
        ) : (
          <div className="flex flex-col gap-4 overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate max-w-[520px]">{user.email || "Unknown email"}</span>
                  {statusBadge}
                  <Badge variant="secondary" className="text-xs">{user.plan || "free"}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="font-mono">{user.id}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => copyToClipboard(String(user.id))}
                    title="Copy user ID"
                    data-testid="button-copy-user-id"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {user.fullName && <span>• {user.fullName}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {status === "blocked" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmAction("unblock");
                    }}
                    disabled={unblockMutation.isPending}
                    data-testid="button-unblock-user"
                  >
                    {unblockMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                    Unblock
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmAction("block");
                    }}
                    disabled={blockMutation.isPending}
                    data-testid="button-block-user"
                  >
                    {blockMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
                    Block
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Privacidad e historial
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Controles vinculados a los toggles de /privacy y consent logs.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchControls()}
                  disabled={isLoadingControls || isFetchingControls}
                  data-testid="button-refresh-data-controls"
                >
                  {isFetchingControls ? <Loader2 className="h-4 w-4 animate-spin" /> : "Actualizar"}
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Compartir datos de uso</p>
                    <p className="text-xs text-muted-foreground">training_opt_in</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Último cambio:{" "}
                      {lastConsentByType.get("training_opt_in")?.createdAt
                        ? format(safeDate(lastConsentByType.get("training_opt_in")!.createdAt)!, "dd/MM/yyyy HH:mm")
                        : "-"}
                    </p>
                  </div>
                  <Switch
                    checked={!!privacySettings.trainingOptIn}
                    onCheckedChange={(checked) => updateControlsMutation.mutate({ trainingOptIn: checked })}
                    disabled={updateControlsMutation.isPending || isLoadingControls}
                    data-testid="admin-switch-training-opt-in"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Seguimiento de análisis</p>
                    <p className="text-xs text-muted-foreground">analytics_tracking</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Último cambio:{" "}
                      {lastConsentByType.get("analytics_tracking")?.createdAt
                        ? format(safeDate(lastConsentByType.get("analytics_tracking")!.createdAt)!, "dd/MM/yyyy HH:mm")
                        : "-"}
                    </p>
                  </div>
                  <Switch
                    checked={privacySettings.analyticsTracking !== false}
                    onCheckedChange={(checked) => updateControlsMutation.mutate({ analyticsTracking: checked })}
                    disabled={updateControlsMutation.isPending || isLoadingControls}
                    data-testid="admin-switch-analytics-tracking"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Datos del navegador remoto</p>
                    <p className="text-xs text-muted-foreground">remote_browser_access</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Último cambio:{" "}
                      {lastConsentByType.get("remote_browser_access")?.createdAt
                        ? format(safeDate(lastConsentByType.get("remote_browser_access")!.createdAt)!, "dd/MM/yyyy HH:mm")
                        : "-"}
                    </p>
                  </div>
                  <Switch
                    checked={!!privacySettings.remoteBrowserDataAccess}
                    onCheckedChange={(checked) => updateControlsMutation.mutate({ remoteBrowserDataAccess: checked })}
                    disabled={updateControlsMutation.isPending || isLoadingControls}
                    data-testid="admin-switch-remote-browser"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Guardar historial de chat</p>
                    <p className="text-xs text-muted-foreground">chat_history_enabled</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Último cambio:{" "}
                      {lastConsentByType.get("chat_history_enabled")?.createdAt
                        ? format(safeDate(lastConsentByType.get("chat_history_enabled")!.createdAt)!, "dd/MM/yyyy HH:mm")
                        : "-"}
                    </p>
                  </div>
                  <Switch
                    checked={featureFlags.chatHistoryEnabled !== false}
                    onCheckedChange={(checked) => updateControlsMutation.mutate({ chatHistoryEnabled: checked })}
                    disabled={updateControlsMutation.isPending || isLoadingControls}
                    data-testid="admin-switch-chat-history"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  Acciones de soporte (se auditan). Usa con cuidado.
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmAction("clear-chats");
                  }}
                  disabled={clearChatsMutation.isPending}
                  data-testid="button-admin-clear-user-chats"
                >
                  {clearChatsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  Borrar historial
                </Button>
              </div>
            </div>

            <AlertDialog
              open={confirmAction !== null}
              onOpenChange={(nextOpen) => {
                const pending =
                  (confirmAction === "block" && blockMutation.isPending) ||
                  (confirmAction === "unblock" && unblockMutation.isPending) ||
                  (confirmAction === "clear-chats" && clearChatsMutation.isPending);
                if (!nextOpen && !pending) setConfirmAction(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {confirmAction === "block"
                      ? "Block user"
                      : confirmAction === "unblock"
                        ? "Unblock user"
                        : "Borrar historial"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {confirmAction === "block" ? (
                      <>
                        ¿Bloquear{" "}
                        <span className="font-medium text-foreground">{user?.email || userId || "este usuario"}</span>?{" "}
                        Esta acción se audita.
                      </>
                    ) : confirmAction === "unblock" ? (
                      <>
                        ¿Desbloquear{" "}
                        <span className="font-medium text-foreground">{user?.email || userId || "este usuario"}</span>?{" "}
                        Esta acción se audita.
                      </>
                    ) : (
                      <>
                        ¿Borrar todo el historial de chats de{" "}
                        <span className="font-medium text-foreground">{user?.email || userId || "este usuario"}</span>?{" "}
                        Esta acción no se puede deshacer.
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={
                      (confirmAction === "block" && blockMutation.isPending) ||
                      (confirmAction === "unblock" && unblockMutation.isPending) ||
                      (confirmAction === "clear-chats" && clearChatsMutation.isPending)
                    }
                  >
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className={cn(
                      confirmAction === "block" || confirmAction === "clear-chats"
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        : ""
                    )}
                    disabled={
                      (confirmAction === "block" && blockMutation.isPending) ||
                      (confirmAction === "unblock" && unblockMutation.isPending) ||
                      (confirmAction === "clear-chats" && clearChatsMutation.isPending)
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      if (confirmAction === "block") blockMutation.mutate();
                      else if (confirmAction === "unblock") unblockMutation.mutate();
                      else if (confirmAction === "clear-chats") {
                        const reason = prompt("Motivo (requerido):", "Soporte / solicitud del usuario");
                        if (!reason) return;
                        const trimmed = reason.trim();
                        if (trimmed.length < 3) {
                          toast.error("Motivo demasiado corto");
                          return;
                        }
                        clearChatsMutation.mutate({ reason: trimmed });
                      }
                    }}
                  >
                    {(confirmAction === "block" && blockMutation.isPending) ||
                    (confirmAction === "unblock" && unblockMutation.isPending) ||
                    (confirmAction === "clear-chats" && clearChatsMutation.isPending) ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Procesando...
                      </>
                    ) : confirmAction === "block" ? (
                      "Bloquear"
                    ) : confirmAction === "unblock" ? (
                      "Desbloquear"
                    ) : (
                      "Borrar"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Conversations</p>
                <p className="text-lg font-semibold tabular-nums">{activity.conversationCount || 0}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Queries</p>
                <p className="text-lg font-semibold tabular-nums">{Number(user.queryCount || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Tokens</p>
                <p className="text-lg font-semibold tabular-nums">{Number(user.tokensConsumed || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Last login</p>
                <p className="text-sm font-medium">
                  {safeDate(user.lastLoginAt) ? format(safeDate(user.lastLoginAt)!, "dd/MM/yyyy HH:mm") : "-"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onNavigate?.("conversations", { userId })}
                data-testid="button-nav-conversations"
              >
                <MessageSquare className="h-4 w-4" />
                Conversations
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onNavigate?.("payments", { userId })}
                data-testid="button-nav-payments"
              >
                <CreditCard className="h-4 w-4" />
                Payments
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onNavigate?.("invoices", { userId })}
                data-testid="button-nav-invoices"
              >
                <FileText className="h-4 w-4" />
                Invoices
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onNavigate?.("security", { userId })}
                data-testid="button-nav-audit"
              >
                <Shield className="h-4 w-4" />
                Audit Logs
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
              <div className="rounded-lg border overflow-hidden">
                <div className="p-3 border-b bg-muted/30">
                  <p className="text-sm font-medium">Recent Conversations</p>
                </div>
                <ScrollArea className="h-[220px]">
                  {(activity.recentConversations || []).length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No recent conversations.</div>
                  ) : (
                    (activity.recentConversations || []).map((c: any) => (
                      <div key={c.id} className="p-3 border-b last:border-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-primary">{String(c.id).slice(-8).toUpperCase()}</span>
                          <span className="text-xs text-muted-foreground">
                            {safeDate(c.updatedAt || c.lastMessageAt || c.createdAt)
                              ? format(safeDate(c.updatedAt || c.lastMessageAt || c.createdAt)!, "dd/MM HH:mm")
                              : "-"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">{c.title || "Untitled"}</span>
                          <span className="tabular-nums">
                            {Number(c.messageCount || 0)} msg • {Number(c.tokensUsed || 0).toLocaleString()} tok
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <div className="p-3 border-b bg-muted/30">
                  <p className="text-sm font-medium">Recent Audit Logs</p>
                </div>
                <ScrollArea className="h-[220px]">
                  {(activity.recentAuditLogs || []).length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No recent audit logs.</div>
                  ) : (
                    (activity.recentAuditLogs || []).map((l: any) => (
                      <div key={l.id} className="p-3 border-b last:border-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{l.action}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              l.details?.severity === "critical"
                                ? "bg-red-500/10 text-red-600 border-red-500/30"
                                : l.details?.severity === "warning"
                                  ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/30"
                                  : "bg-blue-500/10 text-blue-600 border-blue-500/30"
                            )}
                          >
                            {l.details?.severity || "info"}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">{l.resource || "-"}</span>
                          <span>
                            {safeDate(l.createdAt) ? format(safeDate(l.createdAt)!, "dd/MM HH:mm") : "-"}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
