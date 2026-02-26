import { describe, it, expect } from 'vitest';
import {
    shouldIncludeSkill,
    buildSkillSnapshot,
} from '../skillDiscovery';
import type { SkillEntry, SkillEligibilityContext } from '../skillDiscovery';

function makeSkill(overrides: Partial<SkillEntry> = {}): SkillEntry {
    return {
        id: `skill-${Math.random().toString(36).slice(2, 8)}`,
        name: 'test-skill',
        description: 'A test skill',
        source: 'bundled',
        enabled: true,
        ...overrides,
    };
}

function makeEligibility(overrides: Partial<SkillEligibilityContext> = {}): SkillEligibilityContext {
    return {
        platform: 'darwin',
        availableBins: new Set(['git', 'node', 'npm']),
        availableEnvVars: new Set(['HOME', 'PATH', 'OPENAI_API_KEY']),
        ...overrides,
    };
}

describe('shouldIncludeSkill', () => {
    it('includes enabled skill with no requirements', () => {
        expect(shouldIncludeSkill(makeSkill(), makeEligibility())).toBe(true);
    });

    it('excludes disabled skill', () => {
        expect(shouldIncludeSkill(makeSkill({ enabled: false }), makeEligibility())).toBe(false);
    });

    it('excludes skill with missing required binary', () => {
        const skill = makeSkill({ requires: { bins: ['docker'] } });
        expect(shouldIncludeSkill(skill, makeEligibility())).toBe(false);
    });

    it('includes skill when required binary is available', () => {
        const skill = makeSkill({ requires: { bins: ['git'] } });
        expect(shouldIncludeSkill(skill, makeEligibility())).toBe(true);
    });

    it('excludes skill with missing required env var', () => {
        const skill = makeSkill({ requires: { env: ['ANTHROPIC_API_KEY'] } });
        expect(shouldIncludeSkill(skill, makeEligibility())).toBe(false);
    });

    it('includes skill when required env var is available', () => {
        const skill = makeSkill({ requires: { env: ['OPENAI_API_KEY'] } });
        expect(shouldIncludeSkill(skill, makeEligibility())).toBe(true);
    });

    it('requires ALL bins to be present', () => {
        const skill = makeSkill({ requires: { bins: ['git', 'docker'] } });
        expect(shouldIncludeSkill(skill, makeEligibility())).toBe(false);
    });

    it('requires ALL env vars to be present', () => {
        const skill = makeSkill({ requires: { env: ['HOME', 'MISSING'] } });
        expect(shouldIncludeSkill(skill, makeEligibility())).toBe(false);
    });
});

describe('buildSkillSnapshot', () => {
    it('filters out ineligible skills', () => {
        const skills = [
            makeSkill({ name: 'a', enabled: true }),
            makeSkill({ name: 'b', enabled: false }),
            makeSkill({ name: 'c', requires: { bins: ['docker'] } }),
        ];
        const snapshot = buildSkillSnapshot(skills, makeEligibility());
        expect(snapshot.skills).toHaveLength(1);
        expect(snapshot.skills[0].name).toBe('a');
        expect(snapshot.filteredCount).toBe(2);
    });

    it('deduplicates by name (later source wins)', () => {
        const skills = [
            makeSkill({ id: '1', name: 'search', source: 'bundled', description: 'v1' }),
            makeSkill({ id: '2', name: 'search', source: 'custom', description: 'v2' }),
        ];
        const snapshot = buildSkillSnapshot(skills, makeEligibility());
        expect(snapshot.skills).toHaveLength(1);
        expect(snapshot.skills[0].description).toBe('v2');
    });

    it('respects max skills limit (150)', () => {
        const skills = Array.from({ length: 200 }, (_, i) =>
            makeSkill({ name: `skill-${i}` }),
        );
        const snapshot = buildSkillSnapshot(skills, makeEligibility());
        expect(snapshot.skills.length).toBeLessThanOrEqual(150);
    });

    it('respects max prompt chars limit (30KB)', () => {
        const skills = Array.from({ length: 100 }, (_, i) =>
            makeSkill({ name: `skill-${i}`, description: 'x'.repeat(500) }),
        );
        const snapshot = buildSkillSnapshot(skills, makeEligibility());
        expect(snapshot.totalChars).toBeLessThanOrEqual(30_000);
    });

    it('returns formatted prompt string', () => {
        const skills = [makeSkill({ name: 'web_search', description: 'Search the web' })];
        const snapshot = buildSkillSnapshot(skills, makeEligibility());
        expect(snapshot.prompt).toContain('web_search');
        expect(snapshot.prompt).toContain('Search the web');
    });

    it('applies filter to only include specified skills', () => {
        const skills = [
            makeSkill({ name: 'search' }),
            makeSkill({ name: 'browse' }),
            makeSkill({ name: 'execute' }),
        ];
        const snapshot = buildSkillSnapshot(skills, makeEligibility(), ['search', 'execute']);
        expect(snapshot.skills).toHaveLength(2);
        expect(snapshot.skills.map(s => s.name)).toEqual(['search', 'execute']);
    });
});
