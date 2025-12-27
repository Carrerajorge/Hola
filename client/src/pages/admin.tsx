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
  Loader2,
  Filter,
  Eye,
  MessageSquare,
  Flag,
  Calendar,
  ChevronDown,
  ChevronUp,
  X
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type AdminSection = "dashboard" | "users" | "conversations" | "ai-models" | "payments" | "invoices" | "analytics" | "database" | "security" | "reports" | "settings";

const navItems: { id: AdminSection; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "conversations", label: "Conversations", icon: MessageSquare },
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
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard");
      return res.json();
    },
    refetchInterval: 30000
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const d = data || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Dashboard</h2>
        <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-dashboard">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-users">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-blue-500/10">
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-sm font-medium">Users</span>
          </div>
          <p className="text-2xl font-bold">{d.users?.total || 0}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.users?.active || 0} activos</span>
            <span className="text-green-600">+{d.users?.newThisMonth || 0} este mes</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-ai-models">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-purple-500/10">
              <Bot className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-sm font-medium">AI Models</span>
          </div>
          <p className="text-2xl font-bold">{d.aiModels?.active || 0}<span className="text-sm font-normal text-muted-foreground">/{d.aiModels?.total || 0}</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("inline-flex items-center gap-1 text-xs", d.systemHealth?.xai ? "text-green-600" : "text-red-500")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", d.systemHealth?.xai ? "bg-green-500" : "bg-red-500")} />
              xAI
            </span>
            <span className={cn("inline-flex items-center gap-1 text-xs", d.systemHealth?.gemini ? "text-green-600" : "text-red-500")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", d.systemHealth?.gemini ? "bg-green-500" : "bg-red-500")} />
              Gemini
            </span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-payments">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <CreditCard className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-sm font-medium">Payments</span>
          </div>
          <p className="text-2xl font-bold">€{parseFloat(d.payments?.total || "0").toLocaleString()}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>€{parseFloat(d.payments?.thisMonth || "0").toLocaleString()} este mes</span>
            <span>{d.payments?.count || 0} transacciones</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-invoices">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-orange-500/10">
              <FileText className="h-4 w-4 text-orange-500" />
            </div>
            <span className="text-sm font-medium">Invoices</span>
          </div>
          <p className="text-2xl font-bold">{d.invoices?.total || 0}</p>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="text-yellow-600">{d.invoices?.pending || 0} pendientes</span>
            <span className="text-green-600">{d.invoices?.paid || 0} pagadas</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-analytics">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-cyan-500/10">
              <BarChart3 className="h-4 w-4 text-cyan-500" />
            </div>
            <span className="text-sm font-medium">Analytics</span>
          </div>
          <p className="text-2xl font-bold">{(d.analytics?.totalQueries || 0).toLocaleString()}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>~{d.analytics?.avgQueriesPerUser || 0} consultas/usuario</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-database">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-slate-500/10">
              <Database className="h-4 w-4 text-slate-500" />
            </div>
            <span className="text-sm font-medium">Database</span>
          </div>
          <p className="text-2xl font-bold">{d.database?.tables || 0} <span className="text-sm font-normal text-muted-foreground">tablas</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("inline-flex items-center gap-1 text-xs", d.database?.status === "healthy" ? "text-green-600" : "text-red-500")}>
              <CheckCircle className="h-3 w-3" />
              {d.database?.status === "healthy" ? "Operativo" : "Error"}
            </span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-security">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("p-2 rounded-md", d.security?.status === "healthy" ? "bg-green-500/10" : "bg-yellow-500/10")}>
              <Shield className={cn("h-4 w-4", d.security?.status === "healthy" ? "text-green-500" : "text-yellow-500")} />
            </div>
            <span className="text-sm font-medium">Security</span>
          </div>
          <p className="text-2xl font-bold">{d.security?.alerts || 0} <span className="text-sm font-normal text-muted-foreground">alertas</span></p>
          <div className="flex items-center gap-2 mt-2">
            <span className={cn("inline-flex items-center gap-1 text-xs", d.security?.status === "healthy" ? "text-green-600" : "text-yellow-600")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", d.security?.status === "healthy" ? "bg-green-500" : "bg-yellow-500")} />
              {d.security?.status === "healthy" ? "Sin incidentes" : "Revisar"}
            </span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-reports">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-indigo-500/10">
              <FileBarChart className="h-4 w-4 text-indigo-500" />
            </div>
            <span className="text-sm font-medium">Reports</span>
          </div>
          <p className="text-2xl font-bold">{d.reports?.total || 0}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.reports?.scheduled || 0} programados</span>
          </div>
        </div>

        <div className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer" data-testid="card-settings">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-md bg-gray-500/10">
              <Settings className="h-4 w-4 text-gray-500" />
            </div>
            <span className="text-sm font-medium">Settings</span>
          </div>
          <p className="text-2xl font-bold">{d.settings?.total || 0} <span className="text-sm font-normal text-muted-foreground">config</span></p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.settings?.categories || 0} categorías</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">System Health</h3>
            <span className="text-xs text-muted-foreground">{d.systemHealth?.uptime || 99.9}% uptime</span>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">xAI Grok</span>
              <Badge variant={d.systemHealth?.xai ? "default" : "destructive"} className="text-xs">
                {d.systemHealth?.xai ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Google Gemini</span>
              <Badge variant={d.systemHealth?.gemini ? "default" : "destructive"} className="text-xs">
                {d.systemHealth?.gemini ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Database</span>
              <Badge variant={d.database?.status === "healthy" ? "default" : "destructive"} className="text-xs">
                {d.database?.status === "healthy" ? "Healthy" : "Error"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-4">Actividad reciente</h3>
          <div className="space-y-2">
            {(d.recentActivity || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay actividad reciente</p>
            ) : (
              (d.recentActivity || []).slice(0, 5).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <Activity className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate max-w-[200px]">{item.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {item.createdAt ? format(new Date(item.createdAt), "dd/MM HH:mm") : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersSection() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [viewingUser, setViewingUser] = useState<any>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ plan: "", status: "", role: "" });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "createdAt", direction: "desc" });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [newUser, setNewUser] = useState({ email: "", password: "", plan: "free", role: "user" });

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

  const createUserMutation = useMutation({
    mutationFn: async (userData: { email: string; password: string; plan: string; role: string }) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData)
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al crear usuario");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowAddUserModal(false);
      setNewUser({ email: "", password: "", plan: "free", role: "user" });
    }
  });

  const handleExport = (format: "csv" | "json") => {
    window.open(`/api/admin/users/export?format=${format}`, "_blank");
  };

  const filteredAndSortedUsers = users
    .filter((u: any) => {
      const matchesSearch = u.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.fullName?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlan = !filters.plan || u.plan === filters.plan;
      const matchesStatus = !filters.status || u.status === filters.status;
      const matchesRole = !filters.role || u.role === filters.role;
      return matchesSearch && matchesPlan && matchesStatus && matchesRole;
    })
    .sort((a: any, b: any) => {
      const aVal = a[sortConfig.key] || "";
      const bVal = b[sortConfig.key] || "";
      if (sortConfig.direction === "asc") return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

  const totalPages = Math.ceil(filteredAndSortedUsers.length / itemsPerPage);
  const paginatedUsers = filteredAndSortedUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Users ({filteredAndSortedUsers.length})</h2>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" data-testid="button-export-users">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport("csv")}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")}>Export JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1" data-testid="button-add-user">
                <Plus className="h-4 w-4" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" placeholder="user@example.com" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} data-testid="input-new-user-email" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" placeholder="••••••••" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} data-testid="input-new-user-password" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Select value={newUser.plan} onValueChange={(value) => setNewUser({ ...newUser, plan: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={newUser.role} onValueChange={(value) => setNewUser({ ...newUser, role: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="api_only">API Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full" onClick={() => createUserMutation.mutate(newUser)} disabled={!newUser.email || !newUser.password || createUserMutation.isPending} data-testid="button-submit-new-user">
                  {createUserMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : "Create User"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search users..." className="pl-9 h-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="input-search-users" />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
      </div>

      {showFilters && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
          <Select value={filters.plan} onValueChange={(v) => setFilters({ ...filters, plan: v })}>
            <SelectTrigger className="w-[130px] h-8"><SelectValue placeholder="Plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
            <SelectTrigger className="w-[140px] h-8"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="pending_verification">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.role} onValueChange={(v) => setFilters({ ...filters, role: v })}>
            <SelectTrigger className="w-[130px] h-8"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Roles</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="api_only">API Only</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setFilters({ plan: "", status: "", role: "" })}>Clear</Button>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("email")}>
                  <div className="flex items-center gap-1">User {sortConfig.key === "email" && (sortConfig.direction === "asc" ? "↑" : "↓")}</div>
                </th>
                <th className="text-left p-3 font-medium">Plan</th>
                <th className="text-left p-3 font-medium">Role</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("queryCount")}>
                  <div className="flex items-center gap-1">Queries {sortConfig.key === "queryCount" && (sortConfig.direction === "asc" ? "↑" : "↓")}</div>
                </th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("tokensConsumed")}>
                  <div className="flex items-center gap-1">Tokens {sortConfig.key === "tokensConsumed" && (sortConfig.direction === "asc" ? "↑" : "↓")}</div>
                </th>
                <th className="text-left p-3 font-medium">Auth</th>
                <th className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70" onClick={() => handleSort("createdAt")}>
                  <div className="flex items-center gap-1">Created {sortConfig.key === "createdAt" && (sortConfig.direction === "asc" ? "↑" : "↓")}</div>
                </th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.length === 0 ? (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No users found</td></tr>
              ) : paginatedUsers.map((user: any) => (
                <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                        {(user.fullName || user.email || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium truncate max-w-[150px]">{user.fullName || user.username || user.email?.split("@")[0] || "-"}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[150px]">{user.email || "-"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3"><Badge variant="secondary" className="text-xs">{user.plan || "free"}</Badge></td>
                  <td className="p-3"><Badge variant="outline" className="text-xs">{user.role || "user"}</Badge></td>
                  <td className="p-3">
                    <Badge variant={user.status === "active" ? "default" : user.status === "suspended" ? "destructive" : "outline"} className="text-xs">
                      {user.status || "active"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">{(user.queryCount || 0).toLocaleString()}</td>
                  <td className="p-3 text-muted-foreground">{(user.tokensConsumed || 0).toLocaleString()}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{user.authProvider || "email"}</span>
                      {user.emailVerified === "true" && <CheckCircle className="h-3 w-3 text-green-500" />}
                      {user.is2faEnabled === "true" && <Shield className="h-3 w-3 text-blue-500" />}
                    </div>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{user.createdAt ? format(new Date(user.createdAt), "dd/MM/yy") : "-"}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewingUser(user)} data-testid={`button-view-user-${user.id}`}>
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingUser(user)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteUserMutation.mutate(user.id)} data-testid={`button-delete-user-${user.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!viewingUser} onOpenChange={() => setViewingUser(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          {viewingUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{viewingUser.id}</span></div>
                <div><span className="text-muted-foreground">Email:</span> {viewingUser.email || "-"}</div>
                <div><span className="text-muted-foreground">Full Name:</span> {viewingUser.fullName || `${viewingUser.firstName || ""} ${viewingUser.lastName || ""}`.trim() || "-"}</div>
                <div><span className="text-muted-foreground">Plan:</span> <Badge variant="secondary">{viewingUser.plan || "free"}</Badge></div>
                <div><span className="text-muted-foreground">Role:</span> <Badge variant="outline">{viewingUser.role || "user"}</Badge></div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant={viewingUser.status === "active" ? "default" : "outline"}>{viewingUser.status || "active"}</Badge></div>
                <div><span className="text-muted-foreground">Queries:</span> {(viewingUser.queryCount || 0).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Tokens Used:</span> {(viewingUser.tokensConsumed || 0).toLocaleString()} / {(viewingUser.tokensLimit || 100000).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Credits:</span> {(viewingUser.creditsBalance || 0).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Auth Provider:</span> {viewingUser.authProvider || "email"}</div>
                <div><span className="text-muted-foreground">Email Verified:</span> {viewingUser.emailVerified === "true" ? "Yes" : "No"}</div>
                <div><span className="text-muted-foreground">2FA Enabled:</span> {viewingUser.is2faEnabled === "true" ? "Yes" : "No"}</div>
                <div><span className="text-muted-foreground">Last IP:</span> {viewingUser.lastIp || "-"}</div>
                <div><span className="text-muted-foreground">Country:</span> {viewingUser.countryCode || "-"}</div>
                <div><span className="text-muted-foreground">Last Login:</span> {viewingUser.lastLoginAt ? format(new Date(viewingUser.lastLoginAt), "dd/MM/yyyy HH:mm") : "-"}</div>
                <div><span className="text-muted-foreground">Created:</span> {viewingUser.createdAt ? format(new Date(viewingUser.createdAt), "dd/MM/yyyy HH:mm") : "-"}</div>
                <div><span className="text-muted-foreground">Referral Code:</span> {viewingUser.referralCode || "-"}</div>
                <div><span className="text-muted-foreground">Referred By:</span> {viewingUser.referredBy || "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Tags:</span> {viewingUser.tags?.length ? viewingUser.tags.map((t: string) => <Badge key={t} variant="secondary" className="mr-1">{t}</Badge>) : "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">Internal Notes:</span> <p className="mt-1 text-xs">{viewingUser.internalNotes || "-"}</p></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select defaultValue={editingUser.plan || "free"} onValueChange={(value) => updateUserMutation.mutate({ id: editingUser.id, updates: { plan: value } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select defaultValue={editingUser.role || "user"} onValueChange={(value) => updateUserMutation.mutate({ id: editingUser.id, updates: { role: value } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="api_only">API Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select defaultValue={editingUser.status || "active"} onValueChange={(value) => updateUserMutation.mutate({ id: editingUser.id, updates: { status: value } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="pending_verification">Pending Verification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tokens Limit</Label>
                <Input type="number" defaultValue={editingUser.tokensLimit || 100000} onBlur={(e) => updateUserMutation.mutate({ id: editingUser.id, updates: { tokensLimit: parseInt(e.target.value) } })} />
              </div>
              <div className="space-y-2">
                <Label>Internal Notes</Label>
                <Textarea defaultValue={editingUser.internalNotes || ""} onBlur={(e) => updateUserMutation.mutate({ id: editingUser.id, updates: { internalNotes: e.target.value } })} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConversationsSection() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: "", flagStatus: "", userId: "", aiModel: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [viewingConversation, setViewingConversation] = useState<any>(null);

  const updateFilters = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  const { data: statsData } = useQuery({
    queryKey: ["/api/admin/conversations/stats/summary"],
    queryFn: async () => {
      const res = await fetch("/api/admin/conversations/stats/summary");
      return res.json();
    }
  });

  const { data: conversationsData, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/conversations", page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (filters.status) params.set("status", filters.status);
      if (filters.flagStatus) params.set("flagStatus", filters.flagStatus);
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.aiModel) params.set("aiModel", filters.aiModel);
      const res = await fetch(`/api/admin/conversations?${params}`);
      return res.json();
    }
  });

  const { data: conversationDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ["/api/admin/conversations", viewingConversation?.id],
    queryFn: async () => {
      if (!viewingConversation?.id) return null;
      const res = await fetch(`/api/admin/conversations/${viewingConversation.id}`);
      return res.json();
    },
    enabled: !!viewingConversation?.id
  });

  const flagMutation = useMutation({
    mutationFn: async ({ id, flagStatus }: { id: string; flagStatus: string | null }) => {
      const res = await fetch(`/api/admin/conversations/${id}/flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagStatus })
      });
      return res.json();
    },
    onSuccess: () => refetch()
  });

  const handleExport = (format: "csv" | "json") => {
    window.open(`/api/admin/conversations/export?format=${format}`, "_blank");
  };

  const stats = statsData || { activeToday: 0, avgMessagesPerUser: 0, tokensConsumedToday: 0, flaggedConversations: 0 };
  const conversations = conversationsData?.data || [];
  const pagination = conversationsData?.pagination || { page: 1, totalPages: 1, total: 0 };

  const flagColors: Record<string, string> = {
    reviewed: "bg-green-500/10 text-green-600",
    needs_attention: "bg-yellow-500/10 text-yellow-600",
    spam: "bg-red-500/10 text-red-600",
    vip_support: "bg-purple-500/10 text-purple-600"
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Conversations ({pagination.total})</h2>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" data-testid="button-export-conversations">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport("csv")}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")}>Export JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Activity className="h-3 w-3" />
            Active Today
          </div>
          <p className="text-xl font-bold">{stats.activeToday}</p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <MessageSquare className="h-3 w-3" />
            Avg Msgs/User
          </div>
          <p className="text-xl font-bold">{stats.avgMessagesPerUser}</p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <BarChart3 className="h-3 w-3" />
            Tokens Today
          </div>
          <p className="text-xl font-bold">{stats.tokensConsumedToday.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Flag className="h-3 w-3" />
            Flagged
          </div>
          <p className="text-xl font-bold text-yellow-600">{stats.flaggedConversations}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-1" data-testid="button-toggle-filters">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
      </div>

      {showFilters && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30 flex-wrap">
          <Select value={filters.status} onValueChange={(v) => updateFilters({ status: v })}>
            <SelectTrigger className="w-[130px] h-8" data-testid="select-conv-status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.flagStatus} onValueChange={(v) => updateFilters({ flagStatus: v })}>
            <SelectTrigger className="w-[150px] h-8" data-testid="select-conv-flag"><SelectValue placeholder="Flag Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Flags</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="needs_attention">Needs Attention</SelectItem>
              <SelectItem value="spam">Spam</SelectItem>
              <SelectItem value="vip_support">VIP Support</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="User ID" className="w-[180px] h-8" value={filters.userId} onChange={(e) => updateFilters({ userId: e.target.value })} data-testid="input-conv-userid" />
          <Button variant="ghost" size="sm" onClick={() => { setFilters({ status: "", flagStatus: "", userId: "", aiModel: "" }); setPage(1); }} data-testid="button-clear-filters">Clear</Button>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Conversation</th>
                <th className="text-left p-3 font-medium">User</th>
                <th className="text-left p-3 font-medium">Messages</th>
                <th className="text-left p-3 font-medium">Tokens</th>
                <th className="text-left p-3 font-medium">Model</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Flag</th>
                <th className="text-left p-3 font-medium">Started</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {conversations.length === 0 ? (
                <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No conversations found</td></tr>
              ) : conversations.map((conv: any) => (
                <tr key={conv.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <p className="font-medium truncate max-w-[200px]">{conv.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground font-mono">{conv.id.slice(0, 8)}...</p>
                  </td>
                  <td className="p-3">
                    {conv.user ? (
                      <div>
                        <p className="text-xs truncate max-w-[120px]">{conv.user.email || conv.user.fullName || "-"}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Anonymous</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{conv.messageCount || 0}</td>
                  <td className="p-3 text-muted-foreground">{(conv.tokensUsed || 0).toLocaleString()}</td>
                  <td className="p-3"><span className="text-xs">{conv.aiModelUsed || "-"}</span></td>
                  <td className="p-3">
                    <Badge variant={conv.conversationStatus === "active" ? "default" : conv.conversationStatus === "flagged" ? "destructive" : "secondary"} className="text-xs">
                      {conv.conversationStatus || "active"}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className={cn("h-6 px-2 text-xs", conv.flagStatus && flagColors[conv.flagStatus])}>
                          {conv.flagStatus || "Set Flag"}
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => flagMutation.mutate({ id: conv.id, flagStatus: null })}>Clear Flag</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => flagMutation.mutate({ id: conv.id, flagStatus: "reviewed" })}>Reviewed</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => flagMutation.mutate({ id: conv.id, flagStatus: "needs_attention" })}>Needs Attention</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => flagMutation.mutate({ id: conv.id, flagStatus: "spam" })}>Spam</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => flagMutation.mutate({ id: conv.id, flagStatus: "vip_support" })}>VIP Support</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{conv.createdAt ? format(new Date(conv.createdAt), "dd/MM/yy HH:mm") : "-"}</td>
                  <td className="p-3">
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewingConversation(conv)} data-testid={`button-view-conversation-${conv.id}`}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={pagination.page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={pagination.page === pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!viewingConversation} onOpenChange={() => setViewingConversation(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Conversation Details
            </DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : conversationDetail && (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{conversationDetail.id}</span></div>
                <div><span className="text-muted-foreground">User:</span> {conversationDetail.user?.email || "Anonymous"}</div>
                <div><span className="text-muted-foreground">Messages:</span> {conversationDetail.messageCount || 0}</div>
                <div><span className="text-muted-foreground">Tokens:</span> {(conversationDetail.tokensUsed || 0).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Model:</span> {conversationDetail.aiModelUsed || "-"}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="secondary">{conversationDetail.conversationStatus}</Badge></div>
                <div><span className="text-muted-foreground">Flag:</span> {conversationDetail.flagStatus ? <Badge className={flagColors[conversationDetail.flagStatus]}>{conversationDetail.flagStatus}</Badge> : "-"}</div>
                <div><span className="text-muted-foreground">Started:</span> {conversationDetail.createdAt ? format(new Date(conversationDetail.createdAt), "dd/MM/yyyy HH:mm") : "-"}</div>
              </div>

              <Separator />

              <div className="flex-1 overflow-y-auto space-y-3">
                <h4 className="text-sm font-medium sticky top-0 bg-background py-2">Message History ({conversationDetail.messages?.length || 0})</h4>
                {(conversationDetail.messages || []).map((msg: any, idx: number) => (
                  <div key={msg.id || idx} className={cn("rounded-lg p-3 text-sm", msg.role === "user" ? "bg-primary/5 ml-8" : "bg-muted/50 mr-8")}>
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={msg.role === "user" ? "default" : "secondary"} className="text-xs">{msg.role}</Badge>
                      <span className="text-xs text-muted-foreground">{msg.createdAt ? format(new Date(msg.createdAt), "HH:mm:ss") : ""}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content?.slice(0, 500)}{msg.content?.length > 500 ? "..." : ""}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
      case "conversations":
        return <ConversationsSection />;
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
