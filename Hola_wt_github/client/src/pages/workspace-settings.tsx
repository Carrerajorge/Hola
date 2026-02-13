import { useState, useEffect, useMemo } from "react";
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
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/apiClient";
import { isAdminUser, isBillingManagerUser } from "@/lib/admin";
import { formatPeriodEndEs, shouldShowWorkspaceDeactivationBanner } from "@/lib/billing";
import { useCloudLibrary } from "@/hooks/use-cloud-library";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { CreditAlertsDialog } from "@/components/credit-alerts-dialog";
import { BillingHelpDialog } from "@/components/billing-help-dialog";

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
  const { user } = useAuth();
  const isAdmin = isAdminUser(user as any);
  const canManageBilling = isBillingManagerUser(user as any);
  const canManageWorkspace = canManageBilling;
  const { toast } = useToast();
  const userDisplayName = user?.fullName || user?.username || "Tu cuenta";
  const userEmail = user?.email || "";
  const userInitials =
    userDisplayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "U";
  const [workspaceName, setWorkspaceName] = useState("");
  const [orgId, setOrgId] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [logoFileUuid, setLogoFileUuid] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [billingHelpOpen, setBillingHelpOpen] = useState(false);
  const [billingHelpAction, setBillingHelpAction] = useState<string>("workspace_billing");
  const [planSelectKey, setPlanSelectKey] = useState(0);
  const [billingTab, setBillingTab] = useState<"plan" | "invoices">("plan");
  const [creditsOffset, setCreditsOffset] = useState(0);
  const [creditsUsage, setCreditsUsage] = useState<{
    cycleStart: string;
    cycleEnd: string;
    plan: string;
    totalTokens: number;
    totalRequests: number;
    limitTokens: number | null;
    percentUsed: number | null;
  } | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<
    {
      id: string;
      number: string | null;
      status: string | null;
      currency: string | null;
      amountDue: number;
      amountPaid: number;
      amountRemaining: number;
      subtotal: number | null;
      total: number | null;
      createdAt: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      hostedInvoiceUrl: string | null;
      invoicePdf: string | null;
    }[]
  >([]);
  const [invoicesCursor, setInvoicesCursor] = useState<string | null>(null);
  const [invoicesHasMore, setInvoicesHasMore] = useState(false);
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);

  const [billingStatus, setBillingStatus] = useState<{
    subscriptionStatus: string | null;
    subscriptionPeriodEnd: string | null;
    willDeactivate: boolean;
  } | null>(null);

  const deactivationDateLabel = useMemo(() => {
    return formatPeriodEndEs(billingStatus?.subscriptionPeriodEnd ?? null);
  }, [billingStatus?.subscriptionPeriodEnd]);

  const showDeactivationBanner = useMemo(() => {
    return shouldShowWorkspaceDeactivationBanner({
      subscriptionStatus: billingStatus?.subscriptionStatus,
      subscriptionPeriodEnd: billingStatus?.subscriptionPeriodEnd,
    });
  }, [billingStatus?.subscriptionStatus, billingStatus?.subscriptionPeriodEnd]);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const section = params.get("section") as WorkspaceSection | null;
    if (section && menuItems.some(item => item.id === section)) {
      setActiveSection(section);
    }
  }, [searchString]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch("/api/billing/status");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setBillingStatus(data);
        }
      } catch {
        // ignore
      }
    })();

    (async () => {
      try {
        const res = await apiFetch("/api/workspace/me");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setOrgId(data.orgId || "");
        setWorkspaceId(data.workspaceId || "");
        setWorkspaceName(data.name || "");
        setLogoFileUuid(data.logoFileUuid || null);
        setMemberCount(typeof data.memberCount === "number" ? data.memberCount : null);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeSection !== "billing") return;

    let cancelled = false;
    setCreditsLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/billing/credits/usage?offset=${creditsOffset}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "No se pudo cargar el uso de créditos");
        }
        if (!cancelled) setCreditsUsage(data);
      } catch (e: any) {
        if (!cancelled) {
          toast({
            title: "Error",
            description: e?.message || "No se pudo cargar el uso de créditos.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setCreditsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, creditsOffset, toast]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const { uploadFile, isUploading } = useCloudLibrary();

  const openStripePortal = async () => {
    if (!canManageBilling) {
      toast({
        title: "Contactar administrador",
        description: "Solo el administrador puede gestionar la facturación. Envía una solicitud desde aquí.",
      });
      setBillingHelpAction("billing_portal");
      setBillingHelpOpen(true);
      return;
    }
    try {
      const res = await apiFetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo abrir el portal de facturación");
      }
      if (data?.url) window.location.href = data.url;
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo abrir el portal de facturación.",
        variant: "destructive",
      });
    }
  };

  const loadInvoices = async (opts?: { reset?: boolean }) => {
    if (!canManageBilling) return;
    if (invoicesLoading) return;

    const reset = opts?.reset === true;
    setInvoicesError(null);
    setInvoicesLoading(true);
    try {
      const cursor = reset ? null : invoicesCursor;
      const url = cursor
        ? `/api/billing/invoices?limit=10&startingAfter=${encodeURIComponent(cursor)}`
        : `/api/billing/invoices?limit=10`;
      const res = await apiFetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudieron cargar las facturas");
      }

      const nextInvoices = Array.isArray(data?.invoices) ? data.invoices : [];

      setInvoices((prev) => (reset ? nextInvoices : [...prev, ...nextInvoices]));
      setInvoicesHasMore(!!data?.hasMore);
      setInvoicesCursor(data?.nextCursor || null);
      setInvoicesLoaded(true);
    } catch (e: any) {
      const msg = e?.message || "No se pudieron cargar las facturas.";
      setInvoicesError(msg);
      toast({
        title: "Error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setInvoicesLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection !== "billing") return;
    if (billingTab !== "invoices") return;
    if (!canManageBilling) return;
    if (invoicesLoaded) return;
    void loadInvoices({ reset: true });
  }, [activeSection, billingTab, canManageBilling, invoicesLoaded]);

  const formatCycleShort = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
  };

  const planLabel = (planRaw: string | null | undefined) => {
    const plan = String(planRaw || "free").toLowerCase().trim();
    switch (plan) {
      case "free":
        return "Gratis";
      case "go":
        return "Go";
      case "plus":
        return "Plus";
      case "pro":
        return "Pro";
      case "business":
        return "Business";
      case "enterprise":
        return "Enterprise";
      case "admin":
        return "Admin";
      default:
        return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Gratis";
    }
  };

  const formatMoney = (amountCents: number | null | undefined, currency: string | null | undefined) => {
    if (typeof amountCents !== "number") return "—";
    const cur = String(currency || "usd").toUpperCase();
    try {
      return new Intl.NumberFormat("es-ES", { style: "currency", currency: cur }).format(amountCents / 100);
    } catch {
      return `${(amountCents / 100).toFixed(2)} ${cur}`;
    }
  };

  const invoiceStatusInfo = (statusRaw: string | null | undefined) => {
    const status = String(statusRaw || "").toLowerCase().trim();
    switch (status) {
      case "paid":
        return { label: "Pagada", className: "bg-green-100 text-green-700 hover:bg-green-100" };
      case "open":
        return { label: "Pendiente", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" };
      case "draft":
        return { label: "Borrador", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" };
      case "void":
        return { label: "Anulada", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" };
      case "uncollectible":
        return { label: "Incobrable", className: "bg-red-100 text-red-700 hover:bg-red-100" };
      default:
        return { label: statusRaw ? String(statusRaw) : "—", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" };
    }
  };

  const formatInvoiceDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" });
  };

  const handleLogoUpload = async (file: File) => {
    // Client-side validations
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (file.size > 2 * 1024 * 1024) {
      alert("El logo no puede superar 2MB");
      return;
    }
    if (file.type && !allowed.includes(file.type)) {
      alert("Formato no permitido. Use PNG, JPG o WebP");
      return;
    }

    const saved = await uploadFile({
      file,
      metadata: {
        name: "Workspace Logo",
        description: "Logo del espacio de trabajo",
      },
    });

    setLogoFileUuid(saved.uuid);

    // Persist immediately
    setIsSavingWorkspace(true);
    try {
      const res = await apiFetch("/api/workspace/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoFileUuid: saved.uuid }),
      });
      if (res.ok) {
        const data = await res.json();
        setLogoFileUuid(data.logoFileUuid || null);
      }
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleSaveName = async () => {
    setIsSavingWorkspace(true);
    try {
      const res = await apiFetch("/api/workspace/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(data?.error || "No se pudo guardar");
        return;
      }
      setWorkspaceName(data.name || workspaceName);
    } finally {
      setIsSavingWorkspace(false);
    }
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

	            {!canManageWorkspace && (
	              <div className="rounded-lg border bg-muted/30 p-4 flex items-start justify-between gap-4">
	                <div className="space-y-1">
	                  <p className="text-sm font-medium">Solo administrador</p>
	                  <p className="text-sm text-muted-foreground">
	                    Para cambiar el nombre o el logotipo del espacio de trabajo, contacta al administrador.
	                  </p>
	                </div>
	                <Button
	                  variant="outline"
	                  onClick={() => {
	                    setBillingHelpAction("workspace_settings");
	                    setBillingHelpOpen(true);
	                  }}
	                  data-testid="button-workspace-contact-admin"
	                >
	                  Contactar administrador
	                </Button>
	              </div>
	            )}

	            <div className="space-y-6">
	              <h2 className="text-lg font-medium">Aspecto</h2>
	              
	              <div className="space-y-4">
	                <div className="flex items-center justify-between gap-3">
	                  <span className="text-sm">Nombre de espacio de trabajo</span>
	                  <div className="flex items-center gap-2">
	                    <Input
	                      value={workspaceName}
	                      onChange={(e) => setWorkspaceName(e.target.value)}
	                      disabled={!canManageWorkspace}
	                      className="w-72"
	                      data-testid="input-workspace-name"
	                      placeholder="Espacio de trabajo"
	                    />
	                    {canManageWorkspace ? (
	                      <Button
	                        variant="outline"
	                        size="sm"
	                        disabled={isSavingWorkspace || !workspaceName.trim()}
	                        onClick={handleSaveName}
	                        data-testid="button-save-workspace-name"
	                      >
	                        Guardar
	                      </Button>
	                    ) : (
	                      <Button
	                        variant="outline"
	                        size="sm"
	                        onClick={() => {
	                          setBillingHelpAction("workspace_name");
	                          setBillingHelpOpen(true);
	                        }}
	                        data-testid="button-contact-admin-workspace-name"
	                      >
	                        Contactar administrador
	                      </Button>
	                    )}
	                  </div>
	                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm">Logotipo</span>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </div>
	                  <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center">
	                    <Upload className="h-7 w-7 text-muted-foreground mb-2" />
	                    <p className="text-sm text-muted-foreground">PNG/JPG/WebP, máx. 2MB</p>
	                    <div className="mt-2">
	                      {canManageWorkspace ? (
	                        <label className="text-sm text-primary hover:underline cursor-pointer" data-testid="button-browse-files">
	                          <input
	                            type="file"
	                            className="hidden"
	                            accept="image/png,image/jpeg,image/webp"
	                            onChange={(e) => {
	                              const f = e.target.files?.[0];
	                              if (f) handleLogoUpload(f);
	                              e.target.value = '';
	                            }}
	                          />
	                          {isUploading ? "Subiendo..." : "Explorar archivos"}
	                        </label>
	                      ) : (
	                        <Button
	                          variant="outline"
	                          size="sm"
	                          onClick={() => {
	                            setBillingHelpAction("workspace_logo");
	                            setBillingHelpOpen(true);
	                          }}
	                          data-testid="button-contact-admin-workspace-logo"
	                        >
	                          Contactar administrador
	                        </Button>
	                      )}
	                    </div>
	                    {logoFileUuid && (
	                      <p className="mt-2 text-xs text-muted-foreground">Logo actualizado</p>
	                    )}
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
	                        <AvatarFallback className="bg-blue-100 text-blue-700 text-sm">{userInitials}</AvatarFallback>
	                      </Avatar>
	                      <div>
	                        <span className="text-sm font-medium block">{userDisplayName} (Tú)</span>
	                        <span className="text-xs text-muted-foreground">{userEmail}</span>
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
                          Administra si los miembros pueden activar la memoria. Esto permite que ILIAGPT se vuelva más útil recordando detalles y preferencias a través de los chats.{" "}
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
                    <h3 className="font-medium">ILIAGPT Record</h3>
                    <p className="text-xs text-muted-foreground">
                      Administra si los usuarios pueden usar ILIAGPT para grabar, transcribir y resumir audio de formato largo. Las grabaciones solo se usarán para fines de transcripción y no las almacenará.{" "}
                      <button className="text-primary hover:underline">Obtener más información</button>
                    </p>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm">Permitir que los miembros usen ILIAGPT Record</span>
                      <Switch defaultChecked data-testid="switch-record" />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <div className="flex-1 pr-4">
                        <span className="text-sm block">Permitir que ILIAGPT consulte notas y transcripciones anteriores.</span>
                        <span className="text-xs text-muted-foreground">
                          Permitir que los miembros consulten notas y transcripciones anteriores en ILIAGPT Record.
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
                          Controla si los usuarios de este espacio de trabajo pueden permitir que ILIAGPT edite archivos de código al usar la aplicación de escritorio para macOS. Esto permite que ILIAGPT lea y edite el contenido de aplicaciones específicas en su escritorio para dar mejores respuestas.{" "}
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
	        const cycleStartLabel = creditsUsage?.cycleStart ? formatCycleShort(creditsUsage.cycleStart) : "—";
	        const cycleEndLabel = creditsUsage?.cycleEnd ? formatCycleShort(creditsUsage.cycleEnd) : "—";
	        const cycleLine = `${creditsOffset === 0 ? "Ciclo actual" : "Ciclo"}: ${cycleStartLabel} - ${cycleEndLabel}`;
	        const creditsUsed = creditsUsage?.totalTokens ?? 0;
	        const creditsLimit = creditsUsage?.limitTokens ?? null;
        const creditsPercent =
          typeof creditsUsage?.percentUsed === "number"
            ? Math.round(creditsUsage.percentUsed)
            : creditsLimit && creditsLimit > 0
              ? Math.round((creditsUsed / creditsLimit) * 100)
              : null;
	        const cycleEndMs = creditsUsage?.cycleEnd ? new Date(creditsUsage.cycleEnd).getTime() : null;
	        const daysToCycleEnd =
	          creditsOffset === 0 && cycleEndMs ? Math.max(0, Math.ceil((cycleEndMs - Date.now()) / (24 * 60 * 60 * 1000))) : null;
	        const effectivePlanRaw = creditsUsage?.plan || (user as any)?.subscriptionPlan || user?.plan || "free";
	        const effectivePlanKey = String(effectivePlanRaw || "free").toLowerCase().trim();
	        const PLAN_PRICES_USD: Record<string, number | null> = {
	          free: 0,
	          go: 5,
	          plus: 10,
	          pro: 200,
	          business: 25,
	          enterprise: null,
	          admin: null,
	        };
	        const priceUsd = PLAN_PRICES_USD[effectivePlanKey] ?? null;
	        return (
	          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Facturación</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {creditsLoading ? "Cargando ciclo..." : cycleLine}
              </p>
            </div>

            {!canManageBilling && (
              <div className="rounded-lg border bg-muted/30 p-4 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Solo administrador</p>
                  <p className="text-sm text-muted-foreground">
                    Este espacio de trabajo está conectado al panel de administración. Para cambiar el plan, administrar facturación o configurar alertas,
                    contacta al administrador.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBillingHelpAction("workspace_billing");
                    setBillingHelpOpen(true);
                  }}
                  data-testid="button-billing-contact-admin"
                >
                  Contactar administrador
                </Button>
              </div>
            )}

            <Tabs
              value={billingTab}
              onValueChange={(value) => setBillingTab(value as "plan" | "invoices")}
              className="w-full"
            >
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
                        <span className="font-semibold text-lg">Plan {planLabel(creditsUsage?.plan || (user as any)?.subscriptionPlan || user?.plan)}</span>
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Mensualmente</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {billingStatus?.willDeactivate
                          ? `Se desactivará${deactivationDateLabel ? ` el ${deactivationDateLabel}` : ""}`
                          : billingStatus?.subscriptionStatus === "active"
                            ? `Activo${deactivationDateLabel ? ` · Renueva el ${deactivationDateLabel}` : ""}`
                            : "Sin suscripción activa"}
                      </p>
	                  </div>
	                    {canManageBilling ? (
	                      <Select
	                        key={planSelectKey}
	                        onValueChange={(value) => {
	                          // Re-mount to restore placeholder state
	                          setPlanSelectKey((k) => k + 1);
	                          if (value === "change") {
	                            setUpgradeOpen(true);
	                            return;
	                          }
	                          if (value === "cancel" || value === "reactivate") {
	                            void openStripePortal();
	                          }
	                        }}
	                      >
	                        <SelectTrigger className="w-auto gap-2" data-testid="select-manage-plan">
	                          <SelectValue placeholder="Administrar plan" />
	                        </SelectTrigger>
	                        <SelectContent>
	                          <SelectItem value="change">Cambiar plan</SelectItem>
	                          <SelectItem value="cancel">Cancelar plan</SelectItem>
	                          <SelectItem value="reactivate">Reactivar plan</SelectItem>
	                        </SelectContent>
	                      </Select>
	                    ) : (
	                      <Button
	                        variant="outline"
	                        onClick={() => {
	                          setBillingHelpAction("manage_plan");
	                          setBillingHelpOpen(true);
	                        }}
	                        data-testid="button-contact-admin-manage-plan"
	                      >
	                        Contactar administrador
	                      </Button>
	                    )}
	                  </div>
                  
	                  <div className="pt-2">
	                    <div className="flex items-baseline">
	                      {priceUsd === null ? (
	                        <>
	                          <span className="text-4xl font-bold">—</span>
	                          <span className="text-muted-foreground ml-2">Precio personalizado</span>
	                        </>
	                      ) : (
	                        <>
	                          <span className="text-4xl font-bold">${priceUsd}</span>
	                          <span className="text-muted-foreground ml-1">/participante</span>
	                        </>
	                      )}
	                    </div>
	                  </div>
	                  
	                  <p className="text-sm text-muted-foreground">
	                    {typeof memberCount === "number"
	                      ? `${memberCount} participante${memberCount === 1 ? "" : "s"} en uso`
	                      : "Participantes en uso: —"}
	                  </p>
	                </div>

                <div className="border rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Uso de créditos</h3>
                      <p className="text-sm text-muted-foreground">
                        {creditsLoading
                          ? "Cargando..."
                          : creditsOffset === 0
                            ? (daysToCycleEnd !== null ? `Próximo ciclo en ${daysToCycleEnd} día${daysToCycleEnd === 1 ? "" : "s"}` : "Próximo ciclo pronto")
                            : "Ciclo anterior"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-credits-menu">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
	                        </DropdownMenuTrigger>
	                        <DropdownMenuContent align="end">
	                          {canManageBilling ? (
	                            <>
	                              <DropdownMenuItem onSelect={() => setAlertsOpen(true)}>Configurar alertas</DropdownMenuItem>
	                              <DropdownMenuItem onSelect={() => setUpgradeOpen(true)}>Cambiar plan</DropdownMenuItem>
	                              <DropdownMenuItem onSelect={() => void openStripePortal()}>Administrar facturación</DropdownMenuItem>
	                            </>
	                          ) : (
	                            <DropdownMenuItem
	                              onSelect={() => {
	                                setBillingHelpAction("billing_menu");
	                                setBillingHelpOpen(true);
	                              }}
	                            >
	                              Contactar administrador
	                            </DropdownMenuItem>
	                          )}
	                          {isAdmin && <DropdownMenuItem onSelect={() => setLocation("/admin")}>Abrir panel admin</DropdownMenuItem>}
	                        </DropdownMenuContent>
	                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        data-testid="button-credits-prev"
                        disabled={creditsLoading || creditsOffset <= -24}
                        onClick={() => setCreditsOffset((o) => Math.max(-24, o - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        data-testid="button-credits-next"
                        disabled={creditsLoading || creditsOffset >= 0}
                        onClick={() => setCreditsOffset((o) => Math.min(0, o + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <p className="text-sm">
                    <span className="font-semibold">{creditsUsed.toLocaleString()}</span>
                    {creditsLimit ? (
                      <span className="text-muted-foreground">
                        {" "}
                        / {creditsLimit.toLocaleString()} créditos usados{creditsPercent !== null ? ` (${creditsPercent}%)` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground"> créditos usados</span>
                    )}
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
	                    <Button
	                      variant="outline"
	                      data-testid="button-add-credits"
	                      onClick={() => {
	                        if (canManageBilling) {
	                          setUpgradeOpen(true);
	                          return;
	                        }
	                        setBillingHelpAction("add_credits");
	                        setBillingHelpOpen(true);
	                      }}
	                    >
	                      {canManageBilling ? "Agregar créditos" : "Contactar administrador"}
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
	                    <Button
	                      variant="outline"
	                      data-testid="button-manage-alerts"
	                      onClick={() => {
	                        if (canManageBilling) {
	                          setAlertsOpen(true);
	                          return;
	                        }
	                        setBillingHelpAction("credit_alerts");
	                        setBillingHelpOpen(true);
	                      }}
	                    >
	                      {canManageBilling ? "Administrar" : "Contactar administrador"}
	                    </Button>
	                  </div>
	                </div>
              </TabsContent>

              <TabsContent value="invoices" className="mt-6 space-y-4">
                {!canManageBilling ? (
                  <div className="border rounded-lg p-6">
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Solo el administrador puede ver y descargar facturas.
                    </p>
                    <div className="flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openStripePortal()}
                        data-testid="button-open-billing-portal"
                      >
                        Contactar administrador
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-1">
                        <h3 className="font-semibold">Facturas</h3>
                        <p className="text-sm text-muted-foreground">Historial de facturación del espacio de trabajo.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadInvoices({ reset: true })}
                          disabled={invoicesLoading}
                          data-testid="button-refresh-invoices"
                        >
                          {invoicesLoading ? "Cargando..." : "Actualizar"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openStripePortal()}
                          data-testid="button-open-billing-portal"
                        >
                          Ver en portal
                        </Button>
                      </div>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      {invoicesLoading && invoices.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">Cargando facturas...</p>
                      ) : invoicesError ? (
                        <div className="p-6 space-y-3">
                          <p className="text-sm text-muted-foreground">{invoicesError}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void loadInvoices({ reset: true })}
                            disabled={invoicesLoading}
                            data-testid="button-retry-invoices"
                          >
                            Reintentar
                          </Button>
                        </div>
                      ) : invoices.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">No hay facturas disponibles.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr className="text-left text-muted-foreground">
                                <th className="px-4 py-3 font-medium">Fecha</th>
                                <th className="px-4 py-3 font-medium">Estado</th>
                                <th className="px-4 py-3 font-medium">Total</th>
                                <th className="px-4 py-3 font-medium">Periodo</th>
                                <th className="px-4 py-3 font-medium text-right">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoices.map((inv) => {
                                const status = invoiceStatusInfo(inv.status);
                                const period =
                                  inv.periodStart && inv.periodEnd
                                    ? `${formatCycleShort(inv.periodStart)} - ${formatCycleShort(inv.periodEnd)}`
                                    : "—";
                                const total = typeof inv.total === "number" ? inv.total : inv.amountDue;
                                return (
                                  <tr key={inv.id} className="border-t">
                                    <td className="px-4 py-3">
                                      <div className="space-y-0.5">
                                        <div className="font-medium">{formatInvoiceDate(inv.createdAt)}</div>
                                        <div className="text-xs text-muted-foreground">{inv.number ? `#${inv.number}` : inv.id}</div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge className={status.className}>{status.label}</Badge>
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">{formatMoney(total, inv.currency)}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{period}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center justify-end gap-2">
                                        {inv.hostedInvoiceUrl ? (
                                          <Button variant="outline" size="sm" asChild data-testid={`button-invoice-view-${inv.id}`}>
                                            <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                                              Ver
                                            </a>
                                          </Button>
                                        ) : (
                                          <Button variant="outline" size="sm" disabled>
                                            Ver
                                          </Button>
                                        )}
                                        {inv.invoicePdf ? (
                                          <Button variant="outline" size="sm" asChild data-testid={`button-invoice-pdf-${inv.id}`}>
                                            <a href={inv.invoicePdf} target="_blank" rel="noreferrer">
                                              PDF
                                            </a>
                                          </Button>
                                        ) : (
                                          <Button variant="outline" size="sm" disabled>
                                            PDF
                                          </Button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {invoicesHasMore && (
                      <div className="flex justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadInvoices()}
                          disabled={invoicesLoading || !invoicesCursor}
                          data-testid="button-load-more-invoices"
                        >
                          {invoicesLoading ? "Cargando..." : "Cargar más"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
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
      <UpgradePlanDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <CreditAlertsDialog open={alertsOpen} onOpenChange={setAlertsOpen} />
      <BillingHelpDialog open={billingHelpOpen} onOpenChange={setBillingHelpOpen} action={billingHelpAction} />
      {showDeactivationBanner && (
        <div className="flex justify-end px-6 py-3">
          <div className="inline-flex items-center gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Este espacio de trabajo se desactivará.</span>
              <span className="text-muted-foreground ml-1">
                Tendrás acceso al espacio de trabajo hasta que finalice el ciclo de facturación{deactivationDateLabel ? ` el ${deactivationDateLabel}.` : "."}
              </span>
            </div>
	              <Button
	                variant="outline"
	                size="sm"
	                className="ml-2 flex-shrink-0"
	                data-testid="button-reactivate"
	                onClick={() => void openStripePortal()}
	              >
	                {canManageBilling ? "Reactivar" : "Contactar administrador"}
	              </Button>
          </div>
        </div>
      )}

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
