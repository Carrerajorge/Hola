/**
 * ReactFlow Diagram Engine
 * Node-based diagrams and flowcharts
 */

import React, { useCallback, useMemo, forwardRef, useImperativeHandle, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  BackgroundVariant,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowDiagramConfig } from '../types';

// ============================================
// CUSTOM NODE TYPES
// ============================================

function CustomNode({ data }: NodeProps) {
  const nodeData = data as { label: string; description?: string; icon?: string; color?: string };
  const color = nodeData.color || '#6366f1';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        border: `2px solid ${color}`,
        background: `linear-gradient(135deg, ${color}15, ${color}30)`,
        minWidth: '150px',
        boxShadow: `0 4px 12px ${color}20`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {nodeData.icon && <span style={{ fontSize: '18px' }}>{nodeData.icon}</span>}
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0' }}>
            {nodeData.label}
          </div>
          {nodeData.description && (
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              {nodeData.description}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}

function InputNode({ data }: NodeProps) {
  const nodeData = data as { label: string; description?: string; icon?: string; color?: string };
  const color = nodeData.color || '#10b981';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '12px',
        border: `2px solid ${color}`,
        background: `linear-gradient(135deg, ${color}20, ${color}40)`,
        minWidth: '140px',
        boxShadow: `0 4px 12px ${color}25`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {nodeData.icon && <span style={{ fontSize: '18px' }}>{nodeData.icon}</span>}
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0' }}>
          {nodeData.label}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </div>
  );
}

function OutputNode({ data }: NodeProps) {
  const nodeData = data as { label: string; description?: string; icon?: string; color?: string };
  const color = nodeData.color || '#f59e0b';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '12px',
        border: `2px solid ${color}`,
        background: `linear-gradient(135deg, ${color}20, ${color}40)`,
        minWidth: '140px',
        boxShadow: `0 4px 12px ${color}25`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {nodeData.icon && <span style={{ fontSize: '18px' }}>{nodeData.icon}</span>}
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0' }}>
          {nodeData.label}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  custom: CustomNode,
  input: InputNode,
  output: OutputNode,
};

// ============================================
// DEFAULT DEMO FLOW
// ============================================

function getDefaultNodes(): Node[] {
  return [
    {
      id: '1',
      type: 'input',
      data: { label: 'User Input', icon: '👤', color: '#10b981' },
      position: { x: 250, y: 0 },
    },
    {
      id: '2',
      type: 'custom',
      data: { label: 'AI Processing', description: 'NLP & Intent Detection', icon: '🧠', color: '#6366f1' },
      position: { x: 100, y: 120 },
    },
    {
      id: '3',
      type: 'custom',
      data: { label: 'Knowledge Base', description: 'RAG & Vector Search', icon: '📚', color: '#06b6d4' },
      position: { x: 400, y: 120 },
    },
    {
      id: '4',
      type: 'custom',
      data: { label: 'Tool Execution', description: 'Actions & API Calls', icon: '⚙️', color: '#ec4899' },
      position: { x: 100, y: 260 },
    },
    {
      id: '5',
      type: 'custom',
      data: { label: 'Response Generation', description: 'Streaming & Formatting', icon: '✨', color: '#a855f7' },
      position: { x: 400, y: 260 },
    },
    {
      id: '6',
      type: 'output',
      data: { label: 'Response', icon: '💬', color: '#f59e0b' },
      position: { x: 250, y: 400 },
    },
  ];
}

function getDefaultEdges(): Edge[] {
  return [
    {
      id: 'e1-2', source: '1', target: '2',
      animated: true,
      style: { stroke: '#6366f1' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
    },
    {
      id: 'e1-3', source: '1', target: '3',
      animated: true,
      style: { stroke: '#06b6d4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4' },
    },
    {
      id: 'e2-4', source: '2', target: '4',
      style: { stroke: '#ec4899' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#ec4899' },
    },
    {
      id: 'e3-5', source: '3', target: '5',
      style: { stroke: '#a855f7' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#a855f7' },
    },
    {
      id: 'e4-6', source: '4', target: '6',
      style: { stroke: '#f59e0b' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
    },
    {
      id: 'e5-6', source: '5', target: '6',
      style: { stroke: '#f59e0b' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
    },
    {
      id: 'e2-3', source: '2', target: '3',
      type: 'smoothstep',
      style: { stroke: '#94a3b8', strokeDasharray: '5 5' },
      label: 'context',
    },
  ];
}

// ============================================
// REACT FLOW INNER COMPONENT
// ============================================

interface FlowInnerProps {
  config?: FlowDiagramConfig;
  onNodeClick?: (node: Node) => void;
  onEdgeClick?: (edge: Edge) => void;
}

function FlowInner({ config, onNodeClick, onEdgeClick }: FlowInnerProps) {
  const initialNodes = useMemo(() => {
    if (config?.nodes && config.nodes.length > 0) {
      return config.nodes.map((n) => ({
        id: n.id,
        type: n.type === 'custom' || n.type === 'input' || n.type === 'output' ? n.type : 'custom',
        data: n.data,
        position: n.position,
        style: n.style,
        draggable: n.draggable ?? true,
        selectable: n.selectable ?? true,
        parentId: n.parentId,
      })) as Node[];
    }
    return getDefaultNodes();
  }, [config?.nodes]);

  const initialEdges = useMemo(() => {
    if (config?.edges && config.edges.length > 0) {
      return config.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type || 'smoothstep',
        animated: e.animated,
        label: e.label,
        style: e.style,
        markerEnd: e.markerEnd ? { type: MarkerType.ArrowClosed } : undefined,
      })) as Edge[];
    }
    return getDefaultEdges();
  }, [config?.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: '#6366f1' },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
          },
          eds
        )
      ),
    [setEdges]
  );

  const backgroundVariant = useMemo(() => {
    switch (config?.background) {
      case 'lines':
        return BackgroundVariant.Lines;
      case 'cross':
        return BackgroundVariant.Cross;
      case 'none':
        return undefined;
      default:
        return BackgroundVariant.Dots;
    }
  }, [config?.background]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => onNodeClick?.(node)}
      onEdgeClick={(_, edge) => onEdgeClick?.(edge)}
      nodeTypes={nodeTypes}
      fitView={config?.fitView ?? true}
      snapToGrid={config?.snapToGrid}
      snapGrid={config?.snapGrid}
      proOptions={{ hideAttribution: true }}
      style={{ backgroundColor: '#1a1a2e' }}
    >
      {backgroundVariant && (
        <Background variant={backgroundVariant} gap={16} size={1} color="#333" />
      )}
      {(config?.controls ?? true) && <Controls />}
      {(config?.minimap ?? true) && (
        <MiniMap
          nodeColor={(node) => {
            const nodeData = node.data as { color?: string };
            return nodeData?.color || '#6366f1';
          }}
          style={{ backgroundColor: '#0f0f1a' }}
        />
      )}
    </ReactFlow>
  );
}

// ============================================
// REACT FLOW ENGINE COMPONENT
// ============================================

export interface ReactFlowEngineProps {
  config?: FlowDiagramConfig;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onNodeClick?: (node: Node) => void;
  onEdgeClick?: (edge: Edge) => void;
}

export interface ReactFlowEngineRef {
  fitView: () => void;
}

export const ReactFlowEngine = forwardRef<ReactFlowEngineRef, ReactFlowEngineProps>(
  function ReactFlowEngine(
    { config, width = '100%', height = 500, className, style, onReady, onNodeClick, onEdgeClick },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      fitView: () => {
        // Handled internally by ReactFlow
      },
    }));

    return (
      <div
        className={className}
        style={{
          width,
          height,
          borderRadius: '8px',
          overflow: 'hidden',
          ...style,
        }}
        data-testid="reactflow-engine"
      >
        <ReactFlowProvider>
          <FlowInner config={config} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} />
        </ReactFlowProvider>
      </div>
    );
  }
);
