// Auto-fused from Flowise concepts (https://github.com/FlowiseAI/Flowise.git)
// Strategy: port-concept — pure TS reimplementation of core node-graph patterns

// ── Node Types ──

export type NodeType = 'source' | 'transform' | 'merge' | 'filter' | 'output';

export interface GraphNode {
  id: string;
  type: NodeType;
  config: Record<string, any>;
  label?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Execution Result ──

export interface NodeResult {
  nodeId: string;
  type: NodeType;
  output: any;
  durationMs: number;
}

export interface FlowResult {
  nodeResults: NodeResult[];
  outputs: Record<string, any>;
  finalOutput: any;
  totalDurationMs: number;
  metadata: {
    nodesExecuted: number;
    edgesTraversed: number;
  };
}

// ── Topological Sort ──

function topologicalSort(graph: FlowGraph): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    // Visit all dependencies (nodes that feed into this node)
    const deps = graph.edges.filter(e => e.to === nodeId).map(e => e.from);
    for (const dep of deps) {
      visit(dep);
    }
    result.push(nodeId);
  }

  for (const node of graph.nodes) {
    visit(node.id);
  }

  return result;
}

// ── Built-in Transforms ──

function applyTransform(input: any, config: Record<string, any>): any {
  const op = config.operation;
  if (op === 'uppercase') return String(input).toUpperCase();
  if (op === 'lowercase') return String(input).toLowerCase();
  if (op === 'trim') return String(input).trim();
  if (op === 'split') return String(input).split(config.delimiter || ',').map((s: string) => s.trim());
  if (op === 'join') return Array.isArray(input) ? input.join(config.delimiter || ', ') : String(input);
  if (op === 'replace') return String(input).split(config.find || '').join(config.replace || '');
  if (op === 'regex_extract') {
    const match = String(input).match(new RegExp(config.pattern || '.*'));
    return match ? (match[1] || match[0]) : null;
  }
  if (op === 'json_parse') {
    try { return JSON.parse(String(input)); } catch { return input; }
  }
  if (op === 'json_stringify') {
    return JSON.stringify(input, null, config.indent || 0);
  }
  if (op === 'template') {
    let result = String(config.template || '');
    if (typeof input === 'object' && input !== null) {
      for (const [key, value] of Object.entries(input)) {
        result = result.split(`{${key}}`).join(String(value));
      }
    } else {
      result = result.split('{value}').join(String(input));
    }
    return result;
  }
  if (op === 'map' && Array.isArray(input) && config.expression) {
    return input.map((item: any) => {
      if (config.expression === 'uppercase') return String(item).toUpperCase();
      if (config.expression === 'lowercase') return String(item).toLowerCase();
      if (config.expression === 'trim') return String(item).trim();
      return item;
    });
  }
  // Custom function (safe subset)
  if (op === 'length') return Array.isArray(input) ? input.length : String(input).length;
  if (op === 'reverse') return Array.isArray(input) ? [...input].reverse() : String(input).split('').reverse().join('');
  if (op === 'unique') return Array.isArray(input) ? [...new Set(input)] : input;
  if (op === 'sort') return Array.isArray(input) ? [...input].sort() : input;
  if (op === 'flatten') return Array.isArray(input) ? input.flat(config.depth || 1) : input;
  if (op === 'slice') return Array.isArray(input) || typeof input === 'string'
    ? input.slice(config.start || 0, config.end)
    : input;

  return input;
}

// ── Merge Strategies ──

function mergeInputs(inputs: any[], config: Record<string, any>): any {
  const strategy = config.strategy || 'concat';
  if (strategy === 'concat') {
    return inputs.map(i => typeof i === 'string' ? i : JSON.stringify(i)).join(config.separator || '\n');
  }
  if (strategy === 'object') {
    const keys = config.keys || inputs.map((_: any, i: number) => `input_${i}`);
    return Object.fromEntries(keys.map((k: string, i: number) => [k, inputs[i]]));
  }
  if (strategy === 'array') return inputs;
  if (strategy === 'first_non_null') return inputs.find(i => i != null) ?? null;
  if (strategy === 'deep_merge') {
    return inputs.reduce((acc, item) => {
      if (typeof acc === 'object' && typeof item === 'object' && !Array.isArray(acc)) {
        return { ...acc, ...item };
      }
      return item;
    }, {});
  }
  return inputs;
}

// ── Filter Logic ──

function applyFilter(input: any, config: Record<string, any>): any {
  if (!Array.isArray(input)) return input;
  const condition = config.condition;
  if (condition === 'truthy') return input.filter(Boolean);
  if (condition === 'non_empty') return input.filter((i: any) => i !== '' && i != null);
  if (condition === 'contains' && config.value) {
    return input.filter((i: any) => String(i).includes(config.value));
  }
  if (condition === 'not_contains' && config.value) {
    return input.filter((i: any) => !String(i).includes(config.value));
  }
  if (condition === 'min_length' && config.length) {
    return input.filter((i: any) => String(i).length >= config.length);
  }
  return input;
}

// ── Graph Executor ──

export async function executeFlow(
  graph: FlowGraph,
  inputs: Record<string, any>,
): Promise<FlowResult> {
  const start = Date.now();
  const nodeOutputs = new Map<string, any>();
  const nodeResults: NodeResult[] = [];

  const sortedIds = topologicalSort(graph);

  for (const nodeId of sortedIds) {
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    const nodeStart = Date.now();
    const incomingEdges = graph.edges.filter(e => e.to === nodeId);
    const nodeInputs = incomingEdges.map(e => nodeOutputs.get(e.from));

    let output: any;

    switch (node.type) {
      case 'source':
        output = inputs[node.config.key] ?? node.config.defaultValue ?? null;
        break;

      case 'transform':
        output = applyTransform(
          nodeInputs.length === 1 ? nodeInputs[0] : nodeInputs,
          node.config,
        );
        break;

      case 'merge':
        output = mergeInputs(nodeInputs, node.config);
        break;

      case 'filter':
        output = applyFilter(
          nodeInputs.length === 1 ? nodeInputs[0] : nodeInputs,
          node.config,
        );
        break;

      case 'output':
        output = nodeInputs.length === 1 ? nodeInputs[0] : nodeInputs;
        break;
    }

    nodeOutputs.set(nodeId, output);
    nodeResults.push({
      nodeId,
      type: node.type,
      output,
      durationMs: Date.now() - nodeStart,
    });
  }

  // Collect output nodes
  const outputNodes = graph.nodes.filter(n => n.type === 'output');
  const outputs: Record<string, any> = {};
  for (const oNode of outputNodes) {
    outputs[oNode.id] = nodeOutputs.get(oNode.id);
  }

  const finalOutput = outputNodes.length === 1
    ? nodeOutputs.get(outputNodes[0].id)
    : outputs;

  return {
    nodeResults,
    outputs,
    finalOutput,
    totalDurationMs: Date.now() - start,
    metadata: {
      nodesExecuted: nodeResults.length,
      edgesTraversed: graph.edges.length,
    },
  };
}

// ── Graph Builder (fluent API) ──

export class FlowBuilder {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];

  addSource(id: string, key: string, defaultValue?: any): this {
    this.nodes.push({ id, type: 'source', config: { key, defaultValue } });
    return this;
  }

  addTransform(id: string, operation: string, config: Record<string, any> = {}): this {
    this.nodes.push({ id, type: 'transform', config: { operation, ...config } });
    return this;
  }

  addMerge(id: string, strategy: string, config: Record<string, any> = {}): this {
    this.nodes.push({ id, type: 'merge', config: { strategy, ...config } });
    return this;
  }

  addFilter(id: string, condition: string, config: Record<string, any> = {}): this {
    this.nodes.push({ id, type: 'filter', config: { condition, ...config } });
    return this;
  }

  addOutput(id: string): this {
    this.nodes.push({ id, type: 'output', config: {} });
    return this;
  }

  connect(from: string, to: string): this {
    this.edges.push({ from, to });
    return this;
  }

  build(): FlowGraph {
    return { nodes: this.nodes, edges: this.edges };
  }
}
