import { useOpenClawRuntimeOverview } from "@/hooks/use-openclaw-runtime-overview";
import { useLocation } from "wouter";
import {
  Activity, ArrowLeft, Brain, CheckCircle, Globe, Layers, Loader2,
  Monitor, Network, Plug, RefreshCw, Server, Shield, Terminal,
  Wrench, XCircle, Zap, AlertTriangle, Bot, Clock, Eye
} from "lucide-react";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"}`}
    />
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "blue" }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500/10 to-blue-600/5 border-blue-500/20",
    emerald: "from-emerald-500/10 to-emerald-600/5 border-emerald-500/20",
    purple: "from-purple-500/10 to-purple-600/5 border-purple-500/20",
    amber: "from-amber-500/10 to-amber-600/5 border-amber-500/20",
    cyan: "from-cyan-500/10 to-cyan-600/5 border-cyan-500/20",
    rose: "from-rose-500/10 to-rose-600/5 border-rose-500/20",
  };
  const iconColorMap: Record<string, string> = {
    blue: "text-blue-500", emerald: "text-emerald-500", purple: "text-purple-500",
    amber: "text-amber-500", cyan: "text-cyan-500", rose: "text-rose-500",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${colorMap[color] || colorMap.blue} p-4 transition-all hover:scale-[1.02]`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${iconColorMap[color] || iconColorMap.blue}`} />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function ModuleBadge({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
      enabled
        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
        : "bg-zinc-500/10 text-zinc-500 border border-zinc-500/20"
    }`}>
      {enabled ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {name}
    </span>
  );
}

function SectionCard({ title, icon: Icon, children, className = "" }: {
  title: string; icon: any; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function OpenClawDashboard() {
  const { overview, isLoading, error, refresh } = useOpenClawRuntimeOverview(10_000);
  const [, setLocation] = useLocation();

  if (isLoading && !overview) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading OpenClaw Runtime…</p>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4 max-w-md">
          <XCircle className="h-10 w-10 mx-auto text-red-500" />
          <h2 className="text-lg font-semibold">OpenClaw Runtime Unavailable</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={refresh} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const o = overview!;
  const health = o.health;
  const cp = o.controlPlane;
  const sa = o.superAgent;
  const bg = o.background;
  const br = o.browser;
  const conn = o.connectors;
  const orch = o.orchestrator;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setLocation("/admin")} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold">OpenClaw Runtime</h1>
                <p className="text-xs text-muted-foreground">v{sa.localOpenClawVersion || "unknown"}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-xs">
              <StatusDot ok={health.ok} />
              <span className="font-medium">{health.ok ? "Healthy" : "Issues Detected"}</span>
            </div>
            <button onClick={refresh} className="p-2 rounded-lg hover:bg-muted transition-colors" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Warnings Bar */}
        {health.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">Warnings ({health.warnings.length})</span>
            </div>
            <ul className="space-y-1">
              {health.warnings.map((w, i) => (
                <li key={i} className="text-xs text-muted-foreground">• {w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Modules Row */}
        <div className="flex flex-wrap gap-2">
          <ModuleBadge name="Gateway" enabled={health.modules.gateway} />
          <ModuleBadge name="Skills" enabled={health.modules.skills} />
          <ModuleBadge name="Tools" enabled={health.modules.tools} />
          <ModuleBadge name="Plugins" enabled={health.modules.plugins} />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={Plug} label="Connectors" value={conn.total} sub={`${conn.connected} connected`} color="blue" />
          <StatCard icon={Wrench} label="Capabilities" value={conn.writeCapabilities} sub={`${Object.keys(conn.categories).length} categories`} color="purple" />
          <StatCard icon={Monitor} label="Browser" value={br.activeSessions} sub={`${br.profiles.length} profiles`} color="cyan" />
          <StatCard icon={Layers} label="Background Jobs" value={bg.jobs?.total || 0} sub={`${bg.tasks?.jobs || 0} active tasks`} color="amber" />
          <StatCard icon={Bot} label="Subagents" value={bg.subagents?.activeRunners || 0} sub={`${bg.subagents?.totalRuns || 0} total runs`} color="emerald" />
          <StatCard icon={Terminal} label="Processes" value={bg.processes?.count || 0} sub={`${bg.processes?.running || 0} running`} color="rose" />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Control Plane */}
          <SectionCard title="Control Plane — Agent Roles" icon={Brain}>
            <div className="space-y-3">
              {Object.entries(cp.roles).map(([key, role]) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <StatusDot ok={role.configured} />
                    <div>
                      <span className="text-sm font-medium capitalize">{role.role}</span>
                      <p className="text-xs text-muted-foreground">{role.purpose}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{role.provider}/{role.target}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{role.lane}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">Platform Capabilities</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(cp.capabilities).map(([key, value]) => (
                  <span key={key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                    typeof value === "boolean"
                      ? value ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-500"
                      : "bg-blue-500/10 text-blue-400"
                  }`}>
                    {typeof value === "boolean" ? (value ? "✓" : "✗") : ""} {key.replace(/([A-Z])/g, " $1").trim()}
                  </span>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* SuperAgent */}
          <SectionCard title="SuperAgent" icon={Shield}>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
                <Zap className="h-5 w-5 text-violet-500" />
                <div>
                  <p className="text-sm font-medium">OpenClaw v{sa.localOpenClawVersion}</p>
                  <p className="text-xs text-muted-foreground">Tag: {sa.requestedOpenClawTag}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Core Connectors ({sa.connectors.totalConnectors})</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {sa.connectors.coreConnectors.map((c) => (
                    <div key={c.connectorId} className="flex items-center justify-between text-xs p-2 rounded bg-muted/50">
                      <div className="flex items-center gap-2">
                        <StatusDot ok={c.loaded && c.envReady} />
                        <span className="font-medium">{c.displayName}</span>
                      </div>
                      <span className="text-muted-foreground">{c.capabilityCount} caps</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Ecosystem Services ({sa.ecosystem.totalServices})</p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {sa.ecosystem.featuredServices.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/50">
                      <div className="flex items-center gap-2">
                        <StatusDot ok={s.enabled && s.reachable !== false} />
                        <span className="font-medium">{s.id}</span>
                      </div>
                      <span className="text-muted-foreground">{s.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              {Object.keys(sa.capabilities).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Capabilities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(sa.capabilities).map(([key, val]) => (
                      <span key={key} className={`text-xs px-2 py-0.5 rounded ${val ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-500"}`}>
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Browser Runtime */}
          <SectionCard title="Browser Runtime" icon={Globe}>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{br.counts.browser}</p>
                  <p className="text-xs text-muted-foreground">Browser</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{br.counts.computerBrowser}</p>
                  <p className="text-xs text-muted-foreground">Computer</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{br.counts.computerDesktop}</p>
                  <p className="text-xs text-muted-foreground">Desktop</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Profiles</p>
                <div className="flex flex-wrap gap-1.5">
                  {br.profiles.map((p) => (
                    <span key={p.id} className="text-xs px-2 py-1 rounded-full bg-muted border">
                      {p.mobile ? "📱" : "🖥️"} {p.name}
                    </span>
                  ))}
                </div>
              </div>
              {Object.keys(br.capabilities).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Capabilities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(br.capabilities).map(([key, val]) => (
                      <span key={key} className={`text-xs px-2 py-0.5 rounded ${val ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-500"}`}>
                        {val ? "✓" : "✗"} {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {br.sessions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Active Sessions</p>
                  {br.sessions.map((s) => (
                    <div key={s.sessionId} className="text-xs p-2 rounded bg-muted/50 mb-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono">{s.sessionId.slice(0, 12)}…</span>
                        <span className="text-muted-foreground">{s.controller}/{s.mode}</span>
                      </div>
                      {s.url && <p className="text-muted-foreground truncate mt-1">{s.url}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Background Runtime */}
          <SectionCard title="Background Runtime" icon={Activity}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot ok={bg.tasks?.started} />
                    <span className="text-xs font-medium">Task Scheduler</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cron: {bg.tasks?.cronEnabled ? "ON" : "OFF"} · Heartbeat: {bg.tasks?.heartbeatsEnabled ? "ON" : "OFF"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Network className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium">Sessions</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Active: {bg.sessions?.activeSessions || 0} · Errors: {bg.sessions?.errorSessions || 0}
                  </p>
                </div>
              </div>

              {bg.extensions && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Layers className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium">Extensions</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Plugins: {bg.extensions.pluginCount || 0} · Hooks: {bg.extensions.hookCount || 0}
                  </p>
                </div>
              )}

              {bg.processes?.recent && bg.processes.recent.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Recent Processes</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {bg.processes.recent.slice(0, 5).map((p) => (
                      <div key={p.sessionId} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/30">
                        <span className="font-mono truncate max-w-[200px]">{p.name || p.command || p.sessionId.slice(0, 12)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          p.status === "running" ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-500"
                        }`}>{p.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Connectors */}
          <SectionCard title={`Connectors (${conn.total})`} icon={Plug}>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-emerald-500">{conn.connected}</p>
                  <p className="text-xs text-muted-foreground">Connected</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-blue-500">{conn.enabledForUser}</p>
                  <p className="text-xs text-muted-foreground">Enabled</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-purple-500">{conn.writeCapabilities}</p>
                  <p className="text-xs text-muted-foreground">Write Caps</p>
                </div>
              </div>
              {Object.keys(conn.categories).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Categories</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(conn.categories).map(([cat, count]) => (
                      <span key={cat} className="text-xs px-2 py-1 rounded-full bg-muted border">
                        {cat}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {conn.items.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {conn.items.map((c) => (
                    <div key={c.connectorId} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                      <div className="flex items-center gap-2">
                        <StatusDot ok={c.connected} />
                        <span className="font-medium">{c.displayName}</span>
                      </div>
                      <span className="text-muted-foreground">{c.category}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Orchestrator */}
          <SectionCard title="Orchestration Engine" icon={Network}>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Total Runs</span>
                <span className="text-lg font-bold">{orch.status.runCount}</span>
              </div>
              {orch.status.lastRunAtMs && (
                <p className="text-xs text-muted-foreground">
                  Last run: {new Date(orch.status.lastRunAtMs).toLocaleString()}
                </p>
              )}
              {orch.recentRuns.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Recent Runs</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {orch.recentRuns.map((r) => (
                      <div key={r.runId} className="p-2 rounded bg-muted/30 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate max-w-[200px]">{r.objective}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            r.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                          }`}>{r.status}</span>
                        </div>
                        <div className="flex gap-3 mt-1 text-muted-foreground">
                          <span>✓ {r.completedTasks}</span>
                          <span>✗ {r.failedTasks}</span>
                          <span>{(r.executionTimeMs / 1000).toFixed(1)}s</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Footer */}
        <div className="text-center py-6 text-xs text-muted-foreground">
          Generated at {o.generatedAt ? new Date(o.generatedAt).toLocaleString() : "—"} · Auto-refreshes every 10s
        </div>
      </div>
    </div>
  );
}
