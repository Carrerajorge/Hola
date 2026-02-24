import type { ToolProfileId } from '../types';

interface ToolProfile {
  allow?: string[];
  deny?: string[];
}

const PROFILES: Record<ToolProfileId, ToolProfile> = {
  minimal: {
    allow: ['session_status', 'list_skills', 'memory_search'],
  },
  coding: {
    allow: [
      'session_status', 'list_skills', 'memory_search',
      'read_file', 'write_file', 'list_files', 'exec_command',
      'search_code', 'git_status', 'git_diff', 'git_commit',
    ],
  },
  messaging: {
    allow: [
      'session_status', 'list_skills', 'memory_search',
      'send_message', 'list_sessions', 'search_messages',
    ],
  },
  full: {
    // No restrictions
  },
};

export function getToolProfile(id: ToolProfileId): ToolProfile {
  return { ...PROFILES[id] };
}

export function listProfiles(): { id: ToolProfileId; description: string }[] {
  return [
    { id: 'minimal', description: 'Session status and read-only operations' },
    { id: 'coding', description: 'File read/write, exec, git operations' },
    { id: 'messaging', description: 'Message sending and session management' },
    { id: 'full', description: 'No restrictions — all tools allowed' },
  ];
}
