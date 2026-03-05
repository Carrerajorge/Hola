// AgentOS DAG Visualizer - Directed graph plan visualization
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DAGNode, DAGEdge, NodeStatus, DAGState } from "../types";

// --- Layout constants ---
const NODE_WIDTH = 160;
const NODE_HEIGHT = 48;
const GRID_SNAP = 20;

// --- Types ---
interface ViewBox {
  x: number;
  y: number;
  zoom: number;
}

export interface DAGVisualizerProps {
  dag: DAGState;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  className?: string;
}

// --- Node rendering ---

const nodeStatusStyles: Record<NodeStatus, { bg: string; border: string; text: string }> = {
  pending: { bg: "fill-slate-50", border: "stroke-slate-300", text: "fill-slate-500" },
  running: { bg: "fill-blue-50", border: "stroke-blue-500", text: "fill-blue-700" },
  complete: { bg: "fill-emerald-50", border: "stroke-emerald-500", text: "fill-emerald-700" },
  failed: { bg: "fill-red-50", border: "stroke-red-400", text: "fill-red-700" },
  skipped: { bg: "fill-gray-50", border: "stroke-gray-300", text: "fill-gray-400" },
};

const nodeTypeIcons: Record<DAGNode["type"], string> = {
  action: "\u25B6",
  decision: "\u25C6",
  parallel: "\u2261",
  checkpoint: "\u2691",
};

const DAGNodeComponent: React.FC<{
  node: DAGNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
}> = ({ node, isSelected, onSelect, onDoubleClick }) => {
  const styles = nodeStatusStyles[node.status];

  return (
    <g
      transform={`translate(${node.position.x}, ${node.position.y})`}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onDoubleClick(node.id)}
      className="cursor-pointer"
      role="button"
      aria-label={`${node.label} - ${node.status}`}
      tabIndex={0}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={8}
        ry={8}
        className={`${styles.bg} ${styles.border} ${isSelected ? "stroke-2" : "stroke-1"}`}
        strokeDasharray={node.status === "running" ? "4 2" : undefined}
      >
        {node.status === "running" && (
          <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1s" repeatCount="indefinite" />
        )}
      </rect>

      <text x={12} y={20} className={`${styles.text} text-[10px]`}>
        {nodeTypeIcons[node.type]}
      </text>

      <text x={28} y={20} className={`${styles.text} text-[11px] font-medium`}>
        {node.label.length > 16 ? node.label.slice(0, 15) + "\u2026" : node.label}
      </text>

      <text x={28} y={36} className="fill-slate-400 text-[9px]">
        {node.toolName ?? node.type}
        {node.durationMs != null && ` \u00B7 ${node.durationMs}ms`}
      </text>

      {node.retryCount > 0 && (
        <g transform={`translate(${NODE_WIDTH - 20}, 4)`}>
          <circle cx={8} cy={8} r={8} className="fill-amber-100 stroke-amber-400 stroke-1" />
          <text x={8} y={12} textAnchor="middle" className="fill-amber-700 text-[9px] font-bold">
            {node.retryCount}
          </text>
        </g>
      )}
    </g>
  );
};

// --- Edge rendering ---

function computeEdgePath(source: DAGNode, target: DAGNode): string {
  const sx = source.position.x + NODE_WIDTH;
  const sy = source.position.y + NODE_HEIGHT / 2;
  const tx = target.position.x;
  const ty = target.position.y + NODE_HEIGHT / 2;
  const midX = (sx + tx) / 2;

  return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`;
}

const DAGEdgeComponent: React.FC<{
  edge: DAGEdge;
  sourceNode: DAGNode;
  targetNode: DAGNode;
}> = ({ edge, sourceNode, targetNode }) => {
  const path = computeEdgePath(sourceNode, targetNode);
  const isActive = sourceNode.status === "running" || targetNode.status === "running";

  return (
    <g>
      <path
        d={path}
        fill="none"
        className={`${isActive ? "stroke-blue-400" : "stroke-slate-300"} stroke-1`}
        strokeDasharray={edge.conditional ? "6 3" : undefined}
        markerEnd="url(#arrowhead)"
      />
      {edge.label && (
        <text
          x={(sourceNode.position.x + NODE_WIDTH + targetNode.position.x) / 2}
          y={(sourceNode.position.y + targetNode.position.y) / 2 + NODE_HEIGHT / 2 - 6}
          textAnchor="middle"
          className="fill-slate-400 text-[9px]"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
};

// --- Pan/Zoom hook ---

function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>) {
  const [viewBox, setViewBox] = useState<ViewBox>({ x: 0, y: 0, zoom: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewBox((prev) => ({
      ...prev,
      zoom: Math.max(0.25, Math.min(3, prev.zoom * delta)),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = (e.clientX - panStart.current.x) / viewBox.zoom;
    const dy = (e.clientY - panStart.current.y) / viewBox.zoom;
    panStart.current = { x: e.clientX, y: e.clientY };
    setViewBox((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
  }, [viewBox.zoom]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const resetView = useCallback(() => {
    setViewBox({ x: 0, y: 0, zoom: 1 });
  }, []);

  return { viewBox, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, resetView };
}

// --- Main component ---

export const DAGVisualizer: React.FC<DAGVisualizerProps> = ({
  dag,
  selectedNodeId = null,
  onNodeSelect,
  onNodeDoubleClick,
  className = "",
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { viewBox, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, resetView } =
    usePanZoom(svgRef);

  const nodeMap = useMemo(
    () => new Map(dag.nodes.map((n) => [n.id, n])),
    [dag.nodes]
  );

  const handleSelect = useCallback((id: string) => onNodeSelect?.(id), [onNodeSelect]);
  const handleDblClick = useCallback((id: string) => onNodeDoubleClick?.(id), [onNodeDoubleClick]);

  const stats = useMemo(() => {
    const counts: Record<NodeStatus, number> = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 };
    for (const node of dag.nodes) counts[node.status]++;
    return counts;
  }, [dag.nodes]);

  const svgViewBox = `${viewBox.x} ${viewBox.y} ${800 / viewBox.zoom} ${500 / viewBox.zoom}`;

  return (
    <div className={`flex flex-col rounded-lg border border-slate-200 bg-white ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Plan DAG</h3>
          <span className="text-xs text-slate-500">Rev {dag.revision}</span>
        </div>
        <div className="flex items-center gap-2">
          {(["complete", "running", "failed", "pending"] as NodeStatus[]).map((s) => (
            <span key={s} className="text-[10px] text-slate-500">
              <span className={`inline-block mr-0.5 h-2 w-2 rounded-full ${nodeStatusStyles[s].bg.replace("fill-", "bg-")}`} />
              {stats[s]}
            </span>
          ))}
          <button onClick={resetView} className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
            Reset
          </button>
        </div>
      </div>

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        viewBox={svgViewBox}
        className="h-[400px] w-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" className="fill-slate-400" />
          </marker>
        </defs>

        {/* Edges first (below nodes) */}
        <g>
          {dag.edges.map((edge) => {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) return null;
            return <DAGEdgeComponent key={edge.id} edge={edge} sourceNode={src} targetNode={tgt} />;
          })}
        </g>

        {/* Nodes */}
        <g>
          {dag.nodes.map((node) => (
            <DAGNodeComponent
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
              onSelect={handleSelect}
              onDoubleClick={handleDblClick}
            />
          ))}
        </g>
      </svg>
    </div>
  );
};

export default DAGVisualizer;
