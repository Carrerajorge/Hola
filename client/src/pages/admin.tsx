import { useState, useRef } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
  X,
  Terminal,
  Play,
  Layers,
  Server,
  Globe,
  Network,
  Lock,
  Timer,
  FileCode,
  Archive,
  ShieldCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  DollarSign
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import AnalyticsDashboard from "@/components/admin/AnalyticsDashboard";

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

function formatConvId(id: string): string {
  const hash = id.slice(-4).toUpperCase();
  return `CONV-${hash}`;
}

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "-";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return format(d, "dd/MM/yy");
}

function formatDuration(start: Date | string | null, end: Date | string | null): string {
  if (!start) return "-";
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const diffMs = e.getTime() - s.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function ConversationsSection() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState({
    status: "",
    flagStatus: "",
    userId: "",
    aiModel: "",
    dateFrom: "",
    dateTo: "",
    minTokens: "",
    maxTokens: ""
  });
  const [showFilters, setShowFilters] = useState(false);
  const [viewingConversation, setViewingConversation] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newNote, setNewNote] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateFilters = (newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const { data: statsData } = useQuery({
    queryKey: ["/api/admin/conversations/stats/summary"],
    queryFn: async () => {
      const res = await fetch("/api/admin/conversations/stats/summary");
      return res.json();
    }
  });

  const { data: conversationsData, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/conversations", page, filters, sortBy, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20", sortBy, sortOrder });
      if (filters.status) params.set("status", filters.status);
      if (filters.flagStatus) params.set("flagStatus", filters.flagStatus);
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.aiModel) params.set("aiModel", filters.aiModel);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      if (filters.minTokens) params.set("minTokens", filters.minTokens);
      if (filters.maxTokens) params.set("maxTokens", filters.maxTokens);
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
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/conversations", viewingConversation?.id] });
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await fetch(`/api/admin/conversations/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note })
      });
      return res.json();
    },
    onSuccess: () => {
      setNewNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/conversations", viewingConversation?.id] });
    }
  });

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    
    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch("/api/admin/conversations/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query })
        });
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch (e) {
        setSearchResults([]);
      }
      setIsSearching(false);
    }, 500);
  };

  const handleExportJson = () => {
    if (!conversationDetail) return;
    const blob = new Blob([JSON.stringify(conversationDetail, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversation-${formatConvId(conversationDetail.id)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyTranscript = () => {
    if (!conversationDetail?.messages) return;
    const transcript = conversationDetail.messages
      .map((m: any) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(transcript);
  };

  const stats = statsData || { activeToday: 0, avgMessagesPerConversation: 0, tokensConsumedToday: 0, flaggedConversations: 0 };
  const conversations = conversationsData?.data || [];
  const pagination = conversationsData?.pagination || { page: 1, totalPages: 1, total: 0 };

  const flagColors: Record<string, string> = {
    reviewed: "bg-green-500/10 text-green-600 border-green-500/30",
    needs_attention: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    spam: "bg-red-500/10 text-red-600 border-red-500/30",
    vip_support: "bg-purple-500/10 text-purple-600 border-purple-500/30"
  };

  const statusColors: Record<string, string> = {
    active: "bg-green-500/10 text-green-600 border-green-500/30",
    completed: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    flagged: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    archived: "bg-gray-500/10 text-gray-500 border-gray-500/30"
  };

  const SortIcon = ({ column }: { column: string }) => (
    <span className="ml-1 inline-flex">
      {sortBy === column ? (
        sortOrder === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3 opacity-30" />
      )}
    </span>
  );

  const clearFilters = () => {
    setFilters({
      status: "",
      flagStatus: "",
      userId: "",
      aiModel: "",
      dateFrom: "",
      dateTo: "",
      minTokens: "",
      maxTokens: ""
    });
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">CONVERSATION TRACKER</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-conversations" className="transition-all duration-200 hover:bg-muted">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-conversations-today">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Activity className="h-3.5 w-3.5" />
            Conversations Today
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.activeToday}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-avg-messages">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <MessageSquare className="h-3.5 w-3.5" />
            Avg Messages/Conv
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.avgMessagesPerConversation || stats.avgMessagesPerUser || 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-tokens-today">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <BarChart3 className="h-3.5 w-3.5" />
            Tokens Today
          </div>
          <p className="text-2xl font-bold tabular-nums">{(stats.tokensConsumedToday || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/30" data-testid="stat-flagged">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Flag className="h-3.5 w-3.5" />
            Flagged/Review
          </div>
          <p className="text-2xl font-bold tabular-nums text-yellow-500">{stats.flaggedConversations}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations, messages..."
            className="pl-9 h-9 transition-all duration-200"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            data-testid="input-global-search"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {searchResults.length > 0 && searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-[300px] overflow-y-auto">
              {searchResults.map((result: any, idx: number) => (
                <div
                  key={idx}
                  className="p-3 hover:bg-muted cursor-pointer border-b last:border-0 transition-colors duration-150"
                  onClick={() => {
                    setViewingConversation(result);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  data-testid={`search-result-${idx}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-primary">{formatConvId(result.id)}</span>
                    <span className="text-xs text-muted-foreground">{result.user?.email || "Anonymous"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{result.matchedContent || result.title}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className={cn("gap-1.5 transition-all duration-200", showFilters && "bg-muted")}
          data-testid="button-toggle-filters"
        >
          <Filter className="h-4 w-4" />
          Filters
          {Object.values(filters).some(v => v) && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{Object.values(filters).filter(v => v).length}</Badge>
          )}
        </Button>
      </div>

      {showFilters && (
        <div className="p-4 rounded-lg border bg-muted/20 space-y-3 transition-all duration-200">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date From</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.dateFrom}
                onChange={(e) => updateFilters({ dateFrom: e.target.value })}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date To</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters.dateTo}
                onChange={(e) => updateFilters({ dateTo: e.target.value })}
                data-testid="input-date-to"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={filters.status} onValueChange={(v) => updateFilters({ status: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-status">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="flagged">Flagged</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Flag</Label>
              <Select value={filters.flagStatus} onValueChange={(v) => updateFilters({ flagStatus: v })}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-flag">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Flags</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="needs_attention">Needs Attention</SelectItem>
                  <SelectItem value="spam">Spam</SelectItem>
                  <SelectItem value="vip_support">VIP Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">AI Model</Label>
              <Input
                placeholder="e.g. grok-3"
                className="h-8 text-xs"
                value={filters.aiModel}
                onChange={(e) => updateFilters({ aiModel: e.target.value })}
                data-testid="input-ai-model"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min Tokens</Label>
              <Input
                type="number"
                placeholder="0"
                className="h-8 text-xs"
                value={filters.minTokens}
                onChange={(e) => updateFilters({ minTokens: e.target.value })}
                data-testid="input-min-tokens"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                placeholder="∞"
                className="h-8 text-xs"
                value={filters.maxTokens}
                onChange={(e) => updateFilters({ maxTokens: e.target.value })}
                data-testid="input-max-tokens"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">User ID</Label>
              <Input
                placeholder="User ID..."
                className="h-8 text-xs"
                value={filters.userId}
                onChange={(e) => updateFilters({ userId: e.target.value })}
                data-testid="input-user-id"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters" className="text-xs">
              Clear All Filters
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2" data-testid="skeleton-loader">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse h-12 bg-muted rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("id")}
                    data-testid="th-id"
                  >
                    <div className="flex items-center">ID<SortIcon column="id" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("userEmail")}
                    data-testid="th-user"
                  >
                    <div className="flex items-center">User Email<SortIcon column="userEmail" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("createdAt")}
                    data-testid="th-started"
                  >
                    <div className="flex items-center">Started<SortIcon column="createdAt" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("messageCount")}
                    data-testid="th-messages"
                  >
                    <div className="flex items-center">Messages<SortIcon column="messageCount" /></div>
                  </th>
                  <th
                    className="text-left p-3 font-medium cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort("tokensUsed")}
                    data-testid="th-tokens"
                  >
                    <div className="flex items-center">Tokens<SortIcon column="tokensUsed" /></div>
                  </th>
                  <th className="text-left p-3 font-medium" data-testid="th-model">AI Model</th>
                  <th className="text-left p-3 font-medium" data-testid="th-status">Status</th>
                  <th className="text-left p-3 font-medium" data-testid="th-duration">Duration</th>
                  <th className="text-right p-3 font-medium" data-testid="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {conversations.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No conversations found
                    </td>
                  </tr>
                ) : conversations.map((conv: any) => (
                  <tr
                    key={conv.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors duration-150"
                    onClick={() => setViewingConversation(conv)}
                    data-testid={`row-conversation-${conv.id}`}
                  >
                    <td className="p-3">
                      <span className="font-mono text-xs text-primary">{formatConvId(conv.id)}</span>
                    </td>
                    <td className="p-3">
                      <span
                        className="text-xs truncate max-w-[150px] block hover:text-primary transition-colors cursor-pointer"
                        title={conv.user?.email}
                      >
                        {conv.user?.email || "Anonymous"}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{formatRelativeTime(conv.createdAt)}</td>
                    <td className="p-3 text-muted-foreground tabular-nums">{conv.messageCount || 0}</td>
                    <td className="p-3 text-muted-foreground tabular-nums">{(conv.tokensUsed || 0).toLocaleString()}</td>
                    <td className="p-3"><span className="text-xs font-mono">{conv.aiModelUsed || "-"}</span></td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={cn("text-xs border", statusColors[conv.conversationStatus] || statusColors.active)}
                      >
                        {conv.conversationStatus || "active"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground tabular-nums">
                      {formatDuration(conv.createdAt, conv.lastMessageAt)}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 transition-all duration-200 hover:bg-primary/10"
                          onClick={() => setViewingConversation(conv)}
                          data-testid={`button-view-${conv.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {((page - 1) * 20) + 1}-{Math.min(page * 20, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(1)}
              data-testid="button-first-page"
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <div className="flex items-center gap-1 mx-2">
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? "default" : "outline"}
                    size="sm"
                    className="w-8 h-8 p-0"
                    onClick={() => setPage(pageNum)}
                    data-testid={`button-page-${pageNum}`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pagination.totalPages}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pagination.totalPages}
              onClick={() => setPage(pagination.totalPages)}
              data-testid="button-last-page"
            >
              Last
            </Button>
          </div>
        </div>
      )}

      {viewingConversation && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col"
          data-testid="fullscreen-modal"
        >
          <div className="flex items-center justify-between p-4 border-b bg-card">
            <div className="flex items-center gap-4">
              <span className="font-mono text-lg font-semibold text-primary">
                {formatConvId(viewingConversation.id)}
              </span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground">{conversationDetail?.user?.email || "Anonymous"}</span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground">
                <Clock className="inline h-3.5 w-3.5 mr-1" />
                {formatDuration(viewingConversation.createdAt, viewingConversation.lastMessageAt)}
              </span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground font-mono">{conversationDetail?.aiModelUsed || "-"}</span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-sm text-muted-foreground tabular-nums">
                {(conversationDetail?.tokensUsed || 0).toLocaleString()} tokens
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewingConversation(null)}
              data-testid="button-close-modal"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : conversationDetail && (
              <div className="max-w-4xl mx-auto space-y-4">
                {(conversationDetail.messages || []).map((msg: any, idx: number) => (
                  <div
                    key={msg.id || idx}
                    className={cn(
                      "rounded-lg p-4 transition-all duration-200",
                      msg.role === "user"
                        ? "bg-primary/20 ml-12 rounded-tr-sm"
                        : "bg-muted mr-12 rounded-tl-sm"
                    )}
                    data-testid={`message-${idx}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge
                        variant={msg.role === "user" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {msg.role}
                      </Badge>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {msg.tokens && <span className="tabular-nums">{msg.tokens} tokens</span>}
                        <span>{msg.createdAt ? format(new Date(msg.createdAt), "HH:mm:ss") : ""}</span>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t bg-card p-4">
            <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "gap-1.5",
                      conversationDetail?.flagStatus && flagColors[conversationDetail.flagStatus]
                    )}
                    data-testid="button-flag-dropdown"
                  >
                    <Flag className="h-4 w-4" />
                    {conversationDetail?.flagStatus || "Flag Conversation"}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: null })}
                    data-testid="flag-clear"
                  >
                    Clear Flag
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "reviewed" })}
                    data-testid="flag-reviewed"
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                    Reviewed
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "needs_attention" })}
                    data-testid="flag-needs-attention"
                  >
                    <span className="w-2 h-2 rounded-full bg-yellow-500 mr-2" />
                    Needs Attention
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "spam" })}
                    data-testid="flag-spam"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500 mr-2" />
                    Spam
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => flagMutation.mutate({ id: viewingConversation.id, flagStatus: "vip_support" })}
                    data-testid="flag-vip"
                  >
                    <span className="w-2 h-2 rounded-full bg-purple-500 mr-2" />
                    VIP Support
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" size="sm" onClick={handleExportJson} data-testid="button-export-json">
                <Download className="h-4 w-4 mr-1.5" />
                Export JSON
              </Button>

              <Button variant="outline" size="sm" onClick={handleCopyTranscript} data-testid="button-copy-transcript">
                <FileText className="h-4 w-4 mr-1.5" />
                Copy Transcript
              </Button>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                <Textarea
                  placeholder="Add internal note..."
                  className="h-9 min-h-[36px] resize-none text-sm"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  data-testid="textarea-note"
                />
                <Button
                  size="sm"
                  disabled={!newNote.trim() || addNoteMutation.isPending}
                  onClick={() => addNoteMutation.mutate({ id: viewingConversation.id, note: newNote })}
                  data-testid="button-add-note"
                >
                  {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Note"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AIModelsSection() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isSyncing, setIsSyncing] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/admin/models/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/models/stats");
      return res.json();
    }
  });

  const { data: modelsData, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/models/filtered", page, debouncedSearch, providerFilter, typeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (debouncedSearch) params.append("search", debouncedSearch);
      if (providerFilter !== "all") params.append("provider", providerFilter);
      if (typeFilter !== "all") params.append("type", typeFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      const res = await fetch(`/api/admin/models/filtered?${params}`);
      return res.json();
    }
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 500);
  };

  const syncAll = async () => {
    setIsSyncing(true);
    try {
      await fetch("/api/admin/models/sync", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      refetch();
    } finally {
      setIsSyncing(false);
    }
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await fetch(`/api/admin/models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error("Failed to update model");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
      refetch();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models/stats"] });
      refetch();
    }
  });

  const providerColors: Record<string, string> = {
    anthropic: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    google: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    xai: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    openai: "bg-green-500/10 text-green-600 border-green-500/30",
    openrouter: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
    perplexity: "bg-pink-500/10 text-pink-600 border-pink-500/30"
  };

  const typeColors: Record<string, string> = {
    TEXT: "bg-gray-500/10 text-gray-600",
    IMAGE: "bg-purple-500/10 text-purple-600",
    EMBEDDING: "bg-blue-500/10 text-blue-600",
    AUDIO: "bg-yellow-500/10 text-yellow-600",
    VIDEO: "bg-red-500/10 text-red-600",
    MULTIMODAL: "bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-purple-600"
  };

  const models = modelsData?.models || [];
  const pagination = { 
    page: modelsData?.page || 1, 
    totalPages: modelsData?.totalPages || 1, 
    total: modelsData?.total || 0 
  };

  const MetricCardSkeleton = () => (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted animate-pulse w-9 h-9" />
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-8 w-16 bg-muted animate-pulse rounded" />
    </div>
  );

  const TableRowSkeleton = () => (
    <tr className="border-b">
      <td className="p-3"><div className="space-y-1"><div className="h-4 w-32 bg-muted animate-pulse rounded" /><div className="h-3 w-24 bg-muted animate-pulse rounded" /></div></td>
      <td className="p-3"><div className="h-5 w-16 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-5 w-14 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-4 w-20 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-5 w-10 bg-muted animate-pulse rounded-full" /></td>
      <td className="p-3"><div className="h-5 w-9 bg-muted animate-pulse rounded-full" /></td>
      <td className="p-3"><div className="h-4 w-24 bg-muted animate-pulse rounded" /></td>
      <td className="p-3"><div className="h-7 w-7 bg-muted animate-pulse rounded" /></td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium" data-testid="text-ai-models-title">AI Models</h2>
        <Button
          size="sm"
          onClick={syncAll}
          disabled={isSyncing}
          className="gap-2"
          data-testid="button-sync-all"
        >
          {isSyncing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sincronizando...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Sincronizar Todo
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <div className="rounded-lg border p-4" data-testid="card-total-models">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-purple-500/10">
                  <Bot className="h-4 w-4 text-purple-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Total Modelos</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-total-models-count">{stats?.total || 0}</p>
            </div>

            <div className="rounded-lg border p-4" data-testid="card-active-models">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-green-500/10">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Modelos Activos</span>
              </div>
              <p className="text-2xl font-bold text-green-600" data-testid="text-active-models-count">{stats?.active || 0}</p>
            </div>

            <div className="rounded-lg border p-4" data-testid="card-inactive-models">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-red-500/10">
                  <X className="h-4 w-4 text-red-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Modelos Inactivos</span>
              </div>
              <p className="text-2xl font-bold text-red-600" data-testid="text-inactive-models-count">{stats?.inactive || 0}</p>
            </div>

            <div className="rounded-lg border p-4" data-testid="card-providers">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <HardDrive className="h-4 w-4 text-blue-500" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Proveedores</span>
              </div>
              <p className="text-2xl font-bold" data-testid="text-providers-count">{stats?.providers || 0}</p>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar modelos..."
            className="pl-9 h-9"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            data-testid="input-search-models"
          />
        </div>

        <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-provider-filter">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="xai">xAI</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="openrouter">OpenRouter</SelectItem>
            <SelectItem value="perplexity">Perplexity</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-type-filter">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="TEXT">TEXT</SelectItem>
            <SelectItem value="IMAGE">IMAGE</SelectItem>
            <SelectItem value="EMBEDDING">EMBEDDING</SelectItem>
            <SelectItem value="AUDIO">AUDIO</SelectItem>
            <SelectItem value="VIDEO">VIDEO</SelectItem>
            <SelectItem value="MULTIMODAL">MULTIMODAL</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[130px] h-9" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="inactive">Inactivo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isSyncing && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-600">Sincronizando modelos con proveedores...</span>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Modelo</th>
                <th className="text-left p-3 font-medium">Proveedor</th>
                <th className="text-left p-3 font-medium">Tipo</th>
                <th className="text-left p-3 font-medium">Context Window</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Activo</th>
                <th className="text-left p-3 font-medium">Última Sync</th>
                <th className="text-right p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                  <TableRowSkeleton />
                </>
              ) : models.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Bot className="h-8 w-8 text-muted-foreground/50" />
                      <p>No hay modelos {debouncedSearch || providerFilter !== "all" || typeFilter !== "all" || statusFilter !== "all" ? "que coincidan con los filtros" : "configurados"}</p>
                      {!debouncedSearch && providerFilter === "all" && typeFilter === "all" && statusFilter === "all" && (
                        <Button variant="outline" size="sm" onClick={syncAll} disabled={isSyncing} className="mt-2" data-testid="button-sync-empty">
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Sincronizar modelos
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                models.map((model: any) => (
                  <tr key={model.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-model-${model.id}`}>
                    <td className="p-3">
                      <div>
                        <p className="font-medium">{model.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{model.modelId}</p>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={cn("text-xs border", providerColors[model.provider?.toLowerCase()] || "bg-gray-500/10 text-gray-600 border-gray-500/30")}
                        data-testid={`badge-provider-${model.id}`}
                      >
                        {model.provider}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant="secondary"
                        className={cn("text-xs", typeColors[model.type] || "bg-gray-500/10 text-gray-600")}
                        data-testid={`badge-type-${model.id}`}
                      >
                        {model.type || "TEXT"}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : "-"}
                    </td>
                    <td className="p-3">
                      <Switch
                        checked={model.status === "active"}
                        onCheckedChange={(checked) => updateMutation.mutate({
                          id: model.id,
                          updates: { status: checked ? "active" : "inactive" }
                        })}
                        disabled={updateMutation.isPending}
                        data-testid={`switch-status-${model.id}`}
                      />
                    </td>
                    <td className="p-3">
                      <Switch
                        checked={model.isEnabled === "true"}
                        onCheckedChange={(checked) => updateMutation.mutate({
                          id: model.id,
                          updates: { isEnabled: checked ? "true" : "false" }
                        })}
                        disabled={updateMutation.isPending}
                        className={model.isEnabled === "true" ? "data-[state=checked]:bg-green-500" : ""}
                        data-testid={`switch-enabled-${model.id}`}
                      />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {model.lastSyncAt ? format(new Date(model.lastSyncAt), "dd/MM/yyyy HH:mm") : "Never"}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(model.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-model-${model.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && models.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground" data-testid="text-pagination-info">
            Showing {((pagination.page - 1) * 15) + 1} to {Math.min(pagination.page * 15, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage(p => p + 1)}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        </div>
      )}
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
  return <AnalyticsDashboard />;
}

function DatabaseSection() {
  const [activeTab, setActiveTab] = useState<"health" | "tables" | "query">("health");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [sqlQuery, setSqlQuery] = useState("SELECT * FROM users LIMIT 10");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["/api/admin/database/health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/database/health");
      return res.json();
    },
    refetchInterval: 30000
  });

  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ["/api/admin/database/tables"],
    queryFn: async () => {
      const res = await fetch("/api/admin/database/tables");
      return res.json();
    }
  });

  const { data: tableDataResult, isLoading: tableDataLoading } = useQuery({
    queryKey: ["/api/admin/database/tables", selectedTable],
    queryFn: async () => {
      if (!selectedTable) return null;
      const res = await fetch(`/api/admin/database/tables/${selectedTable}`);
      return res.json();
    },
    enabled: !!selectedTable
  });

  const { data: indexesData } = useQuery({
    queryKey: ["/api/admin/database/indexes"],
    queryFn: async () => {
      const res = await fetch("/api/admin/database/indexes");
      return res.json();
    }
  });

  const executeQuery = async () => {
    setIsExecuting(true);
    try {
      const res = await fetch("/api/admin/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sqlQuery })
      });
      const result = await res.json();
      setQueryResult(result);
    } catch (error: any) {
      setQueryResult({ success: false, error: error.message });
    }
    setIsExecuting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Database Management</h2>
        <Button variant="outline" size="sm" onClick={() => refetchHealth()} data-testid="button-refresh-db">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab("health")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", activeTab === "health" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-db-health"
        >
          Health & Stats
        </button>
        <button
          onClick={() => setActiveTab("tables")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", activeTab === "tables" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-db-tables"
        >
          Tables Browser
        </button>
        <button
          onClick={() => setActiveTab("query")}
          className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors", activeTab === "query" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid="tab-db-query"
        >
          SQL Query
        </button>
      </div>

      {activeTab === "health" && (
        <div className="space-y-6">
          {healthLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border p-4" data-testid="card-db-status">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Estado</span>
                  </div>
                  <Badge variant={healthData?.status === "healthy" ? "default" : "destructive"} className="text-sm">
                    {healthData?.status === "healthy" ? "Saludable" : "Error"}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-2">Latencia: {healthData?.latencyMs}ms</p>
                </div>
                <div className="rounded-lg border p-4" data-testid="card-db-connections">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Conexiones</span>
                  </div>
                  <p className="text-2xl font-bold">{healthData?.pool?.active_connections || 0}</p>
                  <p className="text-xs text-muted-foreground">Activas</p>
                </div>
                <div className="rounded-lg border p-4" data-testid="card-db-size">
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Tamaño</span>
                  </div>
                  <p className="text-2xl font-bold">{healthData?.pool?.database_size || "N/A"}</p>
                  <p className="text-xs text-muted-foreground">Total DB</p>
                </div>
                <div className="rounded-lg border p-4" data-testid="card-db-transactions">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Transacciones</span>
                  </div>
                  <p className="text-2xl font-bold">{Number(healthData?.pool?.transactions_committed || 0).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Confirmadas</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Pool Statistics
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Returned</span>
                      <span>{Number(healthData?.pool?.rows_returned || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Fetched</span>
                      <span>{Number(healthData?.pool?.rows_fetched || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Inserted</span>
                      <span>{Number(healthData?.pool?.rows_inserted || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Updated</span>
                      <span>{Number(healthData?.pool?.rows_updated || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rows Deleted</span>
                      <span>{Number(healthData?.pool?.rows_deleted || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Blocks Read</span>
                      <span>{Number(healthData?.pool?.blocks_read || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Blocks Hit (Cache)</span>
                      <span>{Number(healthData?.pool?.blocks_hit || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Table Statistics
                  </h3>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-1 text-sm">
                      {healthData?.tables?.map((table: any) => (
                        <div key={table.table_name} className="flex justify-between py-1 border-b border-dashed last:border-0">
                          <span className="text-muted-foreground truncate max-w-[150px]" title={table.table_name}>{table.table_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs">{table.row_count} rows</span>
                            <span className="text-xs text-muted-foreground">{table.table_size}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="font-medium mb-2">PostgreSQL Version</h3>
                <p className="text-sm text-muted-foreground font-mono">{healthData?.version?.substring(0, 100)}</p>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "tables" && (
        <div className="space-y-4">
          {tablesLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-1 rounded-lg border p-4">
                <h3 className="font-medium mb-4">Tablas ({tablesData?.tables?.length || 0})</h3>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {tablesData?.tables?.map((table: any) => (
                      <button
                        key={table.table_name}
                        onClick={() => setSelectedTable(table.table_name)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded text-sm transition-colors",
                          selectedTable === table.table_name
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                        data-testid={`table-select-${table.table_name}`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="truncate">{table.table_name}</span>
                          <span className="text-xs opacity-70">{table.row_count}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="col-span-3 rounded-lg border p-4">
                {!selectedTable ? (
                  <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                    <div className="text-center">
                      <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Selecciona una tabla para ver sus datos</p>
                    </div>
                  </div>
                ) : tableDataLoading ? (
                  <div className="flex items-center justify-center h-[400px]"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{selectedTable}</h3>
                      <div className="text-sm text-muted-foreground">
                        {tableDataResult?.pagination?.total || 0} registros
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mb-2">
                      {tableDataResult?.columns?.map((col: any) => (
                        <span key={col.column_name} className="bg-muted px-2 py-1 rounded">
                          {col.column_name}: <span className="text-primary">{col.data_type}</span>
                        </span>
                      ))}
                    </div>

                    <ScrollArea className="h-[300px]">
                      <div className="min-w-full">
                        <table className="w-full text-xs">
                          <thead className="bg-muted sticky top-0">
                            <tr>
                              {tableDataResult?.columns?.slice(0, 8).map((col: any) => (
                                <th key={col.column_name} className="px-2 py-1 text-left font-medium truncate max-w-[150px]">
                                  {col.column_name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableDataResult?.data?.map((row: any, idx: number) => (
                              <tr key={idx} className="border-b hover:bg-muted/50">
                                {tableDataResult?.columns?.slice(0, 8).map((col: any) => (
                                  <td key={col.column_name} className="px-2 py-1 truncate max-w-[150px]" title={String(row[col.column_name] ?? "")}>
                                    {row[col.column_name] === null ? <span className="text-muted-foreground">NULL</span> : String(row[col.column_name]).substring(0, 50)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "query" && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                SQL Query Explorer
              </h3>
              <Badge variant="outline" className="text-xs">Solo SELECT</Badge>
            </div>
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              className="w-full h-32 font-mono text-sm bg-muted p-4 rounded-lg border-0 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="SELECT * FROM users LIMIT 10"
              data-testid="input-sql-query"
            />
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">
                Por seguridad, solo se permiten consultas SELECT
              </p>
              <Button onClick={executeQuery} disabled={isExecuting} data-testid="button-execute-query">
                {isExecuting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Ejecutar
              </Button>
            </div>
          </div>

          {queryResult && (
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">Resultados</h3>
                {queryResult.success && (
                  <div className="text-sm text-muted-foreground">
                    {queryResult.rowCount} filas en {queryResult.executionTimeMs}ms
                  </div>
                )}
              </div>
              {queryResult.success ? (
                <ScrollArea className="h-[300px]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        {queryResult.columns?.map((col: string) => (
                          <th key={col} className="px-2 py-1 text-left font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.data?.map((row: any, idx: number) => (
                        <tr key={idx} className="border-b hover:bg-muted/50">
                          {queryResult.columns?.map((col: string) => (
                            <td key={col} className="px-2 py-1 truncate max-w-[200px]" title={String(row[col] ?? "")}>
                              {row[col] === null ? <span className="text-muted-foreground">NULL</span> : String(row[col]).substring(0, 100)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              ) : (
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg text-sm">
                  <p className="font-medium mb-1">Error</p>
                  <p>{queryResult.error}</p>
                  {queryResult.hint && <p className="text-xs mt-2 opacity-70">{queryResult.hint}</p>}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border p-4">
            <h3 className="font-medium mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Índices ({indexesData?.indexes?.length || 0})
            </h3>
            <ScrollArea className="h-[150px]">
              <div className="space-y-1 text-xs font-mono">
                {indexesData?.indexes?.map((idx: any, i: number) => (
                  <div key={i} className="flex justify-between py-1 border-b border-dashed">
                    <span className="text-muted-foreground">{idx.tablename}.{idx.indexname}</span>
                    <span>{idx.index_size}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

const POLICY_TYPES = [
  { value: "cors", label: "CORS", icon: Globe, color: "bg-blue-500" },
  { value: "csp", label: "CSP", icon: FileCode, color: "bg-purple-500" },
  { value: "rate_limit", label: "Rate Limit", icon: Timer, color: "bg-orange-500" },
  { value: "ip_restriction", label: "IP Restriction", icon: Network, color: "bg-red-500" },
  { value: "auth_requirement", label: "Auth Requirement", icon: Lock, color: "bg-green-500" },
  { value: "data_retention", label: "Data Retention", icon: Archive, color: "bg-yellow-500" },
];

const APPLIED_TO_OPTIONS = [
  { value: "global", label: "Global" },
  { value: "api", label: "API" },
  { value: "dashboard", label: "Dashboard" },
  { value: "public", label: "Public" },
];

function SecuritySection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilters, setAuditFilters] = useState({ action: "", dateFrom: "", dateTo: "" });

  const [newPolicy, setNewPolicy] = useState({
    policyName: "",
    policyType: "cors",
    appliedTo: "global",
    priority: 0,
    rules: {} as Record<string, any>
  });

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["/api/admin/security/policies"],
    queryFn: async () => {
      const res = await fetch("/api/admin/security/policies");
      return res.json();
    }
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/admin/security/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/security/stats");
      return res.json();
    }
  });

  const { data: auditLogsData } = useQuery({
    queryKey: ["/api/admin/security/audit-logs", auditPage, auditFilters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: auditPage.toString(),
        limit: "20",
        ...(auditFilters.action && { action: auditFilters.action }),
        ...(auditFilters.dateFrom && { date_from: auditFilters.dateFrom }),
        ...(auditFilters.dateTo && { date_to: auditFilters.dateTo }),
      });
      const res = await fetch(`/api/admin/security/audit-logs?${params}`);
      return res.json();
    }
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["/api/admin/security/logs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/security/logs?limit=10");
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
      if (!res.ok) throw new Error("Failed to create policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/stats"] });
      setShowAddModal(false);
      resetPolicyForm();
    }
  });

  const updatePolicyMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await fetch(`/api/admin/security/policies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Failed to update policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      setEditingPolicy(null);
      setShowAddModal(false);
    }
  });

  const deletePolicyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/security/policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete policy");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/stats"] });
    }
  });

  const togglePolicyMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      const res = await fetch(`/api/admin/security/policies/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled })
      });
      if (!res.ok) throw new Error("Failed to toggle policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/stats"] });
    }
  });

  const resetPolicyForm = () => {
    setNewPolicy({
      policyName: "",
      policyType: "cors",
      appliedTo: "global",
      priority: 0,
      rules: {}
    });
  };

  const handleEditPolicy = (policy: any) => {
    setEditingPolicy(policy);
    setNewPolicy({
      policyName: policy.policyName,
      policyType: policy.policyType,
      appliedTo: policy.appliedTo,
      priority: policy.priority || 0,
      rules: policy.rules || {}
    });
    setShowAddModal(true);
  };

  const handleSavePolicy = () => {
    const policyData = {
      policyName: newPolicy.policyName,
      policyType: newPolicy.policyType,
      appliedTo: newPolicy.appliedTo,
      priority: newPolicy.priority,
      rules: newPolicy.rules
    };
    
    if (editingPolicy) {
      updatePolicyMutation.mutate({ id: editingPolicy.id, ...policyData });
    } else {
      createPolicyMutation.mutate(policyData);
    }
  };

  const getPolicyTypeInfo = (type: string) => {
    return POLICY_TYPES.find(t => t.value === type) || POLICY_TYPES[0];
  };

  const getSeverityBadge = (action: string) => {
    const criticalActions = ["login_failed", "blocked", "unauthorized", "security_alert", "permission_denied"];
    const warningActions = ["warning", "update", "delete"];
    
    if (criticalActions.some(a => action?.includes(a))) {
      return <Badge variant="destructive" className="text-xs">Critical</Badge>;
    }
    if (warningActions.some(a => action?.includes(a))) {
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">Warning</Badge>;
    }
    return <Badge variant="outline" className="text-xs">Info</Badge>;
  };

  const renderPolicyRulesForm = () => {
    switch (newPolicy.policyType) {
      case "cors":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Allowed Origins (one per line)</Label>
              <Textarea 
                data-testid="input-cors-origins"
                placeholder="https://example.com&#10;https://api.example.com"
                value={newPolicy.rules.allowed_origins || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, allowed_origins: e.target.value } })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Allowed Methods</Label>
              <div className="flex flex-wrap gap-3">
                {["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"].map(method => (
                  <label key={method} className="flex items-center gap-2">
                    <Checkbox 
                      data-testid={`checkbox-method-${method.toLowerCase()}`}
                      checked={(newPolicy.rules.allowed_methods || []).includes(method)}
                      onCheckedChange={(checked) => {
                        const methods = newPolicy.rules.allowed_methods || [];
                        setNewPolicy({
                          ...newPolicy,
                          rules: {
                            ...newPolicy.rules,
                            allowed_methods: checked ? [...methods, method] : methods.filter((m: string) => m !== method)
                          }
                        });
                      }}
                    />
                    <span className="text-sm">{method}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max Age (seconds)</Label>
              <Input 
                data-testid="input-cors-max-age"
                type="number"
                value={newPolicy.rules.max_age || 86400}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, max_age: parseInt(e.target.value) } })}
              />
            </div>
          </div>
        );
      case "rate_limit":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Requests per Minute</Label>
              <Input 
                data-testid="input-rate-requests"
                type="number"
                value={newPolicy.rules.requests_per_minute || 60}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, requests_per_minute: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Burst Limit</Label>
              <Input 
                data-testid="input-rate-burst"
                type="number"
                value={newPolicy.rules.burst_limit || 10}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, burst_limit: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select 
                value={newPolicy.rules.scope || "ip"}
                onValueChange={(v) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, scope: v } })}
              >
                <SelectTrigger data-testid="select-rate-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">Per IP</SelectItem>
                  <SelectItem value="user">Per User</SelectItem>
                  <SelectItem value="api_key">Per API Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      case "ip_restriction":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Whitelist CIDRs (one per line)</Label>
              <Textarea 
                data-testid="input-ip-whitelist"
                placeholder="192.168.1.0/24&#10;10.0.0.0/8"
                value={newPolicy.rules.whitelist_cidrs || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, whitelist_cidrs: e.target.value } })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Blacklist CIDRs (one per line)</Label>
              <Textarea 
                data-testid="input-ip-blacklist"
                placeholder="0.0.0.0/0"
                value={newPolicy.rules.blacklist_cidrs || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, blacklist_cidrs: e.target.value } })}
                rows={3}
              />
            </div>
          </div>
        );
      case "csp":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>default-src</Label>
              <Input 
                data-testid="input-csp-default"
                placeholder="'self'"
                value={newPolicy.rules.default_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, default_src: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>script-src</Label>
              <Input 
                data-testid="input-csp-script"
                placeholder="'self' 'unsafe-inline'"
                value={newPolicy.rules.script_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, script_src: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>style-src</Label>
              <Input 
                data-testid="input-csp-style"
                placeholder="'self' 'unsafe-inline'"
                value={newPolicy.rules.style_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, style_src: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>img-src</Label>
              <Input 
                data-testid="input-csp-img"
                placeholder="'self' data: https:"
                value={newPolicy.rules.img_src || ""}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, img_src: e.target.value } })}
              />
            </div>
          </div>
        );
      case "auth_requirement":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Checkbox 
                id="require_2fa"
                data-testid="checkbox-require-2fa"
                checked={newPolicy.rules.require_2fa || false}
                onCheckedChange={(checked) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, require_2fa: checked } })}
              />
              <Label htmlFor="require_2fa">Require Two-Factor Authentication</Label>
            </div>
            <div className="space-y-2">
              <Label>Session Timeout (minutes)</Label>
              <Input 
                data-testid="input-session-timeout"
                type="number"
                value={newPolicy.rules.session_timeout_minutes || 60}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, session_timeout_minutes: parseInt(e.target.value) } })}
              />
            </div>
          </div>
        );
      case "data_retention":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Audit Logs Retention (days)</Label>
              <Input 
                data-testid="input-retention-audit"
                type="number"
                value={newPolicy.rules.audit_logs_days || 365}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, audit_logs_days: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>User Data Retention (days)</Label>
              <Input 
                data-testid="input-retention-user"
                type="number"
                value={newPolicy.rules.user_data_days || 730}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, user_data_days: parseInt(e.target.value) } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Chat History Retention (days)</Label>
              <Input 
                data-testid="input-retention-chat"
                type="number"
                value={newPolicy.rules.chat_history_days || 90}
                onChange={(e) => setNewPolicy({ ...newPolicy, rules: { ...newPolicy.rules, chat_history_days: parseInt(e.target.value) } })}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Security Center
        </h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="policies" data-testid="tab-policies">Policies</TabsTrigger>
          <TabsTrigger value="audit-logs" data-testid="tab-audit-logs">Audit Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border p-4" data-testid="kpi-total-policies">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <Shield className="h-4 w-4 text-blue-500" />
                </div>
                <span className="text-sm text-muted-foreground">Total Policies</span>
              </div>
              <p className="text-2xl font-bold">{stats?.totalPolicies || 0}</p>
            </div>
            <div className="rounded-lg border p-4" data-testid="kpi-active-policies">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-green-500/10">
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                </div>
                <span className="text-sm text-muted-foreground">Active Policies</span>
              </div>
              <p className="text-2xl font-bold">{stats?.activePolicies || 0}</p>
            </div>
            <div className="rounded-lg border p-4" data-testid="kpi-critical-alerts">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-red-500/10">
                  <ShieldAlert className="h-4 w-4 text-red-500" />
                </div>
                <span className="text-sm text-muted-foreground">Critical Alerts (24h)</span>
              </div>
              <p className="text-2xl font-bold">{stats?.criticalAlerts24h || 0}</p>
            </div>
            <div className="rounded-lg border p-4" data-testid="kpi-audit-today">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-md bg-purple-500/10">
                  <Activity className="h-4 w-4 text-purple-500" />
                </div>
                <span className="text-sm text-muted-foreground">Audit Events Today</span>
              </div>
              <p className="text-2xl font-bold">{stats?.auditEventsToday || 0}</p>
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="p-4 border-b">
              <h3 className="font-medium">Recent Security Events</h3>
            </div>
            <ScrollArea className="h-[300px]">
              {recentLogs.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No recent events</div>
              ) : (
                recentLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between p-3 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      {getSeverityBadge(log.action)}
                      <div>
                        <span className="font-medium text-sm">{log.action}</span>
                        <span className="text-muted-foreground text-sm"> - {log.resource}</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {log.createdAt ? format(new Date(log.createdAt), "dd/MM HH:mm") : ""}
                    </span>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="policies" className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{policies.length} policies configured</span>
            <Dialog open={showAddModal} onOpenChange={(open) => {
              setShowAddModal(open);
              if (!open) {
                setEditingPolicy(null);
                resetPolicyForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-policy">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Policy
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingPolicy ? "Edit Policy" : "Create Security Policy"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Policy Name</Label>
                    <Input 
                      data-testid="input-policy-name"
                      placeholder="My Security Policy"
                      value={newPolicy.policyName}
                      onChange={(e) => setNewPolicy({ ...newPolicy, policyName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Policy Type</Label>
                    <Select 
                      value={newPolicy.policyType}
                      onValueChange={(v) => setNewPolicy({ ...newPolicy, policyType: v, rules: {} })}
                    >
                      <SelectTrigger data-testid="select-policy-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POLICY_TYPES.map(type => (
                          <SelectItem key={type.value} value={type.value}>
                            <span className="flex items-center gap-2">
                              <type.icon className="h-4 w-4" />
                              {type.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Applied To</Label>
                      <Select 
                        value={newPolicy.appliedTo}
                        onValueChange={(v) => setNewPolicy({ ...newPolicy, appliedTo: v })}
                      >
                        <SelectTrigger data-testid="select-applied-to">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPLIED_TO_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Input 
                        data-testid="input-priority"
                        type="number"
                        value={newPolicy.priority}
                        onChange={(e) => setNewPolicy({ ...newPolicy, priority: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  
                  <Separator />
                  <h4 className="font-medium">Policy Rules</h4>
                  {renderPolicyRulesForm()}
                  
                  <Button 
                    className="w-full" 
                    onClick={handleSavePolicy}
                    disabled={!newPolicy.policyName || createPolicyMutation.isPending || updatePolicyMutation.isPending}
                    data-testid="button-save-policy"
                  >
                    {(createPolicyMutation.isPending || updatePolicyMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingPolicy ? "Update Policy" : "Create Policy"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Applied To</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Priority</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                      No security policies configured. Click "Add Policy" to create one.
                    </td>
                  </tr>
                ) : (
                  policies.map((policy: any) => {
                    const typeInfo = getPolicyTypeInfo(policy.policyType);
                    return (
                      <tr key={policy.id} className="border-t" data-testid={`row-policy-${policy.id}`}>
                        <td className="p-3">
                          <span className="font-medium">{policy.policyName}</span>
                        </td>
                        <td className="p-3">
                          <Badge className={cn("text-white", typeInfo.color)}>
                            <typeInfo.icon className="h-3 w-3 mr-1" />
                            {typeInfo.label}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">{policy.appliedTo}</Badge>
                        </td>
                        <td className="p-3 text-sm">{policy.priority}</td>
                        <td className="p-3">
                          <Switch 
                            checked={policy.isEnabled === "true"}
                            onCheckedChange={(checked) => togglePolicyMutation.mutate({ id: policy.id, isEnabled: checked })}
                            data-testid={`toggle-policy-${policy.id}`}
                          />
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0"
                              onClick={() => handleEditPolicy(policy)}
                              data-testid={`button-edit-${policy.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => deletePolicyMutation.mutate(policy.id)}
                              data-testid={`button-delete-${policy.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="audit-logs" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Action:</Label>
              <Input 
                data-testid="filter-action"
                placeholder="Filter by action..."
                className="h-8 w-40"
                value={auditFilters.action}
                onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">From:</Label>
              <Input 
                data-testid="filter-date-from"
                type="date"
                className="h-8 w-36"
                value={auditFilters.dateFrom}
                onChange={(e) => setAuditFilters({ ...auditFilters, dateFrom: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">To:</Label>
              <Input 
                data-testid="filter-date-to"
                type="date"
                className="h-8 w-36"
                value={auditFilters.dateTo}
                onChange={(e) => setAuditFilters({ ...auditFilters, dateTo: e.target.value })}
              />
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                setAuditFilters({ action: "", dateFrom: "", dateTo: "" });
                setAuditPage(1);
              }}
              data-testid="button-clear-filters"
            >
              Clear
            </Button>
          </div>

          <div className="rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Timestamp</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Action</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Resource</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">IP Address</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Severity</th>
                </tr>
              </thead>
              <tbody>
                {auditLogsData?.data?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                      No audit logs found matching your filters.
                    </td>
                  </tr>
                ) : (
                  auditLogsData?.data?.map((log: any) => (
                    <tr key={log.id} className="border-t" data-testid={`row-audit-${log.id}`}>
                      <td className="p-3 text-sm">
                        {log.createdAt ? format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss") : "-"}
                      </td>
                      <td className="p-3 font-medium text-sm">{log.action}</td>
                      <td className="p-3 text-sm">{log.resource || "-"}</td>
                      <td className="p-3 text-sm font-mono">{log.ipAddress || "-"}</td>
                      <td className="p-3">{getSeverityBadge(log.action)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {auditLogsData?.pagination && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {auditLogsData.pagination.page} of {auditLogsData.pagination.totalPages} ({auditLogsData.pagination.total} total)
              </span>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage(p => p - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={auditPage >= auditLogsData.pagination.totalPages}
                  onClick={() => setAuditPage(p => p + 1)}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReportsSection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [reportFormat, setReportFormat] = useState<string>("json");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["/api/admin/reports/templates"],
    queryFn: async () => {
      const res = await fetch("/api/admin/reports/templates");
      return res.json();
    }
  });

  const { data: generatedReportsData, isLoading: reportsLoading, refetch: refetchReports } = useQuery({
    queryKey: ["/api/admin/reports/generated", historyPage],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports/generated?page=${historyPage}&limit=20`);
      return res.json();
    },
    refetchInterval: 5000
  });

  const generateReportMutation = useMutation({
    mutationFn: async (data: { templateId: string; format: string; parameters?: any }) => {
      const res = await fetch("/api/admin/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/generated"] });
      setActiveTab("history");
    }
  });

  const deleteReportMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/reports/generated/${id}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/generated"] });
    }
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "user_report": return <Users className="h-5 w-5" />;
      case "ai_models_report": return <Bot className="h-5 w-5" />;
      case "security_report": return <Shield className="h-5 w-5" />;
      case "financial_report": return <DollarSign className="h-5 w-5" />;
      default: return <FileText className="h-5 w-5" />;
    }
  };

  const getTypeBadgeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (type) {
      case "user_report": return "default";
      case "ai_models_report": return "secondary";
      case "security_report": return "destructive";
      case "financial_report": return "outline";
      default: return "secondary";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case "processing": return <Badge variant="outline" className="bg-blue-100 text-blue-800">Processing</Badge>;
      case "completed": return <Badge variant="outline" className="bg-green-100 text-green-800">Completed</Badge>;
      case "failed": return <Badge variant="destructive">Failed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleGenerateFromTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    setActiveTab("generate");
  };

  const handleSubmitGenerate = () => {
    if (!selectedTemplate) return;
    generateReportMutation.mutate({
      templateId: selectedTemplate,
      format: reportFormat,
      parameters: { dateFrom, dateTo }
    });
  };

  const handleDownload = (reportId: string) => {
    window.open(`/api/admin/reports/download/${reportId}`, "_blank");
  };

  if (templatesLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const generatedReports = generatedReportsData?.data || [];
  const pagination = generatedReportsData?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Reports Center</h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates" data-testid="tab-templates">Templates</TabsTrigger>
          <TabsTrigger value="generate" data-testid="tab-generate">Generate Report</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template: any) => (
              <Card key={template.id} className="flex flex-col" data-testid={`card-template-${template.id}`}>
                <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                  <div className="p-2 rounded-lg bg-muted">
                    {getTypeIcon(template.type)}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <Badge variant={getTypeBadgeVariant(template.type)} className="mt-1 text-xs">
                      {template.type.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="text-sm text-muted-foreground">{template.description || "No description"}</p>
                  {template.isSystem === "true" && (
                    <Badge variant="outline" className="mt-2 text-xs">System Template</Badge>
                  )}
                </CardContent>
                <CardFooter>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={() => handleGenerateFromTemplate(template.id)}
                    data-testid={`button-generate-${template.id}`}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Generate
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="generate" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Generate New Report</CardTitle>
              <CardDescription>Configure and generate a report from a template</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Report Template</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger data-testid="select-template">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date From (Optional)</Label>
                  <Input 
                    type="date" 
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    data-testid="input-date-from"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date To (Optional)</Label>
                  <Input 
                    type="date" 
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    data-testid="input-date-to"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Export Format</Label>
                <Select value={reportFormat} onValueChange={setReportFormat}>
                  <SelectTrigger data-testid="select-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={handleSubmitGenerate}
                disabled={!selectedTemplate || generateReportMutation.isPending}
                data-testid="button-submit-generate"
              >
                {generateReportMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Report
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Generated Reports</CardTitle>
                <CardDescription>View and download previously generated reports</CardDescription>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetchReports()}
                data-testid="button-refresh-history"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : generatedReports.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No reports generated yet. Generate your first report from the Templates tab.
                </div>
              ) : (
                <div className="rounded-lg border">
                  <table className="w-full">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Format</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Created</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generatedReports.map((report: any) => (
                        <tr key={report.id} className="border-b last:border-0" data-testid={`row-report-${report.id}`}>
                          <td className="px-4 py-3 text-sm font-medium">{report.name}</td>
                          <td className="px-4 py-3 text-sm">
                            <Badge variant={getTypeBadgeVariant(report.type)} className="text-xs">
                              {report.type.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm">{getStatusBadge(report.status)}</td>
                          <td className="px-4 py-3 text-sm uppercase">{report.format}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {report.createdAt ? format(new Date(report.createdAt), "MMM dd, yyyy HH:mm") : "-"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {report.status === "completed" && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-8 px-2"
                                  onClick={() => handleDownload(report.id)}
                                  data-testid={`button-download-${report.id}`}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              )}
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 px-2 text-destructive hover:text-destructive"
                                onClick={() => deleteReportMutation.mutate(report.id)}
                                data-testid={`button-delete-${report.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                  </span>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage(p => p - 1)}
                      data-testid="button-prev-history"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      disabled={historyPage >= pagination.totalPages}
                      onClick={() => setHistoryPage(p => p + 1)}
                      data-testid="button-next-history"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
