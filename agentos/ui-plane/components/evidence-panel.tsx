// AgentOS Evidence Panel - Citations, sources, confidence, and provenance
import React, { useCallback, useMemo, useState } from "react";
import type { EvidenceCard, EvidenceSource, ProvenanceChain } from "../types";

// --- Types ---

export interface EvidencePanelProps {
  evidence: EvidenceCard[];
  onSourceClick?: (source: EvidenceSource) => void;
  onCardSelect?: (card: EvidenceCard) => void;
  className?: string;
}

type SortMode = "confidence" | "recency" | "sources";
type FilterMode = "all" | "high" | "medium" | "low";

function confidenceTier(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

// --- Sub-components ---

const ConfidenceBadge: React.FC<{ confidence: number }> = ({ confidence }) => {
  const tier = confidenceTier(confidence);
  const colors = {
    high: "bg-emerald-100 text-emerald-700 border-emerald-200",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    low: "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors[tier]}`}>
      {Math.round(confidence * 100)}%
    </span>
  );
};

const SourceTypeIcon: React.FC<{ type: EvidenceSource["type"] }> = ({ type }) => {
  const icons: Record<EvidenceSource["type"], string> = {
    url: "\uD83C\uDF10",
    document: "\uD83D\uDCC4",
    api: "\u26A1",
    tool_output: "\uD83D\uDD27",
    model_reasoning: "\uD83E\uDDE0",
  };
  return <span className="text-xs" aria-label={type}>{icons[type]}</span>;
};

const SourceItem: React.FC<{
  source: EvidenceSource;
  onClick?: (source: EvidenceSource) => void;
}> = ({ source, onClick }) => (
  <button
    onClick={() => onClick?.(source)}
    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 transition-colors"
  >
    <SourceTypeIcon type={source.type} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-medium text-slate-800">{source.title}</p>
      {source.snippet && (
        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{source.snippet}</p>
      )}
      <p className="mt-0.5 truncate text-[10px] text-slate-400">{source.uri}</p>
    </div>
    <time className="shrink-0 text-[10px] text-slate-400">
      {new Date(source.retrievedAt).toLocaleTimeString()}
    </time>
  </button>
);

const ProvenanceSection: React.FC<{ provenance: ProvenanceChain }> = ({ provenance }) => (
  <div className="mt-2 rounded-md bg-slate-50 px-3 py-2">
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Provenance</p>
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
      <div>
        <span className="text-slate-400">Step:</span>{" "}
        <span className="font-mono text-slate-700">{provenance.stepId.slice(0, 8)}</span>
      </div>
      <div>
        <span className="text-slate-400">Tool:</span>{" "}
        <span className="text-slate-700">{provenance.toolName}</span>
      </div>
      <div>
        <span className="text-slate-400">Model:</span>{" "}
        <span className="text-slate-700">{provenance.modelId}</span>
      </div>
      <div>
        <span className="text-slate-400">Parents:</span>{" "}
        <span className="font-mono text-slate-700">
          {provenance.parentIds.length === 0 ? "none" : provenance.parentIds.map((id) => id.slice(0, 6)).join(", ")}
        </span>
      </div>
      <div className="col-span-2">
        <span className="text-slate-400">Input hash:</span>{" "}
        <span className="font-mono text-slate-600 text-[10px]">{provenance.inputHash.slice(0, 16)}</span>
      </div>
      <div className="col-span-2">
        <span className="text-slate-400">Output hash:</span>{" "}
        <span className="font-mono text-slate-600 text-[10px]">{provenance.outputHash.slice(0, 16)}</span>
      </div>
    </div>
  </div>
);

const EvidenceCardItem: React.FC<{
  card: EvidenceCard;
  onSourceClick?: (source: EvidenceSource) => void;
  onSelect?: (card: EvidenceCard) => void;
}> = ({ card, onSourceClick, onSelect }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-sm"
      role="article"
      aria-label={card.claim}
    >
      <button
        className="flex w-full items-start justify-between px-4 py-3 text-left"
        onClick={() => {
          setExpanded(!expanded);
          onSelect?.(card);
        }}
      >
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-sm font-medium text-slate-900">{card.claim}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {card.sources.length} source{card.sources.length !== 1 && "s"}
            {" \u00B7 "}
            {new Date(card.createdAt).toLocaleTimeString()}
          </p>
        </div>
        <ConfidenceBadge confidence={card.confidence} />
      </button>

      {expanded && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sources</p>
          <div className="space-y-1">
            {card.sources.map((source, i) => (
              <SourceItem key={`${source.uri}-${i}`} source={source} onClick={onSourceClick} />
            ))}
          </div>
          <ProvenanceSection provenance={card.provenance} />
        </div>
      )}
    </div>
  );
};

// --- Main component ---

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  evidence,
  onSourceClick,
  onCardSelect,
  className = "",
}) => {
  const [sortMode, setSortMode] = useState<SortMode>("confidence");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const filtered = useMemo(() => {
    let items = [...evidence];

    if (filterMode !== "all") {
      items = items.filter((card) => confidenceTier(card.confidence) === filterMode);
    }

    items.sort((a, b) => {
      switch (sortMode) {
        case "confidence": return b.confidence - a.confidence;
        case "recency": return b.createdAt - a.createdAt;
        case "sources": return b.sources.length - a.sources.length;
        default: return 0;
      }
    });

    return items;
  }, [evidence, sortMode, filterMode]);

  const avgConfidence = useMemo(() => {
    if (evidence.length === 0) return 0;
    return evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length;
  }, [evidence]);

  return (
    <div className={`flex flex-col rounded-lg border border-slate-200 bg-slate-50 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-white px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Evidence</h3>
          <p className="text-[11px] text-slate-500">
            {evidence.length} claim{evidence.length !== 1 && "s"}
            {" \u00B7 Avg confidence "}
            {Math.round(avgConfidence * 100)}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as FilterMode)}
            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700"
          >
            <option value="all">All</option>
            <option value="high">High (&ge;80%)</option>
            <option value="medium">Medium (50-79%)</option>
            <option value="low">Low (&lt;50%)</option>
          </select>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700"
          >
            <option value="confidence">By confidence</option>
            <option value="recency">By recency</option>
            <option value="sources">By sources</option>
          </select>
        </div>
      </div>

      {/* Cards list */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: 520 }}>
        {filtered.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">No evidence collected yet.</p>
        )}
        {filtered.map((card) => (
          <EvidenceCardItem
            key={card.id}
            card={card}
            onSourceClick={onSourceClick}
            onSelect={onCardSelect}
          />
        ))}
      </div>
    </div>
  );
};

export default EvidencePanel;
