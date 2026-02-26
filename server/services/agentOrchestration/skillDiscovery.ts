/**
 * Unified Skill Discovery
 *
 * Discovers and registers skills from multiple sources with eligibility
 * checking. Ported from OpenClaw's skills/workspace.ts and skills/config.ts,
 * adapted for ILIAGPT's CustomSkills DB.
 */

export interface SkillEntry {
    id: string;
    name: string;
    description: string;
    source: 'bundled' | 'workspace' | 'custom';
    enabled: boolean;
    requires?: {
        bins?: string[];
        env?: string[];
        apis?: string[];
    };
    parameters?: Array<{ name: string; type: string; description: string; required: boolean }>;
    actions?: Array<{ id: string; type: string; name: string; config: Record<string, unknown> }>;
}

export interface SkillEligibilityContext {
    platform: string;
    availableBins: Set<string>;
    availableEnvVars: Set<string>;
}

export interface SkillSnapshot {
    skills: SkillEntry[];
    prompt: string;
    totalChars: number;
    filteredCount: number;
}

const MAX_SKILLS_IN_PROMPT = 150;
const MAX_SKILLS_PROMPT_CHARS = 30_000;

/**
 * Check if a skill should be included based on eligibility.
 * Ported from OpenClaw's shouldIncludeSkill().
 */
export function shouldIncludeSkill(
    entry: SkillEntry,
    eligibility: SkillEligibilityContext,
): boolean {
    if (!entry.enabled) return false;

    if (entry.requires?.bins) {
        if (!entry.requires.bins.every(b => eligibility.availableBins.has(b))) return false;
    }

    if (entry.requires?.env) {
        if (!entry.requires.env.every(e => eligibility.availableEnvVars.has(e))) return false;
    }

    return true;
}

/**
 * Build a SkillSnapshot with eligibility filtering, deduplication, and limits.
 */
export function buildSkillSnapshot(
    skills: SkillEntry[],
    eligibility: SkillEligibilityContext,
    filter?: string[],
): SkillSnapshot {
    // 1. Filter by eligibility
    const eligible = skills.filter(s => shouldIncludeSkill(s, eligibility));
    const filteredCount = skills.length - eligible.length;

    // 2. Deduplicate by name (later source wins, so iterate in order)
    const byName = new Map<string, SkillEntry>();
    for (const skill of eligible) {
        byName.set(skill.name, skill);
    }
    let deduped = [...byName.values()];

    // 3. Apply name filter if provided
    if (filter) {
        const filterSet = new Set(filter);
        deduped = deduped.filter(s => filterSet.has(s.name));
    }

    // 4. Enforce max skills limit
    const limited = deduped.slice(0, MAX_SKILLS_IN_PROMPT);

    // 5. Build prompt, enforcing char limit
    let prompt = '';
    const included: SkillEntry[] = [];
    for (const skill of limited) {
        const entry = `- **${skill.name}**: ${skill.description}\n`;
        if (prompt.length + entry.length > MAX_SKILLS_PROMPT_CHARS) break;
        prompt += entry;
        included.push(skill);
    }

    return {
        skills: included,
        prompt,
        totalChars: prompt.length,
        filteredCount: filteredCount + (skills.length - filteredCount - included.length),
    };
}

export class SkillDiscovery {
    /**
     * Load skills from a bundled directory (reads .json files).
     * For now returns empty — will be populated when bundled skills exist.
     */
    loadBundledSkills(_directory: string): SkillEntry[] {
        return [];
    }

    /**
     * Load custom skills from DB. Stub for now — integration will map
     * CustomSkill records to SkillEntry format.
     */
    async loadCustomSkills(_userId: string): Promise<SkillEntry[]> {
        return [];
    }

    /**
     * Merge all skill sources. Later sources override earlier on name collision.
     */
    async discoverAll(userId: string, bundledDir?: string): Promise<SkillEntry[]> {
        const bundled = this.loadBundledSkills(bundledDir ?? 'server/skills');
        const custom = await this.loadCustomSkills(userId);
        return [...bundled, ...custom];
    }

    /**
     * Build snapshot with eligibility filtering.
     */
    async buildSnapshot(
        userId: string,
        eligibility: SkillEligibilityContext,
    ): Promise<SkillSnapshot> {
        const all = await this.discoverAll(userId);
        return buildSkillSnapshot(all, eligibility);
    }
}

export const skillDiscovery = new SkillDiscovery();
