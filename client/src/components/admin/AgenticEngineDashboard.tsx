import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Brain,
  CheckCircle,
  Database,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Terminal,
  Timer,
  Wrench,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

type TimeRangeUnit = "hours" | "days";

type TimeRangeOption = {
  id: string;
  label: string;
  unit: TimeRangeUnit;
  value: number;
};

const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { id: "4h", label: "Last 4h", unit: "hours", value: 4 },
  { id: "12h", label: "Last 12h", unit: "hours", value: 12 },
  { id: "24h", label: "Last 24h", unit: "hours", value: 24 },
  { id: "7d", label: "Last 7d", unit: "days", value: 7 },
  { id: "30d", label: "Last 30d", unit: "days", value: 30 },
  { id: "90d", label: "Last 90d", unit: "days", value: 90 },
];

function getTimeRangeOption(id: string): TimeRangeOption {
  const found = TIME_RANGE_OPTIONS.find((o) => o.id === id);
  return found || TIME_RANGE_OPTIONS.find((o) => o.id === "30d")!;
}

function sanitizeFilenamePart(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function escapeCsvValue(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadTextFile(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AgenticEngineDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [rangeId, setRangeId] = useState<string>("30d");
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [toolSearch, setToolSearch] = useState("");
  const [gapsStatus, setGapsStatus] = useState<string>("pending");
  const [toolCallsStatusFilter, setToolCallsStatusFilter] = useState<string>("all");
  const [toolCallsToolFilter, setToolCallsToolFilter] = useState<string>("");
  const [exportingToolCalls, setExportingToolCalls] = useState(false);

  const range = getTimeRangeOption(rangeId);
  const rangeDescription = range.unit === "hours" ? `last ${range.value}h` : `last ${range.value}d`;

  const userId = selectedUserId === "all" ? undefined : selectedUserId;
  const providerId = "agentic_engine,sandbox";

  const makeAgentUrl = (path: string, extra: Record<string, string | number | undefined> = {}) => {
    const params = new URLSearchParams();
    if (range.unit === "hours") {
      params.set("rangeHours", String(range.value));
    } else {
      params.set("rangeDays", String(range.value));
    }
    params.set("providerId", providerId);
    if (userId) params.set("userId", userId);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const makeUserUrl = (path: string, extra: Record<string, string | number | undefined> = {}) => {
    const params = new URLSearchParams();
    if (userId) params.set("userId", userId);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const { data: agentUsersData, isLoading: agentUsersLoading } = useQuery({
    queryKey: ["/api/admin/agent/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/agent/users?limit=100", { credentials: "include" });
      return res.json();
    },
  });

  const { data: toolsData, isLoading: toolsLoading, refetch: refetchTools } = useQuery({
    queryKey: ["/api/admin/agent/tools", { rangeId, userId, providerId }],
    queryFn: async () => {
      const res = await fetch(makeAgentUrl("/api/admin/agent/tools"), { credentials: "include" });
      return res.json();
    },
  });

  const { data: metricsData, refetch: refetchMetrics } = useQuery({
    queryKey: ["/api/admin/agent/metrics", { rangeId, userId, providerId }],
    queryFn: async () => {
      const res = await fetch(makeAgentUrl("/api/admin/agent/metrics"), { credentials: "include" });
      return res.json();
    },
  });

  const { data: pendingGapsData, refetch: refetchPendingGaps } = useQuery({
    queryKey: ["/api/admin/agent/gaps", { userId, status: "pending" }],
    queryFn: async () => {
      const res = await fetch(makeUserUrl("/api/admin/agent/gaps", { status: "pending" }), { credentials: "include" });
      return res.json();
    },
  });

  const { data: gapsData, refetch: refetchGaps } = useQuery({
    queryKey: ["/api/admin/agent/gaps", { userId, status: gapsStatus }],
    queryFn: async () => {
      const res = await fetch(makeUserUrl("/api/admin/agent/gaps", { status: gapsStatus }), { credentials: "include" });
      return res.json();
    },
    enabled: activeTab === "gaps",
  });

  const { data: memoryData, refetch: refetchMemory } = useQuery({
    queryKey: ["/api/admin/agent/memory/stats", { userId }],
    queryFn: async () => {
      const res = await fetch(makeUserUrl("/api/admin/agent/memory/stats"), { credentials: "include" });
      return res.json();
    },
  });

  const { data: circuitsData, refetch: refetchCircuits } = useQuery({
    queryKey: ["/api/admin/agent/circuits"],
    queryFn: async () => {
      const res = await fetch("/api/admin/agent/circuits", { credentials: "include" });
      return res.json();
    },
  });

  const { data: orchestrationsData, isLoading: orchestrationsLoading, refetch: refetchOrchestrations } = useQuery({
    queryKey: ["/api/admin/agent/orchestrations", { userId }],
    queryFn: async () => {
      const res = await fetch(makeUserUrl("/api/admin/agent/orchestrations", { limit: 50 }), { credentials: "include" });
      return res.json();
    },
    enabled: activeTab === "orchestration",
    refetchInterval: activeTab === "orchestration" ? 10000 : false,
  });

  const { data: toolCallsData, isLoading: toolCallsLoading, refetch: refetchToolCalls } = useQuery({
    queryKey: ["/api/admin/agent/tool-calls", { rangeId, userId, providerId, toolCallsStatusFilter, toolCallsToolFilter }],
    queryFn: async () => {
      const res = await fetch(makeAgentUrl("/api/admin/agent/tool-calls", {
        limit: 12,
        status: toolCallsStatusFilter !== "all" ? toolCallsStatusFilter : undefined,
        toolId: toolCallsToolFilter || undefined,
      }), { credentials: "include" });
      return res.json();
    },
    enabled: activeTab === "overview",
    refetchInterval: activeTab === "overview" ? 15000 : false,
  });

  const [analyzerPrompt, setAnalyzerPrompt] = useState("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisHistory, setAnalysisHistory] = useState<any[]>([]);

  const analyzePrompt = async () => {
    if (!analyzerPrompt.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/admin/agent/complexity/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: analyzerPrompt }),
        credentials: "include",
      });
      const result = await res.json();
      setAnalysisResult(result);
      setAnalysisHistory(prev => [{ prompt: analyzerPrompt, ...result, timestamp: Date.now() }, ...prev].slice(0, 10));
    } catch {
      toast.error("Error analyzing prompt");
    } finally {
      setAnalyzing(false);
    }
  };

  const agentUsers = agentUsersData?.users || [];
  const selectedUser = userId ? agentUsers.find((u: any) => u.id === userId) : null;
  const selectedUserLabel = userId ? (selectedUser?.email || selectedUser?.fullName || userId) : "All users";

  const tools = toolsData?.tools || [];
  const pendingGaps = pendingGapsData?.gaps || [];
  const gaps = gapsData?.gaps || [];
  const metrics = metricsData || { successRate: 0, totalCalls: 0, avgLatencyMs: 0, byStatus: {} };
  const memory = memoryData || { totalAtoms: 0, storageBytes: 0, avgWeight: 0, byType: {} };
  const circuits = circuitsData || [];
  const orchestrations = orchestrationsData?.runs || [];
  const toolCalls = toolCallsData?.logs || [];

  const triggeredCircuits = circuits.length;
  const openCircuits = circuits.filter((c: any) => c?.status === "open").length;
  const halfOpenCircuits = circuits.filter((c: any) => c?.status === "half_open").length;
  const isDegraded = triggeredCircuits > 0;

  const activeTools = tools.filter((t: any) => t.isEnabled !== false).length;
  const toolsUsed = tools.filter((t: any) => Number(t?.usageCount || 0) > 0).length;

  const toolSearchLower = toolSearch.trim().toLowerCase();
  const filteredTools = toolSearchLower
    ? tools.filter((t: any) => `${t.name} ${t.category}`.toLowerCase().includes(toolSearchLower))
    : tools;
  const sortedTools = [...filteredTools].sort(
    (a: any, b: any) =>
      Number(b.usageCount || 0) - Number(a.usageCount || 0) || String(a.name).localeCompare(String(b.name))
  );
  const maxToolUsage = sortedTools.reduce((m: number, t: any) => Math.max(m, Number(t?.usageCount || 0)), 0);

  const refetchAll = () => {
    refetchTools();
    refetchMetrics();
    refetchPendingGaps();
    refetchGaps();
    refetchMemory();
    refetchCircuits();
    refetchToolCalls();
    refetchOrchestrations();
  };

  const getCategoryColor = (cat: string) => {
    if (cat === "trivial") return "bg-green-500";
    if (cat === "simple") return "bg-blue-500";
    if (cat === "moderate") return "bg-yellow-500";
    if (cat === "complex") return "bg-orange-500";
    return "bg-red-500";
  };

  const getPathIcon = (path: string) => {
    if (path === "fast") return <Zap className="h-4 w-4" />;
    if (path === "standard") return <RotateCcw className="h-4 w-4" />;
    if (path === "orchestrated") return <Layers className="h-4 w-4" />;
    return <Server className="h-4 w-4" />;
  };

  const toolCallsHasFilters = toolCallsStatusFilter !== "all" || Boolean(toolCallsToolFilter);

  const updateGapStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "resolved" | "ignored" }) => {
      const res = await fetch(`/api/admin/agent/gaps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Failed to update gap");
      }
      return payload;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/agent/gaps"] });
      toast.success("Gap updated");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to update gap");
    },
  });

  const exportToolCalls = async (format: "json" | "csv") => {
    setExportingToolCalls(true);
    try {
      const res = await fetch(makeAgentUrl("/api/admin/agent/tool-calls", {
        limit: 5000,
        status: toolCallsStatusFilter !== "all" ? toolCallsStatusFilter : undefined,
        toolId: toolCallsToolFilter || undefined,
      }), { credentials: "include" });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || "Export failed");
      }

      const logs = Array.isArray(payload?.logs) ? payload.logs : [];

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const parts = [
        "tool-calls",
        rangeId,
        selectedUserId === "all" ? "all-users" : sanitizeFilenamePart(selectedUserId),
        toolCallsStatusFilter !== "all" ? sanitizeFilenamePart(toolCallsStatusFilter) : "all-status",
        toolCallsToolFilter ? sanitizeFilenamePart(toolCallsToolFilter) : "all-tools",
        ts,
      ];
      const base = parts.filter(Boolean).join("_");

      if (format === "json") {
        const out = {
          exportedAt: new Date().toISOString(),
          filters: {
            rangeId,
            range,
            providerId,
            userId: userId || null,
            status: toolCallsStatusFilter !== "all" ? toolCallsStatusFilter : null,
            toolId: toolCallsToolFilter || null,
          },
          count: logs.length,
          logs,
        };
        downloadTextFile(`${base}.json`, JSON.stringify(out, null, 2), "application/json");
      } else {
        const columns = [
          "id",
          "createdAt",
          "userEmail",
          "userId",
          "toolId",
          "providerId",
          "status",
          "latencyMs",
          "errorCode",
          "errorMessage",
          "chatId",
          "runId",
        ];

        const lines = [columns.join(",")];
        for (const row of logs) {
          lines.push(columns.map((c) => escapeCsvValue((row as any)[c])).join(","));
        }
        downloadTextFile(`${base}.csv`, lines.join("\n"), "text/csv");
      }

      toast.success(`Exported ${logs.length} tool calls`);
    } catch (error: any) {
      toast.error(error?.message || "Export failed");
    } finally {
      setExportingToolCalls(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Agentic Engine</h2>
            <p className="text-sm text-muted-foreground">Enterprise AI Orchestration System</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Badge variant={isDegraded ? "destructive" : "default"} className="gap-1">
            <div className={`w-2 h-2 rounded-full ${isDegraded ? "bg-red-400" : "bg-green-400"}`} />
            {isDegraded ? "Degraded" : "Healthy"}
          </Badge>

          <Select value={rangeId} onValueChange={setRangeId}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={agentUsersLoading}>
            <SelectTrigger className="w-[240px] h-9">
              <SelectValue placeholder="All users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {agentUsers.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.email || u.fullName || u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 sm:grid-cols-7 w-full max-w-4xl">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="analyzer">Analyzer</TabsTrigger>
          <TabsTrigger value="orchestration">Orchestration</TabsTrigger>
          <TabsTrigger value="gaps">
            Gaps {pendingGaps.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{pendingGaps.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="circuits">Circuits</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <Activity className="h-5 w-5 text-blue-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{(metrics.totalCalls || 0).toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">Tool Calls</p>
                    <p className="text-xs text-muted-foreground truncate">{toolsUsed} tools used</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{Number(metrics.successRate || 0).toFixed(1)}%</p>
                    <p className="text-sm text-muted-foreground">Success Rate</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {(metrics.successCalls || 0).toLocaleString()} ok · {(metrics.errorCalls || 0).toLocaleString()} errors
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-500/10">
                    <Timer className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{(metrics.avgLatencyMs || 0).toLocaleString()} ms</p>
                    <p className="text-sm text-muted-foreground">Avg Latency</p>
                    <p className="text-xs text-muted-foreground truncate">{rangeDescription}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/10">
                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{pendingGaps.length}</p>
                    <p className="text-sm text-muted-foreground">Pending Gaps</p>
                    <p className="text-xs text-muted-foreground truncate">{selectedUserLabel}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Brain className="h-5 w-5 text-purple-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{memory.totalAtoms}</p>
                    <p className="text-sm text-muted-foreground">Memory Atoms</p>
                    <p className="text-xs text-muted-foreground truncate">{(memory.storageBytes / 1024).toFixed(1)} KB used</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", isDegraded ? "bg-red-500/10" : "bg-green-500/10")}>
                    <Zap className={cn("h-5 w-5", isDegraded ? "text-red-500" : "text-green-500")} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{triggeredCircuits}</p>
                    <p className="text-sm text-muted-foreground">Circuits Triggered</p>
                    <p className="text-xs text-muted-foreground truncate">
                      open {openCircuits} · half-open {halfOpenCircuits}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Recent Tool Calls
                    </CardTitle>
                    <CardDescription className="truncate">{selectedUserLabel} · {rangeDescription}</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => refetchToolCalls()} disabled={toolCallsLoading}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {toolCallsStatusFilter !== "all" ? (
                      <Badge variant="secondary" className="text-xs">
                        status: {toolCallsStatusFilter}
                      </Badge>
                    ) : null}
                    {toolCallsToolFilter ? (
                      <Badge variant="secondary" className="text-xs font-mono">
                        tool: {toolCallsToolFilter}
                      </Badge>
                    ) : null}
                    {toolCallsHasFilters ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setToolCallsStatusFilter("all");
                          setToolCallsToolFilter("");
                        }}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingToolCalls}
                      onClick={() => exportToolCalls("json")}
                    >
                      Export JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportingToolCalls}
                      onClick={() => exportToolCalls("csv")}
                    >
                      Export CSV
                    </Button>
                  </div>
                </div>
                {toolCallsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : toolCalls.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-60" />
                    <p className="font-medium">No tool calls in range</p>
                    <p className="text-sm">Try a wider time range</p>
                  </div>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b">
                          <tr>
                            <th className="text-left p-3 font-medium">Time</th>
                            <th className="text-left p-3 font-medium">User</th>
                            <th className="text-left p-3 font-medium">Tool</th>
                            <th className="text-left p-3 font-medium">Status</th>
                            <th className="text-right p-3 font-medium">Latency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {toolCalls.map((log: any) => (
                            <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatRelativeTime(log.createdAt)}</td>
                              <td className="p-3 text-xs truncate max-w-[160px]" title={log.userEmail || log.userId || ""}>
                                {log.userEmail || (log.userId ? `${String(log.userId).slice(0, 8)}...` : "-")}
                              </td>
                              <td className="p-3">
                                <button
                                  type="button"
                                  className="font-mono text-xs hover:underline underline-offset-4"
                                  onClick={() => setToolCallsToolFilter(String(log.toolId || ""))}
                                >
                                  {log.toolId}
                                </button>
                                <span className="ml-2 text-xs text-muted-foreground">{log.providerId}</span>
                              </td>
                              <td className="p-3">
                                <button type="button" onClick={() => setToolCallsStatusFilter(String(log.status || "all"))}>
                                  <Badge
                                    variant={log.status === "success" ? "default" : (log.status === "error" ? "destructive" : "secondary")}
                                    className="text-xs"
                                  >
                                    {String(log.status || "").toUpperCase()}
                                  </Badge>
                                </button>
                              </td>
                              <td className="p-3 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                {Number.isFinite(Number(log.latencyMs)) ? `${Number(log.latencyMs)}ms` : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Breakdown
                </CardTitle>
                <CardDescription className="truncate">Tools enabled {activeTools}/{tools.length}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">By Status</p>
                  {Object.keys(metrics.byStatus || {}).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No data</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(metrics.byStatus || {})
                        .sort((a: any, b: any) => Number(b[1] || 0) - Number(a[1] || 0))
                        .slice(0, 8)
                        .map(([status, count]: [string, any]) => (
                          <Button
                            key={status}
                            variant={status === toolCallsStatusFilter ? "default" : "outline"}
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setToolCallsStatusFilter(status)}
                          >
                            {status}: {Number(count || 0).toLocaleString()}
                          </Button>
                        ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Top Tools</p>
                  {sortedTools.filter((t: any) => Number(t?.usageCount || 0) > 0).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tools used</p>
                  ) : (
                    <div className="space-y-2">
                      {sortedTools
                        .filter((t: any) => Number(t?.usageCount || 0) > 0)
                        .slice(0, 8)
                        .map((t: any) => (
                          <button
                            key={t.id}
                            type="button"
                            className={cn(
                              "w-full flex items-center justify-between gap-3 p-2 -mx-2 rounded text-left hover:bg-muted/30 transition-colors",
                              t.id === toolCallsToolFilter ? "bg-muted/40" : ""
                            )}
                            onClick={() => setToolCallsToolFilter(String(t.id || ""))}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{t.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{t.category}</p>
                            </div>
                            <div className="shrink-0 text-sm tabular-nums">{Number(t.usageCount || 0).toLocaleString()}</div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tools" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <CardTitle>Registered Tools</CardTitle>
                  <CardDescription className="truncate">Usage counts · {selectedUserLabel} · {rangeDescription}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => { refetchTools(); refetchMetrics(); }}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {toolsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search tools..."
                        className="pl-9 h-9"
                        value={toolSearch}
                        onChange={(e) => setToolSearch(e.target.value)}
                      />
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {sortedTools.length} tools
                    </Badge>
                  </div>

                  {sortedTools.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Wrench className="h-10 w-10 mx-auto mb-3 opacity-60" />
                      <p className="font-medium">No tools found</p>
                      <p className="text-sm">Try clearing the search filter</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sortedTools.map((tool: any) => {
                        const usage = Number(tool.usageCount || 0);
                        const pct = maxToolUsage > 0 ? Math.min(100, Math.round((usage / maxToolUsage) * 100)) : 0;
                        return (
                          <div key={tool.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="shrink-0">{tool.category}</Badge>
                                <span className="font-medium truncate">{tool.name}</span>
                                <Badge variant={tool.isEnabled ? "default" : "secondary"} className="text-xs shrink-0">
                                  {tool.isEnabled ? "Active" : "Disabled"}
                                </Badge>
                              </div>
                              {tool.description ? (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{tool.description}</p>
                              ) : null}
                              <div className="mt-2 h-1.5 w-full max-w-[420px] bg-muted rounded">
                                <div className="h-1.5 bg-primary rounded" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-medium tabular-nums">{usage.toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground">uses</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analyzer" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Complexity Analyzer</CardTitle>
                  <CardDescription>Test prompt complexity scoring</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Enter a prompt to analyze its complexity..."
                    value={analyzerPrompt}
                    onChange={(e) => setAnalyzerPrompt(e.target.value)}
                    className="min-h-[120px]"
                  />
                  <Button onClick={analyzePrompt} disabled={analyzing || !analyzerPrompt.trim()}>
                    {analyzing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Analyze
                  </Button>
                </CardContent>
              </Card>

              {analysisResult && (
                <Card>
                  <CardHeader>
                    <CardTitle>Analysis Result</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const recommendedPath =
                        analysisResult.recommended_path ||
                        analysisResult.suggestedPath ||
                        analysisResult.suggested_path ||
                        "standard";

                      return (
                        <>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="text-center p-4 rounded-lg bg-muted">
                              <p className="text-5xl font-bold">{analysisResult.score}</p>
                              <p className="text-sm text-muted-foreground mt-1">Complexity Score</p>
                            </div>
                            <div className="text-center p-4 rounded-lg bg-muted">
                              <Badge className={cn("text-lg px-4 py-2 text-white", getCategoryColor(analysisResult.category))}>
                                {analysisResult.category?.toUpperCase()}
                              </Badge>
                              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mt-2">
                                {getPathIcon(recommendedPath)}
                                <span className="font-mono">{recommendedPath}</span>
                              </div>
                            </div>
                          </div>

                          {analysisResult.signals?.length > 0 && (
                            <div className="mt-4">
                              <p className="text-sm font-medium mb-2">Signals Detected:</p>
                              <div className="flex flex-wrap gap-2">
                                {analysisResult.signals.map((s: string) => (
                                  <Badge key={s} variant="outline">{s}</Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {analysisResult.dimensions && (
                            <div className="mt-4 space-y-2">
                              <p className="text-sm font-medium">Dimensions:</p>
                              {Object.entries(analysisResult.dimensions).map(([key, value]: [string, any]) => (
                                <div key={key} className="flex items-center gap-2">
                                  <span className="text-sm w-32 text-muted-foreground">{key.replace("_", " ")}</span>
                                  <Progress value={Number(value || 0) * 10} className="flex-1" />
                                  <span className="text-sm w-8 text-right">{value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}
            </div>

            <div>
              <Card>
                <CardHeader>
                  <CardTitle>History</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    {analysisHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No analysis yet</p>
                    ) : (
                      <div className="space-y-2">
                        {analysisHistory.map((h, i) => (
                          <div
                            key={i}
                            className="p-2 rounded border text-sm cursor-pointer hover:bg-muted/50"
                            onClick={() => {
                              setAnalyzerPrompt(h.prompt);
                              setAnalysisResult(h);
                            }}
                          >
                            <p className="truncate font-medium">{h.prompt}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">{h.score}</Badge>
                              <span className="text-xs text-muted-foreground">{h.category}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="orchestration" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Orchestration Monitor</CardTitle>
                  <CardDescription className="truncate">Active runs · {selectedUserLabel}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => { refetchOrchestrations(); refetchMetrics(); }}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {orchestrationsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : orchestrations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active orchestrations</p>
                  <p className="text-sm">Runs will appear here when tasks are being processed</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orchestrations.map((run: any) => (
                    <div key={run.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{run.id}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          chat: {run.chatId} · user: {run.userEmail || run.userId || "unknown"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={run.status === "running" ? "default" : run.status === "failed" ? "destructive" : "secondary"}>
                          {String(run.status || "").toUpperCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {run.startedAt ? format(new Date(run.startedAt), "HH:mm:ss") : run.createdAt ? format(new Date(run.createdAt), "HH:mm:ss") : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gaps" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Capability Gaps</CardTitle>
                  <CardDescription className="truncate">Requests for missing functionality · {selectedUserLabel}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={gapsStatus} onValueChange={setGapsStatus}>
                    <SelectTrigger className="w-[160px] h-9">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="ignored">Ignored</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => refetchGaps()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {gaps.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">
                    {gapsStatus === "pending"
                      ? "No pending gaps"
                      : gapsStatus === "resolved"
                        ? "No resolved gaps"
                        : gapsStatus === "ignored"
                          ? "No ignored gaps"
                          : "No gaps found"}
                  </p>
                  <p className="text-sm">Try changing the status filter</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {gaps.map((gap: any) => (
                    <div key={gap.id} className="p-4 rounded-lg border">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{gap.userPrompt}</p>
                          <p className="text-sm text-muted-foreground mt-1">{gap.gapReason}</p>
                          {selectedUserId === "all" ? (
                            <p className="text-xs text-muted-foreground mt-2">
                              user: {gap.userEmail || (gap.userId ? `${String(gap.userId).slice(0, 8)}...` : "-")}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground mt-2">
                            updated {formatRelativeTime(gap.updatedAt)}{gap.reviewedBy ? ` · by ${gap.reviewedBy}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={gap.status === "pending" ? "secondary" : gap.status === "ignored" ? "outline" : "default"}>
                              {gap.status}
                            </Badge>
                            {gap.frequencyCount > 1 && (
                              <Badge variant="outline">{gap.frequencyCount}x</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {gap.status === "pending" ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  disabled={updateGapStatusMutation.isPending}
                                  onClick={() => updateGapStatusMutation.mutate({ id: gap.id, status: "resolved" })}
                                >
                                  Resolve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8"
                                  disabled={updateGapStatusMutation.isPending}
                                  onClick={() => updateGapStatusMutation.mutate({ id: gap.id, status: "ignored" })}
                                >
                                  Ignore
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={updateGapStatusMutation.isPending}
                                onClick={() => updateGapStatusMutation.mutate({ id: gap.id, status: "pending" })}
                              >
                                Reopen
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memory" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Memory Statistics</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => refetchMemory()}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted text-center">
                    <p className="text-3xl font-bold">{memory.totalAtoms}</p>
                    <p className="text-sm text-muted-foreground">Total Atoms</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted text-center">
                    <p className="text-3xl font-bold">{(memory.storageBytes / 1024).toFixed(2)}</p>
                    <p className="text-sm text-muted-foreground">KB Used</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted text-center">
                    <p className="text-3xl font-bold">{memory.avgWeight?.toFixed(2) || 0}</p>
                    <p className="text-sm text-muted-foreground">Avg Weight</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted text-center">
                    <p className="text-3xl font-bold">{Object.keys(memory.byType || {}).length}</p>
                    <p className="text-sm text-muted-foreground">Types</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Atoms by Type</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(memory.byType || {}).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No atoms stored</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(memory.byType || {}).map(([type, count]: [string, any]) => (
                      <div key={type} className="flex items-center justify-between p-2 rounded border">
                        <Badge variant="outline">{type}</Badge>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="circuits" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Circuit Breakers</CardTitle>
                  <CardDescription>Automatic failure protection for tools</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchCircuits()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {circuits.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-70" />
                  <p className="font-medium">All circuits operating normally</p>
                  <p className="text-sm">No circuit breakers have been triggered</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {circuits.map((circuit: any) => (
                    <Card key={circuit.name} className={circuit.status === "open" ? "border-red-500" : ""}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{circuit.name}</span>
                          <Badge variant={circuit.status === "closed" ? "default" : circuit.status === "open" ? "destructive" : "secondary"}>
                            {String(circuit.status || "").toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Failures: {circuit.failures}</p>
                          {circuit.lastFailure && (
                            <p>Last failure: {format(new Date(circuit.lastFailure), "HH:mm:ss")}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
