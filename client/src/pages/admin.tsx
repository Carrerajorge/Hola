import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  LayoutDashboard,
  Users,
  Bot,
  CreditCard,
  FileText,
  BarChart3,
  Database,
  Shield,
  FileBarChart,
  Settings,
  Search,
  Plus,
  MoreHorizontal,
  CheckCircle,
  TrendingUp,
  Activity,
  HardDrive,
  Clock,
  Key,
  AlertTriangle,
  Download,
  RefreshCw,
  Trash2,
  Edit,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type AdminSection = "dashboard" | "users" | "ai-models" | "payments" | "invoices" | "analytics" | "database" | "security" | "reports" | "settings";

const navItems: { id: AdminSection; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "ai-models", label: "AI Models", icon: Bot },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "database", label: "Database", icon: Database },
  { id: "security", label: "Security", icon: Shield },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "settings", label: "Settings", icon: Settings },
];

function DashboardSection() {
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ["/api/admin/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard");
      return res.json();
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const metrics = dashboardData?.metrics || { users: 0, queries: 0, revenue: "0", uptime: 99.9 };
  const recentActivity = dashboardData?.recentActivity || [];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Usuarios</span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold" data-testid="text-total-users">{metrics.users.toLocaleString()}</p>
          <div className="flex items-center text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            Activos
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Consultas</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold" data-testid="text-total-queries">{metrics.queries.toLocaleString()}</p>
          <div className="flex items-center text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            Total
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ingresos</span>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-semibold" data-testid="text-total-revenue">€{parseFloat(metrics.revenue).toLocaleString()}</p>
          <div className="flex items-center text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            Total
          </div>
        </div>
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Uptime</span>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </div>
          <p className="text-2xl font-semibold" data-testid="text-uptime">{metrics.uptime}%</p>
          <span className="text-xs text-muted-foreground">Últimos 30 días</span>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium mb-4">Actividad reciente</h3>
        <div className="space-y-3">
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay actividad reciente</p>
          ) : (
            recentActivity.slice(0, 5).map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span>{item.action} - {item.resource}</span>
                <span className="text-xs text-muted-foreground">
                  {item.createdAt ? format(new Date(item.createdAt), "dd/MM HH:mm") : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function UsersSection() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users");
      return res.json();
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditingUser(null);
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    }
  });

  const filteredUsers = users.filter((u: any) => 
    u.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Users ({users.length})</h2>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar usuarios..." 
            className="pl-9 h-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-users"
          />
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-6 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Usuario</span>
          <span>Plan</span>
          <span>Rol</span>
          <span>Estado</span>
          <span>Consultas</span>
          <span>Acciones</span>
        </div>
        {filteredUsers.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No hay usuarios</div>
        ) : (
          filteredUsers.map((user: any) => (
            <div key={user.id} className="grid grid-cols-6 gap-4 p-3 border-b last:border-0 items-center text-sm">
              <div>
                <p className="font-medium">{user.username}</p>
                <p className="text-xs text-muted-foreground">{user.email || "-"}</p>
              </div>
              <Badge variant="secondary" className="w-fit">{user.plan || "free"}</Badge>
              <Badge variant="outline" className="w-fit">{user.role || "user"}</Badge>
              <Badge variant={user.status === "active" ? "default" : "outline"} className="w-fit">
                {user.status === "active" ? "Activo" : "Inactivo"}
              </Badge>
              <span>{(user.queryCount || 0).toLocaleString()}</span>
              <div className="flex gap-1">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingUser(user)}>
                      <Edit className="h-3 w-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Editar usuario</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Plan</Label>
                        <Select 
                          defaultValue={user.plan || "free"}
                          onValueChange={(value) => updateUserMutation.mutate({ id: user.id, updates: { plan: value } })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">Free</SelectItem>
                            <SelectItem value="basic">Basic</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Estado</Label>
                        <Select 
                          defaultValue={user.status || "active"}
                          onValueChange={(value) => updateUserMutation.mutate({ id: user.id, updates: { status: value } })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Activo</SelectItem>
                            <SelectItem value="inactive">Inactivo</SelectItem>
                            <SelectItem value="suspended">Suspendido</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Rol</Label>
                        <Select 
                          defaultValue={user.role || "user"}
                          onValueChange={(value) => updateUserMutation.mutate({ id: user.id, updates: { role: value } })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">Usuario</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 w-7 p-0 text-destructive" 
                  onClick={() => deleteUserMutation.mutate(user.id)}
                  data-testid={`button-delete-user-${user.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AIModelsSection() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newModel, setNewModel] = useState({ name: "", provider: "", modelId: "", costPer1k: "0.00", description: "" });

  const { data: models = [], isLoading } = useQuery({
    queryKey: ["/api/admin/models"],
    queryFn: async () => {
      const res = await fetch("/api/admin/models");
      return res.json();
    }
  });

  const createModelMutation = useMutation({
    mutationFn: async (model: any) => {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      setShowAddModal(false);
      setNewModel({ name: "", provider: "", modelId: "", costPer1k: "0.00", description: "" });
    }
  });

  const updateModelMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await fetch(`/api/admin/models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
    }
  });

  const deleteModelMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">AI Models ({models.length})</h2>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-model">
              <Plus className="h-4 w-4 mr-2" />
              Añadir modelo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Añadir modelo AI</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input 
                  placeholder="GPT-4 Turbo" 
                  value={newModel.name}
                  onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Proveedor</Label>
                <Input 
                  placeholder="OpenAI" 
                  value={newModel.provider}
                  onChange={(e) => setNewModel({ ...newModel, provider: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Model ID</Label>
                <Input 
                  placeholder="gpt-4-turbo" 
                  value={newModel.modelId}
                  onChange={(e) => setNewModel({ ...newModel, modelId: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Costo por 1K tokens</Label>
                <Input 
                  placeholder="0.03" 
                  value={newModel.costPer1k}
                  onChange={(e) => setNewModel({ ...newModel, costPer1k: e.target.value })}
                />
              </div>
              <Button 
                className="w-full" 
                onClick={() => createModelMutation.mutate(newModel)}
                disabled={!newModel.name || !newModel.provider || !newModel.modelId}
              >
                Crear modelo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-4">
        {models.length === 0 ? (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            No hay modelos configurados. Añade uno para empezar.
          </div>
        ) : (
          models.map((model: any) => (
            <div key={model.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Bot className="h-5 w-5" />
                  <div>
                    <p className="font-medium">{model.name}</p>
                    <p className="text-xs text-muted-foreground">{model.provider} - {model.modelId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">€{model.costPer1k}/1K</span>
                  <Switch 
                    checked={model.status === "active"} 
                    onCheckedChange={(checked) => updateModelMutation.mutate({ 
                      id: model.id, 
                      updates: { status: checked ? "active" : "inactive" } 
                    })}
                    data-testid={`switch-model-${model.id}`}
                  />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => deleteModelMutation.mutate(model.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Uso este mes</span>
                  <span>{model.usagePercent || 0}%</span>
                </div>
                <Progress value={model.usagePercent || 0} className="h-1.5" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PaymentsSection() {
  const queryClient = useQueryClient();

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["/api/admin/payments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payments");
      return res.json();
    }
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/admin/payments/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payments/stats");
      return res.json();
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Payments</h2>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-1">Total ingresos</p>
          <p className="text-xl font-semibold" data-testid="text-total-payments">€{stats?.total || "0"}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-1">Este mes</p>
          <p className="text-xl font-semibold">€{stats?.thisMonth || "0"}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-1">Transacciones</p>
          <p className="text-xl font-semibold">{stats?.count || 0}</p>
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-5 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>ID</span>
          <span>Usuario</span>
          <span>Cantidad</span>
          <span>Fecha</span>
          <span>Estado</span>
        </div>
        {payments.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No hay pagos registrados</div>
        ) : (
          payments.map((payment: any) => (
            <div key={payment.id} className="grid grid-cols-5 gap-4 p-3 border-b last:border-0 items-center text-sm">
              <span className="font-mono text-xs">{payment.id.slice(0, 8)}</span>
              <span>{payment.userId || "N/A"}</span>
              <span className="font-medium">€{payment.amount}</span>
              <span className="text-muted-foreground">
                {payment.createdAt ? format(new Date(payment.createdAt), "dd MMM yyyy") : "-"}
              </span>
              <Badge variant={payment.status === "completed" ? "default" : payment.status === "pending" ? "secondary" : "destructive"}>
                {payment.status === "completed" ? "Completado" : payment.status === "pending" ? "Pendiente" : "Fallido"}
              </Badge>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InvoicesSection() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ invoiceNumber: "", amount: "", userId: "" });

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["/api/admin/invoices"],
    queryFn: async () => {
      const res = await fetch("/api/admin/invoices");
      return res.json();
    }
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoice: any) => {
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      setShowAddModal(false);
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Invoices ({invoices.length})</h2>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-invoice">
              <Plus className="h-4 w-4 mr-2" />
              Crear factura
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear factura</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Número de factura</Label>
                <Input 
                  placeholder="INV-2024-001" 
                  value={newInvoice.invoiceNumber}
                  onChange={(e) => setNewInvoice({ ...newInvoice, invoiceNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Importe</Label>
                <Input 
                  placeholder="99.00" 
                  value={newInvoice.amount}
                  onChange={(e) => setNewInvoice({ ...newInvoice, amount: e.target.value })}
                />
              </div>
              <Button 
                className="w-full" 
                onClick={() => createInvoiceMutation.mutate(newInvoice)}
                disabled={!newInvoice.invoiceNumber || !newInvoice.amount}
              >
                Crear factura
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-lg border">
        <div className="grid grid-cols-5 gap-4 p-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Factura</span>
          <span>Cliente</span>
          <span>Importe</span>
          <span>Fecha</span>
          <span>Estado</span>
        </div>
        {invoices.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No hay facturas</div>
        ) : (
          invoices.map((invoice: any) => (
            <div key={invoice.id} className="grid grid-cols-5 gap-4 p-3 border-b last:border-0 items-center text-sm">
              <span className="font-mono text-xs">{invoice.invoiceNumber}</span>
              <span>{invoice.userId || "N/A"}</span>
              <span className="font-medium">€{invoice.amount}</span>
              <span className="text-muted-foreground">
                {invoice.createdAt ? format(new Date(invoice.createdAt), "dd MMM yyyy") : "-"}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                  {invoice.status === "paid" ? "Pagada" : "Pendiente"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 px-2" data-testid={`button-download-invoice-${invoice.id}`}>
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AnalyticsSection() {
  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["/api/admin/analytics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics?days=30");
      return res.json();
    }
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Analytics</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="text-sm font-medium">Actividad reciente</h3>
          <div className="h-32 flex items-end justify-between gap-1">
            {(snapshots.length > 0 ? snapshots.slice(-7) : [1,2,3,4,5,6,7].map(() => ({ totalQueries: Math.random() * 100 }))).map((s: any, i: number) => (
              <div key={i} className="flex-1 bg-primary/20 rounded-t" style={{ height: `${Math.max(10, (s.totalQueries || 0) % 100)}%` }} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">Últimos 7 días</p>
        </div>
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="text-sm font-medium">Resumen</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Registros de analytics</span>
              <span className="font-medium">{snapshots.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Período</span>
              <span className="font-medium">30 días</span>
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium mb-4">Métricas clave</h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-2xl font-semibold">2.3s</p>
            <p className="text-xs text-muted-foreground">Tiempo respuesta</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">94%</p>
            <p className="text-xs text-muted-foreground">Satisfacción</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{snapshots.reduce((sum: number, s: any) => sum + (s.totalQueries || 0), 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Consultas totales</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">€{snapshots.reduce((sum: number, s: any) => sum + parseFloat(s.revenue || "0"), 0).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Ingresos período</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DatabaseSection() {
  const { data: dbInfo, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/database/info"],
    queryFn: async () => {
      const res = await fetch("/api/admin/database/info");
      return res.json();
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Database</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-db">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Estado</span>
          </div>
          <Badge variant={dbInfo?.status === "healthy" ? "default" : "destructive"} className="mb-2">
            {dbInfo?.status === "healthy" ? "Saludable" : "Error"}
          </Badge>
          <p className="text-xs text-muted-foreground">
            Último backup: {dbInfo?.lastBackup ? format(new Date(dbInfo.lastBackup), "dd/MM/yyyy HH:mm") : "N/A"}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Tablas</span>
          </div>
          <div className="space-y-2">
            {dbInfo?.tables && Object.entries(dbInfo.tables).map(([name, info]: [string, any]) => (
              <div key={name} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{name}</span>
                <span>{info.count} registros</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SecuritySection() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPolicy, setNewPolicy] = useState({ domain: "", allowNavigation: "true", rateLimit: 10 });

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["/api/admin/security/policies"],
    queryFn: async () => {
      const res = await fetch("/api/admin/security/policies");
      return res.json();
    }
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ["/api/admin/security/logs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/security/logs?limit=20");
      return res.json();
    }
  });

  const createPolicyMutation = useMutation({
    mutationFn: async (policy: any) => {
      const res = await fetch("/api/admin/security/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      setShowAddModal(false);
    }
  });

  const deletePolicyMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/security/policies/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Security</h2>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Políticas de dominio</h3>
          <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Añadir política
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva política de dominio</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Dominio</Label>
                  <Input 
                    placeholder="ejemplo.com" 
                    value={newPolicy.domain}
                    onChange={(e) => setNewPolicy({ ...newPolicy, domain: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Límite de peticiones/min</Label>
                  <Input 
                    type="number"
                    value={newPolicy.rateLimit}
                    onChange={(e) => setNewPolicy({ ...newPolicy, rateLimit: parseInt(e.target.value) })}
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={() => createPolicyMutation.mutate(newPolicy)}
                  disabled={!newPolicy.domain}
                >
                  Crear política
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        
        <div className="rounded-lg border">
          {policies.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No hay políticas configuradas</div>
          ) : (
            policies.map((policy: any) => (
              <div key={policy.id} className="flex items-center justify-between p-3 border-b last:border-0">
                <div>
                  <p className="font-medium">{policy.domain}</p>
                  <p className="text-xs text-muted-foreground">Límite: {policy.rateLimit} req/min</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={policy.allowNavigation === "true" ? "default" : "secondary"}>
                    {policy.allowNavigation === "true" ? "Permitido" : "Bloqueado"}
                  </Badge>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => deletePolicyMutation.mutate(policy.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Registro de auditoría</h3>
        <div className="rounded-lg border max-h-64 overflow-auto">
          {auditLogs.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No hay registros</div>
          ) : (
            auditLogs.map((log: any) => (
              <div key={log.id} className="flex items-center justify-between p-3 border-b last:border-0 text-sm">
                <div>
                  <span className="font-medium">{log.action}</span>
                  <span className="text-muted-foreground"> - {log.resource}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {log.createdAt ? format(new Date(log.createdAt), "dd/MM HH:mm") : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ReportsSection() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newReport, setNewReport] = useState({ name: "", type: "usage" });

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["/api/admin/reports"],
    queryFn: async () => {
      const res = await fetch("/api/admin/reports");
      return res.json();
    }
  });

  const createReportMutation = useMutation({
    mutationFn: async (report: any) => {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
      setShowAddModal(false);
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Reports ({reports.length})</h2>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-report">
              <Plus className="h-4 w-4 mr-2" />
              Generar reporte
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generar reporte</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input 
                  placeholder="Reporte mensual" 
                  value={newReport.name}
                  onChange={(e) => setNewReport({ ...newReport, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={newReport.type} onValueChange={(value) => setNewReport({ ...newReport, type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usage">Uso</SelectItem>
                    <SelectItem value="revenue">Ingresos</SelectItem>
                    <SelectItem value="users">Usuarios</SelectItem>
                    <SelectItem value="performance">Rendimiento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button 
                className="w-full" 
                onClick={() => createReportMutation.mutate(newReport)}
                disabled={!newReport.name}
              >
                Generar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-lg border">
        {reports.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">No hay reportes generados</div>
        ) : (
          reports.map((report: any) => (
            <div key={report.id} className="flex items-center justify-between p-3 border-b last:border-0">
              <div>
                <p className="font-medium">{report.name}</p>
                <p className="text-xs text-muted-foreground">
                  {report.type} - {report.createdAt ? format(new Date(report.createdAt), "dd/MM/yyyy") : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={report.status === "completed" ? "default" : "secondary"}>
                  {report.status === "completed" ? "Completado" : "Pendiente"}
                </Badge>
                {report.filePath && (
                  <Button variant="ghost" size="sm" className="h-7 px-2">
                    <Download className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SettingsSection() {
  const queryClient = useQueryClient();
  const [newSetting, setNewSetting] = useState({ key: "", value: "", description: "", category: "general" });

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/settings");
      return res.json();
    }
  });

  const upsertSettingMutation = useMutation({
    mutationFn: async (setting: any) => {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setting)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      setNewSetting({ key: "", value: "", description: "", category: "general" });
    }
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const groupedSettings = settings.reduce((acc: any, s: any) => {
    const cat = s.category || "general";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">Settings</h2>
      
      <div className="rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">Añadir configuración</h3>
        <div className="grid grid-cols-4 gap-4">
          <Input 
            placeholder="Clave" 
            value={newSetting.key}
            onChange={(e) => setNewSetting({ ...newSetting, key: e.target.value })}
          />
          <Input 
            placeholder="Valor" 
            value={newSetting.value}
            onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })}
          />
          <Select value={newSetting.category} onValueChange={(value) => setNewSetting({ ...newSetting, category: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="security">Seguridad</SelectItem>
              <SelectItem value="billing">Facturación</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            onClick={() => upsertSettingMutation.mutate(newSetting)}
            disabled={!newSetting.key}
          >
            Guardar
          </Button>
        </div>
      </div>

      {Object.entries(groupedSettings).map(([category, items]: [string, any]) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-medium capitalize">{category}</h3>
          <div className="rounded-lg border divide-y">
            {items.map((setting: any) => (
              <div key={setting.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="font-medium text-sm">{setting.key}</p>
                  <p className="text-xs text-muted-foreground">{setting.description || "Sin descripción"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input 
                    className="w-48 h-8 text-sm"
                    defaultValue={setting.value}
                    onBlur={(e) => {
                      if (e.target.value !== setting.value) {
                        upsertSettingMutation.mutate({ ...setting, value: e.target.value });
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {settings.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          No hay configuraciones guardadas
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");

  const renderSection = () => {
    switch (activeSection) {
      case "dashboard":
        return <DashboardSection />;
      case "users":
        return <UsersSection />;
      case "ai-models":
        return <AIModelsSection />;
      case "payments":
        return <PaymentsSection />;
      case "invoices":
        return <InvoicesSection />;
      case "analytics":
        return <AnalyticsSection />;
      case "database":
        return <DatabaseSection />;
      case "security":
        return <SecuritySection />;
      case "reports":
        return <ReportsSection />;
      case "settings":
        return <SettingsSection />;
      default:
        return <DashboardSection />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-56 border-r flex flex-col">
        <div className="p-4 border-b">
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start gap-2"
            onClick={() => setLocation("/")}
            data-testid="button-back-to-app"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a la app
          </Button>
        </div>
        <div className="p-2">
          <h2 className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Administration
          </h2>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant={activeSection === item.id ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setActiveSection(item.id)}
                data-testid={`nav-${item.id}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </nav>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {renderSection()}
        </div>
      </main>
    </div>
  );
}
