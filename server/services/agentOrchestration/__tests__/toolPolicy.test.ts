import { describe, it, expect, beforeEach } from 'vitest';
import {
    evaluateToolPolicy,
    matchesPattern,
    expandGroups,
    ToolPolicyEngine,
} from '../toolPolicy';
import type { ToolPolicy } from '../toolPolicy';

describe('matchesPattern', () => {
    it('exact match', () => {
        expect(matchesPattern('web_search', 'web_search')).toBe(true);
        expect(matchesPattern('web_search', 'web_browse')).toBe(false);
    });

    it('wildcard match', () => {
        expect(matchesPattern('web_search', 'web_*')).toBe(true);
        expect(matchesPattern('web_browse', 'web_*')).toBe(true);
        expect(matchesPattern('code_search', 'web_*')).toBe(false);
    });

    it('double wildcard', () => {
        expect(matchesPattern('anything', '*')).toBe(true);
    });
});

describe('expandGroups', () => {
    it('expands @search-tools group', () => {
        const result = expandGroups(['@search-tools', 'custom_tool']);
        expect(result).toContain('web_search');
        expect(result).toContain('search_semantic');
        expect(result).toContain('memory_retrieve');
        expect(result).toContain('custom_tool');
    });

    it('leaves non-group entries unchanged', () => {
        const result = expandGroups(['tool_a', 'tool_b']);
        expect(result).toEqual(['tool_a', 'tool_b']);
    });

    it('expands multiple groups', () => {
        const result = expandGroups(['@search-tools', '@file-tools']);
        expect(result).toContain('web_search');
        expect(result).toContain('file_write');
    });
});

describe('evaluateToolPolicy', () => {
    it('allows tool in allow list', () => {
        const policy: ToolPolicy = { agentId: 'a1', allow: ['web_search', 'code_execute'] };
        const result = evaluateToolPolicy('web_search', policy);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('allowed');
    });

    it('denies tool in deny list', () => {
        const policy: ToolPolicy = { agentId: 'a1', deny: ['web_search'] };
        const result = evaluateToolPolicy('web_search', policy);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('denied_by_policy');
    });

    it('deny takes precedence over allow', () => {
        const policy: ToolPolicy = { agentId: 'a1', allow: ['web_*'], deny: ['web_search'] };
        const result = evaluateToolPolicy('web_search', policy);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('denied_by_policy');
    });

    it('wildcard in allow list', () => {
        const policy: ToolPolicy = { agentId: 'a1', allow: ['web_*'] };
        expect(evaluateToolPolicy('web_search', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('web_browse', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('code_execute', policy).allowed).toBe(false);
    });

    it('owner-only tool blocked for non-owner', () => {
        const policy: ToolPolicy = { agentId: 'a1', ownerOnlyTools: ['delete_user'] };
        const result = evaluateToolPolicy('delete_user', policy, false);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('owner_only');
    });

    it('owner-only tool allowed for owner', () => {
        const policy: ToolPolicy = { agentId: 'a1', ownerOnlyTools: ['delete_user'] };
        const result = evaluateToolPolicy('delete_user', policy, true);
        expect(result.allowed).toBe(true);
    });

    it('empty policy allows everything', () => {
        const policy: ToolPolicy = { agentId: 'a1' };
        expect(evaluateToolPolicy('any_tool', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('another_tool', policy).allowed).toBe(true);
    });

    it('tool not in allow list is denied', () => {
        const policy: ToolPolicy = { agentId: 'a1', allow: ['web_search'] };
        const result = evaluateToolPolicy('code_execute', policy);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('not_in_allowlist');
    });

    it('group expansion in policy', () => {
        const policy: ToolPolicy = { agentId: 'a1', allow: ['@search-tools'] };
        expect(evaluateToolPolicy('web_search', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('search_semantic', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('file_write', policy).allowed).toBe(false);
    });
});

describe('ToolPolicyEngine', () => {
    let engine: ToolPolicyEngine;

    beforeEach(() => {
        engine = new ToolPolicyEngine();
    });

    it('sets and retrieves policy', () => {
        const policy: ToolPolicy = { agentId: 'a1', allow: ['web_*'] };
        engine.setPolicy('a1', policy);
        expect(engine.getPolicy('a1')).toEqual(policy);
    });

    it('check delegates to evaluateToolPolicy', () => {
        engine.setPolicy('a1', { agentId: 'a1', deny: ['dangerous_tool'] });
        const result = engine.check('a1', 'dangerous_tool', false);
        expect(result.allowed).toBe(false);
    });

    it('check allows everything for unknown agent', () => {
        const result = engine.check('unknown', 'any_tool', false);
        expect(result.allowed).toBe(true);
    });

    it('removePolicy clears agent policy', () => {
        engine.setPolicy('a1', { agentId: 'a1', deny: ['x'] });
        engine.removePolicy('a1');
        expect(engine.getPolicy('a1')).toBeUndefined();
    });
});
