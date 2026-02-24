// server/openclaw/skills/workspace.ts
import * as fs from 'fs';
import * as path from 'path';
import type { EnhancedSkill, SkillFrontmatter } from '../types';
import { parseFrontmatter } from './frontmatter';
import { checkSkillEligibility } from './eligibility';

export async function loadWorkspaceSkills(directory: string): Promise<EnhancedSkill[]> {
  const skills: EnhancedSkill[] = [];

  // Check if directory exists
  try {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) return skills;
  } catch {
    return skills;
  }

  // Read .md files
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(directory, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { attributes, body } = parseFrontmatter(content);
      const frontmatter = attributes as SkillFrontmatter;
      const id = path.basename(file, '.md');

      const eligibility = checkSkillEligibility({
        os: frontmatter.os,
      });

      skills.push({
        id,
        name: frontmatter.name || id,
        description: frontmatter.description || '',
        prompt: body,
        tools: [],
        source: 'workspace',
        frontmatter,
        eligible: eligibility.eligible,
        filePath,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  return skills;
}
