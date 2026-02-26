/**
 * Auth Profile tools — manage and inspect multi-credential rotation.
 * Registers 2 new tools for the auth profiles system.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../../agent/toolRegistry';

export function createAuthProfileTools(): ToolDefinition[] {
  return [
    {
      name: 'openclaw_auth_profiles_list',
      description:
        'List all auth profiles for a provider, showing rotation status, cooldown state, ' +
        'and usage statistics. Useful for debugging API key rotation issues.',
      inputSchema: z.object({
        provider: z.string().min(1).describe('AI provider name (e.g. openai, xai, google, anthropic)'),
      }),
      execute: async (params: any) => {
        const { getAuthProfileService } = await import('../authProfiles/index');
        const service = getAuthProfileService();
        const profiles = await service.listProfiles(params.provider);

        return {
          provider: params.provider,
          profileCount: profiles.length,
          profiles,
        };
      },
    },
    {
      name: 'openclaw_auth_profiles_status',
      description:
        'Get overall status of auth profiles across all providers — total counts, ' +
        'available vs in-cooldown, and soonest cooldown expiry.',
      inputSchema: z.object({}),
      execute: async () => {
        const { getAuthProfileService } = await import('../authProfiles/index');
        const service = getAuthProfileService();
        return service.getStatus();
      },
    },
  ];
}
