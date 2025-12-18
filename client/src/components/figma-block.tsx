import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, Plus, Minus, ExternalLink, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FigmaNode {
  id: string;
  type: "start" | "end" | "process" | "decision";
  label: string;
  x: number;
  y: number;
}

interface FigmaConnection {
  from: string;
  to: string;
  label?: string;
}

interface FigmaDiagram {
  nodes: FigmaNode[];
  connections: FigmaConnection[];
  title?: string;
}

interface FigmaBlockProps {
  diagram: FigmaDiagram;
  fileUrl?: string;
}

export function FigmaBlock({ diagram, fileUrl }: FigmaBlockProps) {
  const [zoom, setZoom] = useState(1);
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 2));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));

  const handleEditInFigma = () => {
    if (fileUrl) {
      window.open(fileUrl, '_blank');
    } else {
      // Open Figma new file page
      window.open('https://www.figma.com/files/recents-and-sharing/recently-viewed', '_blank');
      toast({
        title: "Abre Figma",
        description: "Crea un nuevo archivo de diseño y recrea el diagrama mostrado aquí.",
      });
    }
  };

  const handleCopyDiagram = () => {
    const diagramText = diagram.nodes.map(n => `${n.type}: ${n.label}`).join('\n');
    navigator.clipboard.writeText(diagramText);
    setCopied(true);
    toast({
      title: "Diagrama copiado",
      description: "Los pasos del diagrama han sido copiados al portapapeles.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const getNodePath = (node: FigmaNode) => {
    const width = 120;
    const height = 50;
    
    switch (node.type) {
      case "start":
      case "end":
        return `M ${node.x} ${node.y + height/2} 
                Q ${node.x} ${node.y} ${node.x + width/4} ${node.y}
                L ${node.x + width*3/4} ${node.y}
                Q ${node.x + width} ${node.y} ${node.x + width} ${node.y + height/2}
                Q ${node.x + width} ${node.y + height} ${node.x + width*3/4} ${node.y + height}
                L ${node.x + width/4} ${node.y + height}
                Q ${node.x} ${node.y + height} ${node.x} ${node.y + height/2} Z`;
      case "decision":
        const cx = node.x + width/2;
        const cy = node.y + height/2;
        return `M ${cx} ${node.y} L ${node.x + width} ${cy} L ${cx} ${node.y + height} L ${node.x} ${cy} Z`;
      case "process":
      default:
        return `M ${node.x} ${node.y} L ${node.x + width} ${node.y} L ${node.x + width} ${node.y + height} L ${node.x} ${node.y + height} Z`;
    }
  };

  const getNodeCenter = (node: FigmaNode) => ({
    x: node.x + 60,
    y: node.y + 25
  });

  const renderConnection = (conn: FigmaConnection, index: number) => {
    const fromNode = diagram.nodes.find(n => n.id === conn.from);
    const toNode = diagram.nodes.find(n => n.id === conn.to);
    
    if (!fromNode || !toNode) return null;
    
    const from = getNodeCenter(fromNode);
    const to = getNodeCenter(toNode);
    
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    
    return (
      <g key={`conn-${index}`}>
        <defs>
          <marker
            id={`arrowhead-${index}`}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
          </marker>
        </defs>
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#666"
          strokeWidth="2"
          markerEnd={`url(#arrowhead-${index})`}
        />
        {conn.label && (
          <text
            x={midX}
            y={midY - 5}
            textAnchor="middle"
            fontSize="12"
            fill="#F24E1E"
            fontWeight="500"
          >
            {conn.label}
          </text>
        )}
      </g>
    );
  };

  const renderNode = (node: FigmaNode) => {
    const center = getNodeCenter(node);
    const isTerminal = node.type === "start" || node.type === "end";
    
    return (
      <g key={node.id}>
        <path
          d={getNodePath(node)}
          fill={isTerminal ? "#f5f5f5" : "white"}
          stroke={node.type === "decision" ? "#F24E1E" : "#333"}
          strokeWidth="2"
        />
        <text
          x={center.x}
          y={center.y + 5}
          textAnchor="middle"
          fontSize="14"
          fill="#333"
          fontWeight={isTerminal ? "600" : "400"}
        >
          {node.label}
        </text>
      </g>
    );
  };

  const svgWidth = 800;
  const svgHeight = 400;

  return (
    <div className={`relative rounded-xl border bg-card overflow-hidden ${isMaximized ? 'fixed inset-4 z-50' : ''}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <svg width="16" height="24" viewBox="0 0 38 57" fill="none">
            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
          </svg>
          <span className="text-sm font-medium">Figma</span>
        </div>
        <button
          onClick={() => setIsMaximized(!isMaximized)}
          className="p-1 rounded hover:bg-accent"
        >
          {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div 
        className="relative bg-[#f5f5f5] overflow-auto"
        style={{ 
          backgroundImage: 'radial-gradient(circle, #ddd 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          minHeight: isMaximized ? 'calc(100% - 100px)' : '300px'
        }}
      >
        <svg 
          width={svgWidth * zoom} 
          height={svgHeight * zoom}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="mx-auto"
        >
          {diagram.connections.map((conn, i) => renderConnection(conn, i))}
          {diagram.nodes.map(node => renderNode(node))}
        </svg>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleEditInFigma}
            data-testid="button-edit-figma"
          >
            <svg width="12" height="18" viewBox="0 0 38 57" fill="none">
              <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
              <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
              <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
              <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
              <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
            </svg>
            Edit in Figma
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={handleCopyDiagram}
            data-testid="button-copy-diagram"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function parseFigmaDiagram(text: string): FigmaDiagram | null {
  try {
    const match = text.match(/```figma\s*([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

export function generateFlowchartFromDescription(description: string): FigmaDiagram {
  const steps = description.split(/[,;]|\sy\s/).map(s => s.trim()).filter(s => s.length > 0);
  
  const nodes: FigmaNode[] = [
    { id: "start", type: "start", label: "Inicio", x: 50, y: 175 }
  ];
  
  const connections: FigmaConnection[] = [];
  let lastId = "start";
  let xPos = 200;
  
  steps.forEach((step, index) => {
    const id = `step-${index}`;
    const isDecision = step.toLowerCase().includes("decisión") || step.toLowerCase().includes("decision") || step.includes("?");
    
    nodes.push({
      id,
      type: isDecision ? "decision" : "process",
      label: step.length > 15 ? step.substring(0, 15) + "..." : step,
      x: xPos,
      y: 175
    });
    
    connections.push({ from: lastId, to: id });
    lastId = id;
    xPos += 150;
  });
  
  nodes.push({ id: "end", type: "end", label: "Fin", x: xPos, y: 175 });
  connections.push({ from: lastId, to: "end" });
  
  return { nodes, connections };
}
