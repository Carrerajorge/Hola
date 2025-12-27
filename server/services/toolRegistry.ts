export type ToolCategory = 'users' | 'ai_models' | 'payments' | 'analytics' | 'database' | 'security' | 'reports' | 'settings' | 'integrations' | 'ai_advanced' | 'automation' | 'data' | 'communication';

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
      },
      // INTEGRATIONS TOOLS (7)
      {
        id: 'slack_send',
        name: 'Send to Slack / Enviar a Slack',
        description: 'Send messages, files, and alerts to Slack channels',
        category: 'integrations',
        capabilities: ['send_message', 'send_file', 'send_alert', 'list_channels', 'slack message', 'enviar mensaje slack', 'notificar slack'],
        endpoint: '/api/integrations/slack',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'email_send',
        name: 'Send Email / Enviar Correo',
        description: 'Send emails, templates, and bulk email campaigns',
        category: 'integrations',
        capabilities: ['send_email', 'send_template', 'send_bulk', 'schedule_email', 'email', 'correo', 'enviar email', 'campaña email'],
        endpoint: '/api/integrations/email',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'webhook_trigger',
        name: 'Trigger Webhook / Disparar Webhook',
        description: 'Trigger HTTP webhooks with various methods',
        category: 'integrations',
        capabilities: ['http_post', 'http_get', 'http_put', 'http_delete', 'webhook', 'trigger', 'disparar webhook', 'llamar api'],
        endpoint: '/api/integrations/webhook',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'calendar_event',
        name: 'Manage Calendar / Gestionar Calendario',
        description: 'Create, update, delete, and list calendar events',
        category: 'integrations',
        capabilities: ['create_event', 'update_event', 'delete_event', 'list_events', 'calendar', 'evento', 'calendario', 'cita', 'reunión'],
        endpoint: '/api/integrations/calendar',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'drive_upload',
        name: 'Upload to Drive / Subir a Drive',
        description: 'Upload files, create folders, and share files in cloud storage',
        category: 'integrations',
        capabilities: ['upload_file', 'create_folder', 'share_file', 'list_files', 'drive', 'storage', 'subir archivo', 'almacenamiento'],
        endpoint: '/api/integrations/drive',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'sms_send',
        name: 'Send SMS / Enviar SMS',
        description: 'Send SMS messages and check delivery status',
        category: 'integrations',
        capabilities: ['send_sms', 'send_bulk_sms', 'check_status', 'sms', 'texto', 'mensaje texto', 'enviar sms'],
        endpoint: '/api/integrations/sms',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'push_notification',
        name: 'Push Notification / Notificación Push',
        description: 'Send push notifications to devices and topics',
        category: 'integrations',
        capabilities: ['send_push', 'send_topic', 'schedule_push', 'push', 'notificación', 'notificación push', 'alerta móvil'],
        endpoint: '/api/integrations/push',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // AI_ADVANCED TOOLS (6)
      {
        id: 'image_generate',
        name: 'Generate Image / Generar Imagen',
        description: 'Generate, edit, upscale, and create image variations using AI',
        category: 'ai_advanced',
        capabilities: ['generate_image', 'edit_image', 'upscale', 'variations', 'imagen', 'generar imagen', 'crear imagen', 'dall-e'],
        endpoint: '/api/tools/image-generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'code_review',
        name: 'Review Code / Revisar Código',
        description: 'Analyze code, suggest fixes, scan for security issues and performance',
        category: 'ai_advanced',
        capabilities: ['analyze_code', 'suggest_fixes', 'security_scan', 'performance_check', 'code review', 'revisar código', 'análisis código', 'seguridad código'],
        endpoint: '/api/tools/code-review',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'document_summarize',
        name: 'Summarize Document / Resumir Documento',
        description: 'Summarize documents, extract key points, and generate outlines',
        category: 'ai_advanced',
        capabilities: ['summarize', 'extract_key_points', 'generate_outline', 'resumen', 'resumir', 'puntos clave', 'esquema'],
        endpoint: '/api/tools/document-summarize',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'translate_text',
        name: 'Translate Text / Traducir Texto',
        description: 'Translate text, detect language, and batch translate content',
        category: 'ai_advanced',
        capabilities: ['translate', 'detect_language', 'batch_translate', 'traducir', 'traducción', 'idioma', 'detectar idioma'],
        endpoint: '/api/tools/translate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'sentiment_analysis',
        name: 'Sentiment Analysis / Análisis de Sentimiento',
        description: 'Analyze sentiment, detect emotions, and check toxicity in text',
        category: 'ai_advanced',
        capabilities: ['analyze_sentiment', 'detect_emotions', 'toxicity_check', 'sentimiento', 'emociones', 'análisis sentimiento', 'toxicidad'],
        endpoint: '/api/tools/sentiment',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'entity_extraction',
        name: 'Extract Entities / Extraer Entidades',
        description: 'Extract names, dates, locations, and other entities from text',
        category: 'ai_advanced',
        capabilities: ['extract_names', 'extract_dates', 'extract_locations', 'entidades', 'extraer nombres', 'extraer fechas', 'ner'],
        endpoint: '/api/tools/entity-extraction',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // AUTOMATION TOOLS (5)
      {
        id: 'schedule_task',
        name: 'Schedule Task / Programar Tarea',
        description: 'Schedule one-time or recurring tasks',
        category: 'automation',
        capabilities: ['schedule_once', 'schedule_recurring', 'cancel_scheduled', 'programar', 'tarea programada', 'cron', 'scheduler'],
        endpoint: '/api/tools/schedule-task',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'batch_process',
        name: 'Batch Process / Procesamiento por Lotes',
        description: 'Process users, emails, or reports in batches',
        category: 'automation',
        capabilities: ['batch_users', 'batch_emails', 'batch_reports', 'lotes', 'procesamiento masivo', 'bulk process'],
        endpoint: '/api/tools/batch-process',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'workflow_manage',
        name: 'Manage Workflow / Gestionar Flujo de Trabajo',
        description: 'Create, update, and trigger automated workflows',
        category: 'automation',
        capabilities: ['create_workflow', 'update_workflow', 'trigger_workflow', 'flujo trabajo', 'automatización', 'workflow'],
        endpoint: '/api/tools/workflow',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'backup_manage',
        name: 'Manage Backups / Gestionar Respaldos',
        description: 'Create, restore, and list system backups',
        category: 'automation',
        capabilities: ['create_backup', 'restore_backup', 'list_backups', 'respaldo', 'backup', 'copia seguridad', 'restaurar'],
        endpoint: '/api/tools/backup',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'cleanup_data',
        name: 'Data Cleanup / Limpieza de Datos',
        description: 'Clean old data, archive, purge deleted items, and optimize storage',
        category: 'automation',
        capabilities: ['cleanup_old', 'archive_data', 'purge_deleted', 'optimize_storage', 'limpieza', 'archivar', 'purgar', 'optimizar'],
        endpoint: '/api/tools/cleanup',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // DATA TOOLS (6)
      {
        id: 'chart_generate',
        name: 'Generate Chart / Generar Gráfico',
        description: 'Generate various types of charts and visualizations',
        category: 'data',
        capabilities: ['line_chart', 'bar_chart', 'pie_chart', 'area_chart', 'scatter_plot', 'gráfico', 'chart', 'visualización'],
        endpoint: '/api/tools/chart-generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'csv_export',
        name: 'Export CSV / Exportar CSV',
        description: 'Export data to CSV format',
        category: 'data',
        capabilities: ['export_users', 'export_payments', 'export_analytics', 'csv', 'exportar csv', 'descargar csv'],
        endpoint: '/api/tools/csv-export',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'pdf_generate',
        name: 'Generate PDF / Generar PDF',
        description: 'Generate PDF reports, invoices, and certificates',
        category: 'data',
        capabilities: ['generate_report', 'generate_invoice', 'generate_certificate', 'pdf', 'generar pdf', 'factura pdf', 'reporte pdf'],
        endpoint: '/api/tools/pdf-generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'excel_export',
        name: 'Export Excel / Exportar Excel',
        description: 'Export data to Excel with multiple sheets and charts',
        category: 'data',
        capabilities: ['export_xlsx', 'multi_sheet', 'with_charts', 'excel', 'xlsx', 'exportar excel', 'hoja cálculo'],
        endpoint: '/api/tools/excel-export',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'data_transform',
        name: 'Transform Data / Transformar Datos',
        description: 'Filter, aggregate, pivot, join, map, and reduce data',
        category: 'data',
        capabilities: ['filter', 'aggregate', 'pivot', 'join', 'map', 'reduce', 'transformar', 'filtrar datos', 'agregar datos'],
        endpoint: '/api/tools/data-transform',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'data_import',
        name: 'Import Data / Importar Datos',
        description: 'Import data from CSV, JSON, Excel and validate',
        category: 'data',
        capabilities: ['import_csv', 'import_json', 'import_excel', 'validate_data', 'importar', 'cargar datos', 'subir datos'],
        endpoint: '/api/tools/data-import',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // COMMUNICATION TOOLS (4)
      {
        id: 'template_render',
        name: 'Render Template / Renderizar Plantilla',
        description: 'Render email, SMS, and notification templates with variables',
        category: 'communication',
        capabilities: ['email_template', 'sms_template', 'notification_template', 'plantilla', 'renderizar', 'template', 'variables'],
        endpoint: '/api/tools/template-render',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'broadcast_send',
        name: 'Send Broadcast / Enviar Difusión',
        description: 'Send broadcasts to segments or all users',
        category: 'communication',
        capabilities: ['send_to_segment', 'send_to_all', 'schedule_broadcast', 'difusión', 'broadcast', 'enviar masivo', 'segmento'],
        endpoint: '/api/tools/broadcast',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'notification_manage',
        name: 'Manage Notifications / Gestionar Notificaciones',
        description: 'Create and list system notifications',
        category: 'communication',
        capabilities: ['create_notification', 'list_notifications', 'notificaciones', 'gestionar notificaciones', 'alertas sistema'],
        endpoint: '/api/tools/notifications',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'announcement_create',
        name: 'Create Announcement / Crear Anuncio',
        description: 'Create, schedule, and target announcements to users',
        category: 'communication',
        capabilities: ['create', 'schedule', 'expire', 'target_users', 'anuncio', 'crear anuncio', 'avisos', 'comunicado'],
        endpoint: '/api/tools/announcements',
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
