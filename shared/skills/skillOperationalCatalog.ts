export type SkillCatalogCategory =
  | "documents"
  | "data"
  | "integrations"
  | "custom"
  | "automation";

export type SkillOpsDomain =
  | "document"
  | "data"
  | "integration"
  | "automation"
  | "security"
  | "infrastructure"
  | "engineering"
  | "communication"
  | "business"
  | "media";

export type SkillOrchestratorLane = "brain" | "research" | "speed";
export type SkillOrchestratorExecutionMode = "tool" | "agent" | "hybrid";
export type SkillExecutionReadiness = "ready" | "guarded" | "setup_required" | "disabled";
export type SkillRuntimeBinding =
  | "local_catalog"
  | "skill_platform"
  | "openclaw_runtime"
  | "external_cli"
  | "delegated_agent";

export type SkillScopeHint =
  | "storage.read"
  | "storage.write"
  | "browser"
  | "email"
  | "database"
  | "external_network"
  | "code_interpreter"
  | "files"
  | "system";

export interface SkillOperationalInput {
  id: string;
  name: string;
  description: string;
  category: SkillCatalogCategory;
  features?: string[];
  triggers?: string[];
  builtIn?: boolean;
  enabled?: boolean;
  instructions?: string;
  runtimeTools?: string[];
}

export interface SkillOperationalPhase {
  title: string;
  description: string;
}

export interface SkillOrchestratorProfile {
  lane: SkillOrchestratorLane;
  laneLabel: string;
  executionMode: SkillOrchestratorExecutionMode;
  executionModeLabel: string;
  runtimeBinding: SkillRuntimeBinding;
  runtimeLabel: string;
  readiness: SkillExecutionReadiness;
  readinessLabel: string;
  primaryTools: string[];
  fallbackTools: string[];
  requiredScopes: SkillScopeHint[];
  routingStrategy: string;
  routingNotes: string[];
}

export interface SkillOperationalProfile {
  badgeLabel: string;
  domainKey: SkillOpsDomain;
  domainLabel: string;
  modeLabel: string;
  modeChip: string;
  operatingFunction: string;
  operatorSummary: string;
  inputSurface: string;
  outputSurface: string;
  requirements: string[];
  abilityHighlights: string[];
  searchTerms: string[];
  executionPhases: SkillOperationalPhase[];
  orchestrator: SkillOrchestratorProfile;
}

export interface PlannerSkillSummary {
  id: string;
  name: string;
  description: string;
  badgeLabel: string;
  domainLabel: string;
  lane: SkillOrchestratorLane;
  executionMode: SkillOrchestratorExecutionMode;
  readiness: SkillExecutionReadiness;
  primaryTools: string[];
  fallbackTools: string[];
  requiredScopes: SkillScopeHint[];
  abilities: string[];
  searchTerms: string[];
  routingStrategy: string;
  routingNotes: string[];
}

export interface PlannerSkillContext {
  activeSkill: PlannerSkillSummary | null;
  relevantSkills: PlannerSkillSummary[];
  routingNotes: string[];
}

type CategoryMeta = {
  badgeLabel: string;
  domainKey: SkillOpsDomain;
  domainLabel: string;
  modeLabel: string;
  modeChip: string;
  inputSurface: string;
  outputSurface: string;
  requirements: string[];
  fallbackAbilities: string[];
  phases: [string, string, string];
  orchestrator: {
    lane: SkillOrchestratorLane;
    executionMode: SkillOrchestratorExecutionMode;
    runtimeBinding: SkillRuntimeBinding;
    readiness: SkillExecutionReadiness;
    primaryTools: string[];
    fallbackTools: string[];
    requiredScopes: SkillScopeHint[];
    routingStrategy: string;
    routingNotes: string[];
  };
};

type DomainRule = {
  pattern: RegExp;
  badgeLabel: string;
  domainKey: SkillOpsDomain;
  domainLabel: string;
  modeLabel: string;
  inputSurface: string;
  outputSurface: string;
  requirements: string[];
  orchestrator: Partial<CategoryMeta["orchestrator"]>;
};

type ExactRoutingOverride = {
  ids: string[];
  tools: string[];
  fallbackTools?: string[];
  lane?: SkillOrchestratorLane;
  executionMode?: SkillOrchestratorExecutionMode;
  runtimeBinding?: SkillRuntimeBinding;
  readiness?: SkillExecutionReadiness;
  requiredScopes?: SkillScopeHint[];
  routingStrategy?: string;
  routingNotes?: string[];
};

const CATEGORY_META: Record<SkillCatalogCategory, CategoryMeta> = {
  documents: {
    badgeLabel: "DocOps",
    domainKey: "document",
    domainLabel: "Documentos y conocimiento",
    modeLabel: "Transformacion y entrega de artefactos",
    modeChip: "Entrega",
    inputSurface: "archivos, notas, plantillas o instrucciones estructuradas",
    outputSurface: "documentos, extractos o artefactos listos para usar",
    requirements: ["Acceso al contenido fuente", "Contexto de formato o destino"],
    fallbackAbilities: [
      "Extraccion estructurada de contenido",
      "Transformacion y normalizacion documental",
      "Entrega de artefactos listos para operar",
    ],
    phases: ["Ingesta controlada", "Transformacion", "Entrega verificable"],
    orchestrator: {
      lane: "speed",
      executionMode: "tool",
      runtimeBinding: "local_catalog",
      readiness: "ready",
      primaryTools: ["create_document", "read_file"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["files"],
      routingStrategy: "Prioriza generacion o lectura estructurada de artefactos antes de sintetizar.",
      routingNotes: [
        "Usa herramientas de documentos como primera opcion.",
        "Escala a sintesis solo cuando haya que consolidar multiples fuentes.",
      ],
    },
  },
  data: {
    badgeLabel: "DataOps",
    domainKey: "data",
    domainLabel: "Datos, busqueda e inteligencia",
    modeLabel: "Consulta, analisis y sintesis accionable",
    modeChip: "Analisis",
    inputSurface: "consultas, datasets, indices, logs o contexto semantico",
    outputSurface: "insights, resultados estructurados o visualizaciones accionables",
    requirements: ["Fuente de datos accesible", "Contexto suficiente para filtrar o resumir"],
    fallbackAbilities: [
      "Consulta y exploracion de datos",
      "Analisis y priorizacion de hallazgos",
      "Sintesis ejecutiva de resultados",
    ],
    phases: ["Captura contextual", "Analisis", "Sintesis accionable"],
    orchestrator: {
      lane: "research",
      executionMode: "tool",
      runtimeBinding: "local_catalog",
      readiness: "ready",
      primaryTools: ["analyze_data", "generate_chart", "memory_search", "web_search"],
      fallbackTools: ["fetch_url", "synthesize"],
      requiredScopes: ["files"],
      routingStrategy: "Extrae evidencia primero, analiza despues y sintetiza al final.",
      routingNotes: [
        "Evita ir directo a sintesis cuando exista una herramienta de consulta o analisis.",
        "Usa memoria o web segun la fuente de verdad disponible.",
      ],
    },
  },
  integrations: {
    badgeLabel: "CommOps",
    domainKey: "integration",
    domainLabel: "Integraciones y servicios externos",
    modeLabel: "Lectura y escritura sobre sistemas conectados",
    modeChip: "R/W",
    inputSurface: "credenciales, ids de recursos, payloads o eventos remotos",
    outputSurface: "acciones remotas confirmadas, sincronizaciones o respuestas API",
    requirements: ["Credenciales del servicio", "Conectividad de red y permisos remotos"],
    fallbackAbilities: [
      "Lectura y escritura sobre servicios externos",
      "Sincronizacion de estado entre sistemas",
      "Confirmacion operativa de acciones remotas",
    ],
    phases: ["Autenticacion", "Operacion remota", "Confirmacion de estado"],
    orchestrator: {
      lane: "speed",
      executionMode: "hybrid",
      runtimeBinding: "openclaw_runtime",
      readiness: "setup_required",
      primaryTools: ["openclaw_clawi_exec", "browse_and_act"],
      fallbackTools: ["fetch_url", "synthesize"],
      requiredScopes: ["external_network"],
      routingStrategy: "En integraciones privilegia ejecucion remota o CLI con confirmacion de estado.",
      routingNotes: [
        "La orquestacion debe asumir setup externo y credenciales antes de ejecutar.",
        "Usa navegacion automatizada solo si no existe acceso programatico o CLI.",
      ],
    },
  },
  automation: {
    badgeLabel: "AgentOps",
    domainKey: "automation",
    domainLabel: "Orquestacion y automatizacion",
    modeLabel: "Planificacion, ejecucion y seguimiento multi-etapa",
    modeChip: "Workflow",
    inputSurface: "objetivos, condiciones, disparadores y contexto operativo",
    outputSurface: "flujos ejecutados, acciones encadenadas y resultados trazables",
    requirements: ["Permisos sobre los sistemas destino", "Reglas o disparadores definidos"],
    fallbackAbilities: [
      "Orquestacion multi-etapa",
      "Ejecucion repetible con trazabilidad",
      "Seguimiento y cierre de tareas operativas",
    ],
    phases: ["Plan tactico", "Ejecucion orquestada", "Seguimiento y cierre"],
    orchestrator: {
      lane: "brain",
      executionMode: "hybrid",
      runtimeBinding: "delegated_agent",
      readiness: "guarded",
      primaryTools: ["openclaw_spawn_subagent", "openclaw_subagent_list", "openclaw_clawi_exec"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["external_network", "system"],
      routingStrategy: "Descompone primero, delega workers despues y sintetiza al cierre.",
      routingNotes: [
        "Las skills de automatizacion deben disparar el patron orquestador y no un solo paso monolitico.",
        "Mantiene trazabilidad de subagentes antes de declarar completado el objetivo.",
      ],
    },
  },
  custom: {
    badgeLabel: "SpecialOps",
    domainKey: "automation",
    domainLabel: "Capacidades especializadas del runtime",
    modeLabel: "Ejecucion especializada bajo contexto y permisos",
    modeChip: "Especializado",
    inputSurface: "prompt operativo, contexto del workspace y permisos de ejecucion",
    outputSurface: "respuesta especializada o accion tecnica de alto valor",
    requirements: ["Entorno compatible", "Contexto suficiente para ejecutar con seguridad"],
    fallbackAbilities: [
      "Ejecucion especializada de runtime",
      "Adaptacion al contexto operativo actual",
      "Entrega de resultados listos para accion",
    ],
    phases: ["Contextualizacion", "Ejecucion especializada", "Respuesta estructurada"],
    orchestrator: {
      lane: "brain",
      executionMode: "hybrid",
      runtimeBinding: "skill_platform",
      readiness: "guarded",
      primaryTools: ["openclaw_clawi_exec", "memory_search", "synthesize"],
      fallbackTools: ["web_search"],
      requiredScopes: ["files"],
      routingStrategy: "Usa la skill como politica de ejecucion y combina herramientas segun contexto.",
      routingNotes: [
        "Las skills personalizadas deben comportarse como una politica tactica, no como texto decorativo.",
        "Si no existe herramienta exacta, usa la skill para sesgar plan, herramientas y salida.",
      ],
    },
  },
};

const DOMAIN_RULES: DomainRule[] = [
  {
    pattern: /(1password|healthcheck|nmap|wireshark|burpsuite|audit|vuln|security)/i,
    badgeLabel: "SecOps",
    domainKey: "security",
    domainLabel: "Seguridad, auditoria y control ofensivo",
    modeLabel: "Inspeccion, endurecimiento y validacion",
    inputSurface: "hosts, secretos, endpoints, superficies de ataque o politicas",
    outputSurface: "hallazgos, controles aplicados o evidencia tecnica",
    requirements: ["Permisos sobre host o red", "Objetivos o credenciales autorizadas"],
    orchestrator: {
      lane: "speed",
      executionMode: "hybrid",
      runtimeBinding: "external_cli",
      readiness: "guarded",
      primaryTools: ["openclaw_clawi_exec", "fetch_url"],
      fallbackTools: ["web_search", "synthesize"],
      requiredScopes: ["system", "external_network"],
      routingStrategy: "Ejecuta comprobaciones controladas, captura evidencia y resume riesgos con claridad.",
      routingNotes: [
        "No sintetices sin evidencia tecnica previa.",
        "Las skills ofensivas deben quedar en modo guarded hasta confirmacion de permisos.",
      ],
    },
  },
  {
    pattern: /(aws|docker|kubernetes|terraform|ansible|puppet|chef|postgres|redis|mongo|firebase|supabase|elastic|kafka|rabbitmq|grafana|prometheus|splunk|newrelic|datadog|nagios|sentry)/i,
    badgeLabel: "InfraOps",
    domainKey: "infrastructure",
    domainLabel: "Infraestructura, cloud y plataforma",
    modeLabel: "Operacion de plataforma y fiabilidad",
    inputSurface: "clusters, recursos cloud, servicios, colas, logs o metricas",
    outputSurface: "cambios de plataforma, diagnosticos o remediaciones operativas",
    requirements: ["Credenciales o permisos de plataforma", "Conectividad al entorno objetivo"],
    orchestrator: {
      lane: "speed",
      executionMode: "hybrid",
      runtimeBinding: "external_cli",
      readiness: "setup_required",
      primaryTools: ["openclaw_clawi_exec", "analyze_data"],
      fallbackTools: ["web_search", "synthesize"],
      requiredScopes: ["external_network", "system"],
      routingStrategy: "Primero inspecciona el estado, luego ejecuta cambios seguros y finalmente valida impacto.",
      routingNotes: [
        "La skill debe sesgar al orquestador hacia diagnostico operativo antes de remediacion.",
        "Escala a subagentes cuando el objetivo abarque multiples sistemas o entornos.",
      ],
    },
  },
  {
    pattern: /(github|gitlab|gh-issues|git-local|coding-agent|vercel|figma|tmux)/i,
    badgeLabel: "EngOps",
    domainKey: "engineering",
    domainLabel: "Ingenieria, codigo y delivery",
    modeLabel: "Operacion de codigo, versionado y entrega",
    inputSurface: "repositorios, ramas, tickets, archivos o pipelines",
    outputSurface: "cambios listos, PRs, despliegues o diagnosticos tecnicos",
    requirements: ["Acceso al repositorio o workspace", "Contexto de rama, ticket o build"],
    orchestrator: {
      lane: "speed",
      executionMode: "hybrid",
      runtimeBinding: "external_cli",
      readiness: "guarded",
      primaryTools: ["generate_code", "shell_exec", "write_multiple_files", "openclaw_clawi_exec"],
      fallbackTools: ["read_file", "list_files", "synthesize"],
      requiredScopes: ["files", "system"],
      routingStrategy: "Materializa cambios en archivos o pipelines antes del resumen final.",
      routingNotes: [
        "Para objetivos de ingenieria evita respuestas solo conversacionales.",
        "Usa shell y generacion de codigo cuando el objetivo implique cambios reales.",
      ],
    },
  },
  {
    pattern: /(slack|discord|whatsapp|wacli|twilio|sendgrid|gmail|himalaya|imsg|bluebubbles|zoom|google-meet|meet|teams|webex|calendly)/i,
    badgeLabel: "CommOps",
    domainKey: "communication",
    domainLabel: "Comunicacion y canales",
    modeLabel: "Lectura, envio y sincronizacion multicanal",
    inputSurface: "mensajes, correos, canales, contactos o eventos",
    outputSurface: "mensajes enviados, historiales, respuestas o sincronizaciones",
    requirements: ["Credenciales del canal", "Conectividad de red y permisos del servicio"],
    orchestrator: {
      lane: "speed",
      executionMode: "tool",
      runtimeBinding: "openclaw_runtime",
      readiness: "setup_required",
      primaryTools: ["openclaw_clawi_exec", "browse_and_act"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["external_network", "email"],
      routingStrategy: "Prioriza acceso nativo o automatizado al canal y deja constancia del resultado.",
      routingNotes: [
        "La skill debe forzar confirmacion del canal y del destinatario antes del envio.",
        "Usa browse_and_act solo como fallback cuando la integracion no exponga CLI o API.",
      ],
    },
  },
  {
    pattern: /(hubspot|salesforce|zendesk|intercom|mailchimp|stripe|pagerduty)/i,
    badgeLabel: "BizOps",
    domainKey: "business",
    domainLabel: "Negocio, soporte y operacion comercial",
    modeLabel: "Gestion transaccional y CRM",
    inputSurface: "leads, tickets, cuentas, clientes, pagos o incidentes",
    outputSurface: "registros actualizados, respuestas, escalaciones o eventos de negocio",
    requirements: ["Acceso al sistema de negocio", "Identificadores o registros operativos"],
    orchestrator: {
      lane: "speed",
      executionMode: "hybrid",
      runtimeBinding: "openclaw_runtime",
      readiness: "setup_required",
      primaryTools: ["openclaw_clawi_exec", "analyze_data"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["external_network"],
      routingStrategy: "Consulta primero el estado del negocio y luego aplica cambios trazables.",
      routingNotes: [
        "El resumen final debe dejar claro impacto comercial, ticketing o cobro afectado.",
      ],
    },
  },
  {
    pattern: /(spreadsheet|xlsx|excel|docx|word|pptx|powerpoint|pdf|notion|obsidian|apple-notes|bear-notes|nano-pdf|generate_document|typeform|survey|things-mac|apple-reminders)/i,
    badgeLabel: "DocOps",
    domainKey: "document",
    domainLabel: "Documentos y conocimiento",
    modeLabel: "Transformacion, lectura y entrega documental",
    inputSurface: "archivos, notas, formularios, plantillas o instrucciones",
    outputSurface: "documentos, extractos, resenas o artefactos listos para uso",
    requirements: ["Acceso al contenido fuente", "Destino o formato definido"],
    orchestrator: {
      lane: "speed",
      executionMode: "tool",
      runtimeBinding: "local_catalog",
      readiness: "ready",
      primaryTools: ["read_file", "create_document", "create_spreadsheet"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["files"],
      routingStrategy: "Empieza leyendo o generando artefactos concretos y usa sintesis solo para cierre.",
      routingNotes: [
        "Las skills documentales deben producir un entregable o extracto verificable.",
      ],
    },
  },
  {
    pattern: /(weather|model-usage|analytics|mixpanel|amplitude|goplaces|blogwatcher|query|search|analyze_spreadsheet|memory_search|formula|database)/i,
    badgeLabel: "DataOps",
    domainKey: "data",
    domainLabel: "Datos, busqueda e inteligencia",
    modeLabel: "Consulta, correlacion y analisis accionable",
    inputSurface: "consultas, indices, datasets, señales o contexto semantico",
    outputSurface: "insights, series, resultados estructurados o resenas accionables",
    requirements: ["Fuente de datos accesible", "Criterios de consulta definidos"],
    orchestrator: {
      lane: "research",
      executionMode: "tool",
      runtimeBinding: "local_catalog",
      readiness: "ready",
      primaryTools: ["analyze_data", "web_search", "memory_search", "generate_chart"],
      fallbackTools: ["fetch_url", "synthesize"],
      requiredScopes: ["files"],
      routingStrategy: "Recupera datos, ejecuta analisis y sintetiza hallazgos con trazabilidad.",
      routingNotes: [
        "Cuando exista un indice o fuente concreta, el planner debe preferirla a respuestas genericas.",
      ],
    },
  },
  {
    pattern: /(nano-banana|openai-image|openai-whisper|sherpa|songsee|video-frames|voice-call|camsnap|sonos|spotify|openhue|blucli|eightctl|peekaboo)/i,
    badgeLabel: "MediaOps",
    domainKey: "media",
    domainLabel: "Media, voz y dispositivos",
    modeLabel: "Captura, sintesis y control de experiencias",
    inputSurface: "prompts, streams, dispositivos, audio, video o sesiones activas",
    outputSurface: "medios generados, capturas, transcripciones o control aplicado",
    requirements: ["Motor multimedia o dispositivo disponible", "Permisos sobre audio, video o control remoto"],
    orchestrator: {
      lane: "speed",
      executionMode: "hybrid",
      runtimeBinding: "external_cli",
      readiness: "setup_required",
      primaryTools: ["openclaw_clawi_exec", "browse_and_act"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["external_network", "system"],
      routingStrategy: "Ejecuta captura o control especializado y devuelve evidencia de salida.",
      routingNotes: [
        "La skill debe producir artefacto, transcripcion o estado de dispositivo verificable.",
      ],
    },
  },
  {
    pattern: /(spawn_subagent|clawhub|mcporter|skill-creator|browse_url|generate_image|oracle|gog|gemini|browser|browse|openclaw)/i,
    badgeLabel: "AgentOps",
    domainKey: "automation",
    domainLabel: "Orquestacion agentica y runtime",
    modeLabel: "Delegacion, ejecucion especializada y composicion",
    inputSurface: "objetivos, prompts, URLs, herramientas o contexto operativo",
    outputSurface: "acciones encadenadas, artefactos o respuestas especializadas",
    requirements: ["Runtime compatible", "Contexto suficiente para operar con seguridad"],
    orchestrator: {
      lane: "brain",
      executionMode: "hybrid",
      runtimeBinding: "delegated_agent",
      readiness: "guarded",
      primaryTools: ["openclaw_spawn_subagent", "openclaw_clawi_exec", "browse_and_act"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["browser", "external_network"],
      routingStrategy: "Cuando la skill sea agentica, el plan debe delegar y componer, no resolver todo en un solo paso.",
      routingNotes: [
        "Usa subagentes para objetivos largos o multi-sistema.",
      ],
    },
  },
];

const EXACT_ROUTING_OVERRIDES: ExactRoutingOverride[] = [
  {
    ids: ["xlsx", "excel", "analyze_spreadsheet", "spreadsheet analyzer"],
    tools: ["create_spreadsheet", "analyze_data", "generate_chart"],
    fallbackTools: ["read_file", "synthesize"],
    lane: "speed",
    executionMode: "tool",
    readiness: "ready",
    requiredScopes: ["files"],
    routingStrategy: "Usa hojas de calculo y analisis tabular como backend principal.",
  },
  {
    ids: ["docx", "word", "generate_document", "office document generator"],
    tools: ["create_document", "read_file"],
    fallbackTools: ["synthesize"],
    lane: "speed",
    executionMode: "tool",
    readiness: "ready",
    requiredScopes: ["files"],
  },
  {
    ids: ["pptx", "powerpoint"],
    tools: ["create_presentation"],
    fallbackTools: ["create_document", "synthesize"],
    lane: "speed",
    executionMode: "tool",
    readiness: "ready",
    requiredScopes: ["files"],
  },
  {
    ids: ["pdf", "nano-pdf"],
    tools: ["read_file", "create_document"],
    fallbackTools: ["synthesize"],
    lane: "speed",
    executionMode: "tool",
    readiness: "ready",
    requiredScopes: ["files"],
  },
  {
    ids: ["data-analysis", "analisis de datos", "analyze_data"],
    tools: ["analyze_data", "generate_chart"],
    fallbackTools: ["memory_search", "synthesize"],
    lane: "research",
    executionMode: "tool",
    readiness: "ready",
    requiredScopes: ["files"],
  },
  {
    ids: ["formulas", "motor de fórmulas", "motor de formulas"],
    tools: ["analyze_data"],
    fallbackTools: ["synthesize"],
    lane: "research",
    executionMode: "tool",
    readiness: "ready",
  },
  {
    ids: ["web-search", "web_search", "búsqueda web", "busqueda web", "web & academic search"],
    tools: ["web_search", "fetch_url", "memory_search"],
    fallbackTools: ["synthesize"],
    lane: "research",
    executionMode: "tool",
    readiness: "ready",
    requiredScopes: ["external_network"],
  },
  {
    ids: ["gmail"],
    tools: ["openclaw_clawi_exec", "browse_and_act"],
    fallbackTools: ["synthesize"],
    lane: "speed",
    executionMode: "tool",
    readiness: "setup_required",
    requiredScopes: ["email", "external_network"],
  },
  {
    ids: ["whatsapp", "wacli"],
    tools: ["openclaw_clawi_exec", "browse_and_act"],
    fallbackTools: ["synthesize"],
    lane: "speed",
    executionMode: "tool",
    readiness: "setup_required",
    requiredScopes: ["external_network"],
  },
  {
    ids: ["automation", "spawn_subagent", "nested subagents (clawi integration)"],
    tools: ["openclaw_spawn_subagent", "openclaw_subagent_list", "openclaw_subagent_status"],
    fallbackTools: ["openclaw_clawi_exec", "synthesize"],
    lane: "brain",
    executionMode: "hybrid",
    runtimeBinding: "delegated_agent",
    readiness: "guarded",
    requiredScopes: ["external_network", "system"],
  },
  {
    ids: ["code-execution", "coding-agent"],
    tools: ["generate_code", "shell_exec", "write_multiple_files"],
    fallbackTools: ["read_file", "synthesize"],
    lane: "speed",
    executionMode: "hybrid",
    runtimeBinding: "external_cli",
    readiness: "guarded",
    requiredScopes: ["files", "system"],
  },
  {
    ids: ["database", "postgres-ops", "mongo-cloud", "supabase-ops", "redis-cli"],
    tools: ["openclaw_clawi_exec", "analyze_data"],
    fallbackTools: ["synthesize"],
    lane: "research",
    executionMode: "hybrid",
    readiness: "setup_required",
    requiredScopes: ["database", "external_network"],
  },
  {
    ids: ["memory_search", "semantic memory (rag)", "openclaw_rag_search"],
    tools: ["memory_search", "openclaw_rag_search"],
    fallbackTools: ["synthesize"],
    lane: "research",
    executionMode: "tool",
    runtimeBinding: "skill_platform",
    readiness: "ready",
  },
  {
    ids: ["browse_url", "headless browser"],
    tools: ["browse_and_act", "fetch_url"],
    fallbackTools: ["web_search", "synthesize"],
    lane: "speed",
    executionMode: "tool",
    runtimeBinding: "openclaw_runtime",
    readiness: "ready",
    requiredScopes: ["browser", "external_network"],
  },
];

function toAsciiLower(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of items) {
    const value = raw.trim();
    if (!value) continue;
    const key = toAsciiLower(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function dedupeScopes(items: SkillScopeHint[]): SkillScopeHint[] {
  const seen = new Set<SkillScopeHint>();
  const out: SkillScopeHint[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function summarizeAbilities(abilities: string[]): string {
  const top = abilities.slice(0, 3);
  if (top.length === 0) return "ejecucion operativa especializada";
  if (top.length === 1) return top[0].toLowerCase();
  if (top.length === 2) return `${top[0].toLowerCase()} y ${top[1].toLowerCase()}`;
  return `${top[0].toLowerCase()}, ${top[1].toLowerCase()} y ${top[2].toLowerCase()}`;
}

function buildExecutionPhases(
  phases: [string, string, string],
  domainLabel: string,
  inputSurface: string,
  outputSurface: string,
): SkillOperationalPhase[] {
  const [phase1, phase2, phase3] = phases;
  return [
    {
      title: phase1,
      description: `Toma ${inputSurface} y valida el contexto operativo antes de mover el orquestador.`,
    },
    {
      title: phase2,
      description: `Ejecuta la tarea en el dominio de ${domainLabel.toLowerCase()} con trazabilidad y herramientas concretas.`,
    },
    {
      title: phase3,
      description: `Entrega ${outputSurface} listo para consumo, seguimiento o accion inmediata.`,
    },
  ];
}

function normalizeSkillTokens(skill: SkillOperationalInput): string[] {
  return dedupe([
    skill.id,
    skill.name,
    skill.description,
    ...(skill.features || []),
    ...(skill.triggers || []),
    ...(skill.runtimeTools || []),
  ]);
}

function resolveDomainRule(skill: SkillOperationalInput): DomainRule | null {
  const haystack = normalizeSkillTokens(skill).join(" ");
  return DOMAIN_RULES.find((rule) => rule.pattern.test(haystack)) ?? null;
}

function resolveExactOverride(skill: SkillOperationalInput): ExactRoutingOverride | null {
  const aliases = [skill.id, skill.name].map((item) => toAsciiLower(item));
  return (
    EXACT_ROUTING_OVERRIDES.find((override) =>
      override.ids.some((id) => aliases.includes(toAsciiLower(id))),
    ) ?? null
  );
}

function resolveAbilities(skill: SkillOperationalInput, meta: CategoryMeta): string[] {
  const candidateAbilities = skill.features?.length
    ? skill.features
    : skill.instructions
      ? skill.instructions
          .split(/[.\n]/)
          .map((part) => part.trim())
          .filter((part) => part.length >= 12)
      : meta.fallbackAbilities;

  return dedupe(candidateAbilities).slice(0, 6);
}

function coerceReadiness(
  skill: SkillOperationalInput,
  defaultReadiness: SkillExecutionReadiness,
): SkillExecutionReadiness {
  if (skill.enabled === false) return "disabled";
  if (!skill.builtIn && skill.category === "custom") return "guarded";
  return defaultReadiness;
}

function readinessLabel(readiness: SkillExecutionReadiness): string {
  switch (readiness) {
    case "ready":
      return "Lista para operar";
    case "guarded":
      return "Opera con guardas";
    case "setup_required":
      return "Requiere setup";
    default:
      return "Desactivada";
  }
}

function laneLabel(lane: SkillOrchestratorLane): string {
  switch (lane) {
    case "brain":
      return "Brain lane";
    case "research":
      return "Research lane";
    default:
      return "Speed lane";
  }
}

function executionModeLabel(mode: SkillOrchestratorExecutionMode): string {
  switch (mode) {
    case "agent":
      return "Delegacion agentica";
    case "hybrid":
      return "Hibrido";
    default:
      return "Tool-first";
  }
}

function runtimeLabel(runtime: SkillRuntimeBinding): string {
  switch (runtime) {
    case "skill_platform":
      return "Skill Platform";
    case "openclaw_runtime":
      return "OpenClaw Runtime";
    case "external_cli":
      return "CLI / Integracion externa";
    case "delegated_agent":
      return "Subagentes / Orquestador";
    default:
      return "Catalogo local";
  }
}

function buildRoutingProfile(
  skill: SkillOperationalInput,
  meta: CategoryMeta,
  domainRule: DomainRule | null,
  exactOverride: ExactRoutingOverride | null,
): SkillOrchestratorProfile {
  const base = domainRule?.orchestrator ?? meta.orchestrator;
  const readiness = coerceReadiness(skill, exactOverride?.readiness ?? base.readiness ?? meta.orchestrator.readiness);
  const primaryTools = dedupe(exactOverride?.tools ?? base.primaryTools ?? meta.orchestrator.primaryTools);
  const fallbackTools = dedupe(exactOverride?.fallbackTools ?? base.fallbackTools ?? meta.orchestrator.fallbackTools);
  const requiredScopes = dedupeScopes([
    ...(exactOverride?.requiredScopes ?? []),
    ...(base.requiredScopes ?? meta.orchestrator.requiredScopes),
  ]);

  return {
    lane: exactOverride?.lane ?? base.lane ?? meta.orchestrator.lane,
    laneLabel: laneLabel(exactOverride?.lane ?? base.lane ?? meta.orchestrator.lane),
    executionMode: exactOverride?.executionMode ?? base.executionMode ?? meta.orchestrator.executionMode,
    executionModeLabel: executionModeLabel(exactOverride?.executionMode ?? base.executionMode ?? meta.orchestrator.executionMode),
    runtimeBinding: exactOverride?.runtimeBinding ?? base.runtimeBinding ?? meta.orchestrator.runtimeBinding,
    runtimeLabel: runtimeLabel(exactOverride?.runtimeBinding ?? base.runtimeBinding ?? meta.orchestrator.runtimeBinding),
    readiness,
    readinessLabel: readinessLabel(readiness),
    primaryTools,
    fallbackTools,
    requiredScopes,
    routingStrategy:
      exactOverride?.routingStrategy ??
      base.routingStrategy ??
      meta.orchestrator.routingStrategy,
    routingNotes: dedupe([
      ...(base.routingNotes ?? meta.orchestrator.routingNotes),
      ...(exactOverride?.routingNotes ?? []),
    ]).slice(0, 4),
  };
}

function tokenScore(goalTokens: string[], skillTokens: string[]): number {
  if (goalTokens.length === 0 || skillTokens.length === 0) return 0;
  let score = 0;
  for (const token of goalTokens) {
    for (const candidate of skillTokens) {
      if (candidate === token) {
        score += 3;
        continue;
      }
      if (candidate.includes(token) || token.includes(candidate)) {
        score += 1;
      }
    }
  }
  return score;
}

function toGoalTokens(goal: string): string[] {
  return dedupe(
    toAsciiLower(goal)
      .split(/[^a-z0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3),
  );
}

function scoreSkillRelevance(goal: string, summary: PlannerSkillSummary): number {
  const goalTokens = toGoalTokens(goal);
  const skillTokens = summary.searchTerms.map((item) => toAsciiLower(item));
  const score = tokenScore(goalTokens, skillTokens);

  if (goalTokens.some((token) => summary.primaryTools.some((tool) => toAsciiLower(tool).includes(token)))) {
    return score + 2;
  }
  return score;
}

export function deriveSkillOperationalProfile(skill: SkillOperationalInput): SkillOperationalProfile {
  const meta = CATEGORY_META[skill.category];
  const domainRule = resolveDomainRule(skill);
  const exactOverride = resolveExactOverride(skill);
  const abilities = resolveAbilities(skill, meta);
  const domainLabel = domainRule?.domainLabel ?? meta.domainLabel;
  const inputSurface = domainRule?.inputSurface ?? meta.inputSurface;
  const outputSurface = domainRule?.outputSurface ?? meta.outputSurface;
  const modeLabel = domainRule?.modeLabel ?? meta.modeLabel;
  const badgeLabel = domainRule?.badgeLabel ?? meta.badgeLabel;
  const requirements = dedupe([...(domainRule?.requirements ?? []), ...meta.requirements]).slice(0, 4);
  const orchestrator = buildRoutingProfile(skill, meta, domainRule, exactOverride);
  const executionPhases = buildExecutionPhases(meta.phases, domainLabel, inputSurface, outputSurface);
  const operatingFunction =
    `Opera como capacidad de ${domainLabel.toLowerCase()}. ` +
    `${modeLabel}. ` +
    `Su nucleo tactico prioriza ${summarizeAbilities(abilities)} y devuelve ${outputSurface}.`;
  const operatorSummary =
    `${orchestrator.laneLabel} en modo ${orchestrator.executionModeLabel.toLowerCase()}. ` +
    `Runtime ${orchestrator.runtimeLabel}. ` +
    `${orchestrator.routingStrategy}`;
  const searchTerms = dedupe([
    skill.id,
    skill.name,
    skill.description,
    badgeLabel,
    domainLabel,
    modeLabel,
    inputSurface,
    outputSurface,
    ...abilities,
    ...orchestrator.primaryTools,
    ...orchestrator.fallbackTools,
    ...orchestrator.requiredScopes,
    ...orchestrator.routingNotes,
    ...(skill.triggers || []),
  ]);

  return {
    badgeLabel,
    domainKey: domainRule?.domainKey ?? meta.domainKey,
    domainLabel,
    modeLabel,
    modeChip: meta.modeChip,
    operatingFunction,
    operatorSummary,
    inputSurface,
    outputSurface,
    requirements,
    abilityHighlights: abilities,
    searchTerms,
    executionPhases,
    orchestrator,
  };
}

export function toPlannerSkillSummary(skill: SkillOperationalInput): PlannerSkillSummary {
  const profile = deriveSkillOperationalProfile(skill);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    badgeLabel: profile.badgeLabel,
    domainLabel: profile.domainLabel,
    lane: profile.orchestrator.lane,
    executionMode: profile.orchestrator.executionMode,
    readiness: profile.orchestrator.readiness,
    primaryTools: profile.orchestrator.primaryTools,
    fallbackTools: profile.orchestrator.fallbackTools,
    requiredScopes: profile.orchestrator.requiredScopes,
    abilities: profile.abilityHighlights,
    searchTerms: profile.searchTerms,
    routingStrategy: profile.orchestrator.routingStrategy,
    routingNotes: profile.orchestrator.routingNotes,
  };
}

export function buildPlannerSkillContext(
  goal: string,
  skills: SkillOperationalInput[],
  options: { activeSkillId?: string | null; limit?: number } = {},
): PlannerSkillContext {
  const summaries = skills.map((skill) => toPlannerSkillSummary(skill));
  const activeSkill = options.activeSkillId
    ? summaries.find((skill) => skill.id === options.activeSkillId) ?? null
    : null;
  const relevantSkills = summaries
    .map((skill) => ({ skill, score: scoreSkillRelevance(goal, skill) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, Math.max(1, options.limit ?? 4))
    .map((item) => item.skill);
  const withActive = activeSkill && !relevantSkills.some((skill) => skill.id === activeSkill.id)
    ? [activeSkill, ...relevantSkills].slice(0, Math.max(1, options.limit ?? 4))
    : relevantSkills;

  const routingNotes = dedupe([
    activeSkill
      ? `La skill activa es ${activeSkill.name}; prioriza ${activeSkill.primaryTools.join(", ")} cuando el objetivo encaje.`
      : "",
    ...withActive.flatMap((skill) => skill.routingNotes),
  ]).slice(0, 6);

  return {
    activeSkill,
    relevantSkills: withActive,
    routingNotes,
  };
}

export function renderPlannerSkillContext(skillContext: PlannerSkillContext | null | undefined): string {
  if (!skillContext) return "";
  const lines: string[] = [];

  if (skillContext.activeSkill) {
    lines.push("ACTIVE_SKILL:");
    lines.push(`- name: ${skillContext.activeSkill.name}`);
    lines.push(`- domain: ${skillContext.activeSkill.domainLabel}`);
    lines.push(`- lane: ${skillContext.activeSkill.lane}`);
    lines.push(`- executionMode: ${skillContext.activeSkill.executionMode}`);
    lines.push(`- readiness: ${skillContext.activeSkill.readiness}`);
    lines.push(`- primaryTools: [${skillContext.activeSkill.primaryTools.join(", ")}]`);
    lines.push(`- fallbackTools: [${skillContext.activeSkill.fallbackTools.join(", ")}]`);
    lines.push(`- abilities: [${skillContext.activeSkill.abilities.join(", ")}]`);
    lines.push(`- routing: ${skillContext.activeSkill.routingStrategy}`);
  }

  if (skillContext.relevantSkills.length > 0) {
    lines.push("RELEVANT_SKILLS:");
    for (const skill of skillContext.relevantSkills) {
      lines.push(
        `- ${skill.name}: lane=${skill.lane}; tools=[${skill.primaryTools.join(", ")}]; readiness=${skill.readiness}; domain=${skill.domainLabel}`,
      );
    }
  }

  if (skillContext.routingNotes.length > 0) {
    lines.push("SKILL_ROUTING_RULES:");
    for (const note of skillContext.routingNotes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}
