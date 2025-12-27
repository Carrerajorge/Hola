export type ToolCategory = 'users' | 'ai_models' | 'payments' | 'analytics' | 'database' | 'security' | 'reports' | 'settings';

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  capabilities: string[];
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  isEnabled: boolean;
  usageCount: number;
  successRate: number;
  healthStatus: 'healthy' | 'degraded' | 'disabled';
  failureCount: number;
  lastFailure?: Date;
}

export class ToolRegistryService {
  private tools: Map<string, ToolDefinition>;
  private capabilityIndex: Map<string, string[]> = new Map();

  private readonly FAILURE_THRESHOLD = 0.2;
  private readonly MIN_CALLS_FOR_DISABLE = 10;

  constructor() {
    this.tools = new Map();
    this.initializeTools();
    this.buildCapabilityIndex();
  }

  private buildCapabilityIndex(): void {
    this.capabilityIndex.clear();
    for (const tool of this.tools.values()) {
      for (const capability of tool.capabilities) {
        const keywords = capability.toLowerCase().split(/\s+/);
        for (const keyword of keywords) {
          const existing = this.capabilityIndex.get(keyword) || [];
          if (!existing.includes(tool.id)) {
            existing.push(tool.id);
          }
          this.capabilityIndex.set(keyword, existing);
        }
      }
    }
  }

  searchByCapability(keyword: string): ToolDefinition[] {
    const normalizedKeyword = keyword.toLowerCase().trim();
    const toolIds = this.capabilityIndex.get(normalizedKeyword) || [];
    return toolIds.map(id => this.tools.get(id)!).filter(Boolean);
  }

  private initializeTools(): void {
    const toolDefinitions: ToolDefinition[] = [
      {
        id: 'list_users',
        name: 'List Users',
        description: 'Retrieve all users in the system with their details',
        category: 'users',
        capabilities: ['view users', 'list users', 'get all users', 'ver usuarios', 'listar usuarios'],
        endpoint: '/api/admin/users',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_user',
        name: 'Get User',
        description: 'Get a specific user by ID',
        category: 'users',
        capabilities: ['get user', 'view user details', 'obtener usuario', 'ver usuario'],
        endpoint: '/api/admin/users/:id',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'create_user',
        name: 'Create User',
        description: 'Create a new user account',
        category: 'users',
        capabilities: ['create user', 'add user', 'new user', 'crear usuario', 'agregar usuario'],
        endpoint: '/api/admin/users',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'update_user',
        name: 'Update User',
        description: 'Update user information',
        category: 'users',
        capabilities: ['update user', 'modify user', 'edit user', 'actualizar usuario', 'editar usuario'],
        endpoint: '/api/admin/users/:id',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'delete_user',
        name: 'Delete User',
        description: 'Delete a user from the system',
        category: 'users',
        capabilities: ['delete user', 'remove user', 'eliminar usuario', 'borrar usuario'],
        endpoint: '/api/admin/users/:id',
        method: 'DELETE',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_models',
        name: 'List AI Models',
        description: 'List all available AI models',
        category: 'ai_models',
        capabilities: ['list models', 'view models', 'get models', 'listar modelos', 'ver modelos'],
        endpoint: '/api/admin/models',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'enable_model',
        name: 'Enable Model',
        description: 'Enable an AI model for use',
        category: 'ai_models',
        capabilities: ['enable model', 'activate model', 'activar modelo', 'habilitar modelo'],
        endpoint: '/api/admin/models/:id/toggle',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'disable_model',
        name: 'Disable Model',
        description: 'Disable an AI model',
        category: 'ai_models',
        capabilities: ['disable model', 'deactivate model', 'desactivar modelo', 'deshabilitar modelo'],
        endpoint: '/api/admin/models/:id/toggle',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'sync_models',
        name: 'Sync Models',
        description: 'Synchronize AI models from providers',
        category: 'ai_models',
        capabilities: ['sync models', 'synchronize models', 'sincronizar modelos'],
        endpoint: '/api/admin/models/sync',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_dashboard',
        name: 'Get Dashboard',
        description: 'Retrieve dashboard metrics and statistics',
        category: 'analytics',
        capabilities: ['get dashboard', 'view analytics', 'metrics', 'ver dashboard', 'métricas', 'estadísticas'],
        endpoint: '/api/admin/dashboard',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_realtime_metrics',
        name: 'Get Realtime Metrics',
        description: 'Get real-time analytics and KPIs',
        category: 'analytics',
        capabilities: ['realtime metrics', 'live metrics', 'kpi', 'métricas en tiempo real'],
        endpoint: '/api/admin/analytics/realtime',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'health_check',
        name: 'Database Health Check',
        description: 'Check database connection and health status',
        category: 'database',
        capabilities: ['health check', 'database status', 'db health', 'estado base de datos'],
        endpoint: '/api/admin/database/health',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_tables',
        name: 'List Tables',
        description: 'List all database tables with statistics',
        category: 'database',
        capabilities: ['list tables', 'view tables', 'tablas', 'listar tablas'],
        endpoint: '/api/admin/database/tables',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'execute_query',
        name: 'Execute Query',
        description: 'Execute a SQL query on the database',
        category: 'database',
        capabilities: ['execute query', 'run query', 'sql', 'ejecutar consulta'],
        endpoint: '/api/admin/database/query',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_indexes',
        name: 'Get Indexes',
        description: 'Get database index information',
        category: 'database',
        capabilities: ['get indexes', 'view indexes', 'índices', 'ver índices'],
        endpoint: '/api/admin/database/indexes',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_policies',
        name: 'List Security Policies',
        description: 'List all security policies',
        category: 'security',
        capabilities: ['list policies', 'security policies', 'políticas de seguridad', 'listar políticas'],
        endpoint: '/api/admin/security/policies',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'create_policy',
        name: 'Create Security Policy',
        description: 'Create a new security policy',
        category: 'security',
        capabilities: ['create policy', 'add policy', 'crear política', 'agregar política'],
        endpoint: '/api/admin/security/policies',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'update_policy',
        name: 'Update Security Policy',
        description: 'Update an existing security policy',
        category: 'security',
        capabilities: ['update policy', 'modify policy', 'actualizar política', 'modificar política'],
        endpoint: '/api/admin/security/policies/:id',
        method: 'PUT',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'delete_policy',
        name: 'Delete Security Policy',
        description: 'Delete a security policy',
        category: 'security',
        capabilities: ['delete policy', 'remove policy', 'eliminar política', 'borrar política'],
        endpoint: '/api/admin/security/policies/:id',
        method: 'DELETE',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_audit_logs',
        name: 'Get Audit Logs',
        description: 'Retrieve security audit logs',
        category: 'security',
        capabilities: ['audit logs', 'security logs', 'logs de auditoría', 'registros de seguridad'],
        endpoint: '/api/admin/security/audit-logs',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_security_stats',
        name: 'Get Security Stats',
        description: 'Get security statistics and alerts',
        category: 'security',
        capabilities: ['security stats', 'security metrics', 'estadísticas de seguridad', 'alertas de seguridad'],
        endpoint: '/api/admin/security/stats',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_templates',
        name: 'List Report Templates',
        description: 'List all available report templates',
        category: 'reports',
        capabilities: ['list templates', 'report templates', 'plantillas de reporte', 'listar plantillas'],
        endpoint: '/api/admin/reports/templates',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'generate_report',
        name: 'Generate Report',
        description: 'Generate a new report from template',
        category: 'reports',
        capabilities: ['generate report', 'create report', 'generar reporte', 'crear reporte'],
        endpoint: '/api/admin/reports/generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_generated',
        name: 'List Generated Reports',
        description: 'List all generated reports',
        category: 'reports',
        capabilities: ['list reports', 'generated reports', 'reportes generados', 'listar reportes'],
        endpoint: '/api/admin/reports/generated',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'download_report',
        name: 'Download Report',
        description: 'Download a generated report',
        category: 'reports',
        capabilities: ['download report', 'export report', 'descargar reporte', 'exportar reporte'],
        endpoint: '/api/admin/reports/download/:id',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_settings',
        name: 'Get Settings',
        description: 'Retrieve all platform settings',
        category: 'settings',
        capabilities: ['get settings', 'view settings', 'configuration', 'obtener configuración', 'ver ajustes'],
        endpoint: '/api/admin/settings',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'update_setting',
        name: 'Update Setting',
        description: 'Update a specific setting value',
        category: 'settings',
        capabilities: ['update setting', 'change setting', 'actualizar configuración', 'cambiar ajuste'],
        endpoint: '/api/admin/settings/:key',
        method: 'PUT',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'bulk_update',
        name: 'Bulk Update Settings',
        description: 'Update multiple settings at once',
        category: 'settings',
        capabilities: ['bulk update', 'update all settings', 'actualización masiva', 'actualizar todo'],
        endpoint: '/api/admin/settings/bulk',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      }
    ];

    for (const tool of toolDefinitions) {
      this.tools.set(tool.id, tool);
    }
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolById(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  getToolsByCategory(category: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.category === category
    );
  }

  incrementUsage(toolId: string, success: boolean): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;

    tool.usageCount++;
    if (!success) {
      tool.failureCount = (tool.failureCount || 0) + 1;
      tool.lastFailure = new Date();
    }

    const failureRate = tool.failureCount / tool.usageCount;
    tool.successRate = Math.round((1 - failureRate) * 100);

    if (tool.usageCount >= this.MIN_CALLS_FOR_DISABLE && failureRate > this.FAILURE_THRESHOLD) {
      tool.healthStatus = 'disabled';
      tool.isEnabled = false;
      console.warn(`[ToolRegistry] Auto-disabled tool ${toolId} due to high failure rate: ${(failureRate * 100).toFixed(1)}%`);
    } else if (failureRate > 0.1) {
      tool.healthStatus = 'degraded';
    } else {
      tool.healthStatus = 'healthy';
    }
  }

  enableTool(toolId: string): boolean {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.isEnabled = true;
      tool.healthStatus = 'healthy';
      tool.failureCount = 0;
      return true;
    }
    return false;
  }

  searchTools(query: string): ToolDefinition[] {
    const normalizedQuery = query.toLowerCase().trim();
    return Array.from(this.tools.values()).filter(tool => {
      const matchesName = tool.name.toLowerCase().includes(normalizedQuery);
      const matchesDescription = tool.description.toLowerCase().includes(normalizedQuery);
      const matchesCapabilities = tool.capabilities.some(cap => 
        cap.toLowerCase().includes(normalizedQuery)
      );
      return matchesName || matchesDescription || matchesCapabilities;
    });
  }
}

export const toolRegistry = new ToolRegistryService();
