/**
 * OpenClaw Tool Profiles
 *
 * Adapted from upstream openclaw tool-catalog.ts and pi-tools.ts.
 * Controls which tools are available to an agent based on its "profile".
 *
 * Profiles:
 *   minimal   — status only (safe for untrusted/sandboxed agents)
 *   coding    — file ops, exec, memory, search
 *   messaging — sessions, message routing, communication
 *   full      — everything available
 *
 * Tool groups allow glob-style inclusion/exclusion.
 */

export type ToolProfile = 'minimal' | 'coding' | 'messaging' | 'full';

export interface ToolCatalogEntry {
  id: string;
  label: string;
  description: string;
  section: ToolSection;
  profiles: ToolProfile[];
}

export type ToolSection =
  | 'subagents'
  | 'rag'
  | 'execution'
  | 'memory'
  | 'sessions'
  | 'scheduling'
  | 'messaging'
  | 'documents'
  | 'browser'
  | 'status';

// ── Core Tool Catalog ────────────────────────────────────────────────────

const CATALOG: ToolCatalogEntry[] = [
  // Status (minimal+)
  {
    id: 'openclaw_subagent_status',
    label: 'Subagent Status',
    description: 'Check status of a subagent run',
    section: 'status',
    profiles: ['minimal', 'coding', 'messaging', 'full'],
  },
  {
    id: 'openclaw_subagent_list',
    label: 'List Subagents',
    description: 'List subagent runs',
    section: 'status',
    profiles: ['minimal', 'coding', 'messaging', 'full'],
  },

  // RAG (coding+)
  {
    id: 'openclaw_rag_search',
    label: 'RAG Search',
    description: 'Search user memory via RAG',
    section: 'rag',
    profiles: ['coding', 'messaging', 'full'],
  },
  {
    id: 'openclaw_rag_context',
    label: 'RAG Context',
    description: 'Build contextual memory block',
    section: 'rag',
    profiles: ['coding', 'messaging', 'full'],
  },

  // Subagent management (coding+)
  {
    id: 'openclaw_spawn_subagent',
    label: 'Spawn Subagent',
    description: 'Spawn a new subagent for parallel work',
    section: 'subagents',
    profiles: ['coding', 'full'],
  },
  {
    id: 'openclaw_subagent_cancel',
    label: 'Cancel Subagent',
    description: 'Cancel a running subagent',
    section: 'subagents',
    profiles: ['coding', 'full'],
  },
  {
    id: 'openclaw_await_subagents',
    label: 'Await Subagents',
    description: 'Wait for child subagents to complete',
    section: 'subagents',
    profiles: ['coding', 'full'],
  },

  // Memory (coding+)
  {
    id: 'openclaw_memory',
    label: 'Memory',
    description: 'Persistent agent memory (save/search/retrieve)',
    section: 'memory',
    profiles: ['coding', 'messaging', 'full'],
  },

  // Scheduling (coding+)
  {
    id: 'openclaw_cron',
    label: 'Cron/Scheduler',
    description: 'Schedule reminders and recurring tasks',
    section: 'scheduling',
    profiles: ['coding', 'messaging', 'full'],
  },

  // Sessions (messaging+)
  {
    id: 'openclaw_sessions_list',
    label: 'List Sessions',
    description: 'List active agent sessions',
    section: 'sessions',
    profiles: ['messaging', 'full'],
  },
  {
    id: 'openclaw_sessions_spawn',
    label: 'Spawn Session',
    description: 'Create a new isolated agent session',
    section: 'sessions',
    profiles: ['messaging', 'full'],
  },
  {
    id: 'openclaw_sessions_send',
    label: 'Send to Session',
    description: 'Send a message to another session',
    section: 'sessions',
    profiles: ['messaging', 'full'],
  },
  {
    id: 'openclaw_sessions_history',
    label: 'Session History',
    description: 'Get conversation history from a session',
    section: 'sessions',
    profiles: ['messaging', 'full'],
  },

  // Message routing (messaging+)
  {
    id: 'openclaw_message_route',
    label: 'Message Route',
    description: 'Route messages across channels',
    section: 'messaging',
    profiles: ['messaging', 'full'],
  },

  // Documents (coding+)
  {
    id: 'openclaw_document_ingest',
    label: 'Document Ingest',
    description: 'Ingest documents into RAG knowledge base',
    section: 'documents',
    profiles: ['coding', 'full'],
  },
  {
    id: 'openclaw_document_batch_ingest',
    label: 'Batch Document Ingest',
    description: 'Batch-ingest multiple documents',
    section: 'documents',
    profiles: ['coding', 'full'],
  },

  // Browser (full only)
  {
    id: 'openclaw_browser_navigate',
    label: 'Browser Navigate',
    description: 'Navigate to a URL and extract content',
    section: 'browser',
    profiles: ['full'],
  },

  // Code execution (coding+)
  {
    id: 'openclaw_code_execute',
    label: 'Code Execute',
    description: 'Execute code in a sandboxed environment',
    section: 'execution',
    profiles: ['coding', 'full'],
  },
];

// ── Profile Resolution ───────────────────────────────────────────────────

export function getToolsForProfile(profile: ToolProfile): ToolCatalogEntry[] {
  return CATALOG.filter(entry => entry.profiles.includes(profile));
}

export function getToolIdsByProfile(profile: ToolProfile): string[] {
  return getToolsForProfile(profile).map(e => e.id);
}

export function isToolAllowedByProfile(toolId: string, profile: ToolProfile): boolean {
  const entry = CATALOG.find(e => e.id === toolId);
  if (!entry) return true; // Unknown tools are allowed (external plugins)
  return entry.profiles.includes(profile);
}

export function getToolCatalog(): ToolCatalogEntry[] {
  return [...CATALOG];
}

export function getToolsBySection(section: ToolSection): ToolCatalogEntry[] {
  return CATALOG.filter(e => e.section === section);
}

export function listSections(): Array<{ section: ToolSection; count: number }> {
  const sections = new Map<ToolSection, number>();
  for (const entry of CATALOG) {
    sections.set(entry.section, (sections.get(entry.section) || 0) + 1);
  }
  return [...sections.entries()].map(([section, count]) => ({ section, count }));
}

// ── Tool Group Resolution ────────────────────────────────────────────────

const TOOL_GROUPS: Record<string, string[]> = {
  'group:subagents': ['openclaw_spawn_subagent', 'openclaw_subagent_status', 'openclaw_subagent_list', 'openclaw_subagent_cancel', 'openclaw_await_subagents'],
  'group:rag': ['openclaw_rag_search', 'openclaw_rag_context'],
  'group:memory': ['openclaw_memory'],
  'group:sessions': ['openclaw_sessions_list', 'openclaw_sessions_spawn', 'openclaw_sessions_send', 'openclaw_sessions_history'],
  'group:documents': ['openclaw_document_ingest', 'openclaw_document_batch_ingest'],
  'group:scheduling': ['openclaw_cron'],
  'group:web': ['openclaw_browser_navigate'],
  'group:messaging': ['openclaw_message_route', ...['openclaw_sessions_list', 'openclaw_sessions_spawn', 'openclaw_sessions_send', 'openclaw_sessions_history']],
  'group:openclaw': CATALOG.map(e => e.id),
};

export function expandToolGroup(groupOrId: string): string[] {
  if (groupOrId.startsWith('group:')) {
    return TOOL_GROUPS[groupOrId] || [];
  }
  return [groupOrId];
}

export function resolveToolPolicy(opts: {
  profile: ToolProfile;
  allow?: string[];
  deny?: string[];
}): string[] {
  let allowed = new Set(getToolIdsByProfile(opts.profile));

  // Expand and add allow list
  if (opts.allow) {
    for (const entry of opts.allow) {
      for (const id of expandToolGroup(entry)) {
        allowed.add(id);
      }
    }
  }

  // Expand and remove deny list
  if (opts.deny) {
    for (const entry of opts.deny) {
      for (const id of expandToolGroup(entry)) {
        allowed.delete(id);
      }
    }
  }

  return [...allowed];
}
