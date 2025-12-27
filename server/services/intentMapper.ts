import { ToolRegistryService, ToolDefinition, ToolCategory } from './toolRegistry';

export interface IntentMatch {
  toolId: string;
  confidence: number;
  reason: string;
}

export interface IntentResult {
  intent: string;
  matches: IntentMatch[];
  hasGap: boolean;
  gapReason?: string;
}

interface KeywordMapping {
  keywords: string[];
  category: ToolCategory;
  intentDescription: string;
}

const KEYWORD_MAPPINGS: KeywordMapping[] = [
  {
    keywords: ['usuarios', 'users', 'user', 'usuario', 'crear usuario', 'create user', 'eliminar usuario', 'delete user', 'listar usuarios', 'list users', 'actualizar usuario', 'update user', 'nuevo usuario', 'new user'],
    category: 'users',
    intentDescription: 'User management'
  },
  {
    keywords: ['modelos', 'models', 'model', 'activar modelo', 'enable model', 'desactivar modelo', 'disable model', 'sincronizar modelos', 'sync models', 'ai', 'ia'],
    category: 'ai_models',
    intentDescription: 'AI Model management'
  },
  {
    keywords: ['reporte', 'report', 'reports', 'generar reporte', 'generate report', 'descargar reporte', 'download report', 'plantillas', 'templates', 'exportar', 'export'],
    category: 'reports',
    intentDescription: 'Report generation'
  },
  {
    keywords: ['seguridad', 'security', 'políticas', 'policies', 'policy', 'audit', 'auditoría', 'alertas', 'alerts', 'logs'],
    category: 'security',
    intentDescription: 'Security management'
  },
  {
    keywords: ['configuración', 'configuration', 'settings', 'ajustes', 'config', 'preferencias', 'preferences'],
    category: 'settings',
    intentDescription: 'Settings configuration'
  },
  {
    keywords: ['base de datos', 'database', 'db', 'tablas', 'tables', 'query', 'consulta', 'índices', 'indexes', 'sql'],
    category: 'database',
    intentDescription: 'Database operations'
  },
  {
    keywords: ['métricas', 'metrics', 'analytics', 'analíticas', 'estadísticas', 'statistics', 'dashboard', 'kpi', 'rendimiento', 'performance'],
    category: 'analytics',
    intentDescription: 'Analytics and metrics'
  },
  {
    keywords: ['pagos', 'payments', 'payment', 'facturación', 'billing', 'invoices', 'facturas', 'transacciones', 'transactions'],
    category: 'payments',
    intentDescription: 'Payment management'
  }
];

const ACTION_KEYWORDS: Record<string, string[]> = {
  list: ['listar', 'list', 'ver', 'view', 'mostrar', 'show', 'obtener', 'get', 'todos', 'all'],
  create: ['crear', 'create', 'nuevo', 'new', 'agregar', 'add', 'insertar', 'insert'],
  update: ['actualizar', 'update', 'modificar', 'modify', 'editar', 'edit', 'cambiar', 'change'],
  delete: ['eliminar', 'delete', 'borrar', 'remove', 'quitar'],
  enable: ['activar', 'enable', 'habilitar', 'encender', 'turn on'],
  disable: ['desactivar', 'disable', 'deshabilitar', 'apagar', 'turn off'],
  generate: ['generar', 'generate', 'crear reporte', 'create report', 'exportar', 'export'],
  sync: ['sincronizar', 'sync', 'synchronize', 'actualizar modelos', 'refresh']
};

export class IntentToolMapper {
  private toolRegistry: ToolRegistryService;

  constructor(toolRegistry: ToolRegistryService) {
    this.toolRegistry = toolRegistry;
  }

  map(userPrompt: string): IntentResult {
    const normalizedPrompt = userPrompt.toLowerCase().trim();
    const matches: IntentMatch[] = [];
    let detectedCategory: ToolCategory | null = null;
    let intentDescription = 'Unknown intent';

    for (const mapping of KEYWORD_MAPPINGS) {
      for (const keyword of mapping.keywords) {
        if (normalizedPrompt.includes(keyword)) {
          detectedCategory = mapping.category;
          intentDescription = mapping.intentDescription;
          break;
        }
      }
      if (detectedCategory) break;
    }

    if (detectedCategory) {
      const categoryTools = this.toolRegistry.getToolsByCategory(detectedCategory);
      const action = this.detectAction(normalizedPrompt);

      for (const tool of categoryTools) {
        const confidence = this.calculateConfidence(normalizedPrompt, tool, action);
        if (confidence > 0) {
          matches.push({
            toolId: tool.id,
            confidence,
            reason: this.generateReason(tool, action)
          });
        }
      }

      matches.sort((a, b) => b.confidence - a.confidence);
    }

    const bestMatch = matches[0];
    const hasGap = !bestMatch || bestMatch.confidence < 0.3;

    return {
      intent: intentDescription,
      matches,
      hasGap,
      gapReason: hasGap 
        ? this.generateGapReason(normalizedPrompt, detectedCategory) 
        : undefined
    };
  }

  private detectAction(prompt: string): string | null {
    for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
      if (keywords.some(k => prompt.includes(k))) {
        return action;
      }
    }
    return null;
  }

  private calculateConfidence(prompt: string, tool: ToolDefinition, action: string | null): number {
    let confidence = 0.1;

    for (const capability of tool.capabilities) {
      if (prompt.includes(capability.toLowerCase())) {
        confidence += 0.4;
        break;
      }
    }

    if (tool.name.toLowerCase().split(' ').some(word => prompt.includes(word))) {
      confidence += 0.2;
    }

    if (action) {
      const toolAction = tool.id.split('_')[0];
      const actionMatch = 
        (action === 'list' && toolAction === 'list') ||
        (action === 'create' && (toolAction === 'create' || toolAction === 'generate')) ||
        (action === 'update' && (toolAction === 'update' || toolAction === 'bulk')) ||
        (action === 'delete' && toolAction === 'delete') ||
        (action === 'enable' && toolAction === 'enable') ||
        (action === 'disable' && toolAction === 'disable') ||
        (action === 'generate' && (toolAction === 'generate' || toolAction === 'download')) ||
        (action === 'sync' && toolAction === 'sync');

      if (actionMatch) {
        confidence += 0.3;
      }
    }

    return Math.min(confidence, 1);
  }

  private generateReason(tool: ToolDefinition, action: string | null): string {
    if (action) {
      return `Matched '${action}' action to ${tool.name}`;
    }
    return `Category match: ${tool.name} (${tool.category})`;
  }

  private generateGapReason(prompt: string, category: ToolCategory | null): string {
    if (!category) {
      return `No category could be determined from the prompt: "${prompt.substring(0, 50)}..."`;
    }
    return `Intent detected for '${category}' category but no specific tool matched with high confidence. The request may require a new capability.`;
  }
}
