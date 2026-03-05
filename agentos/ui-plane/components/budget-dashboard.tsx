// AgentOS Budget Dashboard - SRE-style observability for agent runs
import React, { useMemo } from "react";
import type { BudgetSnapshot, ModelUsage, SREMetric, MetricDatapoint } from "../types";

// --- Types ---

export interface BudgetDashboardProps {
  budget: BudgetSnapshot;
  metrics?: SREMetric[];
  className?: string;
}

// --- Utility ---

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}c`;
  return `$${usd.toFixed(4)}`;
}

function formatLatency(ms: number): string {
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function percentUsed(used: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function budgetSeverity(pct: number): "ok" | "warn" | "critical" {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "warn";
  return "ok";
}

// --- Sub-components ---

const MetricCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  severity?: "ok" | "warn" | "critical";
}> = ({ label, value, sub, severity = "ok" }) => {
  const borderColor = {
    ok: "border-slate-200",
    warn: "border-amber-300",
    critical: "border-red-300",
  }[severity];

  return (
    <div className={`rounded-lg border ${borderColor} bg-white px-4 py-3`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
};

const ProgressRing: React.FC<{ percent: number; size?: number; strokeWidth?: number }> = ({
  percent,
  size = 64,
  strokeWidth = 5,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const severity = budgetSeverity(percent);

  const strokeColor = {
    ok: "stroke-blue-500",
    warn: "stroke-amber-500",
    critical: "stroke-red-500",
  }[severity];

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" className="stroke-slate-100" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" className={`${strokeColor} transition-all duration-500`}
        strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
      />
    </svg>
  );
};

const Sparkline: React.FC<{ data: MetricDatapoint[]; width?: number; height?: number }> = ({
  data,
  width = 120,
  height = 32,
}) => {
  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d.value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={points} className="text-blue-400" />
    </svg>
  );
};

const ModelBreakdownTable: React.FC<{ models: ModelUsage[] }> = ({ models }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-[11px]">
      <thead>
        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
          <th className="pb-2 pr-4 font-medium">Model</th>
          <th className="pb-2 pr-4 font-medium text-right">Calls</th>
          <th className="pb-2 pr-4 font-medium text-right">In Tokens</th>
          <th className="pb-2 pr-4 font-medium text-right">Out Tokens</th>
          <th className="pb-2 pr-4 font-medium text-right">Cost</th>
          <th className="pb-2 font-medium text-right">Avg Latency</th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => (
          <tr key={model.modelId} className="border-b border-slate-50 text-slate-700">
            <td className="py-1.5 pr-4 font-mono font-medium">{model.modelId}</td>
            <td className="py-1.5 pr-4 text-right">{model.calls}</td>
            <td className="py-1.5 pr-4 text-right">{formatTokens(model.inputTokens)}</td>
            <td className="py-1.5 pr-4 text-right">{formatTokens(model.outputTokens)}</td>
            <td className="py-1.5 pr-4 text-right">{formatCost(model.costUsd)}</td>
            <td className="py-1.5 text-right">{formatLatency(model.avgLatencyMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SREMetricRow: React.FC<{ metric: SREMetric }> = ({ metric }) => {
  const trendArrow = { up: "\u2191", down: "\u2193", stable: "\u2192" }[metric.trend];
  const trendColor = {
    up: metric.name.includes("error") ? "text-red-500" : "text-emerald-500",
    down: metric.name.includes("error") ? "text-emerald-500" : "text-amber-500",
    stable: "text-slate-400",
  }[metric.trend];

  const isBreached = metric.threshold != null && metric.value > metric.threshold;

  return (
    <div className={`flex items-center justify-between rounded-md px-3 py-2 ${isBreached ? "bg-red-50" : "bg-white"}`}>
      <div className="flex items-center gap-3">
        <div>
          <p className="text-xs font-medium text-slate-800">{metric.name}</p>
          <p className="text-[10px] text-slate-500">
            {metric.value.toFixed(2)} {metric.unit}
            {metric.threshold != null && ` / ${metric.threshold} ${metric.unit}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Sparkline data={metric.history} />
        <span className={`text-sm font-bold ${trendColor}`}>{trendArrow}</span>
      </div>
    </div>
  );
};

// --- Main component ---

export const BudgetDashboard: React.FC<BudgetDashboardProps> = ({
  budget,
  metrics = [],
  className = "",
}) => {
  const tokenPct = useMemo(() => percentUsed(budget.usedTokens, budget.totalTokens), [budget]);
  const costPct = useMemo(() => percentUsed(budget.spentCostUsd, budget.totalCostUsd), [budget]);
  const tokenSeverity = budgetSeverity(tokenPct);
  const costSeverity = budgetSeverity(costPct);

  return (
    <div className={`flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 ${className}`}>
      {/* Top metrics row */}
      <div className="flex items-center gap-4">
        <div className="relative flex items-center justify-center">
          <ProgressRing percent={tokenPct} />
          <span className="absolute text-xs font-bold text-slate-700">{tokenPct}%</span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            label="Tokens Used"
            value={formatTokens(budget.usedTokens)}
            sub={`of ${formatTokens(budget.totalTokens)}`}
            severity={tokenSeverity}
          />
          <MetricCard
            label="Cost"
            value={formatCost(budget.spentCostUsd)}
            sub={`of ${formatCost(budget.totalCostUsd)}`}
            severity={costSeverity}
          />
          <MetricCard
            label="Latency P50"
            value={formatLatency(budget.latencyP50Ms)}
            sub={`P99: ${formatLatency(budget.latencyP99Ms)}`}
          />
          <MetricCard label="Model Calls" value={String(budget.modelCalls)} />
        </div>
      </div>

      {/* Model breakdown */}
      {budget.modelBreakdown.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <h4 className="mb-2 text-xs font-semibold text-slate-700">Model Breakdown</h4>
          <ModelBreakdownTable models={budget.modelBreakdown} />
        </div>
      )}

      {/* SRE metrics */}
      {metrics.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-slate-700">SRE Metrics</h4>
          <div className="space-y-1">
            {metrics.map((metric) => (
              <SREMetricRow key={metric.name} metric={metric} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetDashboard;
